"""Omnia AI — User accounts, roles, and session auth (JSON file storage, no DB needed).

Roles:
  admin        — full access: manage users, trials, patients, licensing
  pathologist  — review slides, confirm/correct with e-signature, raise/answer queries
  monitor      — CRA/monitor: read all data, raise/answer/close queries, view audit trail
  sponsor      — read-only: view trials/patients/reports, no write actions
"""
import os
import uuid
import hashlib
import secrets
import datetime
from pathlib import Path
from typing import Optional
from backend.storage import read_json as storage_read, write_json as storage_write, transaction

DATA_DIR = Path(os.environ.get("OMNIA_DATA_DIR", ".")) / "data"
USERS_FILE = DATA_DIR / "users.json"
SESSIONS_FILE = DATA_DIR / "sessions.json"

ROLES = ("admin", "pathologist", "monitor", "sponsor")
SESSION_TTL_HOURS = 12


def _init():
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def _read_json(path, default):
    return storage_read(path, default)


def _write_json(path, data):
    storage_write(path, data)


def _hash_password(password: str, salt: Optional[str] = None) -> str:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 200_000).hex()
    return f"{salt}${digest}"


def _verify_password(password: str, stored: str) -> bool:
    try:
        salt, _ = stored.split("$", 1)
    except ValueError:
        return False
    return secrets.compare_digest(_hash_password(password, salt), stored)


# ─── Users ───

def list_users() -> list:
    _init()
    return _read_json(USERS_FILE, [])


def get_user(user_id: str) -> Optional[dict]:
    for u in list_users():
        if u["id"] == user_id:
            return u
    return None


def get_user_by_username(username: str) -> Optional[dict]:
    username = username.strip().lower()
    for u in list_users():
        if u["username"].lower() == username:
            return u
    return None


def create_user(username: str, password: str, full_name: str, role: str) -> dict:
    _init()
    if role not in ROLES:
        raise ValueError(f"Invalid role: {role}")
    # The uniqueness check and the append have to sit inside one transaction:
    # split apart, two simultaneous registrations of the same username both
    # see "not taken", and the second write drops the first user entirely.
    with transaction():
        if get_user_by_username(username):
            raise ValueError("Username already exists")
        users = list_users()
        user = {
            "id": str(uuid.uuid4())[:8],
            "username": username.strip(),
            "full_name": full_name.strip(),
            "role": role,
            "password_hash": _hash_password(password),
            "active": True,
            "created": datetime.datetime.now().isoformat(),
        }
        users.append(user)
        _write_json(USERS_FILE, users)
        return _public(user)


def update_user(user_id: str, updates: dict) -> Optional[dict]:
    with transaction():
        users = list_users()
        for u in users:
            if u["id"] == user_id:
                if "password" in updates:
                    pw = updates.pop("password")
                    if pw:
                        u["password_hash"] = _hash_password(pw)
                if "role" in updates and updates["role"] not in (None, *ROLES):
                    raise ValueError(f"Invalid role: {updates['role']}")
                u.update({k: v for k, v in updates.items() if v is not None})
                _write_json(USERS_FILE, users)
                return _public(u)
        return None


def deactivate_user(user_id: str) -> Optional[dict]:
    return update_user(user_id, {"active": False})


def _public(user: dict) -> dict:
    return {k: v for k, v in user.items() if k != "password_hash"}


def any_users_exist() -> bool:
    return len(list_users()) > 0


# ─── Auth ───

def authenticate(username: str, password: str) -> Optional[dict]:
    user = get_user_by_username(username)
    if not user or not user.get("active", True):
        return None
    if not _verify_password(password, user["password_hash"]):
        return None
    return user


def verify_password_for_user(user_id: str, password: str) -> bool:
    user = get_user(user_id)
    if not user or not user.get("active", True):
        return False
    return _verify_password(password, user["password_hash"])


def _token_id(token: str) -> str:
    """The key a session is filed under: a hash of the token, not the token.

    sessions.json previously held bearer tokens verbatim, so read access to
    the data directory was direct account access — no password needed, just
    copy a string. Storing only the hash means the file is useless to anyone
    who obtains it, and costs nothing: the token still arrives on every
    request, so it can always be re-hashed to find the session.
    """
    return hashlib.sha256(token.encode()).hexdigest()


def _prune_expired(sessions: dict, now: datetime.datetime) -> dict:
    """Drop every session that has already expired.

    Expiry used to be evaluated only for the token being presented, so a
    session belonging to someone who simply closed the app was never removed
    and sessions.json grew for the life of the installation.
    """
    kept = {}
    for key, s in sessions.items():
        try:
            if datetime.datetime.fromisoformat(s["expires"]) >= now:
                kept[key] = s
        except (KeyError, TypeError, ValueError):
            continue  # malformed entry — dropping it is the safe direction
    return kept


def create_session(user_id: str) -> str:
    _init()
    token = secrets.token_hex(32)
    expires = datetime.datetime.now() + datetime.timedelta(hours=SESSION_TTL_HOURS)
    # Read, modify and write under one lock. Previously a login could race the
    # expiry cleanup below: the cleanup wrote back a dictionary it had read
    # before this token existed, so the user who had just signed in
    # successfully was 401'd on their very next request.
    with transaction():
        sessions = _prune_expired(_read_json(SESSIONS_FILE, {}), datetime.datetime.now())
        sessions[_token_id(token)] = {"user_id": user_id, "expires": expires.isoformat()}
        _write_json(SESSIONS_FILE, sessions)
    return token


def get_session_user(token: str) -> Optional[dict]:
    if not token:
        return None
    _init()
    with transaction():
        sessions = _read_json(SESSIONS_FILE, {})
        session = sessions.get(_token_id(token))
        if not session:
            return None
        if datetime.datetime.fromisoformat(session["expires"]) < datetime.datetime.now():
            _write_json(SESSIONS_FILE, _prune_expired(sessions, datetime.datetime.now()))
            return None
    user = get_user(session["user_id"])
    if not user or not user.get("active", True):
        return None
    return _public(user)


def destroy_session(token: str):
    _init()
    with transaction():
        sessions = _read_json(SESSIONS_FILE, {})
        key = _token_id(token)
        if key in sessions:
            del sessions[key]
            _write_json(SESSIONS_FILE, sessions)
