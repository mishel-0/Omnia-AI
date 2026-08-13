"""Omnia AI — Analysis Routes (simplified for pathology pivot)."""
from fastapi import APIRouter

router = APIRouter(prefix="/api/analysis", tags=["analysis"])

@router.get("/health")
def analysis_health():
    return {"status": "ok", "module": "pathology", "version": "1.0.0"}
