#!/bin/bash
# k6 CI runner — runs load tests with configurable target
# Usage: ./scripts/run-k6.sh [smoke|load|stress]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
K6_BIN="${K6_BIN:-$PROJECT_ROOT/tools/k6}"
SCENARIO="${1:-smoke}"
SCRIPT="$PROJECT_ROOT/tests/k6/load-test.js"
RESULTS_DIR="$PROJECT_ROOT/tests/k6/results"
API_URL="${API_URL:-http://localhost:4000}"
JWT_TOKEN="${JWT_TOKEN:-}"

mkdir -p "$RESULTS_DIR"

case "$SCENARIO" in
  smoke)
    echo "[k6] Running smoke test (1 VU, 30s)..."
    "$K6_BIN" run --vus 1 --duration 30s \
      --summary-export="$RESULTS_DIR/smoke-summary.json" \
      -e API_URL="$API_URL" -e JWT_TOKEN="$JWT_TOKEN" \
      --tag scenario=smoke \
      "$SCRIPT"
    ;;
  load)
    echo "[k6] Running load test..."
    "$K6_BIN" run \
      --summary-export="$RESULTS_DIR/load-summary.json" \
      -e API_URL="$API_URL" -e JWT_TOKEN="$JWT_TOKEN" \
      --tag scenario=load --tag ci=true \
      "$SCRIPT"
    ;;
  stress)
    echo "[k6] Running stress test (50 VUs, 5m)..."
    "$K6_BIN" run --vus 50 --duration 5m \
      --summary-export="$RESULTS_DIR/stress-summary.json" \
      -e API_URL="$API_URL" -e JWT_TOKEN="$JWT_TOKEN" \
      --tag scenario=stress \
      "$SCRIPT"
    ;;
  *)
    echo "Usage: $0 [smoke|load|stress]"
    exit 1
    ;;
esac