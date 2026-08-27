"""Omnia AI — Prostate Pathology Analysis Engine.

`analyze_slide()` calls the real trained model (backend/grading_model.py)
for the two things it actually predicts — ISUP grade group and confidence —
and derives the Gleason score display string from that. Everything else in
the return shape (tumor size, PNI/LVI, cribriform pattern, biomarkers,
quality assessment) has NO trained model behind it and comes back as an
explicit null/"Not assessed", never a fabricated value — see
_unassessed_extras() below.

This split matters: a pathologist electronically signs off on this data as
part of the medical record. Inventing plausible-looking biomarker/feature
values under a "real AI" label — even with a disclaimer string attached —
would mean someone attesting to data that was never actually assessed.
Nothing here should return a made-up number; a field the model can't
predict is None, full stop.

Model provenance: single-fold (fold 0 of 5) attention-MIL, EfficientNet-B0
backbone, validation QWK 0.7996 on 1,827 held-out PANDA slides. Not an
ensemble, not externally validated beyond that split. See
backend/grading_model.py's module docstring for the inference details.

If backend/grading_model.py raises (model file missing, unreadable slide,
etc.), analyze_slide() raises AnalysisFailedError rather than substituting
any grade — a failed analysis must surface as a failure, not a guess.
"""
import logging

from backend import grading_model

logger = logging.getLogger(__name__)

MODEL_VERSION = "Omnia-Prostate-attnMIL-fold0-v1 (QWK 0.7996, single-fold, not externally validated)"


class AnalysisFailedError(Exception):
    """Raised when the real grading model can't produce a result. Callers
    must surface this as a failure, never substitute a fabricated grade."""


# WHO/ISUP 2016 grade group mapping — the modern standard alongside the
# traditional Gleason score on every real prostate pathology report.
GRADE_GROUP_MAP = {
    "3+3=6": 1,
    "3+4=7": 2,
    "4+3=7": 3,
    "4+4=8": 4, "3+5=8": 4, "5+3=8": 4,
    "4+5=9": 5, "5+4=9": 5, "5+5=10": 5,
}

# Reverse of the above, for turning the model's predicted grade group back
# into a displayable Gleason score. Grade groups 4 and 5 each cover more
# than one Gleason pattern (e.g. group 4 = 4+4, 3+5, or 5+3) — the model
# predicts the GROUP, not which of those patterns it is, so this picks the
# canonical/most common pattern per group as a display value. That
# ambiguity is real and worth knowing if this ever needs tightening beyond
# grade-group-level accuracy.
GRADE_GROUP_TO_GLEASON = {
    0: "Benign / no tumor identified",
    1: "3+3=6",
    2: "3+4=7",
    3: "4+3=7",
    4: "4+4=8",
    5: "4+5=9",
}

# Simplified NCCN-style risk stratification, driven by grade group.
# Real risk grouping also factors in PSA and clinical stage; this is a
# grade-group-only approximation, since the model produces a slide-level
# grade and nothing else that risk stratification would normally use.
RISK_BY_GRADE_GROUP = {
    0: ("Benign", "green"),
    1: ("Low", "green"),
    2: ("Favorable Intermediate", "blue"),
    3: ("Unfavorable Intermediate", "orange"),
    4: ("High", "red"),
    5: ("Very High", "red"),
}


def _unassessed_extras() -> dict:
    """Everything the trained model does NOT predict. No fabricated values —
    these come back genuinely empty/null rather than a plausible-looking
    random number, so nothing false can end up in front of a pathologist
    or in a signed report. See module docstring for why."""
    return {
        "size_mm": None,
        "tumor_involvement_pct": None,
        "perineural_invasion": None,
        "lymphovascular_invasion": None,
        "cribriform_pattern": None,
        "biomarkers": {},
        "quality": {
            "tissue_quality": "Not assessed",
            "staining_quality": "Not assessed",
            "artifacts_detected": "Not assessed",
        },
        "suspicious_regions": None,
    }


def analyze_slide(filename: str, filepath: str = "") -> dict:
    """Run prostate pathology grading analysis on a whole-slide image.

    grade / grade_group / confidence come from the real trained model
    (backend/grading_model.py). Everything else the model doesn't predict
    comes back null/"Not assessed" — see module docstring and
    _unassessed_extras().

    RETURN SHAPE (required by routes/storage/PDF export/UI):
        {
            "grade": str,                         # Gleason score, e.g. "4+4=8"
            "grade_group": int,                    # WHO/ISUP grade group, 0-5
            "confidence": float,                   # 0.0 - 1.0
            "size_mm": None,
            "tumor_involvement_pct": None,
            "perineural_invasion": None,
            "lymphovascular_invasion": None,
            "cribriform_pattern": None,
            "risk_group": str,                      # e.g. "Unfavorable Intermediate"
            "biomarkers": {},
            "quality": {"tissue_quality": "Not assessed", ...},
            "regions_analyzed": int,                # tiles the model actually processed
            "suspicious_regions": None,
            "processing_time_s": float,
            "model_version": str,
            "source": "ai",
        }

    Raises AnalysisFailedError if the real model can't produce a grade
    (missing model file, unreadable slide, etc.) — callers must not
    substitute a fabricated grade on failure. See module docstring.
    """
    import time
    t0 = time.time()

    try:
        result = grading_model.predict(filepath)
    except grading_model.AnalysisBusyError:
        # Server saturation, not a bad slide. Propagate as-is so the route
        # can return a retryable status and the slide keeps its current
        # state instead of being marked permanently failed.
        raise
    except Exception as e:
        logger.warning("Grading model failed for %s: %r", filename, e)
        raise AnalysisFailedError(str(e)) from e

    grade_group = result["grade_group"]
    grade = GRADE_GROUP_TO_GLEASON[grade_group]
    risk_group, _risk_accent = RISK_BY_GRADE_GROUP[grade_group]

    out = {
        "grade": grade,
        "grade_group": grade_group,
        "confidence": result["confidence"],
        "risk_group": risk_group,
        "regions_analyzed": result["tiles_used"],
        "processing_time_s": round(time.time() - t0, 1),
        "model_version": MODEL_VERSION,
        "source": "ai",
        # Real per-tile attention from the MIL pooling layer, with the
        # slide-space coordinates each weight belongs to. This is what the
        # UI overlays on the actual slide thumbnail — it is model output,
        # not decoration, so it is NOT part of _unassessed_extras().
        "attention_regions": result.get("regions", []),
        "slide_width": result.get("slide_width"),
        "slide_height": result.get("slide_height"),
    }
    out.update(_unassessed_extras())
    return out
