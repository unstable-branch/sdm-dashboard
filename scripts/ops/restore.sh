#!/usr/bin/env bash
# Restore a verified lifecycle backup. This intentionally refuses destructive work by default.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=lifecycle-lib.sh
source "$ROOT/scripts/ops/lifecycle-lib.sh"
usage() { cat <<'USAGE'
Usage: scripts/ops/restore.sh --input DIR --garage-data-volume NAME --garage-meta-volume NAME --force --yes-really-restore [options]

Options:
  --compose-file FILE             Compose file (default: docker-compose.prod.yml)
  --app-version VERSION           Compatibility version (default: VERSION file)
  --allow-version-mismatch        Permit a reviewed cross-version restore

Restore validates the manifest, Garage archive structure, and all SHA-256 checksums
before stopping services. It then replaces PostgreSQL public schema and both Garage
volumes. If any destructive step fails, previously running application services stay
stopped so an operator can recover deliberately.
USAGE
}
input=""; compose_file="$ROOT/docker-compose.prod.yml"; data_volume=""; meta_volume=""; force=false; really=false; allow_version=false; app_version="$(tr -d '\r\n' < "$ROOT/VERSION")"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --input) input="$2"; shift 2;; --compose-file) compose_file="$2"; shift 2;;
    --garage-data-volume) data_volume="$2"; shift 2;; --garage-meta-volume) meta_volume="$2"; shift 2;;
    --app-version) app_version="$2"; shift 2;; --force) force=true; shift;; --yes-really-restore) really=true; shift;;
    --allow-version-mismatch) allow_version=true; shift;; -h|--help) usage; exit 0;; *) lifecycle_die "unknown option: $1";;
  esac
done
[[ -n "$input" && -n "$data_volume" && -n "$meta_volume" && "$force" == true && "$really" == true ]] || { usage >&2; lifecycle_die "restore requires explicit destructive confirmation"; }
[[ -f "$compose_file" ]] || lifecycle_die "compose file does not exist: $compose_file"
[[ "$data_volume" != "$meta_volume" ]] || lifecycle_die "Garage data and metadata volumes must be different"
lifecycle_validate_docker_volume "$data_volume"
lifecycle_validate_docker_volume "$meta_volume"
expected="$app_version"; [[ "$allow_version" == true ]] && expected=""
lifecycle_verify_manifest "$input" "$expected"
for required in postgresql/database.dump garage/data.tar.gz garage/meta.tar.gz; do [[ -f "$input/$required" ]] || lifecycle_die "backup payload is missing: $required"; done
lifecycle_verify_payload_archive "$input/garage/data.tar.gz"
lifecycle_verify_payload_archive "$input/garage/meta.tar.gz"

running=()
for service in api plumber garage; do
  if lifecycle_compose "$compose_file" ps --status running --services | grep -qx "$service"; then running+=("$service"); fi
done
restore_complete=false
on_exit() {
  local status=$?
  trap - EXIT
  if [[ "$restore_complete" == true ]]; then
    [[ ${#running[@]} -eq 0 ]] || lifecycle_compose "$compose_file" start "${running[@]}" || {
      echo "error: restore completed, but one or more previously running services could not be restarted; inspect and start only the required services manually." >&2
      exit 1
    }
  elif [[ ${#running[@]} -gt 0 ]]; then
    echo "error: restore failed after application services were stopped. They have been left stopped to protect the partially restored state. Review the failure, recover PostgreSQL and both Garage volumes from a known-good backup, then start the required services manually." >&2
  fi
  exit "$status"
}
trap on_exit EXIT
[[ ${#running[@]} -eq 0 ]] || lifecycle_compose "$compose_file" stop "${running[@]}"
lifecycle_compose "$compose_file" exec -T postgres psql -U sdm -d sdm_platform -v ON_ERROR_STOP=1 -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
cat "$input/postgresql/database.dump" | lifecycle_compose "$compose_file" exec -T postgres pg_restore -U sdm -d sdm_platform --exit-on-error
lifecycle_volume_restore "$data_volume" "$input" "garage/data.tar.gz"
lifecycle_volume_restore "$meta_volume" "$input" "garage/meta.tar.gz"
restore_complete=true
echo "Restore completed. Run the dedicated migration service before exposing the API."
