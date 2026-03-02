#!/bin/bash
# Windy Pro — Strand H Server Startup
# Run this to start/restart the account server and web frontend
set -e

echo "🌪️  Windy Pro — Starting Strand H Services"
echo "============================================"

# Kill existing processes (pkill works better than lsof in congested sessions)
echo "→ Clearing old processes..."
pkill -f "account-server/server.js" 2>/dev/null && echo "  Killed old account server" || echo "  No old account server"
pkill -f "vite" 2>/dev/null && echo "  Killed old Vite" || echo "  No old Vite"
sleep 1

# Resolve script directory
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Start account server (H1 + H2)
echo ""
echo "→ Starting Account Server on :8098..."
cd "$PROJECT_DIR/services/account-server"
nohup node server.js > /tmp/windy-account-server.log 2>&1 &
ACCOUNT_PID=$!
sleep 2

# Health check
if curl -sf http://localhost:8098/health > /dev/null 2>&1; then
    echo "  ✅ Account Server running (PID: $ACCOUNT_PID)"
else
    echo "  ❌ Account Server failed! Check /tmp/windy-account-server.log"
    tail -5 /tmp/windy-account-server.log 2>/dev/null
    exit 1
fi

# Start Vite dev server (H3 + H5 + H6)
echo ""
echo "→ Starting Vite Dev Server..."
cd "$PROJECT_DIR/src/client/web"
nohup npx vite --host > /tmp/windy-vite-dev.log 2>&1 &
VITE_PID=$!
sleep 3

echo "  ⏳ Vite starting (PID: $VITE_PID)"

echo ""
echo "============================================"
echo "🚀 Services Running:"
echo "   Account Server → http://localhost:8098"
echo "   Web Frontend   → http://localhost:5173 (or :5174)"
echo ""
echo "📋 Test Flow:"
echo "   1. Open http://localhost:5173"
echo "   2. Click 'Sign In' → Register"
echo "   3. After login → Dashboard at /dashboard"
echo "   4. Click '🧬 Soul File' → /soul-file"
echo ""
echo "📝 Logs:"
echo "   tail -f /tmp/windy-account-server.log"
echo "   tail -f /tmp/windy-vite-dev.log"
echo "============================================"
