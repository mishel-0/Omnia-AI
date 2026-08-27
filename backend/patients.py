"""Omnia AI — patient registry and per-patient container.

Why this module exists
----------------------
Before this, a "patient" was a visit row: one record per (typed patient ID,
visit) pair, scoped to a single trial. That has two defects that matter in a
regulated setting:

  1. The identifier was typed by hand. "PT-001", "PT001" and "pt 001" are
     three different subjects to the system and one subject to the person
     entering them. Silent subject-splitting corrupts every longitudinal
     analysis built on top of it.

  2. There was no patient entity at all — only rows that happened to share a
     string. Nothing owned a person's slides, visits and reports, so nothing
     could be retrieved as "this patient's record".

This module introduces the missing entity: a registry of patients, each with
a generated identifier and a directory on disk that holds their material.

Identifiers
-----------
IDs are generated, never typed, and carry a check character. A mistyped or
misread ID is *rejected* rather than silently resolving to a different
patient — the failure mode that matters here is not "ID not found", it is
"ID found, wrong person".

Privacy
-------
The profile is deliberately pseudonymised. It stores no name and no full date
of birth, because this system's purpose is trial analysis, not identity. Year
of birth is kept because age matters clinically; the day and month do not,
and together with sex and site they would make a record re-identifiable.
Sites hold the identity mapping; this application deliberately does not.
"""
import os
import re
import uuid
import random
import datetime
from pathlib import Path
from typing import Optional

from backend.storage import read_json, write_json, transaction

DATA_DIR = Path(os.environ.get("OMNIA_DATA_DIR", ".")) / "data"
REGISTRY_FILE = DATA_DIR / "patient_registry.json"
PATIENT_ROOT = DATA_DIR / "patients"

# Crockford Base32: digits plus letters, excluding I, L, O and U. I/L/O are
# excluded because they are misread as 1/1/0, and U because it turns random
# strings into words. Crockford also defines how to fold the ambiguous glyphs
# on input (I and L read as 1, O reads as 0), so a human who types what they
# think they see still lands on the right patient.
#
# The size matters mathematically, not just aesthetically: the Luhn mod-N
# check below catches every single-character substitution only when N is even.
# An earlier 31-character alphabet here left 4 substitutions in 240 undetected,
# because with odd N the doubling step collides (values 1 and 16 both map to 2).
ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
BASE = len(ALPHABET)  # 32 — even, so the doubling map is a permutation.

# Applied before validation, per the Crockford spec.
_FOLD = {"I": "1", "L": "1", "O": "0"}

UID_PREFIX = "OMN"
UID_BODY_LEN = 7  # plus one check character

MAX_NOTE_LEN = 2000
SEXES = ("", "male", "female", "other")

# Year of birth outside this window is a typo, not a patient.
MIN_BIRTH_YEAR = 1900


class ValidationError(ValueError):
    """Raised for invalid caller input; routes translate this to HTTP 400."""


def _init():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    PATIENT_ROOT.mkdir(parents=True, exist_ok=True)


# ─── Identifier generation and validation ───

def _check_char(body: str) -> str:
    """Luhn mod-N check character over ALPHABET.

    Catches every single-character substitution and every transposition of
    adjacent unlike characters — the two ways a human miscopies an ID.
    """
    factor, total = 2, 0
    for ch in reversed(body):
        addend = factor * ALPHABET.index(ch)
        factor = 1 if factor == 2 else 2
        total += (addend // BASE) + (addend % BASE)
    return ALPHABET[(BASE - (total % BASE)) % BASE]


def format_uid(raw: str) -> str:
    """Canonical display form: OMN-XXXX-XXXX."""
    return f"{UID_PREFIX}-{raw[:4]}-{raw[4:]}"


def generate_uid(existing: Optional[set] = None) -> str:
    """Generate a fresh, unused patient identifier."""
    existing = existing or set()
    rng = random.SystemRandom()
    for _ in range(1000):
        body = "".join(rng.choice(ALPHABET) for _ in range(UID_BODY_LEN))
        uid = format_uid(body + _check_char(body))
        if uid not in existing:
            return uid
    # 32^7 is ~3.4e10; exhausting 1000 attempts means the registry is
    # implausibly large or the RNG is broken. Fail loudly either way.
    raise RuntimeError("Could not generate an unused patient ID")


def normalise_uid(uid: str) -> str:
    """Accept what a human would plausibly type, return the canonical form.

    Case and separators are forgiving; the check character is not.
    """
    cleaned = re.sub(r"[^0-9A-Za-z]", "", uid or "").upper()
    if cleaned.startswith(UID_PREFIX):
        cleaned = cleaned[len(UID_PREFIX):]
    # Fold the glyphs Crockford treats as interchangeable, so an ID read off
    # a screen as "OMN-I234..." resolves to the 1 that was actually printed.
    cleaned = "".join(_FOLD.get(c, c) for c in cleaned)
    if len(cleaned) != UID_BODY_LEN + 1:
        raise ValidationError("Patient ID is not the right length")
    if any(c not in ALPHABET for c in cleaned):
        raise ValidationError("Patient ID contains characters that are not valid")
    if _check_char(cleaned[:-1]) != cleaned[-1]:
        # This is the important branch: a typo must not resolve to a real
        # but different patient.
        raise ValidationError("Patient ID failed its check character — it was mistyped or misread")
    return format_uid(cleaned)


def is_valid_uid(uid: str) -> bool:
    try:
        normalise_uid(uid)
        return True
    except ValidationError:
        return False


# ─── Container on disk ───

def patient_dir(uid: str) -> Path:
    """Directory holding everything belonging to one patient.

    The uid is validated before it reaches the filesystem, so it cannot
    contain separators or traversal sequences.
    """
    uid = normalise_uid(uid)
    return PATIENT_ROOT / uid.replace("-", "_")


def ensure_container(uid: str) -> dict:
    """Create the patient's folder structure. Idempotent."""
    root = patient_dir(uid)
    subdirs = {name: root / name for name in ("slides", "reports")}
    root.mkdir(parents=True, exist_ok=True)
    for path in subdirs.values():
        path.mkdir(parents=True, exist_ok=True)
    return {"root": root, **subdirs}


# ─── Registry ───

def _read_registry() -> list:
    return read_json(REGISTRY_FILE, [])


def _write_registry(data) -> None:
    write_json(REGISTRY_FILE, data)


def create_patient(initials: str = "", year_of_birth=None, sex: str = "",
                   site: str = "", notes: str = "") -> dict:
    """Register a new patient and build their container.

    The identifier is generated here and never supplied by the caller, so two
    coordinators cannot mint the same one.
    """
    _init()
    initials = (initials or "").strip().upper()
    sex = (sex or "").strip().lower()
    site = (site or "").strip()
    notes = (notes or "").strip()

    if initials and not re.fullmatch(r"[A-Z]{1,4}", initials):
        raise ValidationError("Initials must be 1–4 letters")
    if sex not in SEXES:
        raise ValidationError(f"Sex must be one of: {', '.join(s for s in SEXES if s)}")
    if len(notes) > MAX_NOTE_LEN:
        raise ValidationError(f"Notes must be {MAX_NOTE_LEN} characters or fewer")

    if year_of_birth in (None, ""):
        year_of_birth = None
    else:
        try:
            year_of_birth = int(year_of_birth)
        except (TypeError, ValueError):
            raise ValidationError("Year of birth must be a number")
        this_year = datetime.date.today().year
        if not (MIN_BIRTH_YEAR <= year_of_birth <= this_year):
            raise ValidationError(f"Year of birth must be between {MIN_BIRTH_YEAR} and {this_year}")

    with transaction():
        registry = _read_registry()
        uid = generate_uid({p["uid"] for p in registry})
        patient = {
            "uid": uid,
            "initials": initials,
            "year_of_birth": year_of_birth,
            "sex": sex,
            "site": site,
            "notes": notes,
            "created": datetime.datetime.now().isoformat(),
        }
        registry.append(patient)
        _write_registry(registry)

    # Built after the record commits: an orphaned directory is harmless and
    # recoverable, a registry entry with no container is not.
    ensure_container(uid)
    return patient


def get_patient(uid: str) -> Optional[dict]:
    _init()
    try:
        uid = normalise_uid(uid)
    except ValidationError:
        return None
    for p in _read_registry():
        if p["uid"] == uid:
            return p
    return None


def list_registry() -> list:
    _init()
    return _read_registry()


def update_patient(uid: str, updates: dict) -> Optional[dict]:
    """Amend a profile. The uid itself is immutable — reassigning an
    identifier would break every record that already references it."""
    _init()
    try:
        uid = normalise_uid(uid)
    except ValidationError:
        return None
    allowed = {"initials", "year_of_birth", "sex", "site", "notes"}
    updates = {k: v for k, v in updates.items() if k in allowed}
    with transaction():
        registry = _read_registry()
        for p in registry:
            if p["uid"] == uid:
                p.update(updates)
                _write_registry(registry)
                return p
    return None


# ─── Stored reports ───
#
# Reports used to be generated and streamed straight to the browser, so a
# signed report existed only in whatever the user did with the download. A
# report that cannot be retrieved later is not a record. These are written
# into the patient's container so the document that was issued can be
# produced again unchanged.

def save_report(uid: str, filename: str, content: bytes, meta: Optional[dict] = None) -> dict:
    """Persist a generated report into the patient's container."""
    paths = ensure_container(uid)
    safe = re.sub(r"[^A-Za-z0-9._-]", "_", filename or "report.pdf")
    stamp = datetime.datetime.now().strftime("%Y%m%dT%H%M%S")
    stored = f"{stamp}_{safe}"
    target = paths["reports"] / stored
    # Write-then-rename: a reader never sees a half-written report.
    tmp = target.with_suffix(target.suffix + ".part")
    tmp.write_bytes(content)
    tmp.replace(target)
    record = {
        "file": stored,
        "size": len(content),
        "created": datetime.datetime.now().isoformat(),
        **(meta or {}),
    }
    index = paths["root"] / "reports.json"
    existing = read_json(index, [])
    existing.append(record)
    write_json(index, existing)
    return record


def list_reports(uid: str) -> list:
    """Reports on file for a patient, newest first."""
    try:
        root = patient_dir(uid)
    except ValidationError:
        return []
    records = read_json(root / "reports.json", [])
    # Only report what is actually still on disk — a stale index entry would
    # advertise a document that cannot be produced.
    present = []
    for r in records:
        if (root / "reports" / r.get("file", "")).is_file():
            present.append(r)
    return sorted(present, key=lambda r: r.get("created", ""), reverse=True)


def report_path(uid: str, filename: str) -> Optional[Path]:
    """Resolve a stored report, refusing anything outside the container."""
    try:
        root = patient_dir(uid)
    except ValidationError:
        return None
    reports = (root / "reports").resolve()
    candidate = (reports / filename).resolve()
    # Containment check, not string matching: a crafted filename must not
    # escape the patient's own directory.
    if reports not in candidate.parents or not candidate.is_file():
        return None
    return candidate


# ─── Container view ───

def build_patient_container(uid: str, visit_records: list, trials: list) -> Optional[dict]:
    """Everything filed under one patient, grouped by trial.

    Pure function over data the caller supplies, so this module stays free of
    import cycles with the trial store.
    """
    patient = get_patient(uid)
    if not patient:
        return None
    uid = patient["uid"]

    mine = [v for v in visit_records if v.get("patient_uid") == uid]
    trials_by_id = {t["id"]: t for t in trials}

    grouped = {}
    for v in mine:
        grouped.setdefault(v.get("trial_id"), []).append(v)

    enrollments = []
    for trial_id, visits in grouped.items():
        trial = trials_by_id.get(trial_id)
        slides = [s for v in visits for s in v.get("slides", [])]
        # Slide records store the grade FLAT — grade, grade_group, status —
        # not under a nested "analysis" object. Filtering on s["analysis"]
        # matched nothing, so a patient with a signed, graded slide reported
        # zero analysed and zero signed while the dashboard correctly showed
        # one of each. grade_group 0 is a real result (benign), so this tests
        # for presence, not truthiness.
        analysed = [s for s in slides if s.get("grade_group") is not None]
        enrollments.append({
            "trial_id": trial_id,
            "trial_name": trial["name"] if trial else "(deleted trial)",
            "protocol_id": (trial or {}).get("protocol_id", ""),
            "phase": (trial or {}).get("phase", ""),
            "sponsor": (trial or {}).get("sponsor", ""),
            "drug": (trial or {}).get("drug", ""),
            # A site-assigned code beats the generated placeholder. Taking
            # visits[0] blindly showed the patient ID even when a later visit
            # carried the site's real subject number.
            "subject_code": next(
                (v["patient_id"] for v in visits
                 if v.get("patient_id") and v["patient_id"] != uid),
                visits[0].get("patient_id", ""),
            ),
            "visits": sorted(visits, key=lambda v: v.get("created", "")),
            "visit_count": len(visits),
            "slide_count": len(slides),
            "analysed_count": len(analysed),
            "confirmed_count": len([s for s in analysed if s.get("confirmed")]),
        })
    enrollments.sort(key=lambda e: e["trial_name"].lower())

    return {
        "patient": patient,
        "enrollments": enrollments,
        "reports": list_reports(uid),
        "totals": {
            "trials": len(enrollments),
            "visits": sum(e["visit_count"] for e in enrollments),
            "slides": sum(e["slide_count"] for e in enrollments),
            "analysed": sum(e["analysed_count"] for e in enrollments),
            "confirmed": sum(e["confirmed_count"] for e in enrollments),
            "reports": len(list_reports(uid)),
        },
    }
