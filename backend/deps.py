"""Omnia AI — Shared FastAPI auth dependencies."""
from fastapi import Header, HTTPException
from typing import Optional
from backend.users import get_session_user


def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    """Require a valid session. Raises 401 if missing/invalid."""
    token = _extract_token(authorization)
    user = get_session_user(token) if token else None
    if not user:
        raise HTTPException(401, "Not authenticated")
    return user


def get_optional_user(authorization: Optional[str] = Header(None)) -> Optional[dict]:
    """Return the user if a valid session is present, else None. Never raises."""
    token = _extract_token(authorization)
    return get_session_user(token) if token else None


def _extract_token(authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None
    if authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return authorization.strip()


def require_roles(user: dict, *roles: str):
    """Call inside a route body: require_roles(user, 'admin', 'pathologist')."""
    if user["role"] not in roles:
        raise HTTPException(403, f"Requires role: {' or '.join(roles)}")
