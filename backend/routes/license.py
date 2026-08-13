"""Omnia AI — License Routes (replaces auth routes)."""
from fastapi import APIRouter
from pydantic import BaseModel
from backend.license import validate_key, save_license, check_status, generate_key

router = APIRouter(prefix="/api/license", tags=["license"])

class ActivateRequest(BaseModel):
    key: str

@router.get("/status")
def get_status():
    """Check current license status."""
    return check_status()

@router.post("/activate")
def activate(req: ActivateRequest):
    """Activate a license key."""
    result = validate_key(req.key)
    if result["valid"]:
        save_license(req.key)
    return result

@router.post("/generate-dev-key")
def generate_dev_key(org: str = "Development", exp: str = "2028-12-31"):
    """Generate a development license key (for testing)."""
    return {"key": generate_key(org, exp)}
