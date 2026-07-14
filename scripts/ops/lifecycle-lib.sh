#!/usr/bin/env bash
# Shared primitives for portable SDM lifecycle archives. Bash 4+, GNU tar and sha256sum required.
set -euo pipefail

LIFECYCLE_FORMAT_VERSION=1

lifecycle_die() { echo "error: $*" >&2; exit 1; }
lifecycle_sha256() { sha256sum "$1" | awk '{print $1}'; }

lifecycle_require_empty_dir() {
  local path="$1"
  if [[ -e "$path" ]]; then
    lifecycle_die "refusing to overwrite existing path: $path"
  fi
  mkdir -p "$path"
}

lifecycle_archive_tree() {
  local source="$1" archive="$2"
  [[ -d "$source" ]] || lifecycle_die "source directory does not exist: $source"
  tar -C "$source" -czf "$archive" .
}

lifecycle_restore_tree() {
  local archive="$1" destination="$2"
  [[ -f "$archive" ]] || lifecycle_die "archive does not exist: $archive"
  mkdir -p "$destination"
  tar -C "$destination" -xzf "$archive"
}

lifecycle_write_manifest() {
  local root="$1" app_version="$2" compose_file="$3"
  local files_json=""
  local file checksum size
  while IFS= read -r -d '' file; do
    file="${file#"$root"/}"
    [[ "$file" == "manifest.json" ]] && continue
    checksum="$(lifecycle_sha256 "$root/$file")"
    size="$(wc -c < "$root/$file" | tr -d ' ')"
    files_json+="{\"path\":\"$file\",\"sha256\":\"$checksum\",\"bytes\":$size},"
  done < <(find "$root" -type f -print0 | sort -z)
  files_json="[${files_json%,}]"
  python3 - "$root/manifest.json" "$app_version" "$compose_file" "$files_json" <<'PY'
import json, sys
path, app_version, compose_file, files = sys.argv[1:]
json.dump({
  "formatVersion": 1,
  "applicationVersion": app_version,
  "composeFile": compose_file,
  "components": ["postgresql", "garage-data", "garage-meta", "config-metadata"],
  "files": json.loads(files),
}, open(path, "w"), indent=2, sort_keys=True)
open(path, "a").write("\n")
PY
}

lifecycle_verify_manifest() {
  local root="$1" expected_version="${2:-}"
  local manifest="$root/manifest.json"
  [[ -f "$manifest" ]] || lifecycle_die "manifest.json is missing"
  python3 - "$root" "$expected_version" <<'PY'
import hashlib, json, pathlib, sys
root = pathlib.Path(sys.argv[1]).resolve()
expected = sys.argv[2]
manifest = json.loads((root / "manifest.json").read_text())
if manifest.get("formatVersion") != 1:
    raise SystemExit("unsupported backup format; use the matching SDM release to restore it")
if expected and manifest.get("applicationVersion") not in (expected, "unknown"):
    raise SystemExit(f"backup is for {manifest.get('applicationVersion')}; current checkout is {expected}. Run the documented upgrade/rollback procedure or pass --allow-version-mismatch after review.")
for entry in manifest.get("files", []):
    path = (root / entry["path"]).resolve()
    if root not in path.parents or not path.is_file():
        raise SystemExit(f"backup payload is missing: {entry['path']}")
    checksum = hashlib.sha256(path.read_bytes()).hexdigest()
    if checksum != entry["sha256"]:
        raise SystemExit(f"checksum mismatch: {entry['path']}")
PY
}

lifecycle_compose() { docker compose -f "$1" "${@:2}"; }

lifecycle_volume_archive() {
  local volume="$1" archive_dir="$2" archive_name="$3"
  docker run --rm -v "$volume:/source:ro" -v "$archive_dir:/backup" docker.io/library/alpine:3.20 \
    tar -C /source -czf "/backup/$archive_name" .
}

lifecycle_volume_restore() {
  local volume="$1" archive_dir="$2" archive_name="$3"
  docker run --rm -v "$volume:/target" -v "$archive_dir:/backup:ro" docker.io/library/alpine:3.20 \
    sh -ec 'find /target -mindepth 1 -delete; tar -C /target -xzf "/backup/$1"' sh "$archive_name"
}
