#!/usr/bin/env bash
set -euo pipefail
: "${FIRST_IMAGE:?set the first Plumber image}"
: "${SECOND_IMAGE:?set a Plumber image with a different service UID}"
entrypoint="${ENTRYPOINT_FILE:-$(pwd)/plumber/docker-entrypoint.sh}"
prefix="sdm-variant-permissions-$$-$RANDOM"
outputs="$prefix-outputs"
climate="$prefix-climate"
cleanup() { docker volume rm "$outputs" "$climate" >/dev/null; }
docker image inspect "$FIRST_IMAGE" "$SECOND_IMAGE" >/dev/null
docker volume create "$outputs" >/dev/null
docker volume create "$climate" >/dev/null
trap cleanup EXIT
run() {
  local image="$1"; shift
  docker run --rm --network=none --security-opt=no-new-privileges \
    --memory=512m --cpus=2 --pids-limit=128 \
    -v "$outputs:/app/outputs" -v "$climate:/app/Worldclim" \
    -v "$entrypoint:/variant-entrypoint.sh:ro" --entrypoint /bin/sh \
    "$image" /variant-entrypoint.sh sh -ec "$*"
}
run "$FIRST_IMAGE" '
  mkdir -p /app/outputs/.execution-nonces/retained-nonce
  chmod 700 /app/outputs/.execution-nonces /app/outputs/.execution-nonces/retained-nonce
  printf preserved > /app/Worldclim/private-fixture
  chmod 600 /app/Worldclim/private-fixture
  id -u > /app/outputs/first-uid
'
run "$SECOND_IMAGE" '
  test "$(id -u)" != "$(cat /app/outputs/first-uid)"
  test -d /app/outputs/.execution-nonces/retained-nonce
  test "$(stat -c %u /app/outputs/.execution-nonces)" = "$(id -u)"
  test "$(stat -c %a /app/outputs/.execution-nonces)" = 700
  test "$(stat -c %a /app/outputs/.execution-nonces/retained-nonce)" = 700
  mkdir /app/outputs/.execution-nonces/new-nonce
  test "$(cat /app/Worldclim/private-fixture)" = preserved
  printf updated > /app/Worldclim/private-fixture
'
run "$FIRST_IMAGE" '
  test -d /app/outputs/.execution-nonces/retained-nonce
  test -d /app/outputs/.execution-nonces/new-nonce
  test "$(stat -c %u /app/outputs/.execution-nonces)" = "$(id -u)"
  test "$(stat -c %a /app/outputs/.execution-nonces)" = 700
  test "$(cat /app/Worldclim/private-fixture)" = updated
  mkdir /app/outputs/.execution-nonces/back-to-first
'
echo 'PASS: variant switch and switch-back preserve nonces and runtime files; private directories remain 0700'
