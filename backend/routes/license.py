"""Omnia AI — licence routes."""
import os

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.license import (
    validate_key, save_license, check_status, generate_trial_key, TRIAL_DAYS,
)

router = APIRouter(prefix="/api/license", tags=["license"])


class ActivateRequest(BaseModel):
    key: str


@router.get("/status")
def get_status():
    """Current licence status, including days remaining on an evaluation."""
    return check_status()


@router.post("/activate")
def activate(req: ActivateRequest):
    result = validate_key(req.key)
    if result["valid"]:
        save_license(req.key)
    return result


@router.post("/trial")
def start_trial():
    """Issue a {TRIAL_DAYS}-day evaluation key for this installation.

    Available only when no licence is already active, so it cannot be used to
    roll an expired evaluation forward indefinitely.

    This is not access control — the key format is verifiable offline and the
    validator ships with the app, so a determined user can bypass it. It
    exists to give an evaluator a working copy without contacting sales, and
    to make the evaluation period visible in the interface.
    """
    current = check_status()
    if current.get("valid"):
        raise HTTPException(409, "This installation already has an active licence.")
    if current.get("expired") and current.get("edition") == "demo":
        raise HTTPException(
            409,
            "The evaluation period for this installation has ended. "
            "Contact Omnia for a full licence.",
        )
    return generate_trial_key()


# Key minting is a build-time operation, not a runtime API. This previously
# existed as an unauthenticated POST that would hand a licence key to anyone
# who called it, which made the licence check decorative. It is now available
# only when OMNIA_DEV_TOOLS is explicitly set, and never in a shipped build.
if os.environ.get("OMNIA_DEV_TOOLS") == "true":  # pragma: no cover - dev only
    from backend.license import generate_key

    @router.post("/generate-key")
    def generate_dev_key(org: str = "Development", exp: str = "2030-12-31",
                         edition: str = "full"):
        return {"key": generate_key(org, exp, edition)}
