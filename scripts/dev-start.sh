#!/usr/bin/env bash
# scripts/dev-start.sh
# Starts SDM Dashboard services with profile and accelerator selection.
#
# Usage:
#   ./scripts/dev-start.sh            # starts core + email + api + frontend
#   ./scripts/dev-start.sh minimal    # postgres + redis only
#   ./scripts/dev-start.sh plumber    # core + email + Plumber + api + frontend
#   ./scripts/dev-start.sh full       # everything including Plumber + garage
#
# SDM_ACCELERATOR applies to plumber/full: auto (default), amd, nvidia, cpu.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

TMUX_CMD="TMPDIR=/tmp tmux -L sdm"
FRONTEND_BUNDLER="${FRONTEND_BUNDLER:-turbo}"
ACCELERATOR_REQUEST="${SDM_ACCELERATOR:-auto}"
ACCELERATOR_SELECTED="cpu"
COMPOSE_FILES=()

fail() {
  echo -e "${RED}$*${NC}" >&2
  return 1
}

# Keep Docker access consistent with the actual compose calls. The shell is
# quoted before sg sees it, so a path/env value cannot alter the command line.
docker_as_user() {
  local quoted
  printf -v quoted '%q ' "$@"
  sg docker -c "$quoted"
}

compose() {
  docker_as_user docker compose "${COMPOSE_FILES[@]}" "$@"
}

docker_usable() {
  command -v docker >/dev/null 2>&1 \
    && command -v sg >/dev/null 2>&1 \
    && docker_as_user docker info >/dev/null 2>&1
}

amd_host_usable() {
  local render_nodes=(/dev/dri/renderD*)
  docker_usable \
    && [[ -c /dev/kfd ]] \
    && [[ -e "${render_nodes[0]}" ]]
}

nvidia_host_usable() {
  command -v nvidia-smi >/dev/null 2>&1 \
    && nvidia-smi -L >/dev/null 2>&1 \
    && docker_usable \
    && docker_as_user docker info --format '{{json .Runtimes}}' 2>/dev/null \
      | grep -Eq '"nvidia"[[:space:]]*:'
}

get_group_gid() {
  getent group "$1" 2>/dev/null | awk -F: 'NR == 1 { print $3 }'
}

configure_amd_groups() {
  local video_gid render_gid
  video_gid="${AMD_VIDEO_GID:-$(get_group_gid video)}"
  render_gid="${AMD_RENDER_GID:-$(get_group_gid render)}"
  [[ "$video_gid" =~ ^[0-9]+$ ]] \
    || fail "AMD ROCm requires a numeric AMD_VIDEO_GID (host video group was not usable)."
  [[ "$render_gid" =~ ^[0-9]+$ ]] \
    || fail "AMD ROCm requires a numeric AMD_RENDER_GID (host render group was not usable)."
  export AMD_VIDEO_GID="$video_gid"
  export AMD_RENDER_GID="$render_gid"
}

select_accelerator() {
  local amd=0 nvidia=0
  amd_host_usable && amd=1 || true
  nvidia_host_usable && nvidia=1 || true

  case "$ACCELERATOR_REQUEST" in
    cpu)
      ACCELERATOR_SELECTED="cpu"
      ;;
    amd)
      if [[ "$amd" -ne 1 ]]; then
        fail "SDM_ACCELERATOR=amd requested, but Docker, /dev/kfd, or /dev/dri/renderD* is not usable."
        return 1
      fi
      ACCELERATOR_SELECTED="amd"
      ;;
    nvidia)
      if [[ "$nvidia" -ne 1 ]]; then
        fail "SDM_ACCELERATOR=nvidia requested, but nvidia-smi or Docker's NVIDIA runtime is not usable."
        return 1
      fi
      ACCELERATOR_SELECTED="nvidia"
      ;;
    auto)
      if [[ "$amd" -eq 1 && "$nvidia" -eq 1 ]]; then
        fail "Both AMD ROCm and NVIDIA are usable; set SDM_ACCELERATOR=amd or SDM_ACCELERATOR=nvidia."
        return 1
      elif [[ "$amd" -eq 1 ]]; then
        ACCELERATOR_SELECTED="amd"
      elif [[ "$nvidia" -eq 1 ]]; then
        ACCELERATOR_SELECTED="nvidia"
      else
        ACCELERATOR_SELECTED="cpu"
      fi
      ;;
    *)
      fail "SDM_ACCELERATOR must be one of: auto, amd, nvidia, cpu."
      return 1
      ;;
  esac
}

configure_compose_files() {
  COMPOSE_FILES=(-f docker-compose.dev.yml)
  case "$ACCELERATOR_SELECTED" in
    amd)
      configure_amd_groups
      COMPOSE_FILES+=(-f scripts/docker-compose.rocm.yml)
      ;;
    nvidia)
      # Legacy name retained so existing callers remain valid; it is NVIDIA-only.
      COMPOSE_FILES+=(-f scripts/docker-compose.gpu.yml)
      ;;
  esac
}

main() {
  local mode="${1:-dev}"
  local desc
  local -a profiles

  cd "$SCRIPT_DIR"
  export PATH="$HOME/.npm-global/bin:$PATH"

  case "$FRONTEND_BUNDLER" in
    webpack) NEXT_DEV_BUNDLER_FLAG="--webpack" ;;
    turbo|turbopack) NEXT_DEV_BUNDLER_FLAG="--turbo" ;;
    *) fail "FRONTEND_BUNDLER must be 'webpack' or 'turbo'."; return 1 ;;
  esac

  case "$ACCELERATOR_REQUEST" in auto|amd|nvidia|cpu) ;; *) fail "SDM_ACCELERATOR must be one of: auto, amd, nvidia, cpu."; return 1 ;; esac
  docker_usable || { fail "docker is required and must be usable through the docker group."; return 1; }

  echo ""
  echo "========================================="
  echo "  SDM Dashboard — Development Mode"
  echo "========================================="
  echo ""

  case "$mode" in
    minimal)
      [[ "$ACCELERATOR_REQUEST" == "auto" ]] || { fail "SDM_ACCELERATOR applies only to plumber or full mode."; return 1; }
      profiles=(core)
      desc="postgres + redis"
      ;;
    full)
      command -v tmux >/dev/null 2>&1 || { fail "tmux is required for full mode (api + frontend in tmux)."; return 1; }
      profiles=(all)
      desc="all services (core + email + storage + computation)"
      ;;
    plumber)
      command -v tmux >/dev/null 2>&1 || { fail "tmux is required for plumber mode (api + frontend in tmux)."; return 1; }
      profiles=(core email computation)
      desc="postgres, redis, mailpit, plumber (+ local API + frontend)"
      ;;
    dev|"")
      [[ "$ACCELERATOR_REQUEST" == "auto" ]] || { fail "SDM_ACCELERATOR applies only to plumber or full mode."; return 1; }
      profiles=(core email)
      desc="postgres, redis, mailpit (+ local API + frontend)"
      ;;
    *)
      # Preserve the prior catch-all invocation behavior: unknown modes start
      # the ordinary development profile rather than changing existing callers.
      [[ "$ACCELERATOR_REQUEST" == "auto" ]] || { fail "SDM_ACCELERATOR applies only to plumber or full mode."; return 1; }
      profiles=(core email)
      desc="postgres, redis, mailpit (+ local API + frontend)"
      ;;
  esac

  if [[ "$mode" == "plumber" || "$mode" == "full" ]]; then
    select_accelerator
    configure_compose_files
    case "$ACCELERATOR_SELECTED" in
      amd) echo -e "${BLUE}Accelerator:${NC} AMD ROCm (video GID ${AMD_VIDEO_GID}, render GID ${AMD_RENDER_GID})" ;;
      nvidia) echo -e "${BLUE}Accelerator:${NC} NVIDIA CUDA compatibility path" ;;
      cpu) echo -e "${BLUE}Accelerator:${NC} CPU" ;;
    esac
  else
    ACCELERATOR_SELECTED="cpu"
    configure_compose_files
  fi

  local -a profile_flags=()
  local p
  for p in "${profiles[@]}"; do
    profile_flags+=(--profile "$p")
  done

  echo -e "${YELLOW}[1/5]${NC} Starting Docker services: ${desc}..."
  compose "${profile_flags[@]}" up -d --remove-orphans

  echo -e "${YELLOW}[2/5]${NC} Waiting for services to be healthy..."
  local max_wait=60 elapsed=0 unhealthy
  while [[ "$elapsed" -lt "$max_wait" ]]; do
    unhealthy="$(compose ps --format '{{.Service}}: {{.Status}}' 2>/dev/null | grep -c -i 'unhealthy\|starting' || true)"
    if [[ "$unhealthy" -eq 0 ]]; then
      echo -e "${GREEN}All services healthy.${NC}"
      break
    fi
    sleep 3
    elapsed=$((elapsed + 3))
  done
  if [[ "$elapsed" -ge "$max_wait" ]]; then
    echo -e "${RED}Warning: Some services may not be healthy yet. Continuing anyway...${NC}"
  fi

  echo -e "${YELLOW}[3/5]${NC} Running database migrations..."
  cd "${SCRIPT_DIR}/api"
  npx --yes drizzle-kit migrate
  cd "$SCRIPT_DIR"

  echo -e "${YELLOW}[4/5]${NC} Starting API (Hono) on port 4000..."
  kill $(ss -tlnp 'sport = :4000' | grep -oP 'pid=\K\d+') 2>/dev/null || true; sleep 1
  eval "$TMUX_CMD kill-session -t sdm-api" 2>/dev/null || true
  eval "$TMUX_CMD new-session -d -s sdm-api \"cd '${SCRIPT_DIR}/api' && npx --yes tsx --env-file=../.env src/index.ts\""
  sleep 8
  if curl -s -o /dev/null http://localhost:4000/health; then
    echo -e "${GREEN}API started (tmux: sdm-api)${NC}"
  else
    fail "API failed to start."
    eval "$TMUX_CMD capture-pane -t sdm-api -p"
    return 1
  fi

  echo -e "${YELLOW}[5/5]${NC} Starting Frontend (Next.js/${FRONTEND_BUNDLER}) on port 3000..."
  eval "$TMUX_CMD kill-session -t sdm-frontend" 2>/dev/null || true
  eval "$TMUX_CMD new-session -d -s sdm-frontend \"cd '${SCRIPT_DIR}/frontend' && NODE_OPTIONS='--max-old-space-size=4096' npx --yes next dev ${NEXT_DEV_BUNDLER_FLAG} --port 3000 -H 127.0.0.1\""
  sleep 12
  if curl -s -o /dev/null http://localhost:3000; then
    echo -e "${GREEN}Frontend started (tmux: sdm-frontend)${NC}"
  else
    fail "Frontend failed to start."
    eval "$TMUX_CMD capture-pane -t sdm-frontend -p"
    return 1
  fi

  local ip
  ip=$(hostname -I | awk '{print $1}')
  echo ""
  echo "========================================="
  echo -e "  ${GREEN}All services running!${NC}"
  echo "========================================="
  echo -e "  ${BLUE}Frontend:${NC}  http://localhost:3000"
  echo -e "  ${BLUE}API:${NC}       http://localhost:4000"
  echo -e "  ${BLUE}Postgres:${NC}  localhost:5432"
  echo -e "  ${BLUE}Redis:${NC}     localhost:6379"
  if printf '%s\n' "${profiles[@]}" | grep -qxE 'email|all'; then echo -e "  ${BLUE}Mailpit:${NC}   http://localhost:5000 (email inspector)"; fi
  if printf '%s\n' "${profiles[@]}" | grep -qxE 'computation|all'; then echo -e "  ${BLUE}Plumber:${NC}   http://localhost:8000"; fi
  if printf '%s\n' "${profiles[@]}" | grep -qx 'all'; then
    echo -e "  ${BLUE}Garage:${NC}    http://localhost:3900"
    echo -e "  ${BLUE}Prometheus:${NC} http://localhost:9090"
    echo -e "  ${BLUE}Grafana:${NC}  http://localhost:3001 (admin / ${GRAFANA_PASSWORD:-dev-grafana-CHANGE-ME})"
  fi
  echo -e "  ${YELLOW}Remote access:${NC} ssh -L 3000:localhost:3000 -L 4000:localhost:4000 -L 8000:localhost:8000 ${USER}@${ip}"
  echo -e "  ${BLUE}Usage:${NC} ./scripts/dev-start.sh [minimal|plumber|full]"
  echo -e "  ${BLUE}To stop:${NC}  ./scripts/dev-stop.sh"

  if command -v xdg-open >/dev/null 2>&1; then xdg-open http://localhost:3000 2>/dev/null &
  elif command -v sensible-browser >/dev/null 2>&1; then sensible-browser http://localhost:3000 2>/dev/null &
  fi
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
