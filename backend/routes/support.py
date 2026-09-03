"""Support surfaces for an application that runs offline.

There is no support portal to open, no chat to start and no status page to
poll, because this software runs on the site's own hardware with no network
dependency. What a site actually needs when something goes wrong is a file they
can send to whoever supports them, by whatever means their organisation
already uses — so that is what this provides.

The diagnostics bundle deliberately contains no patient data: counts, versions,
paths and recent log lines, and nothing that names or describes a subject. A
support file that carries clinical records turns a support request into a
disclosure.
"""
import datetime
import io
import json
import os
import platform
import sys
import zipfile
from pathlib import Path

from fastapi import APIRouter, Depends
from fastapi.responses import Response

from backend import audit
from backend.deps import get_current_user, require_roles
from backend.version import __version__

router = APIRouter(prefix="/api/system", tags=["support"])

DATA_DIR = Path(os.environ.get("OMNIA_DATA_DIR", ".")) / "data"


def _resource(name: str) -> Path:
    """A file shipped alongside the frozen application."""
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS) / name
    return Path(__file__).resolve().parents[2] / name


@router.get("/changelog")
def api_changelog(user: dict = Depends(get_current_user)):
    """The release notes shipped with this build.

    Read from the file in the bundle rather than fetched, so the notes a site
    reads are the notes for the version they are actually running — not
    whatever a website is serving today.
    """
    path = _resource("CHANGELOG.md")
    try:
        return {"version": __version__, "markdown": path.read_text(encoding="utf-8")}
    except OSError:
        return {"version": __version__, "markdown": "",
                "note": "No release notes are bundled with this build."}


@router.get("/diagnostics")
def api_diagnostics(user: dict = Depends(get_current_user)):
    """A support bundle the site can send on, containing no patient data.

    Administrator-only: it carries absolute filesystem paths and a map of the
    machine's dependencies, which is reconnaissance rather than something an
    ordinary account needs.
    """
    require_roles(user, "admin")
    now = datetime.datetime.now(datetime.timezone.utc)
    stamp = now.strftime("%Y-%m-%d_%H%M%S")

    info = {
        "generated_at": now.isoformat(timespec="seconds").replace("+00:00", "Z"),
        "generated_by": user.get("username"),
        "software": f"Omnia Pathology AI {__version__}",
        "python": sys.version.split()[0],
        "platform": {
            "system": platform.system(),
            "release": platform.release(),
            "machine": platform.machine(),
        },
        "frozen": bool(getattr(sys, "frozen", False)),
        "data_dir": str(DATA_DIR.resolve()) if DATA_DIR.exists() else str(DATA_DIR),
    }

    # Counts only. How many records exist is a support fact; what is in them is
    # not, and the difference is the whole reason this bundle can be emailed.
    counts = {}
    for name in ("trials", "patient_registry", "audit_log", "users", "queries", "batches"):
        f = DATA_DIR / f"{name}.json"
        try:
            payload = json.loads(f.read_text())
            counts[name] = len(payload) if isinstance(payload, (list, dict)) else 1
        except Exception:
            counts[name] = None
    info["record_counts"] = counts

    # The most recent activity, by action and count — never the detail text,
    # which can quote an identifier.
    try:
        recent = audit.list_events(limit=400)
        tally = {}
        for e in recent:
            tally[e.get("action", "?")] = tally.get(e.get("action", "?"), 0) + 1
        info["recent_activity_by_action"] = tally
        info["most_recent_event_at"] = recent[0]["timestamp"] if recent else None
    except Exception:
        info["recent_activity_by_action"] = {}

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("diagnostics.json", json.dumps(info, indent=2))
        z.writestr("README.txt",
                   "Omnia Pathology AI — diagnostics bundle\n"
                   "=======================================\n\n"
                   "This file contains software versions, record counts, and a summary of\n"
                   "recent activity by action type. It contains no patient data: no slide\n"
                   "images, no identifiers, no free-text notes, and no audit detail lines.\n\n"
                   "Send it to whoever supports this installation.\n")

    audit.log_event(
        action="diagnostics_export", entity_type="system", entity_id="",
        user_id=user.get("id"), username=user.get("username", "unknown"),
        details="Support diagnostics bundle generated (contains no patient data).",
    )

    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="omnia-diagnostics-{stamp}.zip"'},
    )
