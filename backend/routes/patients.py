"""Omnia AI — patient registry and container API.

These endpoints treat a patient as a durable entity in their own right,
rather than as rows scattered across trials. The container endpoint is the
one that matters clinically: it answers "show me everything on file for this
person", which the per-trial views cannot.
"""
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional

from backend import patients as registry
from backend.trials import list_patients as list_visit_records, list_trials
from backend.deps import get_current_user, require_roles
from backend.audit import log_event

router = APIRouter(prefix="/api/patients", tags=["patients"])


class CreatePatientRequest(BaseModel):
    initials: str = ""
    year_of_birth: Optional[int] = None
    sex: str = ""
    site: str = ""
    notes: str = ""


class UpdatePatientRequest(BaseModel):
    initials: Optional[str] = None
    year_of_birth: Optional[int] = None
    sex: Optional[str] = None
    site: Optional[str] = None
    notes: Optional[str] = None


@router.post("/")
def api_create_patient(req: CreatePatientRequest, user: dict = Depends(get_current_user)):
    """Register a patient. The identifier is generated here — callers cannot
    supply one, so two coordinators cannot mint the same ID."""
    require_roles(user, "admin", "pathologist")
    try:
        patient = registry.create_patient(**req.model_dump())
    except registry.ValidationError as e:
        raise HTTPException(400, str(e))
    log_event("create", "patient", patient["uid"], user_id=user["id"],
              username=user["username"], details=f"Registered patient {patient['uid']}")
    return patient


@router.get("/")
def api_list_patients(user: dict = Depends(get_current_user)):
    return registry.list_registry()


@router.get("/{uid}")
def api_get_patient(uid: str, user: dict = Depends(get_current_user)):
    patient = registry.get_patient(uid)
    if not patient:
        raise HTTPException(404, "Patient not found")
    return patient


@router.patch("/{uid}")
def api_update_patient(uid: str, req: UpdatePatientRequest, user: dict = Depends(get_current_user)):
    require_roles(user, "admin", "pathologist")
    updates = {k: v for k, v in req.model_dump().items() if v is not None}
    patient = registry.update_patient(uid, updates)
    if not patient:
        raise HTTPException(404, "Patient not found")
    log_event("update", "patient", patient["uid"], user_id=user["id"], username=user["username"])
    return patient


@router.get("/{uid}/container")
def api_patient_container(uid: str, user: dict = Depends(get_current_user)):
    """Everything filed under this patient: profile, every trial they are
    enrolled in, their visits and slides, and their stored reports."""
    container = registry.build_patient_container(uid, list_visit_records(), list_trials())
    if not container:
        raise HTTPException(404, "Patient not found")
    return container


@router.get("/{uid}/reports")
def api_list_reports(uid: str, user: dict = Depends(get_current_user)):
    if not registry.get_patient(uid):
        raise HTTPException(404, "Patient not found")
    return registry.list_reports(uid)


@router.get("/{uid}/reports/{filename}")
def api_get_report(uid: str, filename: str, user: dict = Depends(get_current_user)):
    """Retrieve a report exactly as it was issued.

    `report_path` resolves inside the patient's own directory and returns
    None for anything that escapes it, so a crafted filename cannot reach
    another patient's records or the wider filesystem.
    """
    if not registry.get_patient(uid):
        raise HTTPException(404, "Patient not found")
    path = registry.report_path(uid, filename)
    if not path:
        raise HTTPException(404, "Report not found")
    log_event("read", "report", filename, user_id=user["id"], username=user["username"],
              details=f"Retrieved stored report for {uid}")
    return FileResponse(path, media_type="application/pdf", filename=path.name)
