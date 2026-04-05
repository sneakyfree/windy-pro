#!/bin/bash
# Start all Windy Pro services for local development
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.."; pwd)"
cd "$REPO_ROOT"

# Colors
GREEN='\033[0;32m'
CYAN='\033[0;36m'
DIM='\033[2m'
NC='\033[0m'

echo -e "${GREEN}Starting Windy Pro development stack...${NC}"
echo ""

PIDS=()
cleanup() {
    echo ""
    echo -e "${DIM}Shutting down...${NC}"
    for pid in "${PIDS[@]}"; do
        kill "$pid" 2>/dev/null || true
    done
    wait 2>/dev/null
    echo "Done."
}
trap cleanup EXIT INT TERM

# ── 1. Generate RS256 keys if missing ──
if [ ! -f account-server/keys/private.pem ]; then
    echo -e "${CYAN}Generating RS256 keys...${NC}"
    bash scripts/generate-keys.sh
fi

# ── 2. Account server ──
echo -e "${CYAN}Starting account server (port 8098)...${NC}"
(cd account-server && npm install --silent 2>/dev/null && npm run dev) &
PIDS+=($!)

# ── 3. Web portal (Vite dev server) ──
echo -e "${CYAN}Starting web portal (port 5173)...${NC}"
(cd src/client/web && npm install --silent 2>/dev/null && npm run dev) &
PIDS+=($!)

# ── 4. Transcription engine (Python, optional) ──
if [ -f src/engine/server.py ]; then
    if command -v python3 &>/dev/null; then
        echo -e "${CYAN}Starting transcription engine (port 9876)...${NC}"
        python3 src/engine/server.py &
        PIDS+=($!)
    else
        echo -e "${DIM}Skipping transcription engine (python3 not found)${NC}"
    fi
fi

# ── 5. Translation engine (Python, optional) ──
if [ -f src/translation/server.py ]; then
    if command -v python3 &>/dev/null; then
        echo -e "${CYAN}Starting translation engine (port 9877)...${NC}"
        python3 src/translation/server.py &
        PIDS+=($!)
    else
        echo -e "${DIM}Skipping translation engine (python3 not found)${NC}"
    fi
fi

echo ""
echo -e "${GREEN}Services started:${NC}"
echo -e "  Account server: ${CYAN}http://localhost:8098${NC}"
echo -e "  Web portal:     ${CYAN}http://localhost:5173${NC}"
echo -e "  Transcription:  ${CYAN}ws://localhost:9876${NC}"
echo -e "  Translation:    ${CYAN}ws://localhost:9877${NC}"
echo ""
echo -e "${DIM}Press Ctrl+C to stop all services${NC}"

wait
