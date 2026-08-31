"""Receiving a site's contribution.

The one rule that matters: a site sends its trained *heads only* — never the
backbone, never patient data. The backbone is common to every install and
carries no per-site information; the heads are the few hundred thousand
parameters actually fit to that site's corrections.

MAX_HEAD_BYTES is a blunt but effective guard against the mistake this whole
design exists to prevent: a client accidentally uploading the full merged
checkpoint (backbone + heads, several megabytes) instead of the head state
dict alone. It is not a security boundary — a determined bad actor can still
pad a payload — but it catches an honest client bug before it does damage,
which is the failure mode most likely to actually happen here.
"""
MAX_HEAD_BYTES = 5 * 1024 * 1024  # heads run ~1.35MB; well clear of a full checkpoint

REQUIRED_META_FIELDS = ("sample_count", "local_val_qwk")


class IngestError(ValueError):
    pass


def validate_contribution(weights_bytes: bytes, metadata: dict) -> None:
    if not weights_bytes:
        raise IngestError("Empty upload.")
    if len(weights_bytes) > MAX_HEAD_BYTES:
        raise IngestError(
            f"Upload is {len(weights_bytes) / 1e6:.1f}MB, larger than a head-only "
            f"export should ever be ({MAX_HEAD_BYTES / 1e6:.0f}MB limit). This looks "
            f"like a full model checkpoint, not a head delta — refusing it rather "
            f"than accepting a payload that shouldn't leave the site."
        )
    missing = [f for f in REQUIRED_META_FIELDS if f not in metadata]
    if missing:
        raise IngestError(f"Missing required metadata: {', '.join(missing)}")
    if not isinstance(metadata["sample_count"], int) or metadata["sample_count"] <= 0:
        raise IngestError("sample_count must be a positive integer.")
