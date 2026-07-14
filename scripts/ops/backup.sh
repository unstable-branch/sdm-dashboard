#!/usr/bin/env bash
# Create a quiesced, checksummed PostgreSQL + Garage volume backup.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=lifecycle-lib.sh
source "$ROOT/scripts/ops/lifecycle-lib.sh"

usage() { cat <<'USAGE'
Usage: scripts/ops/backup.sh --output DIR --garage-data-volume NAME --garage-meta-volume NAME [options]

Options:
  --compose-file FILE     Compose file (default: docker-compose.prod.yml)
  --config FILE           Config metadata to include (repeatable; defaults to compose file and garage.toml if present)
  --app-version VERSION   Recorded compatibility version (default: VERSION file)

The script stops API, Plumber, and Garage while taking the backup, then starts only
services that were running before the operation. Archive output must not already exist.
USAGE
}
output=""; compose_file="$ROOT/docker-compose.prod.yml"; data_volume=""; meta_volume=""; app_version="$(tr -d '\r\n' < "$ROOT/VERSION")"; configs=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output) output="$2"; shift 2;; --compose-file) compose_file="$2"; shift 2;;
    --garage-data-volume) data_volume="$2"; shift 2;; --garage-meta-volume) meta_volume="$2"; shift 2;;
    --config) configs+=("$2"); shift 2;; --app-version) app_version="$2"; shift 2;;
    -h|--help) usage; exit 0;; *) lifecycle_die "unknown option: $1";;
  esac
done
[[ -n "$output" && -n "$data_volume" && -n "$meta_volume" ]] || { usage >&2; exit 2; }
[[ -f "$compose_file" ]] || lifecycle_die "compose file does not exist: $compose_file"
[[ "$data_volume" != "$meta_volume" ]] || lifecycle_die "Garage data and metadata volumes must be different"
lifecycle_validate_docker_volume "$data_volume"
lifecycle_validate_docker_volume "$meta_volume"
lifecycle_require_empty_dir "$output"
mkdir -p "$output/postgresql" "$output/garage" "$output/config"
[[ ${#configs[@]} -gt 0 ]] || configs=("$compose_file")
[[ -f "$ROOT/garage.toml" ]] && configs+=("$ROOT/garage.toml")
for config in "${configs[@]}"; do [[ -f "$config" ]] || lifecycle_die "config file does not exist: $config"; cp "$config" "$output/config/$(basename "$config")"; done

running=()
for service in api plumber garage; do
  if lifecycle_compose "$compose_file" ps --status running --services | grep -qx "$service"; then running+=("$service"); fi
done
restore_services() { [[ ${#running[@]} -eq 0 ]] || lifecycle_compose "$compose_file" start "${running[@]}"; }
trap restore_services EXIT
[[ ${#running[@]} -eq 0 ]] || lifecycle_compose "$compose_file" stop "${running[@]}"
lifecycle_compose "$compose_file" exec -T postgres pg_dump -U sdm -Fc sdm_platform > "$output/postgresql/database.dump"
lifecycle_volume_archive "$data_volume" "$output" "garage/data.tar.gz"
lifecycle_volume_archive "$meta_volume" "$output" "garage/meta.tar.gz"
lifecycle_write_manifest "$output" "$app_version" "$(basename "$compose_file")"
echo "Backup created: $output"
