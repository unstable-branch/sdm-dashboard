#!/usr/bin/env bash
# scripts/dev-stop.sh
# Stops all SDM Dashboard services (local tmux + Docker)

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SCRIPT_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}Stopping SDM Dashboard services...${NC}"

# Kill local tmux sessions
echo "  Stopping local API..."
tmux kill-session -t sdm-api 2>/dev/null && echo -e "    ${GREEN}API stopped.${NC}" || echo "    API was not running."

echo "  Stopping local Frontend..."
tmux kill-session -t sdm-frontend 2>/dev/null && echo -e "    ${GREEN}Frontend stopped.${NC}" || echo "    Frontend was not running."

# Stop Docker services
echo "  Stopping Docker services..."
if docker compose -f docker-compose.dev.yml ps -q 2>/dev/null | grep -q .; then
    docker compose -f docker-compose.dev.yml down 2>&1
    echo -e "${GREEN}Docker services stopped.${NC}"
else
    echo "    No Docker services were running."
fi
