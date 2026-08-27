"""Omnia AI — Trial & Patient API Routes."""
import os
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
from backend.grading_model import AnalysisBusyError
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
    protocol_id: str = ""
    phase: str = ""

class UpdateTrialRequest(BaseModel):
    name: Optional[str] = None
    protocol_id: Optional[str] = None
    phase: Optional[str] = None
    sponsor: Optional[str] = None
    drug: Optional[str] = None
    indication: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[str] = None
    sites: Optional[list[str]] = None

class PatientProfile(BaseModel):
    """Pseudonymised profile. Deliberately carries no name and no full date of
    birth — see the privacy note in backend/patients.py."""
    initials: str = ""
    year_of_birth: Optional[int] = None
    sex: str = ""
    site: str = ""
    notes: str = ""

class AddPatientRequest(BaseModel):
    # Optional now: when a site has not assigned its own subject code, the
    # generated patient ID is used instead of rejecting the record.
    patient_id: str = ""
    visit: str = "Baseline"
    notes: str = ""
    site: str = ""
    # Enrol an existing registered patient, or leave blank to register a new
    # one from `profile`.
    patient_uid: str = ""
    profile: Optional[PatientProfile] = None

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
        trial = create_trial(req.name, req.sponsor, req.drug, req.indication, req.notes,
                             req.sites, req.protocol_id, req.phase)
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
        patient = add_patient(trial_id, req.patient_id, req.visit, req.notes, req.site,
                              req.patient_uid,
                              req.profile.model_dump() if req.profile else None)
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
    except AnalysisBusyError as e:
        # 503 + Retry-After: the slide is fine, the machine is saturated.
        # Distinct from an analysis failure so the client can retry rather
        # than showing the pathologist a permanent error.
        raise HTTPException(503, str(e), headers={"Retry-After": "30"})
    if not slide:
        raise HTTPException(404, "Slide not found")
    patient = get_patient(patient_uuid)
    details = (
        f"Analysis failed: {slide.get('model_error')}"
        if slide.get("status") == "analysis_failed"
        else f"Grade: {slide.get('grade')} ({slide.get('analysis_source')})"
    )
    log_event("analyze", "slide", slide_id, user_id=user["id"], username=user["username"],
               trial_id=patient["trial_id"] if patient else None, details=details)
    return slide

class DrugRequest(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    drug_class: Optional[str] = None
    target: Optional[str] = None
    mechanism: Optional[str] = None
    modality: Optional[str] = None
    dose: Optional[str] = None
    route: Optional[str] = None
    schedule: Optional[str] = None
    smiles: Optional[str] = None
    comparator: Optional[str] = None
    notes: Optional[str] = None


@router.get("/{trial_id}/drug")
def api_get_drug(trial_id: str, user: dict = Depends(get_current_user)):
    if not get_trial(trial_id):
        raise HTTPException(404, "Trial not found")
    from backend.drug_profile import get_drug
    return get_drug(trial_id) or {}


@router.put("/{trial_id}/drug")
def api_upsert_drug(trial_id: str, req: DrugRequest, user: dict = Depends(get_current_user)):
    require_roles(user, "admin", "pathologist")
    if not get_trial(trial_id):
        raise HTTPException(404, "Trial not found")
    from backend.drug_profile import upsert_drug
    rec = upsert_drug(trial_id, req.model_dump())
    log_event("update", "trial", trial_id, user_id=user["id"], username=user["username"],
              trial_id=trial_id, details=f"Investigational product set: {rec.get('name') or rec.get('code') or '—'}")
    return rec


@router.get("/{trial_id}/drug/structure.png")
def api_drug_structure(trial_id: str, user: dict = Depends(get_current_user)):
    """2D depiction of the recorded structure."""
    from backend.drug_profile import get_drug, render_structure_png
    drug = get_drug(trial_id)
    if not drug or not drug.get("smiles"):
        raise HTTPException(404, "No structure recorded for this trial")
    png = render_structure_png(drug["smiles"])
    if png is None:
        raise HTTPException(422, "Structure could not be rendered")
    return Response(content=png, media_type="image/png",
                    headers={"Cache-Control": "private, max-age=3600"})


@router.get("/{trial_id}/evidence")
def api_evidence(trial_id: str, user: dict = Depends(get_current_user)):
    """Compound record and observed histology side by side, with an explicit
    account of what that pairing can and cannot support."""
    if not get_trial(trial_id):
        raise HTTPException(404, "Trial not found")
    from backend.drug_profile import evidence_summary
    return evidence_summary(trial_id, list_patients())


@router.get("/{trial_id}/insights")
def api_cohort_insights(trial_id: str, user: dict = Depends(get_current_user)):
    """Trial-level cohort analytics: composition, trajectories, reviewer
    workload and data readiness.

    Reports only what is computed from recorded grades, confidence,
    attention and signature state. See backend/cohort_insights.py for why
    this deliberately stops short of mechanism or efficacy inference.
    """
    if not get_trial(trial_id):
        raise HTTPException(404, "Trial not found")
    from backend.cohort_insights import build_cohort_insights
    return build_cohort_insights(trial_id, list_patients())


@router.get("/{trial_id}/subjects")
def api_list_subjects(trial_id: str, user: dict = Depends(get_current_user)):
    """One row per subject, collapsing their visits into a single container.

    The stored model keeps a separate record per (patient_id, visit); this
    is the view that treats a subject as one longitudinal entity.
    """
    if not get_trial(trial_id):
        raise HTTPException(404, "Trial not found")
    from backend.patient_timeline import list_subjects
    return list_subjects(trial_id, list_patients())


@router.get("/{trial_id}/subjects/{patient_id}/timeline")
def api_subject_timeline(trial_id: str, patient_id: str, user: dict = Depends(get_current_user)):
    """Every visit for one subject, ordered in time, with the grade change
    between consecutive timepoints.

    Reports trajectory only. See backend/patient_timeline.py for why this
    is deliberately not framed as treatment response.
    """
    if not get_trial(trial_id):
        raise HTTPException(404, "Trial not found")
    from backend.patient_timeline import build_subject_timeline
    tl = build_subject_timeline(trial_id, patient_id, list_patients())
    if not tl:
        raise HTTPException(404, "No visits found for this subject in this trial")
    return tl


@router.get("/patients/{patient_uuid}/slides/{slide_id}/thumbnail")
def api_slide_thumbnail(patient_uuid: str, slide_id: str, user: dict = Depends(get_current_user)):
    """Render the actual uploaded slide as a PNG for the viewer.

    Whole-slide images are gigapixel; this reads openslide's downsampled
    pyramid rather than level 0, so it stays fast even on a 160MB+ file.
    Cached hard on the client — a slide's pixels never change once
    uploaded, and re-rendering per view would be wasteful.
    """
    patient = get_patient(patient_uuid)
    if not patient:
        raise HTTPException(404, "Patient not found")
    slide = next((s for s in patient.get("slides", []) if s["id"] == slide_id), None)
    if not slide:
        raise HTTPException(404, "Slide not found")

    filepath = slide.get("filepath")
    if not filepath or not os.path.isfile(filepath):
        raise HTTPException(404, "Slide file is no longer on disk")

    try:
        from backend.grading_model import render_thumbnail
        from backend.trials import THUMB_CACHE_DIR
        png = render_thumbnail(filepath, cache_dir=str(THUMB_CACHE_DIR))
    except Exception as e:
        # A slide the viewer can't render is a real, reportable condition —
        # don't hand back a placeholder image that looks like real tissue.
        raise HTTPException(422, f"Could not render this slide: {e}")

    return Response(
        content=png,
        media_type="image/png",
        headers={"Cache-Control": "private, max-age=31536000, immutable"},
    )

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
