#!/bin/bash
# Extract OpenAPI spec from running Plumber API
# Usage: ./scripts/extract-openapi.sh
# Prerequisites: Plumber must be running on PLUMBER_URL (default http://localhost:8000)

set -euo pipefail

PLUMBER_URL="${PLUMBER_URL:-${PLUMBER_URI:-http://localhost:8000}}"
OUTPUT_DIR="${1:-plumber}"
OUTPUT_FILE="${OUTPUT_DIR}/openapi.json"
MIN_PATHS="${PLUMBER_OPENAPI_MIN_PATHS:-}"
REQUIRED_PATHS="${PLUMBER_OPENAPI_REQUIRED_PATHS:-}"

mkdir -p "$OUTPUT_DIR"

validate_openapi_baseline() {
  if [ -z "$MIN_PATHS" ] && [ -z "$REQUIRED_PATHS" ]; then
    return 0
  fi

  if ! command -v python3 >/dev/null 2>&1; then
    echo "Error: python3 is required for OpenAPI baseline validation" >&2
    return 1
  fi

  python3 - "$OUTPUT_FILE" "$MIN_PATHS" "$REQUIRED_PATHS" <<'PY'
import json
import sys
import re

spec_path = sys.argv[1]
min_paths = sys.argv[2]
required_csv = sys.argv[3]

with open(spec_path, "r", encoding="utf-8") as fh:
    spec = json.load(fh)

paths = spec.get("paths") or {}
path_count = len(paths)
print(f"OpenAPI path count: {path_count}")

if min_paths:
    try:
        min_value = int(min_paths)
    except ValueError as exc:
        raise SystemExit(f"Invalid PLUMBER_OPENAPI_MIN_PATHS value: {min_paths!r}") from exc
    if path_count < min_value:
        raise SystemExit(
            f"OpenAPI baseline check failed: expected >= {min_value} paths, got {path_count}"
        )

required_patterns = [part.strip() for part in required_csv.split(",") if part.strip()]

def pattern_to_regex(pattern):
    placeholder = "__OPENAPI_PLACEHOLDER__"
    pattern = re.sub(r"<[^>]+>|\{[^}]+\}", placeholder, pattern)
    escaped = re.escape(pattern)
    escaped = escaped.replace(r"\*", ".*")
    escaped = escaped.replace(placeholder, "[^/]+")
    return re.compile(f"^{escaped}$")

for pattern in required_patterns:
    matcher = pattern_to_regex(pattern)
    if not any(matcher.match(path) for path in paths):
        raise SystemExit(f"OpenAPI baseline check failed: missing required path matching '{pattern}'")

print("OpenAPI baseline checks passed")
PY
}

echo "Extracting OpenAPI spec from $PLUMBER_URL ..."

# Try Plumber's built-in OpenAPI endpoint first
HTTP_CODE=$(curl -s -o "$OUTPUT_FILE" -w "%{http_code}" "$PLUMBER_URL/openapi.json" 2>/dev/null || echo "000")

if [ "$HTTP_CODE" = "200" ]; then
  echo "Success: OpenAPI spec saved to $OUTPUT_FILE ($HTTP_CODE)"
  validate_openapi_baseline
  exit 0
fi

# Fallback: try historical docs paths used by older smoke scripts
HTTP_CODE=$(curl -s -o "$OUTPUT_FILE" -w "%{http_code}" "$PLUMBER_URL/__openapi__/" 2>/dev/null || echo "000")

if [ "$HTTP_CODE" = "200" ]; then
  echo "Success: OpenAPI spec saved to $OUTPUT_FILE ($HTTP_CODE)"
  validate_openapi_baseline
  exit 0
fi

HTTP_CODE=$(curl -s -o "$OUTPUT_FILE" -w "%{http_code}" "$PLUMBER_URL/__docs__/openapi.json" 2>/dev/null || echo "000")

if [ "$HTTP_CODE" = "200" ]; then
  echo "Success: OpenAPI spec saved to $OUTPUT_FILE ($HTTP_CODE)"
  validate_openapi_baseline
  exit 0
fi

echo "Error: Could not extract OpenAPI spec. Plumber returned HTTP $HTTP_CODE"
echo "Is Plumber running at $PLUMBER_URL?"
exit 1
