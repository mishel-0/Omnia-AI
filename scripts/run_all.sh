#!/bin/bash
"""
Omnia AI — Run All Checks
Usage: bash scripts/run_all.sh
Runs every bot in sequence.
"""
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║     OMNIA AI — FULL SYSTEM CHECK                     ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

OVERALL_PASS=true

run_check() {
    local name=$1
    local cmd=$2
    echo ""
    echo "────────────────────────────────────────────────"
    echo "  [$name]"
    echo "────────────────────────────────────────────────"
    echo ""
    if eval "$cmd"; then
        echo ""
        echo "  ✓ $name PASSED"
    else
        echo ""
        echo "  ✗ $name FAILED"
        OVERALL_PASS=false
    fi
    echo ""
}

run_check "Environment Health"   "python3 scripts/check_env.py"
run_check "Dependency Audit"     "python3 scripts/audit_deps.py"
run_check "TypeScript"           "npx tsc --noEmit"
run_check "Lint"                 "npx oxlint"
run_check "API Contracts"        "python3 scripts/check_api.py"
run_check "Pytest Suite"         "/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/3.9/Resources/Python.app/Contents/MacOS/Python -m pytest tests/ -v --tb=short"

echo ""
echo "╔══════════════════════════════════════════════════════╗"
if [ "$OVERALL_PASS" = true ]; then
    echo "║     ALL CHECKS PASSED ✓                             ║"
else
    echo "║     SOME CHECKS FAILED ✗                            ║"
fi
echo "╚══════════════════════════════════════════════════════╝"
echo ""

if [ "$OVERALL_PASS" = false ]; then
    exit 1
fi
