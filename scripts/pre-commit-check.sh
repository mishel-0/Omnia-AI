#!/bin/bash
# Omnia AI — Pre-commit quality gate
# Runs TypeScript type-check and critical-path tests before every commit.
# Exit code != 0 aborts the commit.

set -e

echo "=== Omnia AI Quality Gate ==="
echo ""

# 1. TypeScript type check
echo "▶ TypeScript type check..."
npx tsc --noEmit 2>&1 | tail -5
if [ ${PIPESTATUS[0]} -ne 0 ]; then
  echo "❌ TypeScript errors found. Fix them before committing."
  exit 1
fi
echo "✅ TypeScript check passed"
echo ""

# 2. Critical-path backend tests
echo "▶ Running critical-path tests..."
source .venv/bin/activate 2>/dev/null || true
python -m pytest tests/ -v --tb=short 2>&1 | tail -20
STATUS=${PIPESTATUS[0]}
if [ $STATUS -ne 0 ] && [ $STATUS -ne 5 ]; then
  echo "❌ Tests failed. Fix them before committing."
  exit 1
fi
echo "✅ All tests passed"
echo ""

echo "=== Quality Gate PASSED ==="
