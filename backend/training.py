"""Omnia AI — Model fine-tuning job manager.

Every slide a pathologist has confirmed or corrected is a labelled example.
This module owns the *job*: readiness checks, starting a run, reporting
progress, cancellation, and history. The training itself lives in
`backend.finetune`, which trains the model's attention and classifier heads
on those labels and only replaces the active model when agreement with the
pathologist improves on slides it was not trained on.

The backbone stays frozen — see `backend/finetune.py` for why that is a real
constraint at clinic data scale rather than a shortcut.
"""
import datetime
import os
import threading
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


def labelled_examples() -> list:
    """Every signed slide as {"filepath", "grade_group", ...}.

    A slide the pathologist corrected carries their grade; one they confirmed
    unchanged carries the grade they agreed with. Both are ground truth. A
    slide whose label cannot be resolved is skipped rather than guessed at,
    because a wrong label teaches the model the wrong thing.
    """
    from backend.trials import grade_group_from_text

    out = []
    for trial in list_trials():
        for p in list_patients(trial["id"]):
            for sl in p.get("slides", []):
                if not sl.get("confirmed"):
                    continue
                path = sl.get("filepath")
                if not path or not Path(path).exists():
                    continue

                if sl.get("doctor_correction"):
                    # Prefer the structured group recorded at correction time;
                    # fall back to parsing for slides signed before that field
                    # existed.
                    group = sl.get("corrected_grade_group")
                    if group is None:
                        group = grade_group_from_text(sl["doctor_correction"])
                else:
                    group = sl.get("grade_group")

                if group is None:
                    continue
                out.append({
                    "filepath": path,
                    "grade_group": int(group),
                    "slide_id": sl.get("id"),
                    "corrected": bool(sl.get("doctor_correction")),
                })
    return out


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


def reconcile_interrupted_runs() -> int:
    """Mark stored runs that can no longer be in progress as interrupted.

    A record left in "running" state after a restart would otherwise show an
    eternal progress bar and block new runs forever.

    Critically, this skips the run that IS currently executing in this
    process. Called at startup that distinction never mattered, but the
    background recovery worker calls it on a schedule, and without the check
    it would mark a live training run as interrupted a couple of minutes
    into its first epoch.

    Returns the number of records repaired.
    """
    with _job_lock:
        live_id = _active["id"] if _active and _active.get("state") == "running" else None

    with transaction():
        runs = read_json(RUNS_FILE, [])
        changed = 0
        for r in runs:
            if r.get("state") == "running" and r.get("id") != live_id:
                r["state"] = "interrupted"
                r["message"] = "Interrupted — the application was closed during training"
                changed += 1
        if changed:
            write_json(RUNS_FILE, runs)
        return changed


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
        "qwk": None,
        "promoted": None,
        "history": [],
        "estimated_seconds": info["estimate"]["estimated_seconds"],
        "eta_seconds": info["estimate"]["estimated_seconds"],
        "hardware": info["hardware"]["cpu_name"],
        "accelerator": info["hardware"]["accelerator"],
        "profile": {k: profile[k] for k in ("tier", "label", "tile_size", "batch_size", "epochs", "precision")},
        "message": "Preparing dataset",
    }

    with _job_lock:
        _active = run
    _cancel.clear()
    _save_run(run)

    threading.Thread(target=_run_job, args=(run["id"],), daemon=True).start()
    return dict(run)


def _run_job(run_id: str):
    """Real fine-tuning. Publishes true loss and true held-out agreement."""
    global _active
    from backend import finetune

    try:
        examples = labelled_examples()

        def progress(fields: dict):
            # finetune emits partial updates; forward whatever it reports.
            _publish(run_id, **fields)

        def cancelled() -> bool:
            return _cancel.is_set()

        with _job_lock:
            if not _active or _active["id"] != run_id:
                return
            epochs = _active["epochs_total"]

        summary = finetune.run_finetune(
            examples,
            epochs=max(1, epochs),
            progress=progress,
            should_cancel=cancelled,
        )

        # State reflects what happened to the MODEL, not just to the job. A run
        # that completed but did not improve grading is "completed" with
        # promoted=False, never presented as a successful update.
        _publish(
            run_id,
            state="completed",
            progress=1.0,
            eta_seconds=0,
            promoted=summary["promoted"],
            baseline_qwk=summary["baseline_qwk"],
            finetuned_qwk=summary["finetuned_qwk"],
            examples_used=summary["examples_used"],
            train_size=summary["train_size"],
            val_size=summary["val_size"],
            best_epoch=summary["best_epoch"],
            history=summary["history"],
            message=(
                f"Agreement improved {summary['baseline_qwk']:.3f} → "
                f"{summary['finetuned_qwk']:.3f}. The updated model is now in use."
                if summary["promoted"] else
                f"Agreement did not improve ({summary['baseline_qwk']:.3f} → "
                f"{summary['finetuned_qwk']:.3f}). The existing model has been kept."
            ),
            finished_at=datetime.datetime.now().isoformat(),
        )

    except finetune.FineTuneError as e:
        cancelled_run = str(e) == "Cancelled" or _cancel.is_set()
        _publish(
            run_id,
            state="cancelled" if cancelled_run else "failed",
            message="Cancelled by user" if cancelled_run else str(e),
            finished_at=datetime.datetime.now().isoformat(),
        )
    except Exception as e:  # never leave a run wedged in "running"
        _publish(run_id, state="failed", message=str(e),
                 finished_at=datetime.datetime.now().isoformat())
    finally:
        with _job_lock:
            if _active and _active["id"] == run_id and _active["state"] == "running":
                _active["state"] = "failed"
