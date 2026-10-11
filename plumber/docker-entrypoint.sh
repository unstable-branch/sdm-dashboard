#!/bin/sh
set -eu

# Fresh Docker volumes are root-owned. Normalize the shared trees while still
# privileged, then rely on setgid directories plus a cooperative umask.
umask 0002
shared_gid="${SDM_SHARED_GID:-2000}"

prepare_shared_dir() {
  dir="$1"
  mkdir -p "$dir"
  marker="$dir/.sdm-shared-permissions-v1"
  if [ ! -e "$marker" ]; then
    chgrp -R "$shared_gid" "$dir"
    chmod -R g+rwX "$dir"
    find "$dir" -xdev -type d -exec chmod g+s {} +
    : > "$marker"
    chgrp "$shared_gid" "$marker"
    chmod g+rw "$marker"
  fi
  chgrp "$shared_gid" "$dir"
  chmod g+rwx,g+s "$dir"
}

prepare_runtime_dir() {
  dir="$1"
  mkdir -p "$dir"
  marker="$dir/.sdm-runtime-permissions-v1"
  # The service UID/GID can differ between CPU/CUDA and ROCm base images.
  # A marker from another variant must not suppress ownership repair.
  if [ ! -e "$marker" ] || [ "$(stat -c '%u:%g' "$marker")" != "$(id -u sdm):$(id -g sdm)" ]; then
    chown -R sdm:sdm "$dir"
    chmod -R u+rwX "$dir"
    : > "$marker"
    chown sdm:sdm "$marker"
  fi
  chown sdm:sdm "$dir"
  chmod u+rwx "$dir"
}

prepare_shared_dir /app/data/uploads
prepare_shared_dir /app/data/boundaries
prepare_shared_dir /app/outputs
prepare_runtime_dir /app/covariates
prepare_runtime_dir /app/Worldclim
prepare_runtime_dir /app/chelsa
prepare_runtime_dir /app/Worldclim_future

# Replay protection is private to Plumber, not part of the shared output
# permission contract. Preserve nonce entries across image switches, repairing
# ownership before dropping privileges. Never follow a redirected nonce root.
nonce_dir="${SDM_EXECUTION_NONCE_DIR:-/app/outputs/.execution-nonces}"
if [ -L "$nonce_dir" ]; then
  echo "Refusing symlink execution nonce directory" >&2
  exit 1
fi
prepare_runtime_dir "$nonce_dir"
find "$nonce_dir" -xdev -type d -exec chmod u=rwx,go=,u-s,g-s {} +

exec gosu sdm "$@"
