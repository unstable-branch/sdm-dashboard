#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=scripts/ops/lifecycle-lib.sh
source "$ROOT/scripts/ops/lifecycle-lib.sh"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/source/nested" "$work/archive" "$work/restored"
printf 'database bytes\n' > "$work/source/nested/payload.txt"
lifecycle_archive_tree "$work/source" "$work/archive/payload.tar.gz"
lifecycle_restore_tree "$work/archive/payload.tar.gz" "$work/restored"
cmp "$work/source/nested/payload.txt" "$work/restored/nested/payload.txt"

mkdir -p "$work/backup/postgresql" "$work/backup/garage" "$work/backup/config"
printf 'dump' > "$work/backup/postgresql/database.dump"
printf 'objects' > "$work/backup/garage/data.tar.gz"
printf 'metadata' > "$work/backup/garage/meta.tar.gz"
printf 'compose' > "$work/backup/config/docker-compose.prod.yml"
lifecycle_write_manifest "$work/backup" "test-version" "docker-compose.prod.yml"
lifecycle_verify_manifest "$work/backup" "test-version"

printf 'corruption' >> "$work/backup/garage/meta.tar.gz"
if lifecycle_verify_manifest "$work/backup" "test-version" >/dev/null 2>&1; then
  echo "expected checksum validation to refuse corruption" >&2
  exit 1
fi
if lifecycle_verify_manifest "$work/backup" "other-version" >/dev/null 2>&1; then
  echo "expected compatibility validation to refuse version mismatch" >&2
  exit 1
fi
printf 'ops lifecycle tests passed\n'
