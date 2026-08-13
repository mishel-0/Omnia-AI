"""Omnia AI — Query / Discrepancy Management.

Standard EDC query workflow: any reviewer can raise a query against a patient or a
specific slide (e.g. "slide label doesn't match patient ID"), others respond, and a
monitor/pathologist closes it once resolved. Open query counts surface on trial and
patient views so nothing gets missed before database lock.
"""
import os
import uuid
import datetime
from pathlib import Path
from typing import Optional
from backend.storage import read_json, write_json, transaction

DATA_DIR = Path(os.environ.get("OMNIA_DATA_DIR", ".")) / "data"
QUERIES_FILE = DATA_DIR / "queries.json"

STATUSES = ("open", "answered", "closed")


def _init():
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def _read_json(path):
    return read_json(path, [])


def _write_json(path, data):
    write_json(path, data)


def raise_query(trial_id: str, patient_uuid: str, subject: str, description: str,
                 raised_by: str, slide_id: Optional[str] = None) -> dict:
    _init()
    query = {
        "id": str(uuid.uuid4())[:8],
        "trial_id": trial_id,
        "patient_uuid": patient_uuid,
        "slide_id": slide_id,
        "subject": subject,
        "description": description,
        "status": "open",
        "raised_by": raised_by,
        "raised_at": datetime.datetime.now().isoformat(),
        "responses": [],
    }
    with transaction():
        queries = _read_json(QUERIES_FILE)
        queries.append(query)
        _write_json(QUERIES_FILE, queries)
    return query


def list_queries(trial_id: Optional[str] = None, patient_uuid: Optional[str] = None,
                  status: Optional[str] = None) -> list:
    _init()
    queries = _read_json(QUERIES_FILE)
    if trial_id:
        queries = [q for q in queries if q["trial_id"] == trial_id]
    if patient_uuid:
        queries = [q for q in queries if q["patient_uuid"] == patient_uuid]
    if status:
        queries = [q for q in queries if q["status"] == status]
    queries.sort(key=lambda q: q["raised_at"], reverse=True)
    return queries


def get_query(query_id: str) -> Optional[dict]:
    for q in _read_json(QUERIES_FILE):
        if q["id"] == query_id:
            return q
    return None


def respond_to_query(query_id: str, responder: str, text: str) -> Optional[dict]:
    with transaction():
        queries = _read_json(QUERIES_FILE)
        for q in queries:
            if q["id"] == query_id:
                q["responses"].append({
                    "by": responder,
                    "text": text,
                    "at": datetime.datetime.now().isoformat(),
                })
                if q["status"] == "open":
                    q["status"] = "answered"
                _write_json(QUERIES_FILE, queries)
                return q

    return None


def close_query(query_id: str, closed_by: str) -> Optional[dict]:
    with transaction():
        queries = _read_json(QUERIES_FILE)
        for q in queries:
            if q["id"] == query_id:
                q["status"] = "closed"
                q["closed_by"] = closed_by
                q["closed_at"] = datetime.datetime.now().isoformat()
                _write_json(QUERIES_FILE, queries)
                return q

    return None


def reopen_query(query_id: str) -> Optional[dict]:
    with transaction():
        queries = _read_json(QUERIES_FILE)
        for q in queries:
            if q["id"] == query_id:
                q["status"] = "open"
                q.pop("closed_by", None)
                q.pop("closed_at", None)
                _write_json(QUERIES_FILE, queries)
                return q

    return None


def open_count(trial_id: str) -> int:
    return len([q for q in list_queries(trial_id=trial_id) if q["status"] != "closed"])


def delete_queries_for_trial(trial_id: str) -> int:
    """Remove every query belonging to a trial. Called when the trial is deleted
    so closed/open queries don't linger as orphans."""
    _init()
    queries = _read_json(QUERIES_FILE)
    keep = [q for q in queries if q.get("trial_id") != trial_id]
    removed = len(queries) - len(keep)
    if removed:
        _write_json(QUERIES_FILE, keep)
    return removed
