#!/usr/bin/env bash
set -Eeuo pipefail

# Guard before sourcing code, installing traps, or invoking Docker.
if [[ "${SDM_EXECUTION_PG_PROOF_OPT_IN:-}" != "RUN_DISPOSABLE_LOCAL_POSTGRES_TESTS" ]]; then
  printf '%s\n' 'Refusing: explicit disposable-PostgreSQL opt-in is required.' >&2
  exit 64
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE='sha256:79bd7c99e923138f136f8009d6bffa66e21e9d4fda5c0c561b00fc9c90cfe537'
LABEL="sdm-execution-proof=$(cat /proc/sys/kernel/random/uuid)"
NAME="sdm-exec-proof-${LABEL##*=}"
CID=''
LOG_DIR="${SDM_EXECUTION_PROOF_LOG_DIR:-${TMPDIR:-/tmp}/sdm-execution-proof}"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/execution-reservation-postgres-$(date -u +%Y%m%dT%H%M%SZ).log"

cleanup() {
  local rc=$?
  if [[ -n "$CID" ]]; then
    local actual_id actual_label running
    actual_id="$(docker inspect --format '{{.Id}}' "$CID" 2>/dev/null || true)"
    actual_label="$(docker inspect --format '{{index .Config.Labels "sdm.execution-proof"}}' "$CID" 2>/dev/null || true)"
    running="$(docker inspect --format '{{.State.Running}}' "$CID" 2>/dev/null || true)"
    if [[ "$actual_id" == "$CID" && "$actual_label" == "$LABEL" ]]; then
      if [[ "$running" == true ]]; then docker stop "$CID" >/dev/null; fi
      docker rm "$CID" >/dev/null
    else
      printf '%s\n' 'Teardown refused: container identity/label verification failed.' >&2
      rc=1
    fi
    if docker inspect "$CID" >/dev/null 2>&1; then
      printf '%s\n' 'Teardown verification failed: owned container still exists.' >&2
      rc=1
    fi
  fi
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Kernel-selected port, loopback-only bind; existing services are not reused.
CID="$(docker run -d --name "$NAME" --label "sdm.execution-proof=$LABEL" -e POSTGRES_PASSWORD=disposable-execution-proof-only --cpus=1 --memory=1g --memory-swap=1g --pids-limit=128 --restart=no -p 127.0.0.1::5432 "$IMAGE" postgres -c listen_addresses='*' -c max_connections=40)"
ACTUAL_ID="$(docker inspect --format '{{.Id}}' "$CID")"
ACTUAL_IMAGE="$(docker inspect --format '{{.Image}}' "$CID")"
ACTUAL_LABEL="$(docker inspect --format '{{index .Config.Labels "sdm.execution-proof"}}' "$CID")"
RESTART="$(docker inspect --format '{{.HostConfig.RestartPolicy.Name}}' "$CID")"
BIND="$(docker inspect --format '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostIp}}' "$CID")"
PORT="$(docker inspect --format '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}' "$CID")"
CPU="$(docker inspect --format '{{.HostConfig.NanoCpus}}' "$CID")"
MEM="$(docker inspect --format '{{.HostConfig.Memory}}' "$CID")"
PIDS="$(docker inspect --format '{{.HostConfig.PidsLimit}}' "$CID")"
[[ "$ACTUAL_ID" == "$CID" && "$ACTUAL_IMAGE" == "$IMAGE" && "$ACTUAL_LABEL" == "$LABEL" && "$RESTART" == no && "$BIND" == 127.0.0.1 && "$PORT" =~ ^[0-9]+$ && "$CPU" == 1000000000 && "$MEM" == 1073741824 && "$PIDS" == 128 ]] || {
  printf '%s\n' 'Disposable PostgreSQL isolation verification failed.' >&2; exit 65;
}

# Credentials are disposable sentinels, only in process environment, never output.
export PGPASSWORD='disposable-execution-proof-only'
DB_URL="postgresql://postgres:disposable-execution-proof-only@127.0.0.1:${PORT}/postgres"
export SDM_EXECUTION_PG_PROOF_OPT_IN=RUN_DISPOSABLE_LOCAL_POSTGRES_TESTS
export SDM_EXECUTION_PG_CONTAINER_ID="$CID" SDM_EXECUTION_PG_LABEL="$LABEL"
export SDM_MIGRATION_TEST_DATABASE_URL="$DB_URL" SDM_MIGRATION_TEST_REQUIRED=1
export SDM_EXECUTION_TEST_DATABASE_URL="$DB_URL" SDM_EXECUTION_TEST_REQUIRED=1
READY_DEADLINE=$((SECONDS + 90))
until timeout --signal=TERM --kill-after=2s 3s docker exec "$CID" pg_isready -h 127.0.0.1 -U postgres -d postgres >/dev/null 2>&1 && (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; do
  if (( SECONDS >= READY_DEADLINE )); then printf '%s\\n' 'PostgreSQL final-TCP readiness deadline exceeded.' >&2; exit 66; fi
  sleep 1
done
printf 'container_id=%s image_id=%s bind=%s port=%s cpu_nano=%s memory_bytes=%s pids=%s restart=%s\n' "$CID" "$ACTUAL_IMAGE" "$BIND" "$PORT" "$CPU" "$MEM" "$PIDS" "$RESTART" >"$LOG_FILE"
{
  printf '%s\n' 'migration schema proof'
  (cd "$ROOT" && pnpm exec vitest run src/db/execution-migration.test.ts)
  printf '%s\n' 'reservation behavior proof'
  (cd "$ROOT" && pnpm exec vitest run src/services/execution-reservation.test.ts)
} >>"$LOG_FILE" 2>&1
printf 'Disposable PostgreSQL proof log: %s\n' "$LOG_FILE"
