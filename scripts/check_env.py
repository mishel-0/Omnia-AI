#!/usr/bin/env python3
"""
Omnia AI — Environment Health Bot
Checks everything before you run the app.
Run: python3 scripts/check_env.py
"""
import os
import sys
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PASS = 0
FAIL = 0
CHECKS = []


def check(name: str, ok: bool, detail: str = ""):
    global PASS, FAIL
    CHECKS.append((name, ok, detail))
    if ok:
        PASS += 1
    else:
        FAIL += 1


print(f"\n{'='*60}")
print("  OMNIA AI — ENVIRONMENT HEALTH CHECK")
print(f"{'='*60}\n")

# ── 1. Python version ──
py = sys.version_info
check("Python version", py.major == 3 and py.minor >= 9,
      f"Python {py.major}.{py.minor}.{py.micro} ({sys.executable})")

# ── 2. Critical Python packages (check both 3.9 and 3.14) ──
# What this product actually imports. This listed pydicom and httpx, and the
# model check below looked for ARIA radiology checkpoints — both from the
# retired DICOM product — so the script reported hard failures on a healthy
# pathology install every time it ran.
REQUIRED_PIPS = {
    "torch": "ML model inference",
    "openslide": "Whole-slide image reading",
    "cv2": "Tile preprocessing",
    "PIL": "Image processing",
    "fastapi": "API server",
    "uvicorn": "ASGI server",
    "numpy": "Array operations",
    "reportlab": "Pathology report PDFs",
}
for pkg, purpose in REQUIRED_PIPS.items():
    try:
        __import__(pkg)
        check(f"pip: {pkg}", True, f"{purpose} ✓ (Python {py.major}.{py.minor})")
    except ImportError:
        # Try Python 3.9 (Xcode toolchain — actual backend runtime)
        try:
            result = subprocess.run(
                ["/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/3.9/Resources/Python.app/Contents/MacOS/Python",
                 "-c", f"import {pkg}"],
                capture_output=True, text=True, timeout=5)
            if result.returncode == 0:
                check(f"pip: {pkg}", True, f"{purpose} ✓ (Python 3.9 — backend runtime)")
            else:
                check(f"pip: {pkg}", False, f"MISSING in both Python {py.major}.{py.minor} and 3.9 — needed for {purpose}")
        except Exception:
            check(f"pip: {pkg}", False, f"MISSING — needed for {purpose}")

# ── 3. Model files ──
# The grading model that actually ships. The three ARIA files this used to
# demand belonged to the retired DICOM product and have never existed in this
# repository, so this section failed on every run.
for fname in [os.path.join("backend", "models", "omnia_prostate_v1.pt")]:
    path = os.path.join(ROOT, fname)
    exists = os.path.exists(path)
    size = os.path.getsize(path) if exists else 0
    check(f"model: {fname}", exists and size > 0,
          f"{size:,} bytes" if exists else "MISSING")

# ── 4. Database files ──
DB_DIR = os.path.join(ROOT, "data")
os.makedirs(DB_DIR, exist_ok=True)
for db in ["omnia_users.db", "phi_store.db"]:
    path = os.path.join(DB_DIR, db)
    exists = os.path.exists(path)
    check(f"db: {db}", True, f"{'exists' if exists else 'will be created on first run'}")

# ── 5. Port availability ──
import socket
for port, name in [(3000, "Frontend (Next.js)"), (8000, "Backend (FastAPI)"), (11434, "Ollama")]:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    result = sock.connect_ex(('127.0.0.1', port))
    sock.close()
    if result == 0:
        check(f"port {port}: {name}", True,
              "IN USE (server running)" if name != "Ollama" else "busy (Ollama running)")
    else:
        check(f"port {port}: {name}", True, "available ✓")

# ── 6. .env.local ──
env_path = os.path.join(ROOT, ".env.local")
if os.path.exists(env_path):
    with open(env_path) as f:
        content = f.read()
    has_api = "NEXT_PUBLIC_API_URL" in content
    check(".env.local", has_api, "found with API_URL ✓" if has_api else "found but missing NEXT_PUBLIC_API_URL")
else:
    check(".env.local", False, "MISSING — backend won't connect from frontend")

# Two checks were removed here rather than updated, because neither could
# fail. One reported a DICOM SCP from the retired product and passed in both
# branches of its own try/except; the other passed a hardcoded True and
# examined nothing at all. A check that always prints a tick measures nothing
# and makes the summary line less trustworthy for the checks that do.

# ── 7. .next/ stale cache check ──
next_dir = os.path.join(ROOT, ".next")
if os.path.exists(next_dir):
    build_id_path = os.path.join(next_dir, "build-manifest.json")
    if os.path.exists(build_id_path):
        check(".next/ cache", True, "exists (rm -rf .next if you see chunk loading errors)")
else:
    check(".next/ cache", True, "not present (will be created on first dev start)")


# ── Summary ──
print(f"\n{'='*60}")
print(f"  RESULTS: {PASS} passed, {FAIL} failed, {PASS + FAIL} total")
print(f"{'='*60}")

for name, ok, detail in CHECKS:
    status = "✓" if ok else "✗"
    print(f"  {status} {name}")
    if detail:
        print(f"    {detail}")

print(f"\n  {'ALL CHECKS PASSED — system ready' if FAIL == 0 else f'{FAIL} ISSUES FOUND — fix before running'}")
print(f"{'='*60}\n")
sys.exit(0 if FAIL == 0 else 1)
