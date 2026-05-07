#!/bin/bash
# Kill any existing Windy Pro / Electron instances
pkill -9 -f "windy-pro" 2>/dev/null
pkill -9 -f "Windy" 2>/dev/null  
pkill -9 -f "electron" 2>/dev/null
sleep 1

# Launch Windy Pro in dev mode
cd "$(dirname "$0")"
echo "🚀 Starting Windy Pro from: $(pwd)"
echo "Node: $(node --version)"
echo "Python: $(python3 --version)"

# Launch electron app
exec npx electron . --no-sandbox
