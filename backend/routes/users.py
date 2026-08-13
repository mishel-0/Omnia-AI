"""Omnia AI — User Accounts & Auth API Routes."""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
from backend.users import (
    list_users, get_user, create_user, update_user, deactivate_user,
    authenticate, create_session, destroy_session, any_users_exist,
    verify_password_for_user, ROLES,
)
from backend.deps import get_current_user, require_roles, _extract_token
from backend.audit import log_event
from fastapi import Header

router = APIRouter(prefix="/api/users", tags=["users"])


class BootstrapRequest(BaseModel):
    username: str
    password: str
    full_name: str


class LoginRequest(BaseModel):
    username: str
    password: str


class CreateUserRequest(BaseModel):
    username: str
    password: str
    full_name: str
    role: str


class UpdateUserRequest(BaseModel):
    full_name: Optional[str] = None
    role: Optional[str] = None
    password: Optional[str] = None
    active: Optional[bool] = None


class VerifyPasswordRequest(BaseModel):
    password: str


@router.get("/bootstrap-needed")
def api_bootstrap_needed():
    return {"needed": not any_users_exist()}


@router.post("/bootstrap")
def api_bootstrap(req: BootstrapRequest):
    """Create the first admin account. Only works when no users exist yet."""
    if any_users_exist():
        raise HTTPException(400, "Setup already complete")
    user = create_user(req.username, req.password, req.full_name, "admin")
    token = create_session(user["id"])
    log_event("login", "user", user["id"], user_id=user["id"], username=user["username"], details="Initial admin account created")
    return {"token": token, "user": user}


@router.post("/login")
def api_login(req: LoginRequest):
    user = authenticate(req.username, req.password)
    if not user:
        raise HTTPException(401, "Invalid username or password")
    from backend.users import _public
    token = create_session(user["id"])
    log_event("login", "user", user["id"], user_id=user["id"], username=user["username"])
    return {"token": token, "user": _public(user)}


@router.post("/logout")
def api_logout(authorization: Optional[str] = Header(None), user: dict = Depends(get_current_user)):
    destroy_session(_extract_token(authorization))
    log_event("logout", "user", user["id"], user_id=user["id"], username=user["username"])
    return {"ok": True}


@router.get("/me")
def api_me(user: dict = Depends(get_current_user)):
    return user


@router.post("/verify-password")
def api_verify_password(req: VerifyPasswordRequest, user: dict = Depends(get_current_user)):
    """Used for e-signature — re-verify the current user's password before a sign-off action."""
    return {"valid": verify_password_for_user(user["id"], req.password)}


@router.get("/")
def api_list_users(user: dict = Depends(get_current_user)):
    require_roles(user, "admin")
    return list_users()


@router.post("/")
def api_create_user(req: CreateUserRequest, user: dict = Depends(get_current_user)):
    require_roles(user, "admin")
    if req.role not in ROLES:
        raise HTTPException(400, f"Invalid role. Must be one of: {', '.join(ROLES)}")
    try:
        created = create_user(req.username, req.password, req.full_name, req.role)
    except ValueError as e:
        raise HTTPException(400, str(e))
    log_event("create", "user", created["id"], user_id=user["id"], username=user["username"],
              details=f"Created user {created['username']} ({created['role']})")
    return created


@router.patch("/{user_id}")
def api_update_user(user_id: str, req: UpdateUserRequest, user: dict = Depends(get_current_user)):
    require_roles(user, "admin")
    updates = req.model_dump()
    try:
        updated = update_user(user_id, updates)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if not updated:
        raise HTTPException(404, "User not found")
    log_event("update", "user", user_id, user_id=user["id"], username=user["username"])
    return updated


@router.delete("/{user_id}")
def api_deactivate_user(user_id: str, user: dict = Depends(get_current_user)):
    require_roles(user, "admin")
    if user_id == user["id"]:
        raise HTTPException(400, "Cannot deactivate your own account")
    updated = deactivate_user(user_id)
    if not updated:
        raise HTTPException(404, "User not found")
    log_event("deactivate", "user", user_id, user_id=user["id"], username=user["username"])
    return updated
