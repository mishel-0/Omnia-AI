"""Omnia AI — Pathology Report API Routes."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from fastapi.responses import Response
from backend.pathology_report import generate_pathology_pdf, generate_trial_summary_pdf
from backend.trials import get_trial, list_patients

router = APIRouter(prefix="/api/reports", tags=["reports"])

class PatientReportRequest(BaseModel):
    trial_name: str = ""
    sponsor: str = ""
    drug: str = ""
    patient_id: str = ""
    visit: str = ""
    slide_filename: str = ""
    analysis_date: str = ""
    ai_grade: str = ""
    ai_confidence: float = 0.0
    tumor_size_mm: float = 0.0
    biomarkers: dict = {}
    treatment_response: str = ""
    prior_size_mm: float = 0.0
    doctor_correction: Optional[str] = None
    notes: str = ""
    grade_group: Optional[int] = None
    risk_group: str = ""
    tumor_involvement_pct: Optional[int] = None
    perineural_invasion: Optional[bool] = None
    lymphovascular_invasion: Optional[bool] = None
    cribriform_pattern: Optional[bool] = None
    quality: dict = {}
    regions_analyzed: Optional[int] = None
    suspicious_regions: Optional[int] = None
    processing_time_s: Optional[float] = None
    model_version: str = ""

@router.post("/patient")
def generate_patient_report(req: PatientReportRequest):
    """Generate a per-patient pathology PDF report."""
    try:
        pdf = generate_pathology_pdf(
            trial_name=req.trial_name,
            sponsor=req.sponsor,
            drug=req.drug,
            patient_id=req.patient_id,
            visit=req.visit,
            slide_filename=req.slide_filename,
            analysis_date=req.analysis_date,
            ai_grade=req.ai_grade,
            ai_confidence=req.ai_confidence,
            tumor_size_mm=req.tumor_size_mm,
            biomarkers=req.biomarkers,
            treatment_response=req.treatment_response,
            prior_size_mm=req.prior_size_mm,
            doctor_correction=req.doctor_correction,
            notes=req.notes,
            grade_group=req.grade_group,
            risk_group=req.risk_group,
            tumor_involvement_pct=req.tumor_involvement_pct,
            perineural_invasion=req.perineural_invasion,
            lymphovascular_invasion=req.lymphovascular_invasion,
            cribriform_pattern=req.cribriform_pattern,
            quality=req.quality,
            regions_analyzed=req.regions_analyzed,
            suspicious_regions=req.suspicious_regions,
            processing_time_s=req.processing_time_s,
            model_version=req.model_version,
        )
        return Response(
            content=pdf,
            media_type="application/pdf",
            headers={"Content-Disposition": f"attachment; filename={req.patient_id}_report.pdf"}
        )
    except Exception as e:
        raise HTTPException(500, f"Failed to generate PDF: {e}")

@router.get("/trial/{trial_id}/summary")
def generate_trial_summary(trial_id: str):
    """Generate a trial-wide summary PDF."""
    trial = get_trial(trial_id)
    if not trial:
        raise HTTPException(404, "Trial not found")
    patients = list_patients(trial_id)
    if not patients:
        raise HTTPException(404, "No patient data found for this trial")
    try:
        pdf = generate_trial_summary_pdf(
            trial_name=trial.get("name", ""),
            sponsor=trial.get("sponsor", ""),
            drug=trial.get("drug", ""),
            patients=patients,
        )
        return Response(
            content=pdf,
            media_type="application/pdf",
            headers={"Content-Disposition": f"attachment; filename={trial['name']}_summary.pdf"}
        )
    except Exception as e:
        import traceback
        raise HTTPException(500, f"Failed to generate summary: {e}\n{traceback.format_exc()}")
