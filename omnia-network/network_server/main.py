"""Omnia Network — federated contribution server.

Sites upload trained head deltas here (never the backbone, never patient
data). Nothing is merged automatically: contributions sit in pending/ until
a human runs merge.py and decides whether the result is good enough to
publish. This is intentional for a pilot with a handful of sites — the
promotion decision is exactly the kind of judgment call that shouldn't be
automated until there's a track record to automate it against.
"""
import datetime
import logging
import os
import re

from fastapi import FastAPI, Header, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

from . import auth, ingest, merge, storage

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("omnia-network")

app = FastAPI(title="Omnia Network — Federated Contribution Server")

# The admin dashboard (a separate app, typically on localhost:3000 in dev)
# calls the /admin/* endpoints directly from the browser, which needs CORS.
# The actual authorization boundary is the x-admin-token check on each
# route, not this — CORS here only decides which browser origins may
# *attempt* a request. Defaults to common local dev ports; set
# OMNIA_NETWORK_DASHBOARD_ORIGINS (comma-separated) for a deployed dashboard.
_default_origins = "http://localhost:3000,http://127.0.0.1:3000"
_origins = os.environ.get("OMNIA_NETWORK_DASHBOARD_ORIGINS", _default_origins).split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _origins if o.strip()],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["x-admin-token", "x-site-key", "content-type", "accept"],
)

ADMIN_TOKEN = os.environ.get("OMNIA_NETWORK_ADMIN_TOKEN", "")


def _require_site(x_site_key: str = Header(...)) -> str:
    site_id = auth.verify_site_key(x_site_key)
    if site_id is None:
        raise HTTPException(401, "Invalid or missing site key.")
    return site_id


def _require_admin(x_admin_token: str = Header(...)) -> None:
    # Deliberately fail closed: an unset ADMIN_TOKEN must never mean "open
    # access", so an empty configured token still rejects every request
    # rather than comparing empty-to-empty and passing.
    if not ADMIN_TOKEN or x_admin_token != ADMIN_TOKEN:
        raise HTTPException(401, "Invalid or missing admin token.")


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")
    if not slug:
        raise HTTPException(422, "Site name must contain at least one letter or digit.")
    return slug


@app.get("/health")
def health():
    return {"status": "ok", "insecure_signing": auth.USING_DEV_SECRET}


@app.post("/contribute")
async def contribute(
    file: UploadFile = File(...),
    sample_count: int = Form(...),
    local_val_qwk: float = Form(...),
    x_site_key: str = Header(...),
):
    site_id = _require_site(x_site_key)
    weights_bytes = await file.read()
    metadata = {"sample_count": sample_count, "local_val_qwk": local_val_qwk}

    try:
        ingest.validate_contribution(weights_bytes, metadata)
    except ingest.IngestError as e:
        raise HTTPException(422, str(e))

    contribution_id = storage.save_contribution(site_id, weights_bytes, metadata)
    logger.info("Received contribution %s from site %s (%d bytes, %d samples, val QWK %.4f)",
                contribution_id, site_id, len(weights_bytes), sample_count, local_val_qwk)
    return {"received": True, "contribution_id": contribution_id}


@app.get("/latest")
def latest():
    release = storage.latest_release()
    if release is None:
        return {"version": None}
    return release


@app.get("/release/{version}")
def get_release(version: str, x_site_key: str = Header(...)):
    _require_site(x_site_key)
    result = storage.get_release(version)
    if result is None:
        raise HTTPException(404, "No such release.")
    weights_bytes, meta = result
    return Response(
        content=weights_bytes,
        media_type="application/octet-stream",
        headers={
            "X-Omnia-Signature": meta.get("signature", ""),
            "X-Omnia-Version": version,
        },
    )


# ─── Admin (dashboard) ───
# Everything below is for the operator, not sites — gated by a single admin
# token rather than the per-site key scheme above. This is a pilot-scale
# tool for one operator, not a multi-user auth system; add real accounts
# before handing dashboard access to more than one person.

class MergeRequest(BaseModel):
    contribution_ids: list[str]


class NewSiteRequest(BaseModel):
    site_name: str


@app.get("/admin/pending")
def admin_pending(x_admin_token: str = Header(...)):
    _require_admin(x_admin_token)
    return storage.list_pending()


@app.get("/admin/releases")
def admin_releases(x_admin_token: str = Header(...)):
    _require_admin(x_admin_token)
    return storage.list_releases()


@app.get("/admin/sites")
def admin_sites(x_admin_token: str = Header(...)):
    _require_admin(x_admin_token)
    return storage.list_sites()


@app.post("/admin/sites")
def admin_create_site(req: NewSiteRequest, x_admin_token: str = Header(...)):
    _require_admin(x_admin_token)
    site_id = _slugify(req.site_name)
    issued = datetime.date.today().isoformat()
    try:
        storage.register_site(site_id, req.site_name)
    except ValueError as e:
        raise HTTPException(409, str(e))
    key = auth.issue_site_key(site_id, issued)
    return {"site_id": site_id, "key": key}


@app.post("/admin/merge")
def admin_merge(req: MergeRequest, x_admin_token: str = Header(...)):
    _require_admin(x_admin_token)
    try:
        return merge.publish_merge(req.contribution_ids)
    except ValueError as e:
        raise HTTPException(422, str(e))
