#!/bin/bash
# ── Omnia AI — Desktop Build Script ──
# Builds standalone macOS/Windows app with:
#   - Next.js frontend (static export)
#   - PyInstaller backend (bundled Python)
#   - Electron shell
# Usage: bash scripts/build-desktop.sh [mac|win]

set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

PLATFORM="${1:-mac}"

# ── 0. Pre-release Check ──
echo ""
echo "[0/4] Pre-release tests..."
if bash scripts/pre-release-check.sh; then
  echo ""
else
  echo "  ❌ Pre-release tests failed. Aborting build."
  exit 1
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Omnia AI — Desktop Build (${PLATFORM})"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── 1. Build Frontend (Next.js standalone) ──
echo ""
echo "[1/4] Building frontend..."
EXPORT_DESKTOP=true npm run build 2>&1 | tail -5
echo "  ✅ Frontend built"
echo "  📋 Copying .next/static to standalone output..."
cp -R .next/static .next/standalone/.next/static 2>/dev/null
echo "  ✅ Static assets copied"
echo "  📋 Copying public/ to standalone output (Next.js standalone mode doesn't do this automatically)..."
rm -rf .next/standalone/public
cp -R public .next/standalone/public
echo "  ✅ Public assets copied"
echo "  📋 Copying node_modules to _modules (electron-builder strips node_modules from extraResources)..."
rm -rf .next/standalone/_modules
cp -R .next/standalone/node_modules .next/standalone/_modules
echo "  ✅ _modules copied"

# ── 2. Build Backend (PyInstaller) ──
echo ""
echo "[2/4] Building backend with PyInstaller..."

if [ ! -d ".venv" ]; then
    echo "  Creating virtual environment..."
    python3 -m venv .venv
fi

# venv layout differs by OS: bin/ on macOS/Linux, Scripts/ on Windows.
if [ -f ".venv/bin/activate" ]; then source .venv/bin/activate; else source .venv/Scripts/activate; fi

# Install app deps + PyInstaller if not present
pip install -q -r requirements.txt 2>&1 | tail -3
pip install pyinstaller 2>&1 | tail -1

# Build the backend
pyinstaller \
    --name omnia-backend \
    --onefile \
    --distpath dist \
    --workpath build/pyinstaller \
    --hidden-import backend.main \
    --hidden-import backend.license \
    --hidden-import backend.trials \
    --hidden-import backend.analysis_engine \
    --hidden-import backend.storage \
    --hidden-import backend.hardware \
    --hidden-import backend.training \
    --hidden-import backend.users \
    --hidden-import backend.audit \
    --hidden-import backend.queries \
    --hidden-import backend.deps \
    --hidden-import backend.pathology_report \
    --hidden-import backend.routes \
    --hidden-import backend.routes.license \
    --hidden-import backend.routes.trials \
    --hidden-import backend.routes.reports \
    --hidden-import backend.routes.analysis \
    --hidden-import backend.routes.users \
    --hidden-import backend.routes.audit \
    --hidden-import backend.routes.queries \
    --hidden-import backend.routes.training \
    --hidden-import multipart \
    --hidden-import multipart.multipart \
    --hidden-import uvicorn \
    --hidden-import uvicorn.logging \
    --hidden-import uvicorn.loops \
    --hidden-import uvicorn.loops.auto \
    --hidden-import uvicorn.protocols \
    --hidden-import uvicorn.protocols.http \
    --hidden-import uvicorn.protocols.http.auto \
    --hidden-import uvicorn.middleware \
    --collect-all reportlab \
    backend/main.py 2>&1 | tail -20

deactivate

if [ ! -f "dist/omnia-backend" ] && [ ! -f "dist/omnia-backend.exe" ]; then
    echo "  ❌ Backend build failed!"
    exit 1
fi
echo "  ✅ Backend built → dist/omnia-backend"

# ── 3. Clean old builds ──
echo ""
echo "[3/4] Cleaning old builds..."
rm -rf dist-desktop build/electron
echo "  ✅ Clean"

# ── 4. Package with electron-builder ──
echo ""
echo "[4/4] Packaging Electron app..."

if [ "$PLATFORM" = "mac" ]; then
    npx electron-builder --mac --config.extraMetadata.main=desktop/main.js 2>&1 | tail -5
elif [ "$PLATFORM" = "win" ]; then
    npx electron-builder --win --config.extraMetadata.main=desktop/main.js 2>&1 | tail -5
elif [ "$PLATFORM" = "all" ]; then
    npx electron-builder --mac --win --config.extraMetadata.main=desktop/main.js 2>&1 | tail -5
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ Build complete!"
echo "  Output: dist-desktop/"
ls -lh dist-desktop/ 2>/dev/null || echo "  (check dist-desktop/ directory)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
