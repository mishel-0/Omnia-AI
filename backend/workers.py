"""Omnia AI — supervised background workers.

Purpose
-------
Several kinds of failure used to be nobody's job: a training run left
"running" because the app was killed mid-epoch, a half-written `.part` file
from an interrupted save, caches growing without bound until the disk filled,
a grading model that failed to load at startup and stayed broken until
someone restarted the app.

Each of those was handled — if at all — at the moment a user happened to
trigger the affected code path, which means the user discovered the problem.
This module gives each one an owner that runs on a schedule, repairs what it
can, and records what it could not.

Design
------
A `Worker` is a named task with an interval. The `Supervisor` runs each in its
own daemon thread, catches everything it throws, applies exponential backoff
after repeated failures, and keeps a status record for every worker so the
application can report its own health instead of appearing fine while a
component is silently dead.

Workers must be idempotent and cheap. They run alongside slide analysis, and
a background task that competes for CPU with a pathologist's analysis is worse
than the problem it solves.
"""
import datetime
import logging
import os
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

logger = logging.getLogger("omnia-pathology")

DATA_DIR = Path(os.environ.get("OMNIA_DATA_DIR", ".")) / "data"

# After this many consecutive failures a worker is reported unhealthy. One
# failure is usually a transient file lock; a run of them is a real fault.
FAILURES_BEFORE_UNHEALTHY = 3
# Backoff is capped so a worker that recovers is not left idle for hours.
MAX_BACKOFF_S = 900.0


@dataclass
class WorkerStatus:
    name: str
    description: str
    interval_s: float
    state: str = "starting"          # starting | idle | running | failing | stopped
    last_run: Optional[str] = None
    last_ok: Optional[str] = None
    last_error: Optional[str] = None
    runs: int = 0
    failures: int = 0
    consecutive_failures: int = 0
    actions: int = 0                 # things this worker actually repaired
    last_action: Optional[str] = None

    @property
    def healthy(self) -> bool:
        return self.consecutive_failures < FAILURES_BEFORE_UNHEALTHY

    def as_dict(self) -> dict:
        return {
            "name": self.name,
            "description": self.description,
            "interval_s": self.interval_s,
            "state": self.state,
            "healthy": self.healthy,
            "last_run": self.last_run,
            "last_ok": self.last_ok,
            "last_error": self.last_error,
            "runs": self.runs,
            "failures": self.failures,
            "consecutive_failures": self.consecutive_failures,
            "actions": self.actions,
            "last_action": self.last_action,
        }


class Worker:
    """One background task.

    Subclasses implement `tick()` and return a short human-readable string
    when they actually did something, or None when there was nothing to do.
    Reporting "nothing to do" separately from "worked" is what makes the
    status page meaningful rather than a row of ever-increasing counters.
    """

    name = "worker"
    description = ""
    interval_s = 300.0
    # Run once shortly after start, before the first full interval elapses.
    run_on_start = True

    def __init__(self):
        self.status = WorkerStatus(self.name, self.description, self.interval_s)

    def tick(self) -> Optional[str]:  # pragma: no cover - overridden
        raise NotImplementedError


class Supervisor:
    """Runs workers, restarts them, and reports their health."""

    def __init__(self):
        self._workers: list[Worker] = []
        self._threads: list[threading.Thread] = []
        self._stop = threading.Event()
        self._lock = threading.Lock()

    def register(self, worker: Worker) -> None:
        with self._lock:
            self._workers.append(worker)

    def start(self) -> None:
        self._stop.clear()
        for worker in self._workers:
            t = threading.Thread(target=self._loop, args=(worker,),
                                 name=f"omnia-{worker.name}", daemon=True)
            t.start()
            self._threads.append(t)
        logger.info("Supervisor started %d background workers: %s",
                    len(self._workers), ", ".join(w.name for w in self._workers))

    def stop(self, timeout: float = 5.0) -> None:
        self._stop.set()
        for t in self._threads:
            t.join(timeout=timeout / max(len(self._threads), 1))
        for w in self._workers:
            w.status.state = "stopped"

    def _loop(self, worker: Worker) -> None:
        backoff = 0.0
        # Stagger the first run so every worker does not wake at once on a
        # machine that is already busy loading the model.
        first_delay = 5.0 if worker.run_on_start else worker.interval_s
        if self._stop.wait(first_delay):
            worker.status.state = "stopped"
            return

        while not self._stop.is_set():
            st = worker.status
            st.state = "running"
            st.last_run = _now()
            st.runs += 1
            try:
                action = worker.tick()
                st.consecutive_failures = 0
                st.last_error = None
                st.last_ok = _now()
                if action:
                    st.actions += 1
                    st.last_action = action
                    logger.info("[%s] %s", worker.name, action)
                st.state = "idle"
                backoff = 0.0
            except Exception as e:
                # A worker must never take the process down, and must never
                # stop running because of one bad cycle.
                st.failures += 1
                st.consecutive_failures += 1
                st.last_error = f"{type(e).__name__}: {e}"
                st.state = "failing"
                logger.warning("[%s] failed (%d consecutive): %s",
                               worker.name, st.consecutive_failures, e)
                backoff = min(MAX_BACKOFF_S,
                              max(worker.interval_s, backoff * 2 or worker.interval_s))

            if self._stop.wait(backoff or worker.interval_s):
                break
        worker.status.state = "stopped"

    def status(self) -> dict:
        workers = [w.status.as_dict() for w in self._workers]
        unhealthy = [w["name"] for w in workers if not w["healthy"]]
        return {
            "healthy": not unhealthy,
            "unhealthy": unhealthy,
            "workers": workers,
        }

    def run_now(self, name: str) -> dict:
        """Run one worker immediately, on the caller's thread.

        Used by the manual "run checks now" action so an operator does not
        have to wait for the next interval to see whether a problem clears.
        """
        for worker in self._workers:
            if worker.name == name:
                st = worker.status
                st.last_run = _now()
                st.runs += 1
                try:
                    action = worker.tick()
                    st.consecutive_failures = 0
                    st.last_error = None
                    st.last_ok = _now()
                    if action:
                        st.actions += 1
                        st.last_action = action
                    st.state = "idle"
                    return {"ok": True, "action": action or "Nothing needed."}
                except Exception as e:
                    st.failures += 1
                    st.consecutive_failures += 1
                    st.last_error = f"{type(e).__name__}: {e}"
                    st.state = "failing"
                    return {"ok": False, "error": st.last_error}
        raise KeyError(name)


def _now() -> str:
    return datetime.datetime.now().isoformat()


# ─── Concrete workers ───

class RunRecoveryWorker(Worker):
    """Repairs training runs left mid-flight by a crash or a forced quit.

    Without this, a run interrupted by the app closing stays "running"
    forever: the training screen shows a progress bar that never moves and
    refuses to start a new run because one is supposedly already active.
    """

    name = "run-recovery"
    description = "Clears training runs interrupted by a restart"
    interval_s = 120.0

    def tick(self) -> Optional[str]:
        from backend import training
        fixed = training.reconcile_interrupted_runs()
        if fixed:
            return f"Marked {fixed} interrupted training run(s) as failed"
        return None


class PartialFileWorker(Worker):
    """Removes leftover `.part` files from interrupted writes.

    Every write-then-rename in the app leaves a `.part` file if the process
    dies between the two steps. They are never read, so they are pure waste,
    but on a slide-sized write that waste is measured in gigabytes.
    """

    name = "partial-files"
    description = "Removes incomplete files left by interrupted saves"
    interval_s = 600.0
    # Old enough that no in-flight write could still own it.
    MIN_AGE_S = 3600.0

    def tick(self) -> Optional[str]:
        if not DATA_DIR.exists():
            return None
        removed = 0
        freed = 0
        cutoff = time.time() - self.MIN_AGE_S
        for path in DATA_DIR.rglob("*.part"):
            try:
                stat = path.stat()
                if stat.st_mtime > cutoff:
                    continue  # a write may still be in progress
                freed += stat.st_size
                path.unlink()
                removed += 1
            except OSError:
                continue
        if removed:
            return f"Removed {removed} incomplete file(s), freeing {freed // (1024*1024)} MB"
        return None


class CacheJanitorWorker(Worker):
    """Keeps derived caches from growing without bound.

    Thumbnails and extracted slide features are both rebuildable, so the only
    cost of deleting them is recomputation. Left alone they grow with every
    slide ever opened, and the first symptom is a full disk during an
    analysis — which fails the analysis, not the cache.
    """

    name = "cache-janitor"
    description = "Keeps rebuildable caches within their size limit"
    interval_s = 1800.0

    LIMITS = {
        "thumb_cache": 512 * 1024 * 1024,     # 512 MB
        "feature_cache": 1024 * 1024 * 1024,  # 1 GB
    }

    def tick(self) -> Optional[str]:
        notes = []
        for folder, limit in self.LIMITS.items():
            path = DATA_DIR / folder
            if not path.is_dir():
                continue
            freed = self._trim(path, limit)
            if freed:
                notes.append(f"{folder}: freed {freed // (1024*1024)} MB")
        return "; ".join(notes) if notes else None

    @staticmethod
    def _trim(path: Path, limit: int) -> int:
        entries = []
        total = 0
        for f in path.rglob("*"):
            if not f.is_file():
                continue
            try:
                st = f.stat()
            except OSError:
                continue
            entries.append((st.st_atime, st.st_size, f))
            total += st.st_size
        if total <= limit:
            return 0
        # Least-recently-used first: the cache entries most likely to be
        # wanted again are the ones touched most recently.
        entries.sort(key=lambda e: e[0])
        freed = 0
        for _atime, size, f in entries:
            if total - freed <= limit:
                break
            try:
                f.unlink()
                freed += size
            except OSError:
                continue
        return freed


class ModelHealthWorker(Worker):
    """Watches the grading model and retries a failed load.

    A model that fails to load at startup previously stayed broken until
    someone restarted the app: every analysis returned the same error and
    nothing ever tried again. Loading is idempotent and cached, so retrying
    costs nothing once it has succeeded.
    """

    name = "model-health"
    description = "Confirms the grading model is loaded and usable"
    interval_s = 300.0

    def __init__(self):
        super().__init__()
        self._was_broken = False

    def tick(self) -> Optional[str]:
        from backend import grading_model

        try:
            grading_model._get_model()
        except Exception:
            self._was_broken = True
            raise  # the supervisor records it and marks this worker unhealthy

        if self._was_broken:
            self._was_broken = False
            return "Grading model recovered and is loadable again"
        return None


class DiskSpaceWorker(Worker):
    """Warns before the disk fills, rather than after an analysis fails.

    Running out of space mid-analysis surfaces as an unhelpful I/O error on
    the pathologist's screen. This notices the approach and asks the cache
    janitor to make room first.
    """

    name = "disk-space"
    description = "Watches free disk space and reclaims cache when it runs low"
    interval_s = 600.0

    LOW_WATERMARK_BYTES = 2 * 1024 * 1024 * 1024  # 2 GB

    def __init__(self, janitor: Optional[CacheJanitorWorker] = None):
        super().__init__()
        self._janitor = janitor

    def tick(self) -> Optional[str]:
        import shutil

        target = DATA_DIR if DATA_DIR.exists() else Path.home()
        free = shutil.disk_usage(target).free
        if free >= self.LOW_WATERMARK_BYTES:
            return None

        note = f"Free disk space low ({free // (1024*1024)} MB)"
        if self._janitor:
            # Drop caches aggressively rather than at their normal limit:
            # rebuildable data is exactly what should go first.
            freed = 0
            for folder in self._janitor.LIMITS:
                path = DATA_DIR / folder
                if path.is_dir():
                    freed += self._janitor._trim(path, 0)
            if freed:
                note += f"; cleared {freed // (1024*1024)} MB of rebuildable cache"
        return note


# ─── Application-wide instance ───

supervisor = Supervisor()


def build_default_workers() -> Supervisor:
    """Register the standard set. Safe to call once at startup."""
    janitor = CacheJanitorWorker()
    for worker in (
        RunRecoveryWorker(),
        ModelHealthWorker(),
        PartialFileWorker(),
        janitor,
        DiskSpaceWorker(janitor),
    ):
        supervisor.register(worker)
    return supervisor
