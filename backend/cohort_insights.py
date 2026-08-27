"""Omnia AI — trial-level cohort analytics.

Aggregates every graded slide and subject timeline in a trial into the
operational and analytical picture a trial team actually works from: where
the cohort sits by grade, which subjects moved, which cases need a
pathologist's attention next, and whether the data is yet in a state that
supports longitudinal analysis.

── The boundary this module holds ──
Everything reported here is COMPUTED from recorded grades, confidences,
attention weights and signature state. Nothing here infers biology,
mechanism, or drug effect, because the system holds none of the inputs
that would support it: no molecular or genomic data, no drug exposure or
dosing, no PK/PD, no biomarker assays, no clinical outcomes, and no
control arm. A model that sees H&E morphology and outputs an ISUP grade
cannot identify a target, a pathway, or a way to improve a compound.

Producing "focus on pathway X to improve efficacy" from this data would be
fabrication with a scientific veneer, and in a drug-development setting
someone could commit real budget to it. So this module reports what the
data supports and states plainly what it does not cover. The value it does
add is real: cohort composition, trajectory distribution, reviewer
workload, data readiness, and which specific cases most need human eyes.
"""
from collections import Counter, defaultdict

from backend.patient_timeline import (
    build_subject_timeline,
    list_subjects,
    MEANINGFUL_GRADE_DELTA,
)

# Below this, the model's own probability mass on its chosen grade is weak
# enough that the case is worth a pathologist looking before it is signed.
LOW_CONFIDENCE = 0.35
# Attention concentration = strongest tile weight / uniform weight. At 1.0 the
# model spread attention evenly and found nothing focal; higher means it
# localised. This describes MODEL behaviour, not verified tumour focality —
# the model was never trained on per-region annotations.
FOCAL_CONCENTRATION = 3.0


def _slide_rows(trial_id: str, patients: list):
    for p in patients:
        if p.get("trial_id") != trial_id:
            continue
        for s in p.get("slides", []):
            yield p, s


def _attention_concentration(slide: dict):
    """How sharply the model localised, relative to spreading evenly."""
    regions = slide.get("attention_regions") or []
    if len(regions) < 2:
        return None
    raws = [r.get("attention_raw") for r in regions if r.get("attention_raw") is not None]
    if not raws:
        return None
    uniform = 1.0 / len(raws)
    return round(max(raws) / uniform, 2) if uniform else None


def build_cohort_insights(trial_id: str, patients: list) -> dict:
    subjects = list_subjects(trial_id, patients)

    grade_dist = Counter()
    confidences = []
    concentrations = []
    by_site = defaultdict(lambda: {"slides": 0, "graded": 0, "signed": 0, "unsigned": 0})

    attention_flags = []
    needs_review = []
    failed = []

    for p, s in _slide_rows(trial_id, patients):
        site = p.get("site") or "Unspecified"
        by_site[site]["slides"] += 1

        if s.get("status") == "analysis_failed":
            failed.append({
                "patient_id": p.get("patient_id"), "visit": p.get("visit"),
                "filename": s.get("filename"), "error": s.get("model_error"),
            })
            continue

        gg = s.get("grade_group")
        if gg is None:
            continue

        by_site[site]["graded"] += 1
        grade_dist[gg] += 1
        if s.get("confirmed"):
            by_site[site]["signed"] += 1
        else:
            by_site[site]["unsigned"] += 1

        conf = s.get("confidence")
        if conf is not None:
            confidences.append(conf)
            # Unsigned AND low-confidence is the combination that most needs a
            # human before it becomes part of the record.
            if conf < LOW_CONFIDENCE and not s.get("confirmed"):
                needs_review.append({
                    "patient_id": p.get("patient_id"), "visit": p.get("visit"),
                    "filename": s.get("filename"), "grade_group": gg,
                    "confidence": conf, "reason": "low model confidence, not yet signed",
                })

        c = _attention_concentration(s)
        if c is not None:
            concentrations.append(c)
            attention_flags.append({
                "patient_id": p.get("patient_id"), "visit": p.get("visit"),
                "concentration": c,
                "pattern": "focal" if c >= FOCAL_CONCENTRATION else "diffuse",
            })

    # Subjects whose trajectory moved more than the model's noise floor.
    movers = []
    for sub in subjects:
        tl = build_subject_timeline(trial_id, sub["patient_id"], patients)
        if not tl:
            continue
        for ch in tl.get("changes", []):
            if ch["exceeds_noise_floor"]:
                movers.append({
                    "patient_id": tl["patient_id"],
                    "from_visit": ch["from_visit"], "to_visit": ch["to_visit"],
                    "delta": ch["delta"],
                    "direction": ch["direction"],
                    "both_signed": ch["both_signed"],
                })

    traj = Counter(s["trajectory"] for s in subjects)
    paired = sum(1 for s in subjects if s["graded_visit_count"] >= 2)

    total_graded = sum(grade_dist.values())
    total_signed = sum(v["signed"] for v in by_site.values())
    mean_conf = round(sum(confidences) / len(confidences), 3) if confidences else None
    mean_conc = round(sum(concentrations) / len(concentrations), 2) if concentrations else None

    return {
        "trial_id": trial_id,
        "subject_count": len(subjects),
        "graded_slide_count": total_graded,
        "signed_slide_count": total_signed,
        "unsigned_slide_count": total_graded - total_signed,
        "failed_analyses": failed,

        "grade_distribution": {str(g): grade_dist.get(g, 0) for g in range(6)},
        "mean_confidence": mean_conf,
        "low_confidence_count": len(needs_review),

        "trajectory_counts": {
            "higher": traj.get("higher", 0),
            "lower": traj.get("lower", 0),
            "unchanged": traj.get("unchanged", 0),
            "single_timepoint": traj.get("single_timepoint", 0),
            "no_data": traj.get("no_data", 0),
        },
        "subjects_with_paired_timepoints": paired,
        "significant_movers": movers,

        "mean_attention_concentration": mean_conc,
        "focal_count": sum(1 for a in attention_flags if a["pattern"] == "focal"),
        "diffuse_count": sum(1 for a in attention_flags if a["pattern"] == "diffuse"),

        "action_items": _action_items(needs_review, failed, total_graded, total_signed, paired, len(subjects)),
        "scope_note": (
            "These figures are computed from recorded grades, model confidence, "
            "attention weights and signature state. This system holds no molecular, "
            "dosing, biomarker or outcome data and no control arm, so it cannot and "
            "does not assess drug mechanism, target selection, or efficacy."
        ),
        "review_queue": sorted(needs_review, key=lambda r: r["confidence"])[:25],
        "site_breakdown": [{"site": k, **v} for k, v in sorted(by_site.items())],
    }


def _action_items(needs_review, failed, total_graded, total_signed, paired, subject_count):
    """Concrete next steps, ordered by what blocks analysis soonest."""
    items = []
    if failed:
        items.append({
            "priority": "high",
            "label": f"{len(failed)} slide{'s' if len(failed) != 1 else ''} failed analysis",
            "detail": "These carry no grade and are excluded from every figure here. Re-analyse or replace the files.",
        })
    unsigned = total_graded - total_signed
    if unsigned:
        items.append({
            "priority": "high" if unsigned > total_signed else "medium",
            "label": f"{unsigned} graded slide{'s' if unsigned != 1 else ''} not yet signed",
            "detail": "Unsigned grades are model output only and are not part of the regulatory record.",
        })
    if needs_review:
        items.append({
            "priority": "medium",
            "label": f"{len(needs_review)} low-confidence case{'s' if len(needs_review) != 1 else ''} awaiting review",
            "detail": f"The model placed under {int(LOW_CONFIDENCE * 100)}% probability on its own grade for these. Prioritise them.",
        })
    unpaired = subject_count - paired
    if unpaired > 0:
        items.append({
            "priority": "medium",
            "label": f"{unpaired} subject{'s' if unpaired != 1 else ''} without a second graded timepoint",
            "detail": "Longitudinal comparison needs at least two graded visits per subject.",
        })
    if not items:
        items.append({
            "priority": "low",
            "label": "No outstanding review actions",
            "detail": "Every graded slide is signed and no analyses failed.",
        })
    return items
