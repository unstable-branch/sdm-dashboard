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

make_backup() {
  local destination="$1"
  mkdir -p "$destination/postgresql" "$destination/garage" "$destination/config" "$work/data" "$work/meta"
  printf 'dump' > "$destination/postgresql/database.dump"
  printf 'object' > "$work/data/object"
  printf 'metadata' > "$work/meta/meta"
  tar -C "$work/data" -czf "$destination/garage/data.tar.gz" .
  tar -C "$work/meta" -czf "$destination/garage/meta.tar.gz" .
  printf 'compose' > "$destination/config/docker-compose.prod.yml"
  lifecycle_write_manifest "$destination" "test-version" "docker-compose.prod.yml"
}

make_backup "$work/backup"
lifecycle_verify_manifest "$work/backup" "test-version"

printf 'corruption' >> "$work/backup/garage/meta.tar.gz"
if lifecycle_verify_manifest "$work/backup" "test-version" >/dev/null 2>&1; then
  echo "expected checksum validation to refuse corruption" >&2
  exit 1
fi
make_backup "$work/backup-clean"
python3 - "$work/backup-clean/manifest.json" <<'PY'
import json, sys
path = sys.argv[1]
data = json.load(open(path))
data["files"].append(data["files"][0])
open(path, "w").write(json.dumps(data))
PY
if lifecycle_verify_manifest "$work/backup-clean" "test-version" >/dev/null 2>&1; then
  echo "expected duplicate manifest entries to be refused" >&2
  exit 1
fi
python3 - "$work/unsafe.tar.gz" <<'PY'
import io, tarfile, sys
with tarfile.open(sys.argv[1], "w:gz") as archive:
    member = tarfile.TarInfo("../escape")
    member.size = 1
    archive.addfile(member, io.BytesIO(b"x"))
PY
if lifecycle_verify_payload_archive "$work/unsafe.tar.gz" >/dev/null 2>&1; then
  echo "expected traversal archive to be refused" >&2
  exit 1
fi

mkdir -p "$work/bin"
cat > "$work/bin/docker" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
echo "$*" >> "${DOCKER_LOG:?}"
if [[ "$1" == volume && "$2" == inspect ]]; then
  [[ "$3" != missing ]] || exit 1
  printf '%s\n' "$3"
  exit 0
fi
if [[ "$1" == compose ]]; then
  case " $* " in
    *" ps --status running --services "*) printf 'api\nplumber\ngarage\n' ;;
    *" pg_restore "*) [[ "${FAIL_PG_RESTORE:-0}" != 1 ]] || exit 41 ;;
  esac
  exit 0
fi
if [[ "$1" == run ]]; then
  [[ "${FAIL_GARAGE_RESTORE:-0}" != 1 || " $* " != *" garage_data:/target "* ]] || exit 42
  exit 0
fi
exit 99
SH
chmod +x "$work/bin/docker"
printf 'services:\n' > "$work/compose.yml"

run_restore() {
  PATH="$work/bin:$PATH" DOCKER_LOG="$work/docker.log" "$ROOT/scripts/ops/restore.sh" \
    --input "$work/backup-command" --compose-file "$work/compose.yml" --app-version test-version \
    --garage-data-volume garage_data --garage-meta-volume garage_meta --force --yes-really-restore "$@"
}
make_backup "$work/backup-command"
: > "$work/docker.log"
run_restore > "$work/success.out" 2> "$work/success.err"
grep -qx 'compose -f .*/compose.yml stop api plumber garage' "$work/docker.log"
grep -qx 'compose -f .*/compose.yml start api plumber garage' "$work/docker.log"

: > "$work/docker.log"
if FAIL_PG_RESTORE=1 run_restore > "$work/failure.out" 2> "$work/failure.err"; then
  echo "expected failed database restore" >&2
  exit 1
fi
if grep -q ' start ' "$work/docker.log"; then
  echo "restore restarted services after a destructive failure" >&2
  exit 1
fi
grep -q 'left stopped' "$work/failure.err"

: > "$work/docker.log"
if FAIL_GARAGE_RESTORE=1 run_restore > "$work/garage-failure.out" 2> "$work/garage-failure.err"; then
  echo "expected failed Garage restore" >&2
  exit 1
fi
if grep -q ' start ' "$work/docker.log"; then
  echo "restore restarted services after a Garage failure" >&2
  exit 1
fi
grep -q 'left stopped' "$work/garage-failure.err"

: > "$work/docker.log"
if run_restore --garage-data-volume ../not-a-volume > /dev/null 2> "$work/invalid-volume.err"; then
  echo "expected malformed volume to be refused" >&2
  exit 1
fi
[[ ! -s "$work/docker.log" ]]
grep -q 'invalid Docker named volume' "$work/invalid-volume.err"

: > "$work/docker.log"
if run_restore --garage-data-volume garage_data --garage-meta-volume garage_data > /dev/null 2> "$work/same-volume.err"; then
  echo "expected identical Garage volumes to be refused" >&2
  exit 1
fi
[[ ! -s "$work/docker.log" ]]
grep -q 'must be different' "$work/same-volume.err"
printf 'ops lifecycle tests passed\n'
