"""Omnia AI — batch analysis routes."""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from backend import batch
from backend.audit import log_event
from backend.deps import get_current_user, require_roles
from backend.trials import get_patient, list_patients

router = APIRouter(prefix="/api/batch", tags=["batch"])


class QueueTrialRequest(BaseModel):
    trial_id: str
    # Re-analysing a slide a pathologist has signed would overwrite a result
    # that carries their signature, so it is off unless explicitly asked for.
    include_analysed: bool = False


@router.post("/trial")
def api_queue_trial(req: QueueTrialRequest, user: dict = Depends(get_current_user)):
    """Queue every unanalysed slide in a trial.

    The unit is the trial, not a folder of files: slides are already attached
    to patients and visits by this point, so asking for a path would mean
    re-deriving the mapping the upload step has already established.
    """
    require_roles(user, "admin", "pathologist")

    items = []
    for p in list_patients(req.trial_id):
        for s in p.get("slides", []):
            if s.get("confirmed"):
                continue  # signed — never re-analyse
            if s.get("grade_group") is not None and not req.include_analysed:
                continue
            items.append({
                "patient_uuid": p["id"],
                "slide_id": s["id"],
                "label": f'{p.get("patient_id", "")} · {s.get("filename", "")}',
            })

    if not items:
        raise HTTPException(409, "No slides in this trial need analysis.")

    job = batch.enqueue(items, trial_id=req.trial_id, created_by=user["full_name"])
    log_event("batch_queued", "trial", req.trial_id, user_id=user["id"],
              username=user["username"], trial_id=req.trial_id,
              details=f"{len(items)} slides queued as batch {job['id']}")
    return job


class QueueSlidesRequest(BaseModel):
    slides: list[dict]     # [{"patient_uuid": ..., "slide_id": ...}]
    trial_id: str = ""


@router.post("/slides")
def api_queue_slides(req: QueueSlidesRequest, user: dict = Depends(get_current_user)):
    """Queue an explicit list of slides."""
    require_roles(user, "admin", "pathologist")
    items = []
    for s in req.slides:
        uid, sid = s.get("patient_uuid"), s.get("slide_id")
        if not uid or not sid:
            raise HTTPException(422, "Each slide needs patient_uuid and slide_id.")
        if not get_patient(uid):
            raise HTTPException(404, f"No such patient: {uid}")
        items.append({"patient_uuid": uid, "slide_id": sid, "label": s.get("label", "")})

    job = batch.enqueue(items, trial_id=req.trial_id, created_by=user["full_name"])
    log_event("batch_queued", "trial", req.trial_id, user_id=user["id"],
              username=user["username"], details=f"{len(items)} slides queued as batch {job['id']}")
    return job


@router.get("/jobs")
def api_jobs(user: dict = Depends(get_current_user)):
    return batch.list_jobs()


@router.get("/jobs/{job_id}")
def api_job(job_id: str, user: dict = Depends(get_current_user)):
    job = batch.get_job(job_id)
    if not job:
        raise HTTPException(404, "No such batch job.")
    return job


@router.post("/jobs/{job_id}/cancel")
def api_cancel(job_id: str, user: dict = Depends(get_current_user)):
    require_roles(user, "admin", "pathologist")
    if not batch.cancel(job_id):
        raise HTTPException(409, "That job has already finished.")
    log_event("batch_cancelled", "trial", job_id, user_id=user["id"], username=user["username"])
    return batch.get_job(job_id)
