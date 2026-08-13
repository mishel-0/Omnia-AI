#!/usr/bin/env python3
"""
Omnia AI — API Contract Bot
Validates every API response against the expected schema.
Run: python3 scripts/check_api.py
"""
import os
import sys
import requests

API_BASE = os.environ.get("OMNIA_API_URL", "http://localhost:8000")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

REQUIRED_CONTRACTS = {
    "/health": {
        "status": str,
        "model_loaded": bool,
        "device": str,
        "classes": list,
    },
    "/api/aria/info": {
        "name": str,
        "version": str,
        "architecture": str,
        "classes": list,
        "loaded": bool,
    },
    "/api/auth/login": {
        "success": bool,
        "token": str,
        "user": dict,
    },
    "/api/auth/me": {
        "success": bool,
        "user": dict,
    },
}

FULL_ANALYSIS_CONTRACT = {
    "prediction": str,
    "confidence": (int, float),
    "confidence_pct": (int, float),
    "risk_level": str,
    "recommendation": str,
    "all_scores": list,
    "heatmap": str,
    "image_preview": str,
    "suspicious_regions": list,
    "lesion_size_mm": (int, float),
    "lesion_volume_mm3": (int, float),
    "radiomics": dict,
    "scanner_info": dict,
    "study_info": dict,
    "triage": dict,
    "fleischner": dict,
    "lungrads": dict,
}

PASS = 0
FAIL = 0


def validate_contract(name: str, data: dict, contract: dict) -> None:
    global PASS, FAIL
    missing = []
    wrong_type = []
    for field, expected_type in contract.items():
        if field not in data:
            missing.append(field)
            continue
        val = data[field]
        if isinstance(expected_type, tuple):
            if not isinstance(val, expected_type):
                wrong_type.append(f"{field}: expected {expected_type}, got {type(val).__name__}")
        elif not isinstance(val, expected_type):
            if expected_type == float and isinstance(val, int):
                continue  # int is fine for float fields
            wrong_type.append(f"{field}: expected {expected_type.__name__}, got {type(val).__name__}")
    if not missing and not wrong_type:
        PASS += 1
        print(f"  ✓ {name}")
    else:
        FAIL += 1
        print(f"  ✗ {name}")
        for f in missing:
            print(f"      Missing: {f}")
        for w in wrong_type:
            print(f"      Type:    {w}")


print(f"\n{'='*60}")
print("  OMNIA AI — API CONTRACT VALIDATION")
print(f"{'='*60}\n")

# ── Login first to get token ──
print("▶ Logging in...")
r = requests.post(f"{API_BASE}/api/auth/login", json={
    "email": "doctor@clinic.lt",
    "password": "TestPass123!",
})
if r.status_code != 200:
    print(f"  ✗ Login failed: {r.text[:200]}")
    sys.exit(1)
token = r.json().get("token")
headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
print("  ✓ Token acquired\n")

# ── Validate static endpoints ──
print("▶ Static endpoint contracts...")
for endpoint, contract in REQUIRED_CONTRACTS.items():
    r = requests.get(f"{API_BASE}{endpoint}", headers=headers)
    if r.status_code == 200:
        validate_contract(endpoint, r.json(), contract)
    elif endpoint == "/api/auth/login":
        # Already tested above
        pass
    else:
        FAIL += 1
        print(f"  ✗ {endpoint}: HTTP {r.status_code}")

# ── Validate full analysis contract ──
print("\n▶ Full analysis contract (DICOM)...")
try:
    import pydicom
    import numpy as np
    from pydicom.dataset import Dataset, FileMetaDataset
    import io

    ds = Dataset()
    ds.file_meta = FileMetaDataset()
    ds.file_meta.MediaStorageSOPClassUID = "1.2.840.10008.5.1.4.1.1.2"
    ds.file_meta.TransferSyntaxUID = "1.2.840.10008.1.2"
    ds.PatientName = "Test^Patient"
    ds.PatientID = "TEST001"
    ds.Modality = "CT"
    ds.Rows = 224
    ds.Columns = 224
    ds.PixelSpacing = [0.5, 0.5]
    pixels = np.random.randint(-1024, 1024, (224, 224), dtype=np.int16).tobytes()
    ds.PixelData = pixels
    ds.BitsAllocated = 16
    ds.BitsStored = 16
    ds.HighBit = 15
    ds.PixelRepresentation = 1
    ds.RescaleIntercept = -1024
    ds.RescaleSlope = 1
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = "MONOCHROME2"
    buf = io.BytesIO()
    ds.save_as(buf)
    buf.seek(0)

    r = requests.post(
        f"{API_BASE}/api/aria/full_analysis",
        files={"file": ("test.dcm", buf.getvalue(), "application/dicom")},
        params={"consent": "true"},
    )
    if r.status_code == 200:
        validate_contract("full_analysis (DICOM)", r.json(), FULL_ANALYSIS_CONTRACT)
    else:
        FAIL += 1
        print(f"  ✗ full_analysis: HTTP {r.status_code}: {r.text[:100]}")
except ImportError:
    print("  ⚠ Skipped (pydicom not available)")

# ── Validate patient contracts ──
print("\n▶ Patient endpoint contracts...")
r = requests.get(f"{API_BASE}/api/patients", headers=headers)
if r.status_code == 200:
    data = r.json()
    validate_contract("GET /api/patients", data, {"success": bool, "patients": list})
else:
    FAIL += 1
    print(f"  ✗ GET /api/patients: HTTP {r.status_code}")

# ── Validate chat contract ──
print("\n▶ Aria Chat contract...")
r = requests.post(f"{API_BASE}/api/aria/chat", json={
    "question": "test?", "analysis": {}, "patient": None,
}, headers=headers)
if r.status_code == 200:
    validate_contract("POST /api/aria/chat", r.json(), {"answer": str})
else:
    FAIL += 1
    print(f"  ✗ chat: HTTP {r.status_code}")

# ── Summary ──
print(f"\n{'='*60}")
print(f"  RESULTS: {PASS} passed, {FAIL} failed, {PASS + FAIL} total")
print(f"{'='*60}")
sys.exit(0 if FAIL == 0 else 1)
