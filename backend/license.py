"""Omnia AI — License Validator (replaces accounts/auth).
Simple HMAC-based license key validation.
"""
import hmac
import hashlib
import os
import datetime
from pathlib import Path

SECRET = b"omnia-secret-key-change-in-production"
LICENSE_FILE = Path(os.environ.get("OMNIA_DATA_DIR", ".")) / "license.key"

def generate_key(organization: str, expiry: str) -> str:
    """Generate a license key for testing.
    Usage: generate_key("ICON_Netherlands", "2027-08-15")
    """
    msg = f"{organization}|{expiry}"
    sig = hmac.new(SECRET, msg.encode(), hashlib.sha256).hexdigest()[:16]
    return f"{msg}|{sig}"

def validate_key(key: str) -> dict:
    """Validate a license key. Returns {valid, organization, expires, message}."""
    try:
        parts = key.strip().split("|")
        if len(parts) != 3:
            return {"valid": False, "message": "Invalid format. Expected: organization|date|signature"}
        organization, expiry, sig = parts
        expected = hmac.new(SECRET, f"{organization}|{expiry}".encode(), hashlib.sha256).hexdigest()[:16]
        if not hmac.compare_digest(sig, expected):
            return {"valid": False, "message": "Invalid license key."}
        exp = datetime.datetime.strptime(expiry, "%Y-%m-%d").date()
        if exp < datetime.date.today():
            return {"valid": False, "message": f"License expired {expiry}."}
        return {"valid": True, "organization": organization, "expires": expiry, "message": "Valid"}
    except Exception as e:
        return {"valid": False, "message": f"Validation error: {e}"}

def save_license(key: str):
    """Save license key to file."""
    LICENSE_FILE.parent.mkdir(parents=True, exist_ok=True)
    LICENSE_FILE.write_text(key.strip())

def load_license() -> str:
    """Load license key from file."""
    if LICENSE_FILE.exists():
        return LICENSE_FILE.read_text().strip()
    return ""

def check_status() -> dict:
    """Check current license status from saved file."""
    key = load_license()
    if not key:
        return {"valid": False, "message": "No license key found. Enter your license key to activate."}
    return validate_key(key)

# Generate a test key for development
if __name__ == "__main__":
    key = generate_key("Development", "2028-12-31")
    print(f"Test license key: {key}")
    print(f"Validate: {validate_key(key)}")
