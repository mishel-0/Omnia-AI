#!/usr/bin/env python3
"""
Omnia AI — Dependency Audit Bot
Checks requirements.txt matches actual imports, package.json matches deps.
Run: python3 scripts/audit_deps.py
"""
import os
import sys
import json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PASS = 0
FAIL = 0
WARNINGS = []


def ok(msg: str):
    global PASS
    PASS += 1
    print(f"  ✓ {msg}")


def fail(msg: str):
    global FAIL
    FAIL += 1
    print(f"  ✗ {msg}")


def warn(msg: str):
    WARNINGS.append(msg)
    print(f"  ⚠ {msg}")


print(f"\n{'='*60}")
print("  OMNIA AI — DEPENDENCY AUDIT")
print(f"{'='*60}\n")

# ── Backend deps ──
print("▶ Backend (Python)...")
# The standard library, straight from the interpreter. Anything here is
# available without being installed, so it must never be reported as a missing
# requirement. sys.stdlib_module_names is 3.10+; the fallback keeps this script
# usable on 3.9 without reintroducing a hand-maintained list as the primary
# source of truth.
STDLIB = set(getattr(sys, "stdlib_module_names", ())) | {
    "__future__", "os", "sys", "io", "json", "re", "time", "math", "typing",
    # First-party. `from backend import ...` is this application importing
    # itself, not a third-party package that belongs in requirements.txt.
    "backend",
}

req_path = os.path.join(ROOT, "requirements.txt")
if not os.path.exists(req_path):
    fail("requirements.txt not found")
    sys.exit(1)

with open(req_path) as f:
    req_lines = [l.strip() for l in f if l.strip() and not l.startswith("#")]

# Check all required packages are listed
# What this product actually needs. These lists previously described the
# retired DICOM/ARIA radiology product — pydicom, matplotlib, cornerstone,
# dicom-parser — so `npm run check:deps` reported "5 ISSUES — fix before
# deploying" on a perfectly healthy pathology tree, every single run. A gate
# that always fails teaches you to ignore it, which is worse than no gate.
REQUIRED_BACKEND = {
    "torch": "PyTorch model runtime",
    "torchvision": "Image transforms",
    "numpy": "Array operations",
    "openslide-python": "Whole-slide image reading",
    "openslide-bin": "Bundled OpenSlide native library",
    "opencv-python-headless": "Tile preprocessing",
    "fastapi": "API framework",
    "uvicorn": "ASGI server",
    "python-multipart": "File uploads",
    "pydantic": "Data validation",
    "reportlab": "Pathology report PDFs",
    "requests": "Omnia Network contribution upload",
    "rdkit": "Investigational-product chemistry",
}

for pkg, purpose in REQUIRED_BACKEND.items():
    found = any(pkg.lower() in line.lower() for line in req_lines)
    if found:
        ok(f"{pkg} in requirements.txt ({purpose})")
    else:
        warn(f"{pkg} MISSING from requirements.txt ({purpose}) — needed for {purpose}")

# Check for packages imported but not listed
IMPORTED_IN_CODE = set()
for root_dir, dirs, files in os.walk(os.path.join(ROOT, "backend")):
    for f in files:
        if f.endswith(".py"):
            with open(os.path.join(root_dir, f)) as fh:
                for line in fh:
                    if line.startswith("import ") or line.startswith("from "):
                        parts = line.split()
                        if len(parts) > 1:
                            pkg = parts[1].split(".")[0]
                            # Ask Python what the standard library is rather
                            # than maintaining the list by hand. The hand-kept
                            # version was missing pathlib, tempfile, platform,
                            # random, traceback, dataclasses and
                            # multiprocessing — and carried " secrets" with a
                            # leading space, so it never matched either. Every
                            # run therefore demanded that eight stdlib modules
                            # be added to requirements.txt.
                            if pkg not in STDLIB:
                                IMPORTED_IN_CODE.add(pkg)

for pkg in sorted(IMPORTED_IN_CODE):
    found = any(pkg.lower() in line.lower() for line in req_lines)
    if not found:
        warn(f"{pkg} imported in code but NOT in requirements.txt")

# ── Frontend deps ──
print("\n▶ Frontend (Node.js)...")
pkg_path = os.path.join(ROOT, "package.json")
if not os.path.exists(pkg_path):
    fail("package.json not found")
else:
    with open(pkg_path) as f:
        pkg_data = json.load(f)

    deps = {**pkg_data.get("dependencies", {}), **pkg_data.get("devDependencies", {})}

    REQUIRED_FRONTEND = {
        "next": "React framework",
        "react": "UI library",
        "react-dom": "DOM rendering",
        "lucide-react": "Icons",
        "tailwindcss": "CSS framework",
        "typescript": "Type checking",
        "electron": "Desktop shell",
        "electron-builder": "Installer packaging",
    }

    for pkg, purpose in REQUIRED_FRONTEND.items():
        if pkg in deps:
            ok(f"{pkg} v{deps[pkg]} in package.json ({purpose})")
        else:
            fail(f"{pkg} MISSING from package.json ({purpose})")

# ── Summary ──
print(f"\n{'='*60}")
print(f"  RESULTS: {PASS} passed, {FAIL} failed, {PASS + FAIL} total")
print(f"{'='*60}")

if WARNINGS:
    print(f"\n  WARNINGS ({len(WARNINGS)}):")
    for w in WARNINGS:
        print(f"    ⚠ {w}")

print(f"\n  {'ALL CHECKS PASSED' if FAIL == 0 else f'{FAIL} ISSUES — fix before deploying'}")
print(f"{'='*60}\n")
sys.exit(0 if FAIL == 0 else 1)
