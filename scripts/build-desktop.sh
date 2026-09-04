#!/bin/bash
# ── Omnia AI — Desktop Build Script ──
# Builds standalone macOS/Windows app with:
#   - Next.js frontend (static export)
#   - PyInstaller backend (bundled Python)
#   - Electron shell
# Usage: bash scripts/build-desktop.sh [mac|win]

# errexit alone is not enough here. Every build step used to be piped through
# `tail`, and a pipeline's exit status is the LAST command's — `tail` always
# succeeds. A failing electron-builder therefore reported success, left
# dist-desktop/ empty, and the script still printed "Build complete". pipefail
# makes the pipeline fail when any stage fails; nounset catches typo'd vars.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

PLATFORM="${1:-mac}"

BUILD_LOG_DIR="$PROJECT_DIR/build/logs"
mkdir -p "$BUILD_LOG_DIR"

# Run a build step with its full output captured. On success show only the tail
# (the useful summary); on failure show the whole log. The old script tailed
# unconditionally, so the one time it mattered the actual error — a TLS reset
# while downloading Electron — scrolled past the 5-line window and all that
# survived was an anonymous stack trace.
run_step() {
    local name="$1"; shift
    local log="$BUILD_LOG_DIR/${name}.log"
    # Capture the status from the command itself. Reading $? after an
    # `if cmd; then ... fi` yields the status of the *if statement* (0 when no
    # branch ran), not of cmd — which would abort the build with a success
    # exit code and let CI publish a broken release.
    local code=0
    "$@" > "$log" 2>&1 || code=$?
    if [ "$code" -eq 0 ]; then
        tail -5 "$log" | sed 's/^/    /'
        return 0
    fi
    echo ""
    echo "  ❌ Step '${name}' failed (exit ${code}). Full output:"
    echo "  ────────────────────────────────────────────────"
    sed 's/^/  │ /' "$log"
    echo "  ────────────────────────────────────────────────"
    echo "  Log retained at: ${log}"
    exit "$code"
}

# Fail loudly if a step "succeeded" but produced nothing. Exit codes are not
# the only way a build lies.
require_file() {
    [ -e "$1" ] || { echo "  ❌ Expected build output missing: $1"; exit 1; }
}
require_nonempty_dir() {
    [ -d "$1" ] && [ -n "$(ls -A "$1" 2>/dev/null)" ] \
        || { echo "  ❌ Expected build output empty or missing: $1"; exit 1; }
}

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
export EXPORT_DESKTOP=true
run_step frontend npm run build
require_file ".next/standalone"
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
run_step pip-deps pip install -q -r requirements.txt
run_step pip-pyinstaller pip install pyinstaller

# Build the backend from omnia-backend.spec — NOT ad-hoc CLI flags. The spec
# is the source of truth for what ships: it bundles the trained grading
# checkpoint (backend/models/omnia_prostate_v1.pt), collects torch/
# torchvision's non-Python payload, and adds the openslide native library
# that ctypes.CDLL loads at runtime (none of which a plain --hidden-import
# list would catch). A CLI invocation that duplicates only the Python-level
# hidden-imports silently ships a backend that can't grade anything.
run_step pyinstaller pyinstaller \
    --distpath dist \
    --workpath build/pyinstaller \
    --noconfirm \
    omnia-backend.spec

deactivate

# onedir: dist/omnia-backend is a directory holding the executable and its
# libraries, so check for the executable inside it rather than for a file at
# that path — the old test passed for a onefile build and silently failed for
# this one.
if [ ! -x "dist/omnia-backend/omnia-backend" ] && [ ! -f "dist/omnia-backend/omnia-backend.exe" ]; then
    echo "  ❌ Backend build failed — no executable in dist/omnia-backend/"
    ls -la dist/omnia-backend 2>/dev/null | head || true
    exit 1
fi
echo "  ✅ Backend built → dist/omnia-backend/ ($(du -sh dist/omnia-backend | cut -f1))"

# PyInstaller does not cross-compile — it freezes for the machine it runs on.
# Building the Windows package here would therefore wrap a macOS Mach-O binary
# in a Windows installer, which installs cleanly and then cannot start its
# backend. The old script did exactly that and exited 0, because the output
# verification below only ever covered macOS.
if [ "$PLATFORM" = "win" ] || [ "$PLATFORM" = "all" ]; then
    if [ ! -f "dist/omnia-backend/omnia-backend.exe" ]; then
        echo ""
        echo "  ❌ Cannot build the Windows package on $(uname -s)."
        echo ""
        echo "     PyInstaller freezes for the host platform, so the backend just"
        echo "     built is a $(uname -m) $(uname -s) executable. Packaging it for"
        echo "     Windows produces an installer whose backend cannot run."
        echo ""
        echo "     Build it on Windows, or let CI do it: the build-windows job in"
        echo "     .github/workflows/release.yml runs on a windows-latest runner,"
        echo "     smoke-tests the bundled backend and grades a real slide before"
        echo "     the installer is published."
        exit 1
    fi
fi

# ── 3. Clean old builds ──
echo ""
echo "[3/4] Cleaning old builds..."
rm -rf dist-desktop build/electron
echo "  ✅ Clean"

# ── 4. Package with electron-builder ──
echo ""
echo "[4/4] Packaging Electron app..."

# A signing certificate that is defined-but-empty is worse than one that is
# absent. GitHub Actions substitutes an empty string for a secret that does not
# exist, so `CSC_LINK: ${{ secrets.MAC_CERT_P12 }}` arrives as CSC_LINK="" —
# which electron-builder reads as "a certificate path was supplied", tries to
# resolve, and fails with "<project dir> not a file". Locally the variable is
# unset entirely, which is why this only ever broke in CI.
#
# Unset the empty ones so an unsigned build is treated as an unsigned build.
NOTARIZE_FLAG=""
if [ -z "${CSC_LINK:-}" ]; then
    unset CSC_LINK CSC_KEY_PASSWORD 2>/dev/null || true
    # Nothing to notarize without a certificate, and asking would fail late.
    NOTARIZE_FLAG="--config.mac.notarize=false"
    export CSC_IDENTITY_AUTO_DISCOVERY=false
    echo "  ℹ️  No signing certificate — building unsigned."
fi

if [ "$PLATFORM" = "mac" ]; then
    run_step electron-builder-mac npx electron-builder --mac --publish never $NOTARIZE_FLAG --config.extraMetadata.main=desktop/main.js
elif [ "$PLATFORM" = "win" ]; then
    run_step electron-builder-win npx electron-builder --win --publish never --config.extraMetadata.main=desktop/main.js
elif [ "$PLATFORM" = "all" ]; then
    run_step electron-builder-all npx electron-builder --mac --win --publish never $NOTARIZE_FLAG --config.extraMetadata.main=desktop/main.js
fi

# Keep the build output out of Spotlight. Without this, the freshly built
# .app inside dist-desktop/ is indexed alongside the copy the user actually
# installed in /Applications, so Spotlight and Launchpad show TWO identical
# "Omnia Pathology AI" entries and there is no way to tell which one opens
# the installed build. `.metadata_never_index` is the documented macOS
# marker for "do not index this directory tree".
if [ "$PLATFORM" = "mac" ] || [ "$PLATFORM" = "all" ]; then
    touch dist-desktop/.metadata_never_index 2>/dev/null || true
    # Drop anything already indexed from a previous build.
    mdutil -E dist-desktop >/dev/null 2>&1 || true
fi

# Verify the packaging step actually produced an application, not just a zero
# exit code. This is the check that would have caught the silent failure.
echo ""
echo "Verifying build output..."
require_nonempty_dir "dist-desktop"
if [ "$PLATFORM" = "mac" ] || [ "$PLATFORM" = "all" ]; then
    APP_PATH="dist-desktop/mac-arm64/Omnia Pathology AI.app"
    [ -d "$APP_PATH" ] || APP_PATH="dist-desktop/mac/Omnia Pathology AI.app"
    require_file "$APP_PATH"
    # The Next.js frontend ships to Contents/Resources/frontend, NOT app.asar.
    # Checking the asar gives a false negative — verify the real location.
    require_nonempty_dir "$APP_PATH/Contents/Resources/frontend"
    require_nonempty_dir "$APP_PATH/Contents/Resources/backend"
    require_file "$APP_PATH/Contents/Resources/backend/omnia-backend"
    echo "  ✅ macOS app verified (frontend + bundled backend present)"
fi

if [ "$PLATFORM" = "win" ] || [ "$PLATFORM" = "all" ]; then
    # The Windows half of the same check. Its absence is why a broken Windows
    # package could be produced with a zero exit code.
    WIN_DIR="dist-desktop/win-unpacked"
    require_nonempty_dir "$WIN_DIR"
    require_nonempty_dir "$WIN_DIR/resources/frontend"
    require_nonempty_dir "$WIN_DIR/resources/backend"
    require_file "$WIN_DIR/resources/backend/omnia-backend.exe"
    echo "  ✅ Windows app verified (frontend + bundled backend present)"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ Build complete!"
echo "  Output: dist-desktop/"
ls -lh dist-desktop/ 2>/dev/null || echo "  (check dist-desktop/ directory)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
