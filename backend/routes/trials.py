"""Omnia AI — Trial & Patient API Routes."""
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from fastapi.responses import Response
from pydantic import BaseModel
from typing import Optional
from backend.trials import (
    run_analysis, ValidationError,
    create_trial, list_trials, get_trial, update_trial, delete_trial,
    add_patient, list_patients, get_patient, update_patient,
    add_slide_upload, confirm_slide, correct_slide, export_corrections,
    export_corrections_csv, export_patients_csv,
    delete_patient, delete_slide, set_trial_status,
)
from backend.deps import get_current_user, require_roles
from backend.users import verify_password_for_user
from backend.audit import log_event

router = APIRouter(prefix="/api/trials", tags=["trials"])

# ─── Models ───

class CreateTrialRequest(BaseModel):
    name: str
    sponsor: str
    drug: str
    indication: str
    notes: str = ""
    sites: list[str] = []

class UpdateTrialRequest(BaseModel):
    name: Optional[str] = None
    sponsor: Optional[str] = None
    drug: Optional[str] = None
    indication: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[str] = None
    sites: Optional[list[str]] = None

class AddPatientRequest(BaseModel):
    patient_id: str
    visit: str = "Baseline"
    notes: str = ""
    site: str = ""

class UpdatePatientRequest(BaseModel):
    patient_id: Optional[str] = None
    visit: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[str] = None
    site: Optional[str] = None

class TrialStatusRequest(BaseModel):
    status: str

class ConfirmSlideRequest(BaseModel):
    patient_id: str
    slide_id: str
    password: str

class CorrectSlideRequest(BaseModel):
    patient_id: str
    slide_id: str
    correction: str
    password: str

# ─── Trial Endpoints ───

@router.post("/")
def api_create_trial(req: CreateTrialRequest, user: dict = Depends(get_current_user)):
    require_roles(user, "admin", "pathologist")
    try:
        trial = create_trial(req.name, req.sponsor, req.drug, req.indication, req.notes, req.sites)
    except ValidationError as e:
        raise HTTPException(400, str(e))
    log_event("create", "trial", trial["id"], user_id=user["id"], username=user["username"],
              trial_id=trial["id"], details=f"Created trial {trial['name']}")
    return trial

@router.get("/")
def api_list_trials(user: dict = Depends(get_current_user)):
    return list_trials()

@router.get("/{trial_id}")
def api_get_trial(trial_id: str, user: dict = Depends(get_current_user)):
    trial = get_trial(trial_id)
    if not trial:
        raise HTTPException(404, "Trial not found")
    return trial

@router.patch("/{trial_id}")
def api_update_trial(trial_id: str, req: UpdateTrialRequest, user: dict = Depends(get_current_user)):
    require_roles(user, "admin", "pathologist")
    updates = {k: v for k, v in req.model_dump().items() if v is not None}
    trial = update_trial(trial_id, updates)
    if not trial:
        raise HTTPException(404, "Trial not found")
    log_event("update", "trial", trial_id, user_id=user["id"], username=user["username"], trial_id=trial_id)
    return trial

@router.delete("/{trial_id}")
def api_delete_trial(trial_id: str, user: dict = Depends(get_current_user)):
    require_roles(user, "admin")
    if not delete_trial(trial_id):
        raise HTTPException(404, "Trial not found")
    log_event("delete", "trial", trial_id, user_id=user["id"], username=user["username"], trial_id=trial_id)
    return {"ok": True}

@router.post("/{trial_id}/status")
def api_set_trial_status(trial_id: str, req: TrialStatusRequest, user: dict = Depends(get_current_user)):
    require_roles(user, "admin", "pathologist")
    try:
        trial = set_trial_status(trial_id, req.status)
    except ValidationError as e:
        raise HTTPException(400, str(e))
    if not trial:
        raise HTTPException(404, "Trial not found")
    log_event("update", "trial", trial_id, user_id=user["id"], username=user["username"],
               trial_id=trial_id, details=f"Status set to {req.status}")
    return trial

# ─── Patient Endpoints ───

@router.post("/{trial_id}/patients")
def api_add_patient(trial_id: str, req: AddPatientRequest, user: dict = Depends(get_current_user)):
    require_roles(user, "admin", "pathologist")
    try:
        patient = add_patient(trial_id, req.patient_id, req.visit, req.notes, req.site)
    except ValidationError as e:
        raise HTTPException(400, str(e))
    if not patient:
        raise HTTPException(404, "Trial not found")
    log_event("create", "patient", patient["id"], user_id=user["id"], username=user["username"],
               trial_id=trial_id, details=f"Added patient {patient['patient_id']}")
    return patient

@router.get("/{trial_id}/patients")
def api_list_patients(trial_id: str, user: dict = Depends(get_current_user)):
    return list_patients(trial_id)

@router.get("/patients/{patient_uuid}")
def api_get_patient(patient_uuid: str, user: dict = Depends(get_current_user)):
    patient = get_patient(patient_uuid)
    if not patient:
        raise HTTPException(404, "Patient not found")
    return patient

@router.patch("/patients/{patient_uuid}")
def api_update_patient(patient_uuid: str, req: UpdatePatientRequest, user: dict = Depends(get_current_user)):
    require_roles(user, "admin", "pathologist")
    updates = {k: v for k, v in req.model_dump().items() if v is not None}
    patient = update_patient(patient_uuid, updates)
    if not patient:
        raise HTTPException(404, "Patient not found")
    log_event("update", "patient", patient_uuid, user_id=user["id"], username=user["username"], trial_id=patient["trial_id"])
    return patient

@router.delete("/patients/{patient_uuid}")
def api_delete_patient(patient_uuid: str, user: dict = Depends(get_current_user)):
    require_roles(user, "admin", "pathologist")
    patient = get_patient(patient_uuid)
    try:
        removed = delete_patient(patient_uuid)
    except ValidationError as e:
        raise HTTPException(409, str(e))
    if not removed:
        raise HTTPException(404, "Patient not found")
    log_event("delete", "patient", patient_uuid, user_id=user["id"], username=user["username"],
               trial_id=patient["trial_id"] if patient else None,
               details=f"Deleted patient {removed['patient_id']}")
    return {"ok": True}

# ─── Slide Endpoints ───

@router.post("/patients/{patient_uuid}/slides")
def api_add_slide(patient_uuid: str, file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    require_roles(user, "admin", "pathologist")
    # Streamed to disk rather than read into memory — whole-slide images are large.
    try:
        slide = add_slide_upload(patient_uuid, file.filename, file.file)
    except (ValidationError, ValueError) as e:
        raise HTTPException(400, str(e))
    if not slide:
        raise HTTPException(404, "Patient not found")
    patient = get_patient(patient_uuid)
    log_event("create", "slide", slide["id"], user_id=user["id"], username=user["username"],
               trial_id=patient["trial_id"] if patient else None,
               details=f"{slide['filename']} ({slide['file_size']:,} bytes)")
    return slide

@router.post("/patients/{patient_uuid}/slides/{slide_id}/analyze")
def api_analyze_slide(patient_uuid: str, slide_id: str, user: dict = Depends(get_current_user)):
    require_roles(user, "admin", "pathologist")
    try:
        slide = run_analysis(patient_uuid, slide_id)
    except ValidationError as e:
        raise HTTPException(409, str(e))
    if not slide:
        raise HTTPException(404, "Slide not found")
    patient = get_patient(patient_uuid)
    log_event("analyze", "slide", slide_id, user_id=user["id"], username=user["username"],
               trial_id=patient["trial_id"] if patient else None,
               details=f"Grade: {slide.get('grade')} ({slide.get('analysis_source')})")
    return slide

@router.delete("/patients/{patient_uuid}/slides/{slide_id}")
def api_delete_slide(patient_uuid: str, slide_id: str, user: dict = Depends(get_current_user)):
    require_roles(user, "admin", "pathologist")
    patient = get_patient(patient_uuid)
    try:
        removed = delete_slide(patient_uuid, slide_id)
    except ValidationError as e:
        raise HTTPException(409, str(e))
    if not removed:
        raise HTTPException(404, "Slide not found")
    log_event("delete", "slide", slide_id, user_id=user["id"], username=user["username"],
               trial_id=patient["trial_id"] if patient else None,
               details=f"Deleted slide {removed['filename']}")
    return {"ok": True}

@router.post("/slides/confirm")
def api_confirm_slide(req: ConfirmSlideRequest, user: dict = Depends(get_current_user)):
    require_roles(user, "admin", "pathologist")
    if not verify_password_for_user(user["id"], req.password):
        raise HTTPException(400, "Incorrect password — signature not applied")
    try:
        result = confirm_slide(req.patient_id, req.slide_id, signed_by=user["full_name"])
    except ValidationError as e:
        raise HTTPException(409, str(e))
    if not result:
        raise HTTPException(404, "Slide not found")
    patient = get_patient(req.patient_id)
    log_event("sign_confirm", "slide", req.slide_id, user_id=user["id"], username=user["username"],
               trial_id=patient["trial_id"] if patient else None, details="Reviewed and Approved")
    return result

@router.post("/slides/correct")
def api_correct_slide(req: CorrectSlideRequest, user: dict = Depends(get_current_user)):
    require_roles(user, "admin", "pathologist")
    if not verify_password_for_user(user["id"], req.password):
        raise HTTPException(400, "Incorrect password — signature not applied")
    try:
        result = correct_slide(req.patient_id, req.slide_id, req.correction, signed_by=user["full_name"])
    except ValidationError as e:
        raise HTTPException(409, str(e))
    if not result:
        raise HTTPException(404, "Slide not found")
    patient = get_patient(req.patient_id)
    log_event("sign_correct", "slide", req.slide_id, user_id=user["id"], username=user["username"],
               trial_id=patient["trial_id"] if patient else None, details=f"Corrected to: {req.correction}")
    return result

# ─── Export ───

@router.get("/{trial_id}/export-corrections")
def api_export_corrections(trial_id: str, user: dict = Depends(get_current_user)):
    return export_corrections(trial_id)

@router.get("/{trial_id}/export-corrections-csv")
def api_export_corrections_csv(trial_id: str, user: dict = Depends(get_current_user)):
    return Response(
        content=export_corrections_csv(trial_id),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=trial_{trial_id}_corrections.csv"}
    )

@router.get("/{trial_id}/export-patients-csv")
def api_export_patients_csv(trial_id: str, user: dict = Depends(get_current_user)):
    return Response(
        content=export_patients_csv(trial_id),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=trial_{trial_id}_patients.csv"}
    )
