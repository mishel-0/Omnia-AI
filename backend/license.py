"""Omnia AI — licence key validation.

Key format
----------
    ORGANISATION|EDITION|YYYY-MM-DD|SIGNATURE

The signature is an HMAC-SHA256 of everything before it, truncated to 16 hex
characters. Keys issued before editions existed have three fields and are
still accepted as full licences, so existing installs keep working.

Editions
--------
    demo   — 60-day evaluation. Time-limited and labelled as such throughout
             the interface, so nobody mistakes an evaluation copy for a
             licensed clinical deployment.
    full   — a normal commercial licence.

On the signing secret
---------------------
`OMNIA_LICENSE_SECRET` supplies the signing key. When it is unset the module
falls back to a published development secret and marks itself insecure, which
`check_status()` reports.

This is deliberately honest rather than reassuring: this repository is public,
so the fallback secret is public too, and anyone can mint a key against it.
Client-side licence checks are a speed bump in any product that ships the
validator to the customer — the binary can be patched regardless. Real
enforcement needs server-side activation. Set the environment variable for a
production build and treat this as deterrence, not security.
"""
import datetime
import hashlib
import hmac
import os
from pathlib import Path

# Published on purpose — see the module docstring. A build that cares sets
# OMNIA_LICENSE_SECRET and never uses this value.
_DEV_SECRET = b"omnia-development-secret-not-for-production"

SECRET = os.environ.get("OMNIA_LICENSE_SECRET", "").encode() or _DEV_SECRET
USING_DEV_SECRET = SECRET == _DEV_SECRET

LICENSE_FILE = Path(os.environ.get("OMNIA_DATA_DIR", ".")) / "license.key"

TRIAL_DAYS = 60
EDITIONS = ("demo", "full")


def _sign(payload: str) -> str:
    return hmac.new(SECRET, payload.encode(), hashlib.sha256).hexdigest()[:16]


def generate_key(organization: str, expiry: str, edition: str = "full") -> str:
    """Issue a licence key.

    `expiry` is YYYY-MM-DD, inclusive — the key is valid through that day.
    """
    organization = (organization or "").strip() or "Unlicensed"
    if "|" in organization:
        raise ValueError("Organisation name cannot contain '|'")
    if edition not in EDITIONS:
        raise ValueError(f"Edition must be one of: {', '.join(EDITIONS)}")
    datetime.datetime.strptime(expiry, "%Y-%m-%d")  # validate shape early
    payload = f"{organization}|{edition}|{expiry}"
    return f"{payload}|{_sign(payload)}"


def generate_trial_key(organization: str = "Evaluation", days: int = TRIAL_DAYS) -> dict:
    """Issue a time-limited evaluation key starting today."""
    expiry = datetime.date.today() + datetime.timedelta(days=days)
    key = generate_key(organization, expiry.isoformat(), edition="demo")
    return {
        "key": key,
        "organization": organization,
        "edition": "demo",
        "expires": expiry.isoformat(),
        "days": days,
    }


def validate_key(key: str) -> dict:
    """Validate a key, returning its status and remaining time.

    Never raises: a malformed key is a normal user error, not a fault.
    """
    parts = (key or "").strip().split("|")

    if len(parts) == 4:
        organization, edition, expiry, sig = parts
        payload = f"{organization}|{edition}|{expiry}"
    elif len(parts) == 3:
        # Pre-edition keys. Treated as full licences so existing activations
        # survive the format change rather than locking a user out.
        organization, expiry, sig = parts
        edition = "full"
        payload = f"{organization}|{expiry}"
    else:
        return {"valid": False, "message":
                "That key is not in the right format. Check for a missing character."}

    if edition not in EDITIONS:
        return {"valid": False, "message": "Unrecognised licence edition."}

    if not hmac.compare_digest(sig, _sign(payload)):
        return {"valid": False, "message":
                "This licence key is not valid. Check it was copied in full."}

    try:
        exp = datetime.datetime.strptime(expiry, "%Y-%m-%d").date()
    except ValueError:
        return {"valid": False, "message": "This licence key has an unreadable date."}

    today = datetime.date.today()
    days_left = (exp - today).days

    if days_left < 0:
        expired = "evaluation period" if edition == "demo" else "licence"
        return {
            "valid": False, "expired": True, "edition": edition,
            "organization": organization, "expires": expiry,
            "message": f"This {expired} ended on {expiry}.",
        }

    return {
        "valid": True,
        "organization": organization,
        "edition": edition,
        "expires": expiry,
        "days_remaining": days_left,
        # Surfaced so the interface can warn before work is interrupted,
        # rather than the app simply stopping one morning.
        "expiring_soon": days_left <= 14,
        "message": (
            f"Evaluation copy — {days_left} day{'s' if days_left != 1 else ''} remaining"
            if edition == "demo" else f"Licensed to {organization}"
        ),
    }


def save_license(key: str) -> None:
    LICENSE_FILE.parent.mkdir(parents=True, exist_ok=True)
    LICENSE_FILE.write_text(key.strip())


def load_license() -> str:
    if LICENSE_FILE.exists():
        return LICENSE_FILE.read_text().strip()
    return ""


def check_status() -> dict:
    key = load_license()
    if not key:
        return {"valid": False, "message":
                "No licence key found. Enter your key to activate Omnia."}
    status = validate_key(key)
    # Reported so an operator can tell whether this build's keys are signed
    # with a real secret or the published development one.
    status["insecure_signing"] = USING_DEV_SECRET
    return status


if __name__ == "__main__":  # pragma: no cover - operator utility
    import json
    import sys

    org = sys.argv[1] if len(sys.argv) > 1 else "Evaluation"
    print(json.dumps(generate_trial_key(org), indent=2))
