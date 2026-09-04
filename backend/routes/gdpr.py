"""Data-subject rights endpoints.

Every route here is admin-only. Subject access hands over a complete personal
record and erasure destroys one, so both are exactly the operations that must
not be reachable by an ordinary account — a coordinator who can export any
subject on demand is a data-protection incident waiting for a bad afternoon.

Each call is itself logged. Article 15 requests are processing, and processing
that leaves no trace cannot be shown to a regulator.
"""
import datetime
import json

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse

from backend import audit, gdpr
from backend.deps import get_current_user

router = APIRouter(prefix="/api/gdpr", tags=["gdpr"])


def _admin(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(
            status_code=403,
            detail="Data-subject requests may only be handled by an administrator.",
        )
    return user


@router.get("/subjects/{uid}/export")
def api_export_subject(uid: str, user: dict = Depends(_admin)):
    """Article 15 / 20 — everything held about one subject, as JSON."""
    record = gdpr.subject_record(uid)
    if record is None:
        # An erased subject is not the same as one that never existed, and the
        # difference is the whole point of keeping tombstones. Saying "not
        # found" for an erased subject would leave a controller unable to show
        # they honoured the request.
        if gdpr.was_erased(uid):
            raise HTTPException(
                status_code=410,
                detail="This subject was erased under Article 17. See the erasure log.",
            )
        raise HTTPException(status_code=404, detail="No such subject.")

    audit.log_event(
        action="gdpr_export",
        entity_type="patient",
        entity_id=uid,
        user_id=user.get("id"),
        username=user.get("username", "unknown"),
        details="Subject access request fulfilled (Article 15/20).",
    )
    # Content-Disposition so the browser saves it as the portable document it
    # is, rather than rendering it as a wall of JSON.
    return JSONResponse(
        content=record,
        headers={"Content-Disposition": f'attachment; filename="subject-{uid}.json"'},
    )


@router.post("/subjects/{uid}/redact")
def api_redact_subject(uid: str, reason: str = Query(""), user: dict = Depends(_admin)):
    """Article 17, where 17(3) applies — clear identifiers, keep measurements."""
    result = gdpr.redact_subject(
        uid,
        actor=user.get("username", "unknown"),
        actor_id=user.get("id"),
        reason=reason,
    )
    if result is None:
        raise HTTPException(status_code=404, detail="No such subject.")
    return {"status": "redacted", "subject": result}


@router.post("/subjects/{uid}/erase")
def api_erase_subject(uid: str, reason: str = Query(""), force: bool = Query(False),
                      user: dict = Depends(_admin)):
    """Article 17 — full erasure, where nothing lawfully requires retention."""
    try:
        stone = gdpr.erase_subject(
            uid,
            actor=user.get("username", "unknown"),
            actor_id=user.get("id"),
            reason=reason,
            force=force,
        )
    except gdpr.ErasureRefused as exc:
        # 409, not 400: the request is well-formed and the caller is
        # authorised — it conflicts with the current state of the data. The
        # body carries the Article and what is blocking, so the interface can
        # explain the refusal instead of showing "operation failed".
        raise HTTPException(
            status_code=409,
            detail={
                "message": str(exc),
                "article": exc.article,
                "trials_blocking": exc.trials_blocking,
                "alternative": "redact",
            },
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return {"status": "erased", "tombstone": stone}


@router.get("/erasures")
def api_erasure_log(user: dict = Depends(_admin)):
    """Evidence that erasure requests were honoured, and what went with them."""
    return {"erasures": gdpr.erasure_log()}


@router.get("/retention")
def api_retention(user: dict = Depends(_admin)):
    """Article 5(1)(e) — what is being held past the retention period."""
    overdue = gdpr.overdue_subjects()
    return {
        "retention_years": gdpr.retention_years(),
        "overdue_count": len(overdue),
        "overdue": overdue,
        "note": ("Reported for review, never deleted automatically. Erasing "
                 "clinical data on a timer is how a sponsor loses a dataset "
                 "they were required to keep."),
    }


@router.get("/processing-activities")
def api_processing_activities(user: dict = Depends(_admin)):
    """Article 30 — what this software does with personal data."""
    return gdpr.processing_activities()
