---
description: How to rebuild and relaunch the Windy Pro Electron desktop app after making code changes
---

# Rebuild & Relaunch Windy Pro

**IMPORTANT:** Every time you make changes to the Electron app (renderer JS, CSS, main.js, etc.), you MUST rebuild and relaunch automatically. Do NOT leave the old version running.

## Steps

// turbo-all

1. Kill any running instances:
```bash
# macOS
pkill -f "Windy Pro" 2>/dev/null; pkill -f "electron" 2>/dev/null; sleep 1
# Linux
pkill -9 -f "windy-pro" 2>/dev/null; pkill -9 -f "Windy" 2>/dev/null; sleep 1
```

2. Remove old build artifacts and rebuild:
```bash
# macOS
cd ~/windy-pro && rm -rf dist/mac* dist/*.dmg 2>/dev/null && npm run build:mac 2>&1 | tail -5
# Linux
cd ~/windy-pro && rm -f dist/*.AppImage dist/*.deb 2>/dev/null && npm run build:linux 2>&1 | tail -5
```

3. Launch the new version:
```bash
# macOS
cd ~/windy-pro && open "dist/mac/Windy Pro.app" && echo "🚀 Launched"
# Linux
cd ~/windy-pro && nohup dist/Windy\ Pro-*.AppImage --no-sandbox &>/dev/null & echo "🚀 Launched (PID: $!)"
```

## Quick Dev Mode (no rebuild needed for renderer changes)
```bash
# Both platforms — runs from source, hot-reloads renderer
cd ~/windy-pro && npx electron . --no-sandbox 2>&1
```

## Notes
- macOS: Use `open` to launch .app bundles (respects Gatekeeper)
- Linux: Always use `--no-sandbox` flag for AppImage launch
- The build takes ~60-120 seconds
- Dev mode (`npx electron .`) requires no build step for renderer changes
