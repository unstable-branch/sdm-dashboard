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
  if [ ! -e "$marker" ]; then
    chown -R sdm:sdm "$dir"
    chmod -R u+rwX "$dir"
    : > "$marker"
    chown sdm:sdm "$marker"
  fi
  chown sdm:sdm "$dir"
  chmod u+rwx "$dir"
}

prepare_shared_dir /app/data/uploads
prepare_shared_dir /app/outputs
prepare_runtime_dir /app/covariates
prepare_runtime_dir /app/Worldclim
prepare_runtime_dir /app/chelsa
prepare_runtime_dir /app/Worldclim_future

exec gosu sdm "$@"
