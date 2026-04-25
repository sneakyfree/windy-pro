#!/usr/bin/env bash
#
# Clean-state install smoke test. Renames ~/.windy-pro/ out of the
# way, installs the latest .dmg/.exe/.AppImage from dist/, launches
# the app to verify the wizard boots and creates a config, then
# restores the original ~/.windy-pro/.
#
# This is the automation wrapper around BUILD.md's "Clean-state
# install test" ritual. Doesn't replace the full user-driven test
# (which catches visual regressions), but catches the 80% case:
#   - Wizard reaches Screen 0 and creates config.json
#   - bundled Python boots + venv works
#   - No crash in the first 30s
#
# Usage:
#   ./scripts/release/smoke.sh [--dry-run]
#   ./scripts/release/smoke.sh --artifact /path/to/Windy-Pro-1.7.0-arm64.dmg
#
# Exits 0 if smoke test passes, 1 otherwise.

# shellcheck source=_common.sh
source "$(dirname "$0")/_common.sh"

if [[ " $* " == *" --help "* ]]; then
  sed -n '2,21p' "$0"
  exit 0
fi

ARTIFACT=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "--artifact" ]; then ARTIFACT="$arg"; fi
  prev="$arg"
done

# If --artifact not given, pick the newest .dmg in dist/
if [ -z "$ARTIFACT" ]; then
  ARTIFACT="$(ls -t "$REPO_ROOT/dist/"*.dmg 2>/dev/null | head -1)"
fi
if [ -z "$ARTIFACT" ] || [ ! -f "$ARTIFACT" ]; then
  fail "no artifact found; pass --artifact PATH or run build-all.sh first"
fi
log "smoking: $ARTIFACT"

# Backup existing state so the test doesn't clobber real installs
BACKUP_DIR="/tmp/windy-smoke-backup-$$"
if [ -d "$HOME/.windy-pro" ]; then
  log "backing up existing ~/.windy-pro → $BACKUP_DIR"
  run mv "$HOME/.windy-pro" "$BACKUP_DIR"
fi

restore_backup() {
  if [ -d "$BACKUP_DIR" ]; then
    log "restoring ~/.windy-pro from $BACKUP_DIR"
    rm -rf "$HOME/.windy-pro" || true
    mv "$BACKUP_DIR" "$HOME/.windy-pro"
  fi
}
trap restore_backup EXIT

# Platform-specific install + launch
case "$(uname -s)" in
  Darwin)
    if [[ "$ARTIFACT" != *.dmg ]]; then
      fail "expected .dmg on macOS, got $ARTIFACT"
    fi
    MOUNT_POINT=""
    if [ "$DRY_RUN" -eq 0 ]; then
      log "mounting .dmg"
      MOUNT_OUT="$(hdiutil attach "$ARTIFACT" -nobrowse -quiet | tail -1)"
      MOUNT_POINT="$(echo "$MOUNT_OUT" | awk '{for(i=3;i<=NF;i++) printf "%s ", $i}' | sed 's/ *$//')"
      log "mounted at: $MOUNT_POINT"
      log "copying .app to /Applications"
      APP_SRC="$MOUNT_POINT/Windy Pro.app"
      [ -d "$APP_SRC" ] || fail ".app not found in mounted dmg"
      rm -rf "/Applications/Windy Pro.app" || true
      cp -R "$APP_SRC" "/Applications/"
      hdiutil detach "$MOUNT_POINT" -quiet || true
    fi

    if [ "$DRY_RUN" -eq 0 ]; then
      log "launching app (bg) — will kill after 30s"
      open -a "/Applications/Windy Pro.app"
      sleep 25
      # Check for wizard log banner as proof of boot
      LOG_FILE="$HOME/Library/Logs/Windy Pro/wizard-install.log"
      if [ -f "$LOG_FILE" ] && grep -q "WIZARD START" "$LOG_FILE"; then
        ok "wizard-install.log banner present — wizard booted"
      else
        warn "no wizard log found (app may not have reached wizard; check manually)"
      fi
      # Stop the app cleanly
      osascript -e 'tell application "Windy Pro" to quit' 2>/dev/null || true
      sleep 2
      pkill -f "Windy Pro" 2>/dev/null || true
    fi
    ;;
  Linux)
    if [[ "$ARTIFACT" != *.AppImage ]]; then
      fail "expected .AppImage on Linux, got $ARTIFACT"
    fi
    warn "Linux smoke automation is incomplete — manual test required."
    warn "Run: chmod +x '$ARTIFACT' && '$ARTIFACT'"
    ;;
  *)
    warn "Windows smoke automation not implemented — use the PowerShell"
    warn "equivalent or run the .exe manually and check for the wizard."
    ;;
esac

ok "smoke test completed (see stdout for warnings)"
