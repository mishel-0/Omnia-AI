"""Omnia AI — Model fine-tuning API routes."""
from fastapi import APIRouter, HTTPException, Depends

from backend.deps import get_current_user, require_roles
from backend.audit import log_event
from backend import training
from backend import finetune

router = APIRouter(prefix="/api/training", tags=["training"])


@router.get("/readiness")
def api_readiness(user: dict = Depends(get_current_user)):
    """Hardware profile, dataset readiness, and a time estimate for this machine."""
    return training.readiness()


@router.get("/status")
def api_status(user: dict = Depends(get_current_user)):
    return training.status() or {"state": "idle"}


@router.get("/runs")
def api_runs(user: dict = Depends(get_current_user)):
    return training.list_runs()


@router.post("/start")
def api_start(user: dict = Depends(get_current_user)):
    require_roles(user, "admin", "pathologist")
    try:
        run = training.start(started_by=user["full_name"])
    except training.TrainingError as e:
        raise HTTPException(409, str(e))
    log_event("train_start", "model", run["id"], user_id=user["id"], username=user["username"],
              details=f"{run['examples']} examples, {run['epochs_total']} epochs")
    return run


@router.post("/cancel")
def api_cancel(user: dict = Depends(get_current_user)):
    require_roles(user, "admin", "pathologist")
    if not training.cancel():
        raise HTTPException(409, "No training run is currently active.")
    log_event("train_cancel", "model", "", user_id=user["id"], username=user["username"])
    return {"ok": True}


@router.get("/model")
def api_active_model(user: dict = Depends(get_current_user)):
    """Which model the app is grading with right now, and where it came from."""
    return finetune.active_model_info()


@router.post("/model/revert")
def api_revert_model(user: dict = Depends(get_current_user)):
    """Go back to the model supplied with Omnia.

    The fine-tuned checkpoints stay on disk, so this is reversible by running
    another fine-tune rather than a destructive action.
    """
    require_roles(user, "admin", "pathologist")
    if not finetune.revert_to_shipped():
        raise HTTPException(409, "The shipped model is already in use.")
    try:
        from backend import grading_model
        grading_model.reload_model()
    except Exception:
        pass  # pointer is already removed; a stale cache clears on restart
    log_event("model_revert", "model", "", user_id=user["id"], username=user["username"],
              details="Reverted to the model supplied with Omnia")
    return finetune.active_model_info()
