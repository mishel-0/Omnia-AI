"""Omnia AI — Model fine-tuning API routes."""
import os

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from backend.deps import get_current_user, require_roles
from backend.audit import log_event
from backend import training
from backend import finetune

router = APIRouter(prefix="/api/training", tags=["training"])

NETWORK_URL = os.environ.get("OMNIA_NETWORK_URL", "")
NETWORK_SITE_KEY = os.environ.get("OMNIA_NETWORK_SITE_KEY", "")

# Bumped whenever the terms shown to the user change in a way that affects
# what they agreed to. The audit entry records this version, not just that
# "consent" happened, so a later dispute can be checked against the exact
# text the signer saw rather than whatever the terms say today.
NETWORK_TERMS_VERSION = "2026-08-31"


class NetworkContributeRequest(BaseModel):
    consented: bool = False
    terms_version: str = ""


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


@router.get("/network/status")
def api_network_status(user: dict = Depends(get_current_user)):
    """Whether this install is configured to contribute to the Omnia network,
    and whether there's a local fine-tune ready to send."""
    head = finetune.active_head_info()
    return {
        "configured": bool(NETWORK_URL and NETWORK_SITE_KEY),
        "has_local_finetune": head is not None,
        "local_val_qwk": head.get("local_val_qwk") if head else None,
        "sample_count": head.get("sample_count") if head else None,
        "terms_version": NETWORK_TERMS_VERSION,
    }


@router.post("/network/contribute")
def api_network_contribute(req: NetworkContributeRequest, user: dict = Depends(get_current_user)):
    """Send this site's trained heads — never the backbone, never patient
    data — to the Omnia federated network for merging with other sites.

    Only the head-only checkpoint written by finetune.py is ever read here;
    there is no code path in this handler that can reach the merged
    (backbone-included) model file or any patient record.

    Consent is checked server-side, not just gated by the UI. A checkbox the
    client controls is not a control at all if the server accepts the
    request either way — the frontend disabling a button is a convenience,
    this check is what actually stops a contribution without recorded
    agreement to the current terms.
    """
    require_roles(user, "admin", "pathologist")

    if not req.consented or req.terms_version != NETWORK_TERMS_VERSION:
        raise HTTPException(
            422,
            "Contribution was not sent: consent to the current Omnia Network terms "
            f"({NETWORK_TERMS_VERSION}) was not recorded for this request."
        )

    if not (NETWORK_URL and NETWORK_SITE_KEY):
        raise HTTPException(409, "This installation is not configured for the Omnia network. "
                                  "Set OMNIA_NETWORK_URL and OMNIA_NETWORK_SITE_KEY.")

    head = finetune.active_head_info()
    if head is None:
        raise HTTPException(409, "No local fine-tune to send — the shipped model is active, "
                                  "or the active fine-tune predates head export support.")

    import requests
    from pathlib import Path

    weights_bytes = Path(head["head_path"]).read_bytes()

    # Recorded before the network call, not after: if the upload fails, the
    # fact that this user agreed to send this exact head is still true and
    # still belongs in the trail — it is a record of consent, not of success.
    log_event("network_consent", "model", "", user_id=user["id"], username=user["username"],
              details=f"Agreed to Omnia Network terms {NETWORK_TERMS_VERSION} for a "
                      f"{head['sample_count']}-sample local fine-tune, local QWK {head['local_val_qwk']}")

    try:
        resp = requests.post(
            f"{NETWORK_URL.rstrip('/')}/contribute",
            files={"file": ("head.pt", weights_bytes, "application/octet-stream")},
            data={
                "sample_count": head["sample_count"],
                "local_val_qwk": head["local_val_qwk"],
            },
            headers={"x-site-key": NETWORK_SITE_KEY},
            timeout=30,
        )
        resp.raise_for_status()
    except requests.RequestException as e:
        log_event("network_contribute_failed", "model", "", user_id=user["id"], username=user["username"],
                  details=str(e))
        raise HTTPException(502, f"Could not reach the Omnia network: {e}")

    result = resp.json()
    log_event("network_contribute", "model", result.get("contribution_id", ""),
              user_id=user["id"], username=user["username"],
              details=f"{len(weights_bytes)} bytes, {head['sample_count']} samples, "
                      f"local QWK {head['local_val_qwk']}")
    return result
