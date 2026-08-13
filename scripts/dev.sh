#!/bin/bash
"""
Omnia AI — Dev Startup Bot
Usage: bash scripts/dev.sh
Starts both servers with proper checks.
"""
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo ""
echo "════════════════════════════════════════════════════════"
echo "  OMNIA AI — DEV STARTUP"
echo "════════════════════════════════════════════════════════"
echo ""

# ── 1. Environment check ──
echo "▶ Running environment health check..."
python3 scripts/check_env.py || {
    echo "⚠  Environment check failed. Fix issues above or use --force to skip."
    exit 1
}
echo ""

# ── 2. Kill existing servers ──
echo "▶ Cleaning up existing processes..."
kill $(lsof -ti :3000 2>/dev/null) 2>/dev/null || true
kill $(lsof -ti :8000 2>/dev/null) 2>/dev/null || true
sleep 1
echo "  ✓ Ports 3000, 8000 freed"
echo ""

# ── 3. Start backend ──
echo "▶ Starting backend (port 8000)..."
python3 run_backend.py &
BACKEND_PID=$!
echo "  PID: $BACKEND_PID"

# Wait for backend
for i in $(seq 1 15); do
    if curl -s http://localhost:8000/health > /dev/null 2>&1; then
        echo "  ✓ Backend ready (model loaded)"
        break
    fi
    if [ "$i" -eq 15 ]; then
        echo "  ✗ Backend failed to start"
        exit 1
    fi
    sleep 1
done
echo ""

# ── 4. Clean .next/ cache ──
echo "▶ Checking .next/ cache..."
if [ -d ".next" ]; then
    echo "  Removing stale cache to prevent chunk errors..."
    rm -rf .next
    echo "  ✓ Cleared"
else
    echo "  ✓ No stale cache"
fi
echo ""

# ── 5. Start frontend ──
echo "▶ Starting frontend (port 3000)..."
npx next dev &
FRONTEND_PID=$!
echo "  PID: $FRONTEND_PID"

# Wait for frontend
for i in $(seq 1 30); do
    if curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/dashboard 2>/dev/null | grep -q 200; then
        echo "  ✓ Frontend ready"
        break
    fi
    if [ "$i" -eq 30 ]; then
        echo "  ✗ Frontend failed to start"
        exit 1
    fi
    sleep 1
done
echo ""

# ── 6. Print URLs ──
echo "════════════════════════════════════════════════════════"
echo "  BOTH SERVERS RUNNING"
echo "════════════════════════════════════════════════════════"
echo ""
echo "  Frontend:  http://localhost:3000/dashboard"
echo "  Backend:   http://localhost:8000/health"
echo "  API docs:  http://localhost:8000/docs"
echo "  Login:     doctor@clinic.lt / TestPass123!"
echo ""
echo "════════════════════════════════════════════════════════"
echo "  Press Ctrl+C to stop both servers"
echo "════════════════════════════════════════════════════════"

# Trap Ctrl+C to kill both
trap "echo ''; echo 'Shutting down...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT

# Wait for either to exit
wait $BACKEND_PID $FRONTEND_PID
