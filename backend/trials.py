"""Omnia AI — Trial & Patient Manager (JSON file storage, no DB needed)."""
import os
import uuid
import shutil
import datetime
from pathlib import Path
from typing import Optional, BinaryIO
from backend.analysis_engine import analyze_slide, AnalysisFailedError
from backend.storage import read_json, write_json, safe_filename, transaction
from backend import patients as registry

DATA_DIR = Path(os.environ.get("OMNIA_DATA_DIR", ".")) / "data"
TRIALS_FILE = DATA_DIR / "trials.json"
PATIENTS_FILE = DATA_DIR / "patients.json"
SLIDES_DIR = DATA_DIR / "slides"
# Rendered slide thumbnails. Derived data — safe to delete, rebuilt on demand.
THUMB_CACHE_DIR = DATA_DIR / "thumb_cache"

ALLOWED_SLIDE_EXTENSIONS = (".svs",)
MAX_NAME_LEN = 200

# A trial in a regulated setting is identified by its registry/protocol number,
# not by an internal nickname — two sponsors can both run an "ALK-427". The
# field is optional so existing records stay valid, but it is captured at
# creation because retro-fitting an identifier onto accumulated slide data is
# how records get mismatched.
MAX_PROTOCOL_LEN = 100

# Phases are a closed vocabulary; free text here makes cohorts unfilterable.
# "" means the coordinator has not stated one.
TRIAL_PHASES = (
    "", "Preclinical", "Phase I", "Phase I/II", "Phase II",
    "Phase II/III", "Phase III", "Phase IV", "Observational",
)

# Canonical text for each ISUP grade group. Kept here (not imported from
# analysis_engine) because corrections are validated at the storage layer.
GRADE_TEXT_BY_GROUP = {
    0: "Benign / no tumor identified",
    1: "3+3=6",
    2: "3+4=7",
    3: "4+3=7",
    4: "4+4=8",
    5: "4+5=9",
}


def grade_group_from_text(text: str):
    """Resolve a pathologist's correction to an ISUP grade group, or None.

    Accepts the canonical text, a bare group number, or a Gleason pattern
    written with incidental spaces. Anything it cannot resolve returns None
    so the caller rejects it rather than storing an unusable label.
    """
    raw = (text or "").strip()
    if not raw:
        return None
    if raw.isdigit() and 0 <= int(raw) <= 5:
        return int(raw)
    squashed = "".join(raw.split()).lower()
    for group, canonical in GRADE_TEXT_BY_GROUP.items():
        if squashed == "".join(canonical.split()).lower():
            return group
    # "4+3=7" and "4+3" both identify group 3; the sum is redundant.
    import re as _re
    m = _re.match(r"^(?:gleason)?(\d)\+(\d)(?:=\d+)?$", squashed)
    if m:
        primary, secondary = int(m.group(1)), int(m.group(2))
        for group, canonical in GRADE_TEXT_BY_GROUP.items():
            if canonical.startswith(f"{primary}+{secondary}"):
                return group
    if "benign" in squashed:
        return 0
    return None


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
                  sites: Optional[list] = None, protocol_id: str = "",
                  phase: str = "") -> dict:
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
    protocol_id = (protocol_id or "").strip()
    phase = (phase or "").strip()
    for label, value in (("Trial name", name), ("Sponsor", sponsor), ("Drug", drug),
                         ("Indication", indication or "")):
        if len(value) > MAX_NAME_LEN:
            raise ValidationError(f"{label} must be {MAX_NAME_LEN} characters or fewer")
    if len(protocol_id) > MAX_PROTOCOL_LEN:
        raise ValidationError(f"Protocol ID must be {MAX_PROTOCOL_LEN} characters or fewer")
    if phase not in TRIAL_PHASES:
        raise ValidationError(f"Phase must be one of: {', '.join(p for p in TRIAL_PHASES if p)}")
    trial = {
        "id": str(uuid.uuid4())[:8],
        "name": name,
        "protocol_id": protocol_id,
        "phase": phase,
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
                    if path.is_file() and _is_managed_slide_path(path):
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

def add_patient(trial_id: str, patient_id: str = "", visit: str = "Baseline", notes: str = "",
                site: str = "", patient_uid: str = "",
                profile: Optional[dict] = None) -> Optional[dict]:
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
    visit = (visit or "Baseline").strip() or "Baseline"

    # Resolve which person this visit belongs to. Either the caller names an
    # already-registered patient, or one is registered now — a visit is never
    # filed against a bare string again, which is what allowed the same
    # subject to split into several under slightly different spellings.
    if patient_uid:
        known = registry.get_patient(patient_uid)
        if not known:
            raise ValidationError("No patient is registered with that ID")
        patient_uid = known["uid"]
    else:
        known = registry.create_patient(**(profile or {}))
        patient_uid = known["uid"]
    registry.ensure_container(patient_uid)

    # The subject code is the site's own label for this person within this
    # trial. It is optional: when a site has not assigned one, the generated
    # patient ID stands in, so the record is never unlabelled.
    patient_id = (patient_id or "").strip() or patient_uid
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
        "patient_uid": patient_uid,
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

def _is_managed_slide_path(path: Path) -> bool:
    """True if `path` is a slide file this application owns.

    Slides live either in the legacy flat directory or inside a patient
    container; both are under our data directory. Anything else — a path a
    record was doctored to point at — must never be unlinked.
    """
    try:
        resolved = path.resolve()
    except OSError:
        return False
    roots = (SLIDES_DIR.resolve(), registry.PATIENT_ROOT.resolve())
    return any(root in resolved.parents for root in roots)


def _remove_slide_file(slide: dict):
    """Delete a slide's stored file, only if this application owns it."""
    fp = slide.get("filepath")
    if not fp:
        return
    try:
        path = Path(fp)
        if path.is_file() and _is_managed_slide_path(path):
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

# A trial can be suspended without being finished — by a data monitoring
# committee, by the sponsor, or by a regulator — and that is a different state
# from "closed" in every way that matters: enrolment stops but the trial is
# still live, its data is still under retention, and it can resume. Collapsing
# it into "closed" would have told a monitor the study had ended.
TRIAL_STATUSES = ("active", "on_hold", "closed")


def set_trial_status(trial_id: str, status: str) -> Optional[dict]:
    """Move a trial between running, suspended and closed.

    Closing stamps the end date, because the moment a trial closes is the only
    moment the software can know it — asking someone to type it later produces
    a date that is remembered rather than recorded. Reopening clears it again,
    so a running trial never carries an end date it has not reached.
    """
    if status not in TRIAL_STATUSES:
        raise ValidationError(f"Status must be one of: {', '.join(TRIAL_STATUSES)}")
    updates = {"status": status}
    if status == "closed":
        updates["ended"] = datetime.datetime.now().isoformat()
    else:
        updates["ended"] = ""
    return update_trial(trial_id, updates)

def _refresh_trial_slide_stats(trial_id: str):
    if not get_trial(trial_id):
        return
    all_slides = [s for pat in list_patients(trial_id) for s in pat["slides"]]
    confirmed = sum(1 for s in all_slides if s.get("confirmed"))
    update_trial(trial_id, {
        "slides_analyzed": len(all_slides),
        "slides_confirmed": confirmed,
    })

def _assert_readable_slide(path: str):
    """Raise ValidationError unless openslide can actually open this file.

    Imported lazily: openslide pulls in a native library, and the rest of
    trial/patient management must keep working on a machine where slide
    support isn't available.
    """
    from backend import testmode

    if testmode.active():
        return  # test fixtures upload dummy bytes on purpose; see grading_model.predict
    try:
        import openslide
    except Exception:
        # No slide support installed — accept the file rather than block
        # uploads outright, and let analysis report the real problem.
        return
    try:
        slide = openslide.OpenSlide(path)
    except Exception as e:
        raise ValidationError(
            "This file could not be opened as a whole-slide image. It may be "
            f"corrupt, incomplete, or an unsupported format. ({e})"
        )
    try:
        w, h = slide.dimensions
        if w <= 0 or h <= 0:
            raise ValidationError("This slide reports no image dimensions and cannot be analysed.")
    finally:
        slide.close()


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
    # Slides are filed in the owning patient's container so a person's
    # material lives in one place on disk. Records written before containers
    # existed keep their absolute path in the slide record and still resolve,
    # so this does not orphan anything; SLIDES_DIR remains the fallback for
    # any visit that predates the registry.
    _uid = patient.get("patient_uid")
    if _uid:
        stored_path = registry.ensure_container(_uid)["slides"] / f"{slide_id}_{filename}"
    else:
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

    if file_size == 0:
        stored_path.unlink(missing_ok=True)
        raise ValidationError("That file is empty.")

    # Verify the file is actually a readable whole-slide image NOW, while the
    # user is still watching the upload — not tens of seconds later when
    # analysis fails. A correct .svs extension proves nothing: a renamed
    # PDF, a truncated transfer, or an unsupported vendor format all reach
    # this point looking fine. Rejecting here also stops unreadable files
    # accumulating on disk against patient records.
    try:
        _assert_readable_slide(str(stored_path))
    except ValidationError:
        stored_path.unlink(missing_ok=True)
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
        """Run the trained grading model on a slide and store the results.
        See backend/analysis_engine.py. Raises AnalysisFailedError rather
        than storing a substitute grade if the model cannot run."""
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
                        try:
                            result = analyze_slide(s["filename"], s.get("filepath", ""))
                        except AnalysisFailedError as e:
                            # A failed analysis must surface as a failure, not
                            # silently leave the slide in its prior state or
                            # (worse) show a fabricated grade. The pathologist
                            # sees "analysis failed" and can retry or escalate.
                            s["status"] = "analysis_failed"
                            s["model_error"] = str(e)
                            _write_json(PATIENTS_FILE, patients)
                            return s
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
                        s["attention_regions"] = result.get("attention_regions", [])
                        s["slide_width"] = result.get("slide_width")
                        s["slide_height"] = result.get("slide_height")
                        s["model_error"] = None
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
                        # Corrections are the ground-truth labels a fine-tune
                        # learns from, so they must be one of the six ISUP
                        # grade groups rather than free text. "4+3=7" and
                        # "Gleason 4+3" and "4 + 3 = 7" were all accepted
                        # before and none of them resolve to a label.
                        corrected_group = grade_group_from_text(correction)
                        if corrected_group is None:
                            raise ValidationError(
                                "Corrected grade must be one of: "
                                + "; ".join(f"{g} ({t})" for g, t in GRADE_TEXT_BY_GROUP.items())
                            )
                        correction = GRADE_TEXT_BY_GROUP[corrected_group]
                        s["corrected_grade_group"] = corrected_group
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
