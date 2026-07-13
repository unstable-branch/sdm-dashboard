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

prepare_shared_dir /app/data/uploads
prepare_shared_dir /app/outputs

exec gosu sdm "$@"
