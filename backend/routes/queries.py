"""Omnia AI — Query / Discrepancy Management API Routes."""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
from backend.queries import (
    raise_query, list_queries, get_query, respond_to_query, close_query, reopen_query,
)
from backend.deps import get_current_user
from backend.audit import log_event

router = APIRouter(prefix="/api/queries", tags=["queries"])


class RaiseQueryRequest(BaseModel):
    trial_id: str
    patient_uuid: str
    subject: str
    description: str
    slide_id: Optional[str] = None


class RespondRequest(BaseModel):
    text: str


@router.post("/")
def api_raise_query(req: RaiseQueryRequest, user: dict = Depends(get_current_user)):
    q = raise_query(req.trial_id, req.patient_uuid, req.subject, req.description,
                     raised_by=user["full_name"], slide_id=req.slide_id)
    log_event("raise_query", "query", q["id"], user_id=user["id"], username=user["username"],
              trial_id=req.trial_id, details=req.subject)
    return q


@router.get("/")
def api_list_queries(trial_id: Optional[str] = None, patient_uuid: Optional[str] = None,
                      status: Optional[str] = None, user: dict = Depends(get_current_user)):
    return list_queries(trial_id=trial_id, patient_uuid=patient_uuid, status=status)


@router.post("/{query_id}/respond")
def api_respond(query_id: str, req: RespondRequest, user: dict = Depends(get_current_user)):
    q = respond_to_query(query_id, user["full_name"], req.text)
    if not q:
        raise HTTPException(404, "Query not found")
    log_event("respond_query", "query", query_id, user_id=user["id"], username=user["username"],
               trial_id=q["trial_id"], details=req.text)
    return q


@router.post("/{query_id}/close")
def api_close(query_id: str, user: dict = Depends(get_current_user)):
    q = close_query(query_id, user["full_name"])
    if not q:
        raise HTTPException(404, "Query not found")
    log_event("close_query", "query", query_id, user_id=user["id"], username=user["username"], trial_id=q["trial_id"])
    return q


@router.post("/{query_id}/reopen")
def api_reopen(query_id: str, user: dict = Depends(get_current_user)):
    q = reopen_query(query_id)
    if not q:
        raise HTTPException(404, "Query not found")
    log_event("reopen_query", "query", query_id, user_id=user["id"], username=user["username"], trial_id=q["trial_id"])
    return q
