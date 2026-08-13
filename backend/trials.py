"""Omnia AI — Trial & Patient Manager (JSON file storage, no DB needed)."""
import os
import uuid
import shutil
import datetime
from pathlib import Path
from typing import Optional, BinaryIO
from backend.analysis_engine import analyze_slide
from backend.storage import read_json, write_json, safe_filename, transaction

DATA_DIR = Path(os.environ.get("OMNIA_DATA_DIR", ".")) / "data"
TRIALS_FILE = DATA_DIR / "trials.json"
PATIENTS_FILE = DATA_DIR / "patients.json"
SLIDES_DIR = DATA_DIR / "slides"

ALLOWED_SLIDE_EXTENSIONS = (".svs",)
MAX_NAME_LEN = 200

class ValidationError(ValueError):
    """Raised for invalid caller input; routes translate this to HTTP 400."""

def _init():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    SLIDES_DIR.mkdir(parents=True, exist_ok=True)

def _read_json(path):
    return read_json(path, [])

def _write_json(path, data):
    write_json(path, data)

# ─── Trials ───

def create_trial(name: str, sponsor: str, drug: str, indication: str, notes: str = "",
                  sites: Optional[list] = None) -> dict:
    _init()
    name = (name or "").strip()
    sponsor = (sponsor or "").strip()
    drug = (drug or "").strip()
    if not name:
        raise ValidationError("Trial name is required")
    if not sponsor:
        raise ValidationError("Sponsor is required")
    if not drug:
        raise ValidationError("Drug is required")
    for label, value in (("Trial name", name), ("Sponsor", sponsor), ("Drug", drug),
                         ("Indication", indication or "")):
        if len(value) > MAX_NAME_LEN:
            raise ValidationError(f"{label} must be {MAX_NAME_LEN} characters or fewer")
    trial = {
        "id": str(uuid.uuid4())[:8],
        "name": name,
        "sponsor": sponsor,
        "drug": drug,
        "indication": indication,
        "notes": notes,
        "sites": sites or [],
        "status": "active",
        "patient_count": 0,
        "slides_analyzed": 0,
        "slides_confirmed": 0,
        "created": datetime.datetime.now().isoformat(),
    }
    with transaction():
        trials = _read_json(TRIALS_FILE)
        trials.append(trial)
        _write_json(TRIALS_FILE, trials)
    return trial

def list_trials() -> list:
    _init()
    return _read_json(TRIALS_FILE)

def get_trial(trial_id: str) -> Optional[dict]:
    for t in list_trials():
        if t["id"] == trial_id:
            return t
    return None

def update_trial(trial_id: str, updates: dict) -> Optional[dict]:
    with transaction():
        trials = list_trials()
        for t in trials:
            if t["id"] == trial_id:
                t.update(updates)
                _write_json(TRIALS_FILE, trials)
                return t
    return None

def delete_trial(trial_id: str) -> bool:
    """Delete a trial and everything belonging to it: patients, stored slide
    files on disk, and any queries raised against it. Leaving these behind
    orphans records and silently leaks slide files forever."""
    with transaction():
        return _delete_trial_locked(trial_id)

def _delete_trial_locked(trial_id: str) -> bool:
    trials = list_trials()
    new = [t for t in trials if t["id"] != trial_id]
    if len(new) == len(trials):
        return False

    # Remove stored slide files for this trial's patients before dropping records.
    for p in list_patients(trial_id):
        for s in p.get("slides", []):
            fp = s.get("filepath")
            if fp:
                try:
                    path = Path(fp)
                    # Only ever unlink inside our own slides directory.
                    if path.is_file() and SLIDES_DIR.resolve() in path.resolve().parents:
                        path.unlink()
                except OSError:
                    pass

    _write_json(TRIALS_FILE, new)
    keep = [p for p in _read_json(PATIENTS_FILE) if p["trial_id"] != trial_id]
    _write_json(PATIENTS_FILE, keep)

    # Cascade to queries (imported lazily to avoid a circular import).
    try:
        from backend.queries import delete_queries_for_trial
        delete_queries_for_trial(trial_id)
    except Exception:
        pass
    return True

# ─── Patients ───

def add_patient(trial_id: str, patient_id: str, visit: str = "Baseline", notes: str = "",
                site: str = "") -> Optional[dict]:
    """Add a patient to a trial. Returns None if the trial does not exist so the
    caller can 404 instead of silently creating an orphan record."""
    _init()
    trial = get_trial(trial_id)
    if not trial:
        return None
    if trial.get("status") == "closed":
        raise ValidationError(
            "This trial is closed. Reopen it before adding patients."
        )
    patient_id = (patient_id or "").strip()
    visit = (visit or "Baseline").strip() or "Baseline"
    if not patient_id:
        raise ValidationError("Patient ID is required")
    if len(patient_id) > MAX_NAME_LEN:
        raise ValidationError(f"Patient ID must be {MAX_NAME_LEN} characters or fewer")
    # A patient may legitimately appear at several visits, but the same
    # patient ID at the same visit is a duplicate record.
    for existing in list_patients(trial_id):
        if existing["patient_id"].strip().lower() == patient_id.lower() and \
           existing.get("visit", "").strip().lower() == visit.lower():
            raise ValidationError(f"Patient {patient_id} already exists at visit {visit}")
    patient = {
        "id": str(uuid.uuid4())[:8],
        "trial_id": trial_id,
        "patient_id": patient_id,
        "visit": visit,
        "notes": notes,
        "site": site,
        "slides": [],
        "status": "pending",
        "created": datetime.datetime.now().isoformat(),
    }
    with transaction():
        patients = _read_json(PATIENTS_FILE)
        patients.append(patient)
        _write_json(PATIENTS_FILE, patients)
        if get_trial(trial_id):
            update_trial(trial_id, {"patient_count": len(list_patients(trial_id))})
    return patient

def list_patients(trial_id: str = None) -> list:
    _init()
    all_patients = _read_json(PATIENTS_FILE)
    if trial_id:
        return [p for p in all_patients if p["trial_id"] == trial_id]
    return all_patients

def get_patient(patient_uuid: str)  -> Optional[dict]:
    for p in list_patients():
        if p["id"] == patient_uuid:
            return p
    return None

def update_patient(patient_uuid: str, updates: dict)  -> Optional[dict]:
    with transaction():
        patients = _read_json(PATIENTS_FILE)
        for p in patients:
            if p["id"] == patient_uuid:
                p.update(updates)
                _write_json(PATIENTS_FILE, patients)
                return p
    return None

def _remove_slide_file(slide: dict):
    """Delete a slide's stored file, but only ever inside our own slides dir."""
    fp = slide.get("filepath")
    if not fp:
        return
    try:
        path = Path(fp)
        if path.is_file() and SLIDES_DIR.resolve() in path.resolve().parents:
            path.unlink()
    except OSError:
        pass

def delete_patient(patient_uuid: str) -> Optional[dict]:
    """Remove a patient and their stored slide files.

    Signed slides are part of the regulatory record, so a patient carrying any
    e-signed slide cannot be deleted — the trial-level delete is the only way
    to remove signed data, and that is an explicit admin action.
    """
    with transaction():
        patients = _read_json(PATIENTS_FILE)
        for i, p in enumerate(patients):
            if p["id"] == patient_uuid:
                if any(s.get("confirmed") for s in p.get("slides", [])):
                    raise ValidationError(
                        "This patient has electronically signed slides and cannot be deleted."
                    )
                for s in p.get("slides", []):
                    _remove_slide_file(s)
                removed = patients.pop(i)
                _write_json(PATIENTS_FILE, patients)
                trial_id = removed["trial_id"]
                if get_trial(trial_id):
                    update_trial(trial_id, {"patient_count": len(list_patients(trial_id))})
                _refresh_trial_slide_stats(trial_id)
                return removed
    return None

def delete_slide(patient_uuid: str, slide_id: str) -> Optional[dict]:
    """Remove a single slide and its stored file. Signed slides are immutable."""
    with transaction():
        patients = _read_json(PATIENTS_FILE)
        for p in patients:
            if p["id"] == patient_uuid:
                for i, s in enumerate(p.get("slides", [])):
                    if s["id"] == slide_id:
                        if s.get("confirmed"):
                            raise ValidationError(
                                "This slide has been electronically signed and cannot be deleted."
                            )
                        _remove_slide_file(s)
                        removed = p["slides"].pop(i)
                        _recompute_patient_status(p)
                        _write_json(PATIENTS_FILE, patients)
                        _refresh_trial_slide_stats(p["trial_id"])
                        return removed
    return None

def set_trial_status(trial_id: str, status: str) -> Optional[dict]:
    """Close or reopen a trial. Closing marks enrollment/review complete."""
    valid = ("active", "closed")
    if status not in valid:
        raise ValidationError(f"Status must be one of: {', '.join(valid)}")
    return update_trial(trial_id, {"status": status})

def _refresh_trial_slide_stats(trial_id: str):
    if not get_trial(trial_id):
        return
    all_slides = [s for pat in list_patients(trial_id) for s in pat["slides"]]
    confirmed = sum(1 for s in all_slides if s.get("confirmed"))
    update_trial(trial_id, {
        "slides_analyzed": len(all_slides),
        "slides_confirmed": confirmed,
    })

def add_slide_upload(patient_uuid: str, filename: str, source: BinaryIO) -> Optional[dict]:
    """Stream an uploaded slide file to disk and register it against the patient.

    `source` is a file-like object; it is streamed rather than read into memory
    because real whole-slide images are routinely 1-3 GB.
    """
    _init()
    filename = safe_filename(filename)
    if not filename.lower().endswith(ALLOWED_SLIDE_EXTENSIONS):
        raise ValidationError(
            f"Unsupported file type. Expected {' or '.join(ALLOWED_SLIDE_EXTENSIONS)}"
        )
    patient = get_patient(patient_uuid)
    if not patient:
        return None
    parent = get_trial(patient["trial_id"])
    if parent and parent.get("status") == "closed":
        raise ValidationError("This trial is closed. Reopen it before uploading slides.")

    slide_id = str(uuid.uuid4())[:8]
    stored_path = SLIDES_DIR / f"{slide_id}_{filename}"
    try:
        with open(stored_path, "wb") as dest:
            shutil.copyfileobj(source, dest, length=1024 * 1024)
        file_size = stored_path.stat().st_size
    except BaseException:
        try:
            stored_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise

    slide = {
        "id": slide_id,
        "filename": filename,
        "filepath": str(stored_path),
        "file_size": file_size,
        "status": "pending",
        "grade": None,
        "grade_group": None,
        "size_mm": None,
        "tumor_involvement_pct": None,
        "perineural_invasion": None,
        "lymphovascular_invasion": None,
        "cribriform_pattern": None,
        "risk_group": None,
        "biomarkers": {},
        "quality": None,
        "regions_analyzed": None,
        "suspicious_regions": None,
        "processing_time_s": None,
        "model_version": None,
        "confidence": None,
        "analysis_source": None,
        "confirmed": False,
        "doctor_correction": None,
        "created": datetime.datetime.now().isoformat(),
    }

    # The record append must be atomic end-to-end, or parallel uploads
    # read the same list and overwrite each other's additions.
    with transaction():
        patients = _read_json(PATIENTS_FILE)
        for p in patients:
            if p["id"] == patient_uuid:
                p["slides"].append(slide)
                _write_json(PATIENTS_FILE, patients)
                _refresh_trial_slide_stats(p["trial_id"])
                return slide
    return None

def _recompute_patient_status(patient: dict):
    """A patient is only 'reviewed' once every one of their slides is signed off.
    Marking them reviewed after a single confirmation hides pending work."""
    slides = patient.get("slides", [])
    if not slides:
        patient["status"] = "pending"
    elif all(s.get("confirmed") for s in slides):
        patient["status"] = "reviewed"
    else:
        patient["status"] = "in_review"

def run_analysis(patient_uuid: str, slide_id: str) -> Optional[dict]:
    with transaction():
        """Run (mock or real) AI analysis on a slide and store the results.
        See backend/analysis_engine.py for the model integration point."""
        patients = _read_json(PATIENTS_FILE)
        for p in patients:
            if p["id"] == patient_uuid:
                for s in p["slides"]:
                    if s["id"] == slide_id:
                        # Re-running analysis after sign-off would silently replace the
                        # data a pathologist legally attested to. Refuse it.
                        if s.get("confirmed"):
                            raise ValidationError(
                                "This slide has been electronically signed and cannot be re-analyzed."
                            )
                        result = analyze_slide(s["filename"], s.get("filepath", ""))
                        s["grade"] = result["grade"]
                        s["grade_group"] = result["grade_group"]
                        s["confidence"] = result["confidence"]
                        s["size_mm"] = result["size_mm"]
                        s["tumor_involvement_pct"] = result["tumor_involvement_pct"]
                        s["perineural_invasion"] = result["perineural_invasion"]
                        s["lymphovascular_invasion"] = result["lymphovascular_invasion"]
                        s["cribriform_pattern"] = result["cribriform_pattern"]
                        s["risk_group"] = result["risk_group"]
                        s["biomarkers"] = result["biomarkers"]
                        s["quality"] = result["quality"]
                        s["regions_analyzed"] = result["regions_analyzed"]
                        s["suspicious_regions"] = result["suspicious_regions"]
                        s["processing_time_s"] = result["processing_time_s"]
                        s["model_version"] = result["model_version"]
                        s["analysis_source"] = result["source"]
                        s["status"] = "analyzed"
                        _write_json(PATIENTS_FILE, patients)
                        return s
        return None

def confirm_slide(patient_uuid: str, slide_id: str, signed_by: str = "", signature_meaning: str = "Reviewed and Approved")  -> Optional[dict]:
    with transaction():
        patients = _read_json(PATIENTS_FILE)
        for p in patients:
            if p["id"] == patient_uuid:
                for s in p["slides"]:
                    if s["id"] == slide_id:
                        if s.get("confirmed"):
                            raise ValidationError("This slide has already been signed.")
                        if not s.get("grade"):
                            raise ValidationError(
                                "Slide has not been analyzed yet — there is nothing to attest to."
                            )
                        s["confirmed"] = True
                        s["doctor_correction"] = None
                        s["signed_by"] = signed_by
                        s["signed_at"] = datetime.datetime.now().isoformat()
                        s["signature_meaning"] = signature_meaning
                        _recompute_patient_status(p)
                        _write_json(PATIENTS_FILE, patients)
                        _refresh_trial_slide_stats(p["trial_id"])
                        return s

    return None

def correct_slide(patient_uuid: str, slide_id: str, correction: str, signed_by: str = "")  -> Optional[dict]:
    with transaction():
        patients = _read_json(PATIENTS_FILE)
        for p in patients:
            if p["id"] == patient_uuid:
                for s in p["slides"]:
                    if s["id"] == slide_id:
                        if s.get("confirmed"):
                            raise ValidationError("This slide has already been signed.")
                        if not s.get("grade"):
                            raise ValidationError(
                                "Slide has not been analyzed yet — there is nothing to correct."
                            )
                        correction = (correction or "").strip()
                        if not correction:
                            raise ValidationError("A corrected grade is required")
                        s["confirmed"] = True
                        s["doctor_correction"] = correction
                        s["signed_by"] = signed_by
                        s["signed_at"] = datetime.datetime.now().isoformat()
                        s["signature_meaning"] = "Reviewed and Corrected"
                        _recompute_patient_status(p)
                        _write_json(PATIENTS_FILE, patients)
                        _refresh_trial_slide_stats(p["trial_id"])
                        return s

    return None

# ─── Export ───

def export_corrections(trial_id: str) -> list:
    """Export all doctor corrections for federated training."""
    corrections = []
    for p in list_patients(trial_id):
        for s in p["slides"]:
            if s.get("confirmed") or s.get("doctor_correction"):
                corrections.append({
                    "patient_id": p["patient_id"],
                    "visit": p["visit"],
                    "slide": s["filename"],
                    "ai_grade": s.get("grade"),
                    "doctor_grade": s.get("doctor_correction") or s.get("grade"),
                    "grade_group": s.get("grade_group"),
                    "risk_group": s.get("risk_group"),
                    "ai_confidence": s.get("confidence"),
                    "tumor_involvement_pct": s.get("tumor_involvement_pct"),
                    "perineural_invasion": s.get("perineural_invasion"),
                    "lymphovascular_invasion": s.get("lymphovascular_invasion"),
                    "cribriform_pattern": s.get("cribriform_pattern"),
                    "confirmed": s.get("confirmed"),
                    "signed_by": s.get("signed_by"),
                    "signed_at": s.get("signed_at"),
                    "signature_meaning": s.get("signature_meaning"),
                })
    return corrections

def export_corrections_csv(trial_id: str) -> str:
    import io
    import csv
    rows = export_corrections(trial_id)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["patient_id", "visit", "slide", "ai_grade", "doctor_grade", "grade_group",
                      "risk_group", "ai_confidence", "tumor_involvement_pct", "perineural_invasion",
                      "lymphovascular_invasion", "cribriform_pattern", "confirmed",
                      "signed_by", "signed_at", "signature_meaning"])
    # `or ""` would turn legitimate zero values (0% involvement, 0.0 confidence)
    # into blanks, so fall back only on None.
    def cell(v):
        return "" if v is None else v
    for r in rows:
        writer.writerow([r["patient_id"], r["visit"], r["slide"], cell(r.get("ai_grade")),
                          cell(r.get("doctor_grade")), cell(r.get("grade_group")), cell(r.get("risk_group")),
                          cell(r.get("ai_confidence")), cell(r.get("tumor_involvement_pct")),
                          cell(r.get("perineural_invasion")), cell(r.get("lymphovascular_invasion")),
                          cell(r.get("cribriform_pattern")), cell(r.get("confirmed")), cell(r.get("signed_by")),
                          cell(r.get("signed_at")), cell(r.get("signature_meaning"))])
    return buf.getvalue()

def export_patients_csv(trial_id: str) -> str:
    import io
    import csv
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["patient_id", "site", "visit", "status", "slide_count", "confirmed_count", "created"])
    for p in list_patients(trial_id):
        slides = p.get("slides", [])
        confirmed = sum(1 for s in slides if s.get("confirmed"))
        writer.writerow([p["patient_id"], p.get("site", ""), p["visit"], p["status"],
                          len(slides), confirmed, p["created"]])
    return buf.getvalue()
