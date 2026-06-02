#!/usr/bin/env bash
# scripts/dev-start.sh
# Starts SDM Dashboard services with profile selection.
#
# Usage:
#   ./scripts/dev-start.sh            # starts core + email + api + frontend
#   ./scripts/dev-start.sh minimal    # postgres + redis only (api/frontend local)
#   ./scripts/dev-start.sh plumber    # core + email + plumber + api + frontend
#   ./scripts/dev-start.sh full       # everything including plumber + garage
#
# Profiles:
#   core        postgres, redis
#   email       mailpit (email inspection)
#   storage     garage (S3-compatible storage)
#   computation plumber (R model backend)

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SCRIPT_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# tmux socket fix: use explicit TMPDIR and socket name to avoid permission issues
TMUX_CMD="TMPDIR=/tmp tmux -L sdm"

# Ensure npx doesn't prompt for install confirmation
export PATH="$HOME/.npm-global/bin:$PATH"

MODE="${1:-dev}"

echo ""
echo "========================================="
echo "  SDM Dashboard — Development Mode"
echo "========================================="
echo ""

# Check prerequisites
command -v docker >/dev/null 2>&1 || { echo -e "${RED}docker is required but not installed.${NC}"; exit 1; }

case "$MODE" in
  minimal)
    PROFILES=(core)
    DESC="postgres + redis"
    ;;
  full)
    command -v tmux >/dev/null 2>&1 || { echo -e "${RED}tmux is required for full mode (api + frontend in tmux).${NC}"; exit 1; }
    PROFILES=(all)
    DESC="all services (core + email + storage + computation)"
    ;;
  plumber)
    command -v tmux >/dev/null 2>&1 || { echo -e "${RED}tmux is required for plumber mode (api + frontend in tmux).${NC}"; exit 1; }
    PROFILES=(core email computation)
    DESC="postgres, redis, mailpit, plumber (+ local API + frontend)"
    ;;
  *)
    command -v tmux >/dev/null 2>&1 || { echo -e "${RED}tmux is required for dev mode (api + frontend in tmux).${NC}"; exit 1; }
    PROFILES=(core email)
    DESC="postgres, redis, mailpit (+ local API + frontend)"
    ;;
esac

# Build --profile flags for docker compose
PROFILE_FLAGS=""
for p in "${PROFILES[@]}"; do
  PROFILE_FLAGS+=" --profile $p"
done

# 1. Start Docker backing services
echo -e "${YELLOW}[1/4]${NC} Starting Docker services: ${DESC}..."
sg docker -c "docker compose -f docker-compose.dev.yml${PROFILE_FLAGS} up -d --remove-orphans" 2>&1

# 2. Wait for healthy
echo -e "${YELLOW}[2/4]${NC} Waiting for services to be healthy..."
MAX_WAIT=60
ELAPSED=0
while [ $ELAPSED -lt $MAX_WAIT ]; do
    UNHEALTHY=$(sg docker -c "docker compose -f docker-compose.dev.yml ps --format '{{.Service}}: {{.Status}}' 2>/dev/null | grep -c -i 'unhealthy\|starting' || true")
    if [ "$UNHEALTHY" -eq 0 ]; then
        echo -e "${GREEN}All services healthy.${NC}"
        break
    fi
    sleep 3
    ELAPSED=$((ELAPSED + 3))
done

if [ $ELAPSED -ge $MAX_WAIT ]; then
    echo -e "${RED}Warning: Some services may not be healthy yet. Continuing anyway...${NC}"
fi

# 3. Run database migrations
echo -e "${YELLOW}[3/4]${NC} Running database migrations..."
cd "${SCRIPT_DIR}/api"
npx --yes drizzle-kit migrate 2>&1
cd "${SCRIPT_DIR}"

# 4. Start API locally in tmux
echo -e "${YELLOW}[4/5]${NC} Starting API (Hono) on port 4000..."
kill $(ss -tlnp 'sport = :4000' | grep -oP 'pid=\K\d+') 2>/dev/null; sleep 1
eval "$TMUX_CMD kill-session -t sdm-api" 2>/dev/null || true
eval "$TMUX_CMD new-session -d -s sdm-api \"cd '${SCRIPT_DIR}/api' && npx --yes tsx --env-file=../.env src/index.ts\"" 2>&1

# Wait for API to start
sleep 8
if curl -s -o /dev/null http://localhost:4000/health; then
    echo -e "${GREEN}API started (tmux: sdm-api)${NC}"
else
    echo -e "${RED}API failed to start.${NC}"
    eval "$TMUX_CMD capture-pane -t sdm-api -p"
    exit 1
fi

# 5. Start Frontend locally in tmux
echo -e "${YELLOW}[5/5]${NC} Starting Frontend (Next.js) on port 3000..."
eval "$TMUX_CMD kill-session -t sdm-frontend" 2>/dev/null || true
eval "$TMUX_CMD new-session -d -s sdm-frontend \"cd '${SCRIPT_DIR}/frontend' && NODE_OPTIONS='--max-old-space-size=4096' npx --yes next dev --turbo --port 3000 -H 127.0.0.1\"" 2>&1

# Wait for frontend to start
sleep 12
if curl -s -o /dev/null http://localhost:3000; then
    echo -e "${GREEN}Frontend started (tmux: sdm-frontend)${NC}"
else
    echo -e "${RED}Frontend failed to start.${NC}"
    eval "$TMUX_CMD capture-pane -t sdm-frontend -p"
    exit 1
fi

# Get network IP for remote access
IP=$(hostname -I | awk '{print $1}')

# Print status
echo ""
echo "========================================="
echo -e "  ${GREEN}All services running!${NC}"
echo "========================================="
echo ""
echo -e "  ${BLUE}Frontend:${NC}  http://localhost:3000"
echo -e "  ${BLUE}API:${NC}       http://localhost:4000"
echo -e "  ${BLUE}Postgres:${NC}  localhost:5432"
echo -e "  ${BLUE}Redis:${NC}     localhost:6379"
if printf '%s\n' "${PROFILES[@]}" | grep -qx "email" || printf '%s\n' "${PROFILES[@]}" | grep -qx "all"; then
    echo -e "  ${BLUE}Mailpit:${NC}   http://localhost:5000 (email inspector)"
fi
if printf '%s\n' "${PROFILES[@]}" | grep -qx "computation" || printf '%s\n' "${PROFILES[@]}" | grep -qx "all"; then
    echo -e "  ${BLUE}Plumber:${NC}   http://localhost:8000"
fi
if printf '%s\n' "${PROFILES[@]}" | grep -qx "all"; then
    echo -e "  ${BLUE}Garage:${NC}    http://localhost:3900"
fi
echo ""
echo -e "  ${YELLOW}Remote access:${NC} SSH tunnel from your local machine:"
echo -e "    ssh -L 3000:localhost:3000 -L 4000:localhost:4000 -L 8000:localhost:8000 ${USER}@${IP}"
echo ""
echo -e "  ${BLUE}tmux sessions:${NC}"
echo "    API:       TMPDIR=/tmp tmux -L sdm attach -t sdm-api"
echo "    Frontend:  TMPDIR=/tmp tmux -L sdm attach -t sdm-frontend"
echo ""
echo -e "  ${BLUE}Usage:${NC}"
echo "    ./scripts/dev-start.sh          default (core + email + local API/frontend)"
echo "    ./scripts/dev-start.sh minimal  postgres + redis only"
echo "    ./scripts/dev-start.sh plumber  core + email + plumber + local API/frontend"
echo "    ./scripts/dev-start.sh full     all Docker services"
echo ""
echo -e "  ${BLUE}To stop:${NC}  ./scripts/dev-stop.sh"
echo ""

# Open browser if available
if command -v xdg-open >/dev/null 2>&1; then
    xdg-open http://localhost:3000 2>/dev/null &
elif command -v sensible-browser >/dev/null 2>&1; then
    sensible-browser http://localhost:3000 2>/dev/null &
fi
