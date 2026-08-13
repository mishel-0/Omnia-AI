#!/bin/bash
# ── Omnia AI — Pre-Release Test Suite ──
# Runs all checks before building DMG/EXE
set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Omnia AI — Pre-Release Tests"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
FAILED=0

# ── 1. TypeScript check ──
echo "[1/6] TypeScript check..."
if npx tsc --noEmit 2>/dev/null; then
  echo "  ✅ TypeScript OK"
else
  echo "  ❌ TypeScript errors found!"
  npx tsc --noEmit 2>&1 | tail -5
  FAILED=1
fi
echo ""

# ── 2. Lint ──
echo "[2/6] Lint..."
if npm run lint 2>/dev/null; then
  echo "  ✅ Lint OK"
else
  echo "  ⚠️  Lint warnings (non-blocking)"
fi
echo ""

# ── 3. Backend tests ──
echo "[3/6] Backend tests..."
if [ ! -d ".venv" ]; then
  python3 -m venv .venv
fi
# venv layout differs by OS: bin/ on macOS/Linux, Scripts/ on Windows.
if [ -f ".venv/bin/activate" ]; then source .venv/bin/activate; else source .venv/Scripts/activate; fi
pip install -q -r requirements.txt 2>&1 | tail -3
# End-to-end API regression suite (starts its own server on a free port with a
# throwaway data dir). This is the gate that catches auth/RBAC, clinical
# integrity, and data-integrity regressions before a release is packaged.
python3 tests/integration_api_test.py 2>&1 | tail -8
STATUS=${PIPESTATUS[0]}
if [ $STATUS -eq 0 ]; then
  echo "  ✅ Backend integration tests pass"
else
  echo "  ❌ Backend integration tests failed!"
  FAILED=1
fi
echo ""

# ── 4. Frontend build test ──
echo "[4/6] Frontend build test..."
if EXPORT_DESKTOP=true npm run build 2>/dev/null; then
  echo "  ✅ Frontend builds OK"
else
  echo "  ❌ Frontend build failed!"
  FAILED=1
fi
echo ""

# ── 5. Backend binary exists ──
echo "[5/6] Backend binary..."
if [ -f "dist/omnia-backend" ]; then
  SIZE=$(ls -lh dist/omnia-backend | awk '{print $5}')
  echo "  ✅ Backend binary: ${SIZE}"
else
  echo "  ⚠️  No backend binary — PyInstaller not run yet (will be built during packaging)"
fi
echo ""

# ── 6. Core source files exist ──
echo "[6/6] Core file check..."
for f in desktop/main.js desktop/preload.js .next/standalone/server.js; do
  if [ -f "$f" ]; then
    echo "  ✅ $f"
  else
    echo "  ❌ Missing: $f"
    FAILED=1
  fi
done
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ "$FAILED" -eq 0 ]; then
  echo "  ✅ All tests passed! Ready for release."
else
  echo "  ❌ Some tests failed. Fix before releasing."
  exit 1
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
