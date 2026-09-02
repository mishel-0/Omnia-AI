"""Omnia AI — Audit Trail (21 CFR Part 11–style immutable event log).

Every write action in the system (login, trial/patient/slide changes, e-signatures,
queries, exports) is appended here. Entries are never edited or deleted through the API —
only appended — so the log stays a trustworthy record of who did what and when.
"""
import os
import uuid
import contextvars
import datetime
from pathlib import Path
from typing import Optional
from backend.storage import read_json, write_json, transaction

DATA_DIR = Path(os.environ.get("OMNIA_DATA_DIR", ".")) / "data"
AUDIT_FILE = DATA_DIR / "audit_log.json"


def _init():
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def _read_json(path):
    return read_json(path, [])


def _write_json(path, data):
    write_json(path, data)


# The network origin of whatever is currently being served.
#
# 21 CFR Part 11 §11.10(e) wants an audit trail that identifies the source of a
# record, and until now an entry said who but never from where. Passing the
# request down to every log_event call site would have meant touching all of
# them, so this is a context variable set once per request by middleware and
# read here. ContextVars propagate into Starlette's threadpool, so synchronous
# endpoints see it too.
_current_ip = contextvars.ContextVar("omnia_audit_ip", default="")


def set_request_ip(ip: str):
    """Record the origin of the request being served on this context."""
    _current_ip.set(ip or "")


def log_event(
    action: str,
    entity_type: str,
    entity_id: str = "",
    user_id: Optional[str] = None,
    username: str = "system",
    details: str = "",
    trial_id: Optional[str] = None,
) -> dict:
    """Append an immutable audit entry. Never raises — auditing must never break the request."""
    try:
        _init()
        entry = {
            "id": str(uuid.uuid4())[:8],
            "timestamp": datetime.datetime.now().isoformat(),
            "user_id": user_id,
            "username": username,
            "action": action,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "trial_id": trial_id,
            "details": details,
            # Empty for anything not raised by an HTTP request — the background
            # workers, migrations, startup recovery. Rendered as "—" rather
            # than invented, and blank on every entry written before this
            # field existed.
            "ip": _current_ip.get(""),
        }
        # Guarded so concurrent actions cannot drop each other's audit entries —
        # a lost entry means the trail no longer reflects what actually happened.
        with transaction():
            entries = _read_json(AUDIT_FILE)
            entries.append(entry)
            _write_json(AUDIT_FILE, entries)
        return entry
    except Exception:
        return {}


def list_events(trial_id: Optional[str] = None, user_id: Optional[str] = None,
                 action: Optional[str] = None, limit: int = 500) -> list:
    _init()
    entries = _read_json(AUDIT_FILE)
    if trial_id:
        entries = [e for e in entries if e.get("trial_id") == trial_id]
    if user_id:
        entries = [e for e in entries if e.get("user_id") == user_id]
    if action:
        entries = [e for e in entries if e.get("action") == action]
    entries.sort(key=lambda e: e["timestamp"], reverse=True)
    return entries[:limit]


def export_csv(trial_id: Optional[str] = None) -> str:
    import io
    import csv
    entries = list_events(trial_id=trial_id, limit=100000)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["timestamp", "username", "action", "entity_type", "entity_id", "trial_id", "details"])
    for e in entries:
        writer.writerow([e["timestamp"], e["username"], e["action"], e["entity_type"],
                          e["entity_id"], e.get("trial_id") or "", e["details"]])
    return buf.getvalue()
