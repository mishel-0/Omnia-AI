"""Omnia AI — longitudinal per-subject view.

The stored data model keeps one record per (patient_id, visit): "P001 /
Baseline" and "P001 / Week 12" are siblings with nothing linking them. This
module is the missing container — it groups every visit belonging to one
subject within a trial, orders those visits in time, and reports how the
graded result moved between them.

── What this reports, and what it deliberately does not ──
It reports the ISUP grade group recorded at each timepoint and the change
between consecutive timepoints. It does NOT report treatment response, and
nothing here should be presented as evidence a drug is or is not working.
That distinction is clinical, not cosmetic:

  1. Repeat needle biopsies sample DIFFERENT tissue each time. A grade that
     moves between two biopsies may reflect which cores happened to hit
     tumour, not a change in the disease. This is the dominant confounder
     and it does not average out at n=1.
  2. ISUP grade is not a validated response endpoint for prostate cancer
     therapy. Response in prostate trials is assessed with PSA kinetics,
     imaging, and pathologic response at prostatectomy. Serial-biopsy grade
     change is used for active-surveillance progression, which is a
     different question from drug efficacy.
  3. The grading model carries roughly +/-1 grade group of error, so a
     one-step move between visits sits inside its own noise floor.

So the timeline surfaces the trajectory and names its confounders, and
leaves the causal question to the investigator. A pathologist-signed grade
is always preferred over an unreviewed model output, and any trajectory
resting on unsigned grades is marked provisional.
"""
import re
from typing import Optional

# How many grade groups must a change span before it is worth flagging at
# all? The model's own error is about one grade group, and biopsy sampling
# adds more on top, so a single-step move is not a signal.
MEANINGFUL_GRADE_DELTA = 2

_VISIT_PATTERNS = [
    (re.compile(r"\bscreen", re.I), -1.0),
    (re.compile(r"\b(baseline|bl|pre[- ]?treat|c1d1)\b", re.I), 0.0),
    (re.compile(r"\bday\s*(\d+)", re.I), None),      # value from capture
    (re.compile(r"\bweek\s*(\d+)", re.I), None),
    (re.compile(r"\bmonth\s*(\d+)", re.I), None),
    (re.compile(r"\byear\s*(\d+)", re.I), None),
]
_UNIT_DAYS = {"day": 1.0, "week": 7.0, "month": 30.44, "year": 365.25}


def visit_order_key(visit: str) -> Optional[float]:
    """Approximate days-from-baseline for a free-text visit label.

    Visit labels are operator-entered strings ("Baseline", "Week 12",
    "Month 6"), so ordering them alphabetically would put Week 12 before
    Week 2. Returns None when the label carries no recognisable ordinal —
    the caller then falls back to record creation time rather than
    inventing an order.
    """
    if not visit:
        return None
    v = visit.strip()
    if re.search(r"\bscreen", v, re.I):
        return -1.0
    if re.search(r"\b(baseline|bl|pre[- ]?treat|c1d1)\b", v, re.I):
        return 0.0
    m = re.search(r"\b(day|week|month|year)s?\s*[-#]?\s*(\d+)", v, re.I)
    if m:
        return float(m.group(2)) * _UNIT_DAYS[m.group(1).lower()]
    # A bare number ("12") is ambiguous — treat it as a week, the most
    # common convention in trial visit naming, but only when nothing else
    # matched.
    m = re.fullmatch(r"\s*(\d+)\s*", v)
    if m:
        return float(m.group(1)) * 7.0
    return None


def _visit_grade(patient: dict) -> dict:
    """Resolve one visit's grade from its slides.

    A pathologist-signed grade always wins over an unreviewed model output:
    the signature is the point at which a qualified human took
    responsibility for the number. Where several slides exist for a visit,
    the highest grade group is taken — standard practice, since the most
    advanced focus drives management, not the average across cores.
    """
    best = None
    for s in patient.get("slides", []):
        gg = s.get("grade_group")
        if gg is None:
            continue
        signed = bool(s.get("confirmed"))
        # A doctor correction, where present, is the authoritative grade text.
        entry = {
            "grade_group": gg,
            "grade": s.get("doctor_correction") or s.get("grade"),
            "signed": signed,
            "confidence": s.get("confidence"),
            "slide_id": s.get("id"),
            "filename": s.get("filename"),
            "source": s.get("analysis_source"),
        }
        if best is None:
            best = entry
            continue
        # Prefer signed over unsigned; among equals prefer the higher grade.
        if (entry["signed"], entry["grade_group"]) > (best["signed"], best["grade_group"]):
            best = entry
    return best or {}


def build_subject_timeline(trial_id: str, patient_id: str, patients: list) -> Optional[dict]:
    """Group every visit for one subject in one trial into a single view."""
    records = [
        p for p in patients
        if p.get("trial_id") == trial_id
        and (p.get("patient_id") or "").strip().lower() == (patient_id or "").strip().lower()
    ]
    if not records:
        return None

    # Order by parsed visit ordinal where possible, otherwise by creation
    # time. Records without an ordinal sort after those with one, so a
    # recognised schedule is never scrambled by an ad-hoc visit label.
    def sort_key(p):
        k = visit_order_key(p.get("visit", ""))
        return (0, k, p.get("created", "")) if k is not None else (1, 0.0, p.get("created", ""))

    records.sort(key=sort_key)

    timepoints = []
    for p in records:
        g = _visit_grade(p)
        timepoints.append({
            "patient_uuid": p.get("id"),
            "visit": p.get("visit"),
            "visit_day": visit_order_key(p.get("visit", "")),
            "site": p.get("site", ""),
            "status": p.get("status"),
            "created": p.get("created"),
            "slide_count": len(p.get("slides", [])),
            "graded": bool(g),
            **({"grade_group": g["grade_group"], "grade": g["grade"],
                "signed": g["signed"], "confidence": g.get("confidence"),
                "slide_id": g.get("slide_id"), "filename": g.get("filename")} if g else {}),
        })

    graded = [t for t in timepoints if t.get("graded")]
    changes = []
    for prev, cur in zip(graded, graded[1:]):
        delta = cur["grade_group"] - prev["grade_group"]
        changes.append({
            "from_visit": prev["visit"],
            "to_visit": cur["visit"],
            "from_grade_group": prev["grade_group"],
            "to_grade_group": cur["grade_group"],
            "delta": delta,
            "direction": "increase" if delta > 0 else "decrease" if delta < 0 else "no_change",
            # Only a move larger than the model's own error is worth the
            # reader's attention; anything smaller is inside the noise.
            "exceeds_noise_floor": abs(delta) >= MEANINGFUL_GRADE_DELTA,
            "both_signed": bool(prev.get("signed") and cur.get("signed")),
        })

    summary = _summarise(graded, changes)

    return {
        "trial_id": trial_id,
        "patient_id": records[0].get("patient_id"),
        "visit_count": len(timepoints),
        "graded_visit_count": len(graded),
        "timepoints": timepoints,
        "changes": changes,
        **summary,
    }


def _summarise(graded: list, changes: list) -> dict:
    """Describe the trajectory in plain language, without asserting cause."""
    caveats = [
        "Repeat biopsies sample different tissue, so a grade change may reflect "
        "which cores contained tumour rather than a change in the disease.",
        "ISUP grade is not a validated treatment-response endpoint. Prostate "
        "trials assess response with PSA kinetics, imaging, and pathologic "
        "response at surgery.",
        f"The grading model carries roughly +/-1 grade group of error, so changes "
        f"smaller than {MEANINGFUL_GRADE_DELTA} grade groups sit within its noise.",
    ]

    if len(graded) == 0:
        return {"trajectory": "no_data",
                "headline": "No graded visits yet.",
                "detail": "Analyse and sign at least one slide to start this subject's timeline.",
                "caveats": [], "provisional": False}

    if len(graded) == 1:
        t = graded[0]
        return {"trajectory": "single_timepoint",
                "headline": f"One graded visit: {t['visit']} at Grade Group {t['grade_group']}.",
                "detail": "A second timepoint is needed before any change can be described.",
                "caveats": [], "provisional": not t.get("signed")}

    first, last = graded[0], graded[-1]
    overall = last["grade_group"] - first["grade_group"]
    provisional = any(not t.get("signed") for t in graded)

    if overall > 0:
        trajectory = "higher"
        headline = (f"Grade Group rose from {first['grade_group']} at {first['visit']} "
                    f"to {last['grade_group']} at {last['visit']}.")
    elif overall < 0:
        trajectory = "lower"
        headline = (f"Grade Group fell from {first['grade_group']} at {first['visit']} "
                    f"to {last['grade_group']} at {last['visit']}.")
    else:
        trajectory = "unchanged"
        headline = (f"Grade Group unchanged at {first['grade_group']} from "
                    f"{first['visit']} to {last['visit']}.")

    if abs(overall) >= MEANINGFUL_GRADE_DELTA:
        detail = ("This change is larger than the model's typical error, so it is "
                  "worth review against the rest of the clinical picture.")
    elif overall != 0:
        detail = ("This is a one-step change, which falls within the model's own "
                  "margin of error and biopsy sampling variation. Treat it as "
                  "inconclusive on its own.")
    else:
        detail = "No change in recorded grade group between the first and last graded visit."

    return {"trajectory": trajectory, "overall_delta": overall, "headline": headline,
            "detail": detail, "caveats": caveats, "provisional": provisional}


def list_subjects(trial_id: str, patients: list) -> list:
    """One row per distinct subject in a trial, collapsing their visits."""
    by_subject = {}
    for p in patients:
        if p.get("trial_id") != trial_id:
            continue
        key = (p.get("patient_id") or "").strip().lower()
        if not key:
            continue
        by_subject.setdefault(key, []).append(p)

    out = []
    for key, recs in by_subject.items():
        tl = build_subject_timeline(trial_id, recs[0]["patient_id"], patients)
        if tl:
            out.append({
                "patient_id": tl["patient_id"],
                "visit_count": tl["visit_count"],
                "graded_visit_count": tl["graded_visit_count"],
                "trajectory": tl["trajectory"],
                "overall_delta": tl.get("overall_delta"),
                "headline": tl["headline"],
                "provisional": tl.get("provisional", False),
                "sites": sorted({r.get("site", "") for r in recs if r.get("site")}),
            })
    out.sort(key=lambda r: r["patient_id"].lower())
    return out
