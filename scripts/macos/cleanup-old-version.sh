#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
# Windy Pro — macOS Scorched Earth Uninstaller
# Removes ALL old Windy Pro app files. PRESERVES user data.
# ═══════════════════════════════════════════════════════════════════
set -e

LOG="/tmp/windy-pro-install.log"
echo "$(date '+%Y-%m-%d %H:%M:%S') [macos-cleanup] ═══ SCORCHED EARTH macOS ═══" >> "$LOG"

# ─── 1. Force-kill ALL Windy Pro processes ───
echo "Killing all Windy Pro processes..."
pkill -9 -f "Windy Pro" 2>/dev/null || true
pkill -9 -f "windy-pro" 2>/dev/null || true
pkill -9 -f "WindyPro" 2>/dev/null || true
sleep 2
# Double-tap
pkill -9 -f "Windy Pro\|windy-pro\|WindyPro" 2>/dev/null || true

# ─── 2. Remove /Applications/Windy Pro.app ───
echo "Removing application bundle..."
if [ -d "/Applications/Windy Pro.app" ]; then
  rm -rf "/Applications/Windy Pro.app"
  echo "  Removed: /Applications/Windy Pro.app" >> "$LOG"
fi
# Also check for alternative naming
for app in "/Applications/WindyPro.app" "/Applications/Windy-Pro.app"; do
  if [ -d "$app" ]; then
    rm -rf "$app"
    echo "  Removed: $app" >> "$LOG"
  fi
done

# ─── 3. PRESERVE ~/Library/Application Support/Windy Pro ───
# This contains user settings, translation memory, recordings.
# NEVER DELETE THIS.
echo "  ✅ PRESERVED: ~/Library/Application Support/Windy Pro/" >> "$LOG"
echo "  ✅ PRESERVED: ~/Library/Application Support/windy-pro/" >> "$LOG"

# ─── 4. Remove caches (safe to delete) ───
rm -rf "$HOME/Library/Caches/Windy Pro" 2>/dev/null || true
rm -rf "$HOME/Library/Caches/windy-pro" 2>/dev/null || true
rm -rf "$HOME/Library/Caches/com.thewindstorm.windy-pro" 2>/dev/null || true

# ─── 5. Remove old Python venvs ───
rm -rf "$HOME/.windy-pro/venv" 2>/dev/null || true
rm -rf "$HOME/.windy-pro/python" 2>/dev/null || true

# ─── 6. Remove LaunchAgents (autostart) ───
rm -f "$HOME/Library/LaunchAgents/com.thewindstorm.windy-pro.plist" 2>/dev/null || true

# ─── 7. Remove old CLI links ───
rm -f /usr/local/bin/windy-pro 2>/dev/null || true

# ─── 8. Verify removal ───
CLEAN=1
if [ -d "/Applications/Windy Pro.app" ]; then
  echo "  ⚠️ REMNANT: /Applications/Windy Pro.app still exists" >> "$LOG"
  CLEAN=0
fi
if pgrep -f "Windy Pro\|windy-pro" >/dev/null 2>&1; then
  echo "  ⚠️ REMNANT: Processes still running" >> "$LOG"
  CLEAN=0
fi

if [ "$CLEAN" = "1" ]; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') [macos-cleanup] ✅ Old installation completely removed" >> "$LOG"
  echo "✅ Old installation removed. User data preserved."
else
  echo "$(date '+%Y-%m-%d %H:%M:%S') [macos-cleanup] ⚠️ Some remnants remain" >> "$LOG"
  echo "⚠️ Some remnants could not be removed. Check $LOG"
fi
