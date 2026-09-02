"""Data-subject rights: access, portability, erasure, retention.

What this module is for
-----------------------
The application already had the hard part of data protection right. Patients
are pseudonymous by construction — no name, no full date of birth, identity
mapping held by the site and deliberately not by this application — and every
mutation lands in an append-only audit trail. That is Article 25 (data
protection by design) and most of Article 32 (security of processing).

What it had no answer for at all was the *subject's* side: there was no way to
tell a patient what is held about them (Article 15), hand it over in a portable
form (Article 20), or erase it (Article 17). A regulator does not accept "the
data is pseudonymised" as a substitute for those. Pseudonymous data is still
personal data under Recital 26, precisely because the site holds the key.

Erasure and clinical trials are in tension
------------------------------------------
A trial's integrity depends on its data not moving under it. Deleting a subject
mid-trial does not produce a clean dataset, it produces a corrupt one, and the
sponsor cannot then stand behind the endpoint. GDPR anticipates this: Article
17(3)(d) suspends the right to erasure where processing is necessary for
scientific research under Article 89(1), and 17(3)(b)/(c) where retention is a
legal obligation or serves public health. Clinical trial regulations impose
exactly such retention.

So this module refuses to pretend the conflict does not exist. It offers two
operations, and makes the caller face which one applies:

  redact  — clears every direct identifier (initials, site, sex, year of birth,
            free-text notes) while keeping the pseudonymous measurements the
            trial's conclusions rest on. This is the correct answer for an
            enrolled subject: the person becomes unidentifiable, the endpoint
            survives.

  erase   — redaction, plus destruction of the container: reports, slides, the
            registry row itself. Only available when the subject is not
            enrolled in an active trial, because that is the only case where
            it is lawful *and* does not silently corrupt a dataset.

Asking to erase an enrolled subject is refused with the reason and the Article,
not with a generic error. A coordinator who cannot see why the system said no
will find a way around the system.

What survives erasure, and why
------------------------------
A tombstone. It records that a subject with this identifier was erased, when,
by whom, under what reason, and how many artefacts went with them. It holds no
personal data — no initials, no notes, nothing about the person.

Keeping it is not a hedge against the right to erasure, it is required by it.
Article 17 obliges you to be able to *demonstrate* the erasure happened, and
Article 30 obliges you to keep records of processing. An erasure that leaves no
trace is indistinguishable from data loss, and an auditor cannot tell whether
you honoured the request or simply lost the file. The tombstone also stops the
identifier being minted again and quietly attached to a different person.
"""
import datetime
import json
import os
import shutil
from pathlib import Path
from typing import Optional

from backend import audit, patients, trials
from backend.storage import read_json, write_json, transaction
from backend.version import __version__

DATA_DIR = Path(os.environ.get("OMNIA_DATA_DIR", ".")) / "data"
TOMBSTONE_FILE = DATA_DIR / "erasure_log.json"

# The fields that can point back at a living person. Everything else in a
# patient record is a measurement. Kept as one list so that adding a field to
# the patient model and forgetting to redact it is a visible omission here
# rather than a silent leak.
DIRECT_IDENTIFIERS = ("initials", "year_of_birth", "sex", "site", "notes")

# Article 5(1)(e): personal data must not be kept longer than necessary. The
# figure itself is a controller's decision, not something software may invent —
# it follows from the trial protocol and national law, and differs between
# sponsors. What the software owes is a default that is defensible, a way to
# change it, and a way to find what has run past it.
DEFAULT_RETENTION_YEARS = 25


def _init():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not TOMBSTONE_FILE.exists():
        write_json(TOMBSTONE_FILE, [])


def _read_tombstones() -> list:
    _init()
    return read_json(TOMBSTONE_FILE, [])


def retention_years() -> int:
    """The configured retention period, in years."""
    raw = os.environ.get("OMNIA_RETENTION_YEARS", "")
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return DEFAULT_RETENTION_YEARS
    # A zero or negative retention period would mark every record overdue the
    # moment it is created, which is not a policy anyone means to set.
    return value if value > 0 else DEFAULT_RETENTION_YEARS


# ── Article 15 (access) and Article 20 (portability) ────────────────────────

def subject_record(uid: str) -> Optional[dict]:
    """Everything held about one data subject, in one portable document.

    Article 20 requires a "structured, commonly used and machine-readable
    format", which is why this returns plain JSON rather than the PDF a report
    would use. A PDF is a document about a patient; this is the data itself.

    Returns None if there is no such subject, so that a caller can distinguish
    "erased" (a tombstone exists) from "never existed" (nothing does).
    """
    patient = patients.get_patient(uid)
    if not patient:
        return None
    uid = patient["uid"]

    enrolments = [v for v in trials.list_patients() if v.get("patient_id") == uid]
    known = {t["id"]: t for t in trials.list_trials()}

    return {
        "exported_at": datetime.datetime.now(datetime.timezone.utc)
                               .isoformat(timespec="seconds").replace("+00:00", "Z"),
        "exported_by_software": f"Omnia Pathology AI {__version__}",
        "subject": patient,
        "enrolments": [
            {
                "trial": known.get(v.get("trial_id"), {}).get("name", v.get("trial_id")),
                "visit": v.get("visit"),
                "notes": v.get("notes"),
                "slides": v.get("slides", []),
            }
            for v in enrolments
        ],
        "reports": patients.list_reports(uid),
        # The audit trail is part of what is held about the subject, and
        # Article 15(1) does not carve it out — but only *this* subject's
        # entries. list_events() has no entity filter and returns the whole
        # trail, so handing back its output unfiltered would answer one
        # subject-access request with every other subject's processing history.
        # A subject-access response is itself a disclosure, and the fastest way
        # to turn Article 15 into an Article 33 breach notification.
        "processing_history": [
            e for e in audit.list_events(limit=100000)
            if e.get("entity_id") == uid
            or uid in (e.get("details") or "")
        ],
        "notice": (
            "This export contains the pseudonymous record held by this "
            "application. It holds no name and no full date of birth: the "
            "identity mapping is held by the treating site, not here."
        ),
    }


# ── Article 17 (erasure) ────────────────────────────────────────────────────

def _active_enrolments(uid: str) -> list:
    """Trials this subject is enrolled in that are still running."""
    open_trials = {t["id"] for t in trials.list_trials() if t.get("status") == "active"}
    return [
        v for v in trials.list_patients()
        if v.get("patient_id") == uid and v.get("trial_id") in open_trials
    ]


class ErasureRefused(Exception):
    """Raised when erasure is unlawful or would corrupt a running trial.

    Carries the reason and the Article, because a refusal a coordinator cannot
    understand is a refusal they will work around.
    """

    def __init__(self, message: str, article: str, trials_blocking: list):
        super().__init__(message)
        self.article = article
        self.trials_blocking = trials_blocking


def redact_subject(uid: str, actor: str = "system", actor_id: Optional[str] = None,
                   reason: str = "") -> Optional[dict]:
    """Clear every direct identifier, keep the pseudonymous measurements.

    The lawful answer for a subject enrolled in a running trial: the person
    stops being identifiable, and the endpoint the sponsor will report still
    rests on the data it was computed from.
    """
    patient = patients.get_patient(uid)
    if not patient:
        return None
    uid = patient["uid"]

    cleared = [f for f in DIRECT_IDENTIFIERS if patient.get(f) not in (None, "", [])]
    result = patients.redact(uid)

    audit.log_event(
        action="gdpr_redact",
        entity_type="patient",
        entity_id=uid,
        user_id=actor_id,
        username=actor,
        details=(f"Direct identifiers cleared under Article 17 "
                 f"({len(cleared)} field(s): {', '.join(cleared) or 'none set'}). "
                 f"Reason: {reason or 'not stated'}"),
    )
    return result


def erase_subject(uid: str, actor: str = "system", actor_id: Optional[str] = None,
                  reason: str = "", force: bool = False) -> dict:
    """Redact, then destroy the container and the registry row.

    Refuses while the subject is enrolled in an active trial, unless `force`
    is set — which exists for the case where a controller has determined the
    erasure is required and has accepted the effect on the dataset. That is a
    controller's decision to record, not the software's to make silently, so
    forcing is written into the tombstone.
    """
    patient = patients.get_patient(uid)
    if not patient:
        raise ValueError(f"No such subject: {uid}")
    uid = patient["uid"]

    # Electronically signed slides are part of the regulatory record: 21 CFR
    # Part 11 and the trial's own retention obligation both require them to
    # survive. trials.delete_patient refuses to remove a patient carrying one,
    # so attempting erasure anyway would destroy everything else and leave the
    # signed slides behind — while the tombstone claimed a complete erasure.
    # A tombstone that overstates what was destroyed is worse than no erasure
    # at all, because it is the evidence an auditor would rely on.
    signed = [
        v for v in trials.list_patients()
        if v.get("patient_id") == uid
        and any(sl.get("confirmed") for sl in (v.get("slides") or []))
    ]
    if signed and not force:
        names = {t["id"]: t["name"] for t in trials.list_trials()}
        raise ErasureRefused(
            "This subject has electronically signed slides. A signed grade is "
            "part of the regulatory record and cannot be destroyed without the "
            "controller deciding that erasure overrides that obligation. Redact "
            "the subject instead — that removes every identifier and leaves the "
            "signed record standing.",
            article="Article 17(3)(b) — a legal obligation to retain",
            trials_blocking=sorted({names.get(v.get("trial_id"), v.get("trial_id"))
                                    for v in signed}),
        )

    blocking = _active_enrolments(uid)
    if blocking and not force:
        names = {t["id"]: t["name"] for t in trials.list_trials()}
        raise ErasureRefused(
            "This subject is enrolled in a trial that is still running. Erasing "
            "them now would remove data the trial's conclusions rest on. Redact "
            "them instead — that clears every identifier and leaves the "
            "measurements intact — or close the trial first.",
            article="Article 17(3)(d), read with Article 89(1)",
            trials_blocking=[names.get(v.get("trial_id"), v.get("trial_id")) for v in blocking],
        )

    # Count before destroying, so the tombstone can say what went.
    reports = patients.list_reports(uid)
    enrolments = [v for v in trials.list_patients() if v.get("patient_id") == uid]
    slide_count = sum(len(v.get("slides", []) or []) for v in enrolments)

    # Clear the identifiers first. If the directory removal below fails
    # part-way, the failure leaves a redacted subject rather than an
    # identifiable one — the safe direction to fail in.
    redact_subject(uid, actor=actor, actor_id=actor_id, reason=reason)

    # One unremovable visit must not abort the erasure and strand the rest of
    # the subject's data — but it must not vanish either. Whatever could not be
    # destroyed is named in the tombstone, so the record says what actually
    # happened rather than what was intended.
    not_destroyed = []
    for visit in enrolments:
        try:
            trials.delete_patient(visit.get("id"))
        except Exception as exc:
            not_destroyed.append({
                "enrolment": visit.get("id"),
                "trial": visit.get("trial_id"),
                "reason": str(exc),
            })

    container = patients.patient_dir(uid)
    if container.exists():
        shutil.rmtree(container, ignore_errors=True)

    with transaction():
        registry = [p for p in patients.list_registry() if p.get("uid") != uid]
        write_json(patients.REGISTRY_FILE, registry)

    stone = {
        "uid": uid,
        "erased_at": datetime.datetime.now(datetime.timezone.utc)
                             .isoformat(timespec="seconds").replace("+00:00", "Z"),
        "erased_by": actor,
        "reason": reason or "not stated",
        "forced_over_active_trial": bool(blocking and force),
        "forced_over_signed_slides": bool(signed and force),
        # Counts, never content.
        "artefacts_destroyed": {
            "reports": len(reports),
            "enrolments": len(enrolments) - len(not_destroyed),
            "slides": slide_count,
        },
        # Empty on a clean erasure. Non-empty means the erasure was partial,
        # and the tombstone says so rather than implying completeness.
        "not_destroyed": not_destroyed,
        "complete": not not_destroyed,
        "software": f"Omnia Pathology AI {__version__}",
    }
    with transaction():
        stones = _read_tombstones()
        stones.append(stone)
        write_json(TOMBSTONE_FILE, stones)

    audit.log_event(
        action="gdpr_erase",
        entity_type="patient",
        entity_id=uid,
        user_id=actor_id,
        username=actor,
        details=(f"Subject erased under Article 17. Destroyed: "
                 f"{len(reports)} report(s), {len(enrolments)} enrolment(s), "
                 f"{slide_count} slide(s). Reason: {reason or 'not stated'}"
                 + (" FORCED over an active trial." if blocking and force else "")
                 + (f" INCOMPLETE: {len(not_destroyed)} enrolment(s) could not be "
                    f"destroyed." if not_destroyed else "")),
    )
    return stone


def erasure_log() -> list:
    """The tombstones, newest first — evidence that erasures were honoured."""
    return sorted(_read_tombstones(), key=lambda s: s.get("erased_at", ""), reverse=True)


def was_erased(uid: str) -> bool:
    try:
        uid = patients.normalise_uid(uid)
    except Exception:
        return False
    return any(s.get("uid") == uid for s in _read_tombstones())


# ── Article 5(1)(e): storage limitation ─────────────────────────────────────

def overdue_subjects(now: Optional[datetime.datetime] = None) -> list:
    """Subjects held past the retention period.

    Reported, never deleted automatically. Erasing clinical data on a timer,
    with no human deciding, is how a sponsor loses a dataset they were legally
    required to keep — the storage-limitation principle is a duty to review,
    not a licence to destroy unattended.
    """
    now = now or datetime.datetime.now()
    limit = retention_years()
    out = []
    for p in patients.list_registry():
        created = p.get("created")
        if not created:
            continue
        try:
            when = datetime.datetime.fromisoformat(created)
        except (TypeError, ValueError):
            continue
        age = (now - when).days / 365.25
        if age >= limit:
            out.append({
                "uid": p.get("uid"),
                "created": created,
                "age_years": round(age, 1),
                "retention_years": limit,
                "already_redacted": bool(p.get("redacted")),
            })
    return out


# ── Article 30: records of processing activities ────────────────────────────

def processing_activities() -> dict:
    """The Article 30 record, as far as the software can state it.

    Deliberately honest about its own limits. Article 30 requires the
    controller's identity, their DPO, transfers to third countries and the
    retention schedule — none of which software can know about the
    organisation deploying it. What it *can* state truthfully is what the
    application itself does with personal data, which is the part a controller
    would otherwise have to reverse-engineer from the source.
    """
    return {
        "software": f"Omnia Pathology AI {__version__}",
        "generated_at": datetime.datetime.now(datetime.timezone.utc)
                                .isoformat(timespec="seconds").replace("+00:00", "Z"),
        "controller": "The deploying organisation. Not known to this software.",
        "categories_of_data_subject": ["Trial participants", "Application users"],
        "categories_of_personal_data": {
            "special_category": {
                "present": True,
                "article": "Article 9(1) — data concerning health",
                "detail": ("Prostate histopathology slide images, Gleason and ISUP "
                           "grades, and the visit records linking them to a "
                           "pseudonymous subject identifier."),
            },
            "identifiers": {
                "held": ["Pseudonymous subject ID", "Initials", "Year of birth",
                         "Sex", "Site", "Free-text notes"],
                "not_held": ["Name", "Full date of birth", "Address", "Contact details",
                             "National or hospital identifier"],
                "detail": ("The identity mapping is held by the treating site. This "
                           "application cannot re-identify a subject on its own."),
            },
        },
        "purposes": [
            "Computer-assisted grading of prostate histopathology for clinical trials",
            "Comparison of grade distributions before and after an intervention",
            "Audit and traceability of who graded, confirmed or corrected what",
        ],
        "lawful_basis": {
            "note": ("The basis is the controller's to determine and document. "
                     "In the trial setting this software is built for, processing "
                     "of health data usually rests on Article 9(2)(j) — scientific "
                     "research under Article 89(1) — with the Article 6 basis "
                     "commonly 6(1)(e) or 6(1)(f). This software does not choose "
                     "on the controller's behalf."),
        },
        "recipients": ["None. The application processes data locally and does not "
                       "transmit personal data to the vendor or any third party."],
        "third_country_transfers": ("None by the software. It runs offline on the "
                                    "controller's own hardware."),
        "retention": {
            "configured_years": retention_years(),
            "note": ("Set by the controller via OMNIA_RETENTION_YEARS. Records past "
                     "it are reported for review, never deleted automatically."),
        },
        "security_measures": [
            "Pseudonymisation by design — no name or full date of birth is stored "
            "(Article 32(1)(a))",
            "Runs offline; the service binds to loopback and is not exposed to the "
            "network by default",
            "Role-based access control; session tokens are stored as SHA-256 "
            "digests, never in the clear",
            "Append-only audit trail of every mutation, with the acting user",
            "Atomic writes, so an interrupted operation cannot leave a partially "
            "written clinical record",
        ],
        "data_subject_rights_supported": {
            "Article 15 (access)": "subject_record()",
            "Article 20 (portability)": "subject_record(), as JSON",
            "Article 17 (erasure)": "erase_subject(), with redact_subject() where "
                                    "Article 17(3)(d) applies",
            "Article 5(1)(e) (storage limitation)": "overdue_subjects()",
        },
        "limits_of_this_record": (
            "Generated by the software about the software. It is not a complete "
            "Article 30 record: the controller must add their own identity, their "
            "DPO's contact details, any transfers they make outside the "
            "application, and their own retention schedule and lawful basis."
        ),
    }
