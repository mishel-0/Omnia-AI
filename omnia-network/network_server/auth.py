"""Site API keys for the Omnia federated network.

Same HMAC pattern as backend/license.py, deliberately — one signing scheme
to reason about instead of two. A site key proves which installation sent a
contribution; it is not what protects the contribution's contents, since the
payload itself never contains patient data (see ingest.py).

Key format
----------
    SITE_ID|ISSUED_YYYY-MM-DD|SIGNATURE

The signature is an HMAC-SHA256 of everything before it, truncated to 16 hex
characters.
"""
import hashlib
import hmac
import os

SECRET = os.environ.get("OMNIA_NETWORK_SECRET", "").encode() or b"omnia-network-dev-secret-not-for-production"
USING_DEV_SECRET = SECRET == b"omnia-network-dev-secret-not-for-production"


def _sign(payload: str) -> str:
    return hmac.new(SECRET, payload.encode(), hashlib.sha256).hexdigest()[:16]


def issue_site_key(site_id: str, issued: str) -> str:
    site_id = (site_id or "").strip()
    if "|" in site_id or not site_id:
        raise ValueError("site_id must be non-empty and contain no '|'")
    payload = f"{site_id}|{issued}"
    return f"{payload}|{_sign(payload)}"


def verify_site_key(key: str) -> str | None:
    """Returns the site_id if the key is valid, else None."""
    parts = (key or "").strip().split("|")
    if len(parts) != 3:
        return None
    site_id, issued, sig = parts
    payload = f"{site_id}|{issued}"
    if not hmac.compare_digest(sig, _sign(payload)):
        return None
    return site_id
