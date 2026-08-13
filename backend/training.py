"""Omnia AI — Model fine-tuning job manager.

The training dataset is real: every slide a pathologist has confirmed or
corrected becomes a labelled example, which is exactly the data used to
fine-tune a grading model on site-specific material.

── Current status ──
`_run_job()` SIMULATES the optimisation loop. No model weights exist yet and
none are written. It reports honest, hardware-derived timing and a plausible
loss curve so the surrounding workflow (readiness checks, progress, history,
audit) can be built and demonstrated now.

── To plug in real training ──
Replace the body of `_run_job()` with the actual loop: build the dataset from
`collect_training_examples()`, train, and call `_publish()` after each epoch
with the true loss/accuracy. Everything else — the API, progress reporting,
cancellation, and history — already works against that contract.
"""
import datetime
import os
import random
import threading
import time
import uuid
from pathlib import Path
from typing import Optional

from backend.storage import read_json, write_json, transaction
from backend.hardware import detect_hardware, assess_capability, estimate_training
from backend.trials import list_trials, list_patients

DATA_DIR = Path(os.environ.get("OMNIA_DATA_DIR", ".")) / "data"
RUNS_FILE = DATA_DIR / "training_runs.json"

MIN_EXAMPLES = 20  # below this a fine-tune will overfit rather than help

_job_lock = threading.Lock()
_active: Optional[dict] = None
_cancel = threading.Event()


class TrainingError(RuntimeError):
    """Raised for invalid training requests; routes map this to HTTP 400/409."""


def collect_training_examples() -> dict:
    """Every pathologist-reviewed slide is a labelled training example."""
    total_slides = 0
    confirmed = 0
    corrected = 0
    per_trial = []

    for trial in list_trials():
        t_conf = 0
        t_corr = 0
        t_total = 0
        for p in list_patients(trial["id"]):
            for s in p.get("slides", []):
                t_total += 1
                if s.get("confirmed"):
                    t_conf += 1
                    if s.get("doctor_correction"):
                        t_corr += 1
        total_slides += t_total
        confirmed += t_conf
        corrected += t_corr
        if t_conf:
            per_trial.append({"trial": trial["name"], "examples": t_conf, "corrections": t_corr})

    return {
        "total_slides": total_slides,
        "usable_examples": confirmed,
        "corrections": corrected,
        "agreements": confirmed - corrected,
        "per_trial": per_trial,
        "minimum_required": MIN_EXAMPLES,
        "ready": confirmed >= MIN_EXAMPLES,
    }


def readiness() -> dict:
    """Everything the training screen needs before a run is started."""
    hw = detect_hardware()
    profile = assess_capability(hw)
    dataset = collect_training_examples()
    estimate = estimate_training(profile, dataset["usable_examples"])
    return {
        "hardware": hw,
        "profile": profile,
        "dataset": dataset,
        "estimate": estimate,
        "active_run": status(),
    }


def _load_runs() -> list:
    return read_json(RUNS_FILE, [])


def _save_run(run: dict):
    with transaction():
        runs = read_json(RUNS_FILE, [])
        for i, r in enumerate(runs):
            if r["id"] == run["id"]:
                runs[i] = run
                break
        else:
            runs.append(run)
        write_json(RUNS_FILE, runs)


def list_runs(limit: int = 20) -> list:
    runs = _load_runs()
    runs.sort(key=lambda r: r.get("started_at", ""), reverse=True)
    return runs[:limit]


def status() -> Optional[dict]:
    with _job_lock:
        return dict(_active) if _active else None


def cancel() -> bool:
    with _job_lock:
        if not _active:
            return False
    _cancel.set()
    return True


def _publish(run_id: str, **fields):
    """Update the in-memory job snapshot the API polls.

    Scoped to a run id so a thread from a superseded run can never write over
    the run that replaced it.
    """
    global _active
    with _job_lock:
        if _active is None or _active.get("id") != run_id:
            return
        _active.update(fields)
        snapshot = dict(_active)
    _save_run(snapshot)


def reconcile_interrupted_runs():
    """A run marked 'running' in storage cannot survive a process restart.
    Mark such records interrupted so history never shows an eternal run."""
    with transaction():
        runs = read_json(RUNS_FILE, [])
        changed = False
        for r in runs:
            if r.get("state") == "running":
                r["state"] = "interrupted"
                r["message"] = "Interrupted — the application was closed during training"
                changed = True
        if changed:
            write_json(RUNS_FILE, runs)


def start(started_by: str) -> dict:
    """Begin a fine-tuning run. Raises TrainingError if not permitted."""
    global _active

    run_id = str(uuid.uuid4())[:8]

    # Claim the slot and publish the id in ONE critical section. Checking the
    # guard and assigning _active separately let simultaneous requests both pass
    # and spawn competing threads.
    with _job_lock:
        if _active and _active.get("state") == "running":
            raise TrainingError("A training run is already in progress.")
        _active = {"id": run_id, "state": "running", "message": "Preparing dataset",
                   "epoch": 0, "epochs_total": 0, "progress": 0.0}

    try:
        info = readiness()
        dataset = info["dataset"]
        if not dataset["ready"]:
            raise TrainingError(
                f"Need at least {MIN_EXAMPLES} pathologist-reviewed slides to fine-tune "
                f"(currently {dataset['usable_examples']}). Confirm or correct more slides first."
            )
    except BaseException:
        # Never leave the slot claimed if the run could not be prepared.
        with _job_lock:
            if _active and _active.get("id") == run_id:
                _active = None
        raise

    profile = info["profile"]
    run = {
        "id": run_id,
        "state": "running",
        "started_by": started_by,
        "started_at": datetime.datetime.now().isoformat(),
        "finished_at": None,
        "examples": dataset["usable_examples"],
        "corrections": dataset["corrections"],
        "epochs_total": profile["epochs"],
        "epoch": 0,
        "progress": 0.0,
        "loss": None,
        "accuracy": None,
        "history": [],
        "estimated_seconds": info["estimate"]["estimated_seconds"],
        "eta_seconds": info["estimate"]["estimated_seconds"],
        "hardware": info["hardware"]["cpu_name"],
        "accelerator": info["hardware"]["accelerator"],
        "profile": {k: profile[k] for k in ("tier", "label", "tile_size", "batch_size", "epochs", "precision")},
        "simulated": True,   # flips to False once real training is wired in
        "message": "Preparing dataset",
    }

    with _job_lock:
        _active = run
    _cancel.clear()
    _save_run(run)

    threading.Thread(target=_run_job, args=(run["id"],), daemon=True).start()
    return dict(run)


def _run_job(run_id: str):
    """SIMULATED optimisation loop — see module docstring for the real swap point."""
    global _active
    try:
        with _job_lock:
            if not _active or _active["id"] != run_id:
                return
            epochs = _active["epochs_total"]
            total_seconds = max(_active["estimated_seconds"], 8)

        # The simulated run is bounded so it can be demonstrated, while the
        # hardware-derived figure stays visible separately as the real estimate.
        wall_clock = min(total_seconds, 45)
        per_epoch = wall_clock / epochs
        rng = random.Random(run_id)
        loss = rng.uniform(0.82, 0.95)
        acc = rng.uniform(0.55, 0.62)

        for epoch in range(1, epochs + 1):
            steps = 10
            for _ in range(steps):
                if _cancel.is_set():
                    _publish(run_id, state="cancelled", message="Cancelled by user",
                             finished_at=datetime.datetime.now().isoformat())
                    return
                time.sleep(per_epoch / steps)

            # Loss decays with diminishing returns; accuracy climbs toward a plateau.
            loss = max(0.06, loss * rng.uniform(0.74, 0.88))
            acc = min(0.97, acc + (0.97 - acc) * rng.uniform(0.22, 0.38))
            progress = epoch / epochs
            # Count down the time this run will actually take. Reporting the
            # full-hardware estimate here would show minutes remaining on a run
            # that finishes in seconds.
            remaining = int(wall_clock * (1 - progress))

            _publish(
                run_id,
                epoch=epoch,
                progress=round(progress, 4),
                loss=round(loss, 4),
                accuracy=round(acc, 4),
                eta_seconds=remaining,
                message=f"Epoch {epoch} of {epochs}",
                history=((status() or {}).get("history", []) if (status() or {}).get("id") == run_id else []) + [
                    {"epoch": epoch, "loss": round(loss, 4), "accuracy": round(acc, 4)}
                ],
            )

        _publish(run_id, state="completed", progress=1.0, eta_seconds=0,
                 message="Training complete",
                 finished_at=datetime.datetime.now().isoformat())
    except Exception as e:  # never leave a run wedged in "running"
        _publish(run_id, state="failed", message=str(e),
                 finished_at=datetime.datetime.now().isoformat())
    finally:
        with _job_lock:
            if _active and _active["id"] == run_id and _active["state"] == "running":
                _active["state"] = "failed"
