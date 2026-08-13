"""Omnia AI — Audit Trail API Routes."""
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import Response
from typing import Optional
from backend.audit import list_events, export_csv
from backend.deps import get_current_user, require_roles

router = APIRouter(prefix="/api/audit", tags=["audit"])


@router.get("/")
def api_list_events(trial_id: Optional[str] = None, user_id: Optional[str] = None,
                     action: Optional[str] = None, limit: int = 500,
                     user: dict = Depends(get_current_user)):
    require_roles(user, "admin", "monitor")
    return list_events(trial_id=trial_id, user_id=user_id, action=action, limit=limit)


@router.get("/export-csv")
def api_export_csv(trial_id: Optional[str] = None, user: dict = Depends(get_current_user)):
    require_roles(user, "admin", "monitor")
    csv_data = export_csv(trial_id=trial_id)
    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=audit_trail.csv"}
    )
