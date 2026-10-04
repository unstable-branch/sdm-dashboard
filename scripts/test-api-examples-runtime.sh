#!/usr/bin/env bash
set -euo pipefail

# Exercise fresh and pre-existing disposable volumes using the API image's
# root-preparation wrapper. All images are local immutable IDs; no network.
base_ref="${API_BASE_IMAGE:-sdm-dashboard-api:latest}"
base_image="$(docker image inspect "$base_ref" --format '{{.Id}}')"
alpine_image="$(docker image inspect alpine:latest --format '{{.Id}}')"
suffix="$(date +%s)-$$-${RANDOM}"
old_volume="sdm-api-examples-old-${suffix}"
fresh_volume="sdm-api-examples-fresh-${suffix}"
guard_volume="sdm-api-examples-guard-${suffix}"
test_image="sdm-api-examples-runtime:${suffix}"
base_tag="sdm-api-examples-runtime-base:${suffix}"
created_volumes=()
image_created=0
base_tag_created=0
build_context=""
log_dir="${SDM_RUNTIME_LOG_DIR:-${TMPDIR:-/tmp}}"
mkdir -p "$log_dir"

cleanup() {
  local volume
  for volume in "${created_volumes[@]}"; do docker volume rm "$volume" >/dev/null || true; done
  if [ "$image_created" -eq 1 ]; then docker image rm "$test_image" >/dev/null || true; fi
  if [ "$base_tag_created" -eq 1 ]; then docker image rm "$base_tag" >/dev/null || true; fi
  if [ -n "$build_context" ]; then rm -rf -- "$build_context"; fi
}
trap cleanup EXIT

for volume in "$old_volume" "$fresh_volume" "$guard_volume"; do
  if docker volume inspect "$volume" >/dev/null 2>&1; then
    printf 'Refusing to use pre-existing volume %s\n' "$volume" >&2
    exit 2
  fi
done
for image in "$test_image" "$base_tag"; do
  if docker image inspect "$image" >/dev/null 2>&1; then
    printf 'Refusing to use pre-existing image %s\n' "$image" >&2
    exit 2
  fi
done

docker image tag "$base_image" "$base_tag"
base_tag_created=1
# Compile the same native source locally, statically, so this network-disabled
# oracle needs no package fetch or runtime libc assumption. Production builds
# compile it independently in Dockerfile.api; that remains a separate gate.
build_context="$(mktemp -d "${TMPDIR:-/tmp}/sdm-examples-build-${suffix}-XXXXXX")"
mkdir -p "$build_context/api/scripts" "$build_context/data" "$build_context/scripts"
cp api/docker-entrypoint.sh api/prepare-examples.cjs "$build_context/api/"
cp api/scripts/prepare-examples.test.cjs "$build_context/api/scripts/"
cp -R data/examples "$build_context/data/"
cp scripts/Dockerfile.api-examples-runtime-test "$build_context/scripts/"
cc --version
cc -static -std=c11 -O2 -Wall -Wextra -Werror api/publish-example.c -o "$build_context/api/publish-example"
sha256sum api/publish-example.c "$build_context/api/publish-example"
docker build --network none --pull=false --build-arg "API_BASE_IMAGE=$base_tag" \
  --file "$build_context/scripts/Dockerfile.api-examples-runtime-test" --tag "$test_image" "$build_context"
image_created=1

# Run privileged setup-boundary regressions on the actual Node/Alpine runtime.
docker run --rm --network none --cpus 0.5 --memory 128m --user 0 \
  --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  --entrypoint node "$test_image" --test /usr/local/lib/sdm/tests/prepare-examples.test.cjs

create_volume() {
  local name="$1" result
  result="$(docker volume create "$name")"
  [ "$result" = "$name" ] || { printf 'Unexpected volume name: %s\n' "$result" >&2; exit 2; }
  created_volumes+=("$name")
}

# Populate before mounting the API image: this prevents Docker copy-up and
# represents a volume created by an older image.
create_volume "$old_volume"
docker run --rm --network none --cpus 0.5 --memory 128m --user 0 --entrypoint sh \
  --volume "$old_volume:/app/data/examples" "$alpine_image" -eu -c '
    mkdir -p /app/data/examples/geo
    printf %s old-saved-csv-v1 > /app/data/examples/saved-user.csv
    printf %s old-user-metadata-v1 > /app/data/examples/saved-user.meta
    printf %s existing-user-fixture-name-v1 > /app/data/examples/multi_species_test.csv
    chown -R 1000:2000 /app/data/examples
  '
old_csv_hash="$(docker run --rm --network none --cpus 0.5 --memory 128m --user 0 --entrypoint sh \
  --volume "$old_volume:/app/data/examples" "$alpine_image" -c 'sha256sum /app/data/examples/saved-user.csv | cut -d " " -f1')"
old_meta_hash="$(docker run --rm --network none --cpus 0.5 --memory 128m --user 0 --entrypoint sh \
  --volume "$old_volume:/app/data/examples" "$alpine_image" -c 'sha256sum /app/data/examples/saved-user.meta | cut -d " " -f1')"
old_conflict_hash="$(docker run --rm --network none --cpus 0.5 --memory 128m --user 0 --entrypoint sh \
  --volume "$old_volume:/app/data/examples" "$alpine_image" -c 'sha256sum /app/data/examples/multi_species_test.csv | cut -d " " -f1')"

create_volume "$fresh_volume"
create_volume "$guard_volume"
docker run --rm --network none --cpus 0.5 --memory 128m --user 0 --entrypoint sh \
  --volume "$guard_volume:/app/data/examples" "$alpine_image" -eu -c '
    mkdir -p /app/data/examples
    ln -s /tmp /app/data/examples/geo
  '

fixture_count="$(find data/examples -type f | wc -l | tr -d ' ')"
[ "$fixture_count" -eq 7 ] || { printf 'Expected 7 source fixtures, found %s\n' "$fixture_count" >&2; exit 2; }

run_checks() {
  local volume="$1" label="$2"
  docker run --rm --network none --cpus 0.5 --memory 128m --volume "$volume:/app/data/examples" \
    "$test_image" sh -eu -c '
      test "$(id -u)" = 1000
      test -w /app/data/examples
      test "$(find /usr/share/sdm/examples-seed -type f | wc -l | tr -d " ")" = 7
      (cd /usr/share/sdm/examples-seed && find . -type f -print | sort) > /tmp/seed-files
      while IFS= read -r relative; do
        target="/app/data/examples/${relative#./}"
        if [ ! -f "$target" ] || [ ! -r "$target" ]; then
          printf "missing built-in fixture in examples volume: %s\\n" "$relative" >&2
          exit 1
        fi
        case "$1:$relative" in
          old*:./multi_species_test.csv)
            test "$(cat "$target")" = existing-user-fixture-name-v1
            ;;
          *)
            cmp "/usr/share/sdm/examples-seed/${relative#./}" "$target"
            ;;
        esac
      done < /tmp/seed-files
      case "$1" in
        old*)
          test "$(cat /app/data/examples/saved-user.csv)" = old-saved-csv-v1
          test "$(cat /app/data/examples/saved-user.meta)" = old-user-metadata-v1
          ;;
      esac
      if [ "$1" = old-replacement ]; then
        test "$(cat /app/data/examples/replacement-sentinel.csv)" = replacement-sentinel-v1
      fi
      if [ "$1" = fresh ] || [ "$1" = fresh-replacement ]; then
        test -w /app/data/examples/geo
        test "$(stat -c %g /app/data/examples/geo)" = 2000
        test "$(stat -c %a /app/data/examples/geo)" = 2775
        if [ "$1" = fresh-replacement ]; then
          test "$(cat /app/data/examples/geo/api-save.csv)" = nested-api-save-v1
        else
          printf %s nested-api-save-v1 > /app/data/examples/geo/api-save.csv
        fi
      fi
      printf %s replacement-sentinel-v1 > /app/data/examples/replacement-sentinel.csv
    ' sh "$label"
  if [[ "$label" == old* ]]; then
    docker run --rm --network none --cpus 0.5 --memory 128m --user 0 --entrypoint sh \
      --volume "$volume:/app/data/examples" "$alpine_image" -eu -c '
        test "$(sha256sum /app/data/examples/saved-user.csv | cut -d " " -f1)" = "$1"
        test "$(sha256sum /app/data/examples/saved-user.meta | cut -d " " -f1)" = "$2"
        test "$(sha256sum /app/data/examples/multi_species_test.csv | cut -d " " -f1)" = "$3"
      ' sh "$old_csv_hash" "$old_meta_hash" "$old_conflict_hash"
  fi
}

# In the pre-fix image this fails on the first absent built-in, rather than on
# setup. The caller preserves the output as the RED evidence log.
run_checks "$old_volume" old
run_checks "$old_volume" old-replacement
run_checks "$fresh_volume" fresh
run_checks "$fresh_volume" fresh-replacement

# A symlinked destination component must fail closed with a bounded diagnostic.
if docker run --rm --network none --cpus 0.5 --memory 128m --volume "$guard_volume:/app/data/examples" \
  "$test_image" sh -c 'exit 0' >"$log_dir/sdm-examples-symlink-guard.log" 2>&1; then
  printf 'Expected symlinked fixture destination to fail closed\n' >&2
  exit 1
fi
grep -F 'refusing unsafe examples path' "$log_dir/sdm-examples-symlink-guard.log" >/dev/null

printf 'API examples runtime check passed: fresh, old-volume, repeated replacement; %s fixtures; base %s.\n' "$fixture_count" "$base_image"
