"""Omnia AI — batch analysis queue.

Grading one slide at a time through the API is the right shape for a
pathologist reviewing a case. It is the wrong shape for a sponsor handing over
a cohort: 1,500 subjects at a dozen cores each is tens of thousands of slides,
which is days of continuous work. Nobody sits and clicks through that, and
nobody wants it to start again from the beginning because the machine was
restarted on hour nine.

So: a queue that survives a restart, processes one slide at a time, and can be
watched while it runs.

Design notes
------------
One item at a time, deliberately. `grading_model.predict()` already bounds
concurrency with a semaphore sized for this machine, and a batch that saturated
it would starve the interactive path — a pathologist opening a slide while a
cohort runs would be told the engine is busy. The batch is the background
citizen here; interactive work wins.

State lives in a JSON file written through backend.storage, so a crash leaves
either the previous state or the new one, never a half-written queue. On
startup anything left mid-flight is returned to pending: an item that was
running when the process died did not finish, and the only safe assumption is
that it needs doing again.
"""
import datetime
import logging
import os
import threading
import uuid
from pathlib import Path
from typing import Optional

from backend.storage import read_json, write_json, transaction

logger = logging.getLogger("omnia-pathology")

DATA_DIR = Path(os.environ.get("OMNIA_DATA_DIR", ".")) / "data"
JOBS_FILE = DATA_DIR / "batch_jobs.json"

# Item states. `pending` and `running` are live; the rest are terminal.
PENDING, RUNNING, DONE, FAILED, SKIPPED = "pending", "running", "done", "failed", "skipped"
TERMINAL = (DONE, FAILED, SKIPPED)

_worker: Optional[threading.Thread] = None
_wake = threading.Event()
_stop = threading.Event()


def _read() -> dict:
    return read_json(JOBS_FILE, {"jobs": []})


def _write(state: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    write_json(JOBS_FILE, state)


def _now() -> str:
    return datetime.datetime.now().isoformat()


# ─── Public API ───

def enqueue(items: list[dict], trial_id: str = "", created_by: str = "") -> dict:
    """Queue slides for analysis.

    `items` is [{"patient_uuid": str, "slide_id": str, "label": str}]. Returns
    the job record. Duplicate slides already queued in a live job are skipped
    rather than queued twice — resubmitting the same cohort should not double
    the work.
    """
    if not items:
        raise ValueError("No slides to queue.")

    with transaction():
        state = _read()
        live = {
            (i["patient_uuid"], i["slide_id"])
            for j in state["jobs"] if not j.get("finished_at")
            for i in j["items"] if i["status"] not in TERMINAL
        }
        job = {
            "id": uuid.uuid4().hex[:8],
            "trial_id": trial_id,
            "created_by": created_by,
            "created_at": _now(),
            "finished_at": None,
            "cancelled": False,
            "items": [
                {
                    "patient_uuid": i["patient_uuid"],
                    "slide_id": i["slide_id"],
                    "label": i.get("label", ""),
                    "status": SKIPPED if (i["patient_uuid"], i["slide_id"]) in live else PENDING,
                    "error": "Already queued in another job"
                             if (i["patient_uuid"], i["slide_id"]) in live else "",
                    "started_at": None,
                    "finished_at": None,
                }
                for i in items
            ],
        }
        state["jobs"].append(job)
        _write(state)

    _wake.set()
    logger.info("Queued batch %s: %d slides", job["id"], len(job["items"]))
    return _summarise(job)


def list_jobs() -> list[dict]:
    return [_summarise(j) for j in reversed(_read()["jobs"])]


def get_job(job_id: str) -> Optional[dict]:
    for j in _read()["jobs"]:
        if j["id"] == job_id:
            out = _summarise(j)
            out["items"] = j["items"]
            return out
    return None


def cancel(job_id: str) -> bool:
    """Stop a job. Whatever is mid-flight finishes — killing an analysis
    part-way would leave the slide record in an indeterminate state — but
    nothing further is started."""
    with transaction():
        state = _read()
        for j in state["jobs"]:
            if j["id"] == job_id and not j.get("finished_at"):
                j["cancelled"] = True
                for i in j["items"]:
                    if i["status"] == PENDING:
                        i["status"] = SKIPPED
                        i["error"] = "Cancelled"
                # Close the job here when nothing is left in flight. Without
                # this a cancelled job kept finished_at=None, so _summarise
                # reported state "queued" forever — the panel polled a job
                # that could never change and went on offering "Stop" on work
                # that had already stopped. When an item is still running the
                # worker settles it, and _settle() closes the job then.
                if all(i["status"] in TERMINAL for i in j["items"]):
                    j["finished_at"] = _now()
                _write(state)
                return True
    return False


def _summarise(job: dict) -> dict:
    counts = {s: 0 for s in (PENDING, RUNNING, DONE, FAILED, SKIPPED)}
    for i in job["items"]:
        counts[i["status"]] = counts.get(i["status"], 0) + 1
    total = len(job["items"])
    settled = sum(counts[s] for s in TERMINAL)
    return {
        "id": job["id"],
        "trial_id": job.get("trial_id", ""),
        "created_by": job.get("created_by", ""),
        "created_at": job.get("created_at"),
        "finished_at": job.get("finished_at"),
        "cancelled": job.get("cancelled", False),
        "total": total,
        "counts": counts,
        # Progress counts every settled item, including failures and skips —
        # a bar that only advances on success stalls at 80% forever on a
        # cohort where a fifth of the slides are unreadable.
        "progress": round(settled / total, 4) if total else 0.0,
        "state": "finished" if job.get("finished_at")
                 else "running" if counts[RUNNING]
                 else "queued",
    }


# ─── Worker ───

def _claim_next() -> Optional[tuple[str, dict]]:
    """Mark the next pending item as running and return it, atomically."""
    with transaction():
        state = _read()
        for job in state["jobs"]:
            if job.get("finished_at") or job.get("cancelled"):
                continue
            for item in job["items"]:
                if item["status"] == PENDING:
                    item["status"] = RUNNING
                    item["started_at"] = _now()
                    _write(state)
                    return job["id"], dict(item)
        return None


def _settle(job_id: str, patient_uuid: str, slide_id: str, status: str, error: str = "") -> None:
    with transaction():
        state = _read()
        for job in state["jobs"]:
            if job["id"] != job_id:
                continue
            for item in job["items"]:
                if item["patient_uuid"] == patient_uuid and item["slide_id"] == slide_id:
                    item["status"] = status
                    item["error"] = error
                    item["finished_at"] = _now()
            if all(i["status"] in TERMINAL for i in job["items"]):
                job["finished_at"] = _now()
        _write(state)


def _recover_interrupted() -> int:
    """Return anything left `running` by a previous process to `pending`."""
    with transaction():
        state = _read()
        n = 0
        for job in state["jobs"]:
            for item in job["items"]:
                if item["status"] == RUNNING:
                    item["status"] = PENDING
                    item["started_at"] = None
                    n += 1
        if n:
            _write(state)
        return n


def _loop() -> None:
    from backend.trials import run_analysis
    from backend.grading_model import AnalysisBusyError

    while not _stop.is_set():
        claimed = _claim_next()
        if not claimed:
            _wake.clear()
            # Woken by enqueue(), or polled in case a job was added by another
            # path; the timeout is the safety net, not the mechanism.
            _wake.wait(timeout=5.0)
            continue

        job_id, item = claimed
        try:
            slide = run_analysis(item["patient_uuid"], item["slide_id"])
            if slide is None:
                _settle(job_id, item["patient_uuid"], item["slide_id"], FAILED, "Slide not found")
            elif slide.get("status") == "analysis_failed":
                # A failed analysis is a normal outcome, not an exception —
                # record why and carry on rather than stopping the cohort.
                _settle(job_id, item["patient_uuid"], item["slide_id"], FAILED,
                        str(slide.get("model_error") or "Analysis failed"))
            else:
                _settle(job_id, item["patient_uuid"], item["slide_id"], DONE)
        except AnalysisBusyError:
            # Interactive work has the engine. Put it back and try later
            # rather than burning the item.
            _settle(job_id, item["patient_uuid"], item["slide_id"], PENDING)
            _stop.wait(timeout=15.0)
        except Exception as e:                      # noqa: BLE001 - one bad slide must not end the run
            logger.exception("Batch item failed")
            _settle(job_id, item["patient_uuid"], item["slide_id"], FAILED, str(e))


def start() -> None:
    global _worker
    if _worker and _worker.is_alive():
        return
    recovered = _recover_interrupted()
    if recovered:
        logger.info("Batch queue: returned %d interrupted slides to pending", recovered)
    _stop.clear()
    _worker = threading.Thread(target=_loop, name="omnia-batch", daemon=True)
    _worker.start()
    _wake.set()


def stop(timeout: float = 3.0) -> None:
    _stop.set()
    _wake.set()
    if _worker and _worker.is_alive():
        _worker.join(timeout=timeout)
