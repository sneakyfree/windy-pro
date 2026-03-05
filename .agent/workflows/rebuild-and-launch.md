---
description: How to rebuild and relaunch the Windy Pro Electron desktop app after making code changes
---

# Rebuild & Relaunch Windy Pro

**IMPORTANT:** Every time you make changes to the Electron app (renderer JS, CSS, main.js, etc.), you MUST rebuild and relaunch automatically. Do NOT leave the old version running.

## Steps

// turbo-all

1. Kill any running instances:
```bash
pkill -9 -f "windy-pro" 2>/dev/null; pkill -9 -f "Windy" 2>/dev/null; sleep 1
```

2. Remove old build artifacts and rebuild:
```bash
cd /home/sneakyfree/windy-pro && rm -f dist/*.AppImage dist/*.deb 2>/dev/null && npm run build:linux 2>&1 | tail -5
```

3. Launch the new version:
```bash
cd /home/sneakyfree/windy-pro && nohup dist/Windy\ Pro-*.AppImage --no-sandbox &>/dev/null & echo "🚀 Launched (PID: $!)"
```

## Combined One-Liner
For efficiency, combine all steps into one command:
```bash
cd /home/sneakyfree/windy-pro && pkill -9 -f "windy-pro" 2>/dev/null; pkill -9 -f "Windy" 2>/dev/null; sleep 1 && rm -f dist/*.AppImage dist/*.deb 2>/dev/null && npm run build:linux 2>&1 | tail -5 && echo "---" && nohup dist/Windy\ Pro-*.AppImage --no-sandbox &>/dev/null & echo "🚀 Launched (PID: $!)"
```

## Notes
- Always use `--no-sandbox` flag for AppImage launch
- The build takes ~60-90 seconds
- Always confirm the launch PID is returned before reporting success
