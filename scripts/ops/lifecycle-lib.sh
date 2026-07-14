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

lifecycle_validate_docker_volume() {
  local volume="$1" inspected
  [[ "$volume" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] || lifecycle_die "invalid Docker named volume: $volume"
  inspected="$(docker volume inspect "$volume" --format '{{.Name}}' 2>/dev/null)" \
    || lifecycle_die "Docker named volume does not exist: $volume"
  [[ "$inspected" == "$volume" ]] || lifecycle_die "Docker volume inspection did not confirm named volume: $volume"
}

lifecycle_archive_tree() {
  local source="$1" archive="$2"
  [[ -d "$source" ]] || lifecycle_die "source directory does not exist: $source"
  tar -C "$source" -czf "$archive" .
}

lifecycle_restore_tree() {
  local archive="$1" destination="$2"
  [[ -f "$archive" ]] || lifecycle_die "archive does not exist: $archive"
  lifecycle_verify_payload_archive "$archive"
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
import hashlib, json, pathlib, re, sys
root = pathlib.Path(sys.argv[1]).resolve()
expected = sys.argv[2]
required_files = {"postgresql/database.dump", "garage/data.tar.gz", "garage/meta.tar.gz"}
required_components = {"postgresql", "garage-data", "garage-meta", "config-metadata"}

def fail(message):
    raise SystemExit(message)

def valid_path(value):
    if not isinstance(value, str) or not value or value.startswith("/") or "\\" in value:
        return False
    parts = value.split("/")
    return all(part not in ("", ".", "..") for part in parts)

try:
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
    fail(f"malformed manifest.json: {error}")
if not isinstance(manifest, dict) or manifest.get("formatVersion") != 1:
    fail("unsupported backup format; use the matching SDM release to restore it")
if not isinstance(manifest.get("applicationVersion"), str) or not manifest["applicationVersion"]:
    fail("manifest applicationVersion is missing or malformed")
if expected and manifest["applicationVersion"] not in (expected, "unknown"):
    fail(f"backup is for {manifest['applicationVersion']}; current checkout is {expected}. Run the documented upgrade/rollback procedure or pass --allow-version-mismatch after review.")
components = manifest.get("components")
if not isinstance(components, list) or any(not isinstance(value, str) for value in components) or set(components) != required_components or len(components) != len(required_components):
    fail("manifest components do not match the required PostgreSQL, Garage, and config metadata payloads")
files = manifest.get("files")
if not isinstance(files, list):
    fail("manifest files must be an array")
declared = set()
for entry in files:
    if not isinstance(entry, dict) or set(entry) != {"path", "sha256", "bytes"}:
        fail("manifest contains a malformed file entry")
    path_text, checksum, size = entry["path"], entry["sha256"], entry["bytes"]
    if not valid_path(path_text) or path_text == "manifest.json":
        fail(f"manifest contains an unsafe payload path: {path_text!r}")
    if not isinstance(checksum, str) or not re.fullmatch(r"[0-9a-f]{64}", checksum):
        fail(f"manifest contains an invalid SHA-256: {path_text}")
    if not isinstance(size, int) or isinstance(size, bool) or size < 0:
        fail(f"manifest contains an invalid byte size: {path_text}")
    if path_text in declared:
        fail(f"manifest contains a duplicate payload entry: {path_text}")
    if path_text not in required_files and not path_text.startswith("config/"):
        fail(f"manifest contains an undeclared payload class: {path_text}")
    declared.add(path_text)
if not required_files <= declared:
    fail("manifest is missing required PostgreSQL or Garage payload entries")
actual = set()
for path in root.rglob("*"):
    if path == root / "manifest.json":
        continue
    relative = path.relative_to(root).as_posix()
    if path.is_symlink():
        fail(f"backup contains an unsafe symbolic-link payload: {relative}")
    if path.is_dir():
        continue
    if not path.is_file():
        fail(f"backup contains an unsafe non-regular payload: {relative}")
    actual.add(relative)
if actual != declared:
    missing, extra = declared - actual, actual - declared
    fail(f"manifest payload mismatch (missing={sorted(missing)}, undeclared={sorted(extra)})")
for entry in files:
    path = root / entry["path"]
    if path.stat().st_size != entry["bytes"]:
        fail(f"byte size mismatch: {entry['path']}")
    checksum = hashlib.sha256(path.read_bytes()).hexdigest()
    if checksum != entry["sha256"]:
        fail(f"checksum mismatch: {entry['path']}")
PY
}

lifecycle_verify_payload_archive() {
  local archive="$1"
  [[ -f "$archive" ]] || lifecycle_die "archive does not exist: $archive"
  python3 - "$archive" <<'PY'
import tarfile, sys
archive = sys.argv[1]
seen = set()
try:
    with tarfile.open(archive, "r:gz") as payload:
        for member in payload.getmembers():
            name = member.name
            if not isinstance(name, str) or name.startswith("/"):
                raise ValueError(f"unsafe absolute payload path: {name!r}")
            parts = name.split("/")
            if any(part == ".." for part in parts):
                raise ValueError(f"unsafe traversal payload path: {name!r}")
            normalized = "/".join(part for part in parts if part not in ("", "."))
            if normalized:
                if normalized in seen:
                    raise ValueError(f"duplicate payload path: {normalized}")
                seen.add(normalized)
            if not (member.isdir() or member.isreg()):
                raise ValueError(f"unsupported payload member type: {name!r}")
except (OSError, EOFError, tarfile.TarError, ValueError) as error:
    raise SystemExit(f"unsafe or malformed Garage payload archive: {error}")
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
