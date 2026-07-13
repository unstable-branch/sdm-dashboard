#!/usr/bin/env bash
set -euo pipefail

plumber_image="${PLUMBER_IMAGE:-sdm-dashboard-plumber:latest}"
api_image="${API_IMAGE:-sdm-dashboard-api:latest}"
volume="sdm-shared-permissions-$RANDOM-$$"

cleanup() {
  docker volume rm -f "$volume" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker image inspect "$plumber_image" "$api_image" >/dev/null
docker volume create "$volume" >/dev/null

docker run --rm -v "$volume:/app/outputs" "$plumber_image" \
  sh -c 'mkdir -p /app/outputs/jobs/fresh-volume && printf raster > /app/outputs/jobs/fresh-volume/output.tif'

docker run --rm -v "$volume:/app/outputs" "$api_image" \
  sh -c 'test -w /app/outputs/jobs/fresh-volume && printf encrypted > /app/outputs/jobs/fresh-volume/output.tif.enc'

docker run --rm -v "$volume:/app/outputs" "$plumber_image" \
  sh -c 'test -r /app/outputs/jobs/fresh-volume/output.tif.enc && printf plumber-again > /app/outputs/jobs/fresh-volume/after-api.txt'

echo "Fresh shared-volume permissions check passed."
