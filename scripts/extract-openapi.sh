#!/bin/bash
# Extract OpenAPI spec from running Plumber API
# Usage: ./scripts/extract-openapi.sh
# Prerequisites: Plumber must be running on PLUMBER_URL (default http://localhost:8000)

set -euo pipefail

PLUMBER_URL="${PLUMBER_URI:-http://localhost:8000}"
OUTPUT_DIR="${1:-plumber}"
OUTPUT_FILE="${OUTPUT_DIR}/openapi.json"

mkdir -p "$OUTPUT_DIR"

echo "Extracting OpenAPI spec from $PLUMBER_URL ..."

# Try Plumber's built-in OpenAPI endpoint first
HTTP_CODE=$(curl -s -o "$OUTPUT_FILE" -w "%{http_code}" "$PLUMBER_URL/__openapi__/" 2>/dev/null || echo "000")

if [ "$HTTP_CODE" = "200" ]; then
  echo "Success: OpenAPI spec saved to $OUTPUT_FILE ($HTTP_CODE)"
  exit 0
fi

# Fallback: try /__docs__/openapi.json which some plumber versions use
HTTP_CODE=$(curl -s -o "$OUTPUT_FILE" -w "%{http_code}" "$PLUMBER_URL/__docs__/openapi.json" 2>/dev/null || echo "000")

if [ "$HTTP_CODE" = "200" ]; then
  echo "Success: OpenAPI spec saved to $OUTPUT_FILE ($HTTP_CODE)"
  exit 0
fi

echo "Error: Could not extract OpenAPI spec. Plumber returned HTTP $HTTP_CODE"
echo "Is Plumber running at $PLUMBER_URL?"
exit 1