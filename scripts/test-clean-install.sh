#!/usr/bin/env bash
#
# test-clean-install.sh
#
# Runs the gold-standard "fresh user install" verification:
#   1. Backs up your existing Windy Pro state safely
#   2. Lets you install the new .dmg as if you'd never used the app before
#   3. You manually run through the wizard + verify transcription
#   4. Restores your original state, byte-for-byte
#
# Usage:
#   scripts/test-clean-install.sh prepare        # backup + open .dmg
#   scripts/test-clean-install.sh status         # show current backup state
#   scripts/test-clean-install.sh restore        # restore from backup
#   scripts/test-clean-install.sh emergency-restore <backup-dir>
#                                                # restore even if state file lost
#
# Designed to be FAILSAFE:
#   - Backup uses mv (atomic, fast, single-disk-usage)
#   - Refuses to clobber an existing backup
#   - Refuses to restore over a state mid-install
#   - Logs every action with absolute paths
#   - Prints exactly where your data went so you can recover manually if needed
#

set -euo pipefail

# ─── Paths ────────────────────────────────────────────────────────────────

readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly STATE_FILE="$REPO_ROOT/.test-clean-install-state"
readonly BACKUP_ROOT="$HOME/.windy-pro-test-backups"

readonly WINDY_DIR="$HOME/.windy-pro"
readonly USER_DATA_DEV="$HOME/Library/Application Support/windy-pro"
readonly USER_DATA_PROD="$HOME/Library/Application Support/Windy Pro"
readonly INSTALLED_APP="/Applications/Windy Pro.app"

# Find the most recent .dmg in dist/
readonly DMG_PATH="$(ls -t "$REPO_ROOT/dist/"*.dmg 2>/dev/null | head -1 || true)"

# ─── Pretty output ────────────────────────────────────────────────────────

c_green="\033[32m"
c_yellow="\033[33m"
c_red="\033[31m"
c_blue="\033[34m"
c_dim="\033[2m"
c_reset="\033[0m"

log()  { echo -e "${c_blue}▸${c_reset} $*"; }
ok()   { echo -e "${c_green}✓${c_reset} $*"; }
warn() { echo -e "${c_yellow}⚠${c_reset} $*"; }
err()  { echo -e "${c_red}✗${c_reset} $*" >&2; }
hdr()  { echo; echo -e "${c_blue}═══ $* ═══${c_reset}"; }

# ─── Subcommand: prepare ──────────────────────────────────────────────────

cmd_prepare() {
  hdr "PREPARING CLEAN-STATE INSTALL TEST"

  # 1. Refuse if a previous test is in progress
  if [ -f "$STATE_FILE" ]; then
    err "A test is already in progress. State file exists at:"
    err "  $STATE_FILE"
    echo
    err "Either run '$0 restore' to finish the previous test,"
    err "or '$0 status' to see what state you're in."
    exit 2
  fi

  # 2. Verify .dmg exists
  if [ -z "${DMG_PATH:-}" ] || [ ! -f "$DMG_PATH" ]; then
    err "No .dmg found in $REPO_ROOT/dist/"
    err "Run a build first: CSC_IDENTITY_AUTO_DISCOVERY=false npm run build:mac"
    exit 1
  fi
  log "Will install: $DMG_PATH"
  log "             ($(du -sh "$DMG_PATH" | cut -f1))"

  # 3. Check for running Windy processes — backup is unsafe if app is writing
  local pids
  pids="$(pgrep -f "Windy Pro\\|windy-pro" 2>/dev/null | grep -v $$ || true)"
  if [ -n "$pids" ]; then
    warn "Windy Pro processes are running:"
    pgrep -fl "Windy Pro\\|windy-pro" | grep -v $$ | head -10
    echo
    read -p "Kill them before proceeding? [y/N] " -n 1 -r REPLY
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      err "Cannot proceed with running Windy Pro processes — backup would be inconsistent."
      exit 1
    fi
    pkill -f "Windy Pro" 2>/dev/null || true
    pkill -f "windy-pro" 2>/dev/null || true
    sleep 1
    log "Killed Windy Pro processes"
  fi

  # 4. Disk space sanity check
  local needed_kb available_kb
  needed_kb=$(du -sk "$WINDY_DIR" 2>/dev/null | cut -f1 || echo 0)
  available_kb=$(df -k "$HOME" | awk 'NR==2 {print $4}')
  if [ "$needed_kb" -gt "$available_kb" ]; then
    err "Not enough disk space. Need ${needed_kb}K, have ${available_kb}K available."
    exit 1
  fi

  # 5. Create backup directory
  local stamp backup_dir
  stamp="$(date +%Y%m%d-%H%M%S)"
  backup_dir="$BACKUP_ROOT/$stamp"
  mkdir -p "$backup_dir"
  ok "Backup dir: $backup_dir"

  # 6. Move (not copy) state into backup — atomic + fast + no double disk usage
  local moved=()

  if [ -d "$WINDY_DIR" ]; then
    log "Moving $WINDY_DIR → $backup_dir/dot-windy-pro"
    mv "$WINDY_DIR" "$backup_dir/dot-windy-pro"
    moved+=("dot-windy-pro|$WINDY_DIR")
    ok "  (was $(du -sh "$backup_dir/dot-windy-pro" | cut -f1))"
  else
    log "$WINDY_DIR does not exist — nothing to back up there"
  fi

  if [ -d "$USER_DATA_DEV" ]; then
    log "Moving $USER_DATA_DEV → $backup_dir/userdata-dev"
    mv "$USER_DATA_DEV" "$backup_dir/userdata-dev"
    moved+=("userdata-dev|$USER_DATA_DEV")
    ok "  (was $(du -sh "$backup_dir/userdata-dev" | cut -f1))"
  fi

  if [ -d "$USER_DATA_PROD" ]; then
    log "Moving $USER_DATA_PROD → $backup_dir/userdata-prod"
    mv "$USER_DATA_PROD" "$backup_dir/userdata-prod"
    moved+=("userdata-prod|$USER_DATA_PROD")
    ok "  (was $(du -sh "$backup_dir/userdata-prod" | cut -f1))"
  fi

  if [ -d "$INSTALLED_APP" ]; then
    log "Backing up existing /Applications/Windy Pro.app → $backup_dir/installed-app/"
    mkdir -p "$backup_dir/installed-app"
    cp -R "$INSTALLED_APP" "$backup_dir/installed-app/"
    moved+=("installed-app|$INSTALLED_APP")
    ok "  (was $(du -sh "$backup_dir/installed-app" | cut -f1))"
  fi

  # 7. Write state file (so 'restore' knows where everything went)
  {
    echo "stamp=$stamp"
    echo "backup_dir=$backup_dir"
    echo "dmg_path=$DMG_PATH"
    echo "started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "moved_count=${#moved[@]}"
    printf 'moved=%s\n' "${moved[@]}"
  } > "$STATE_FILE"
  ok "Wrote state file: $STATE_FILE"

  # 8. Tell the user exactly what to do next
  hdr "READY FOR CLEAN INSTALL TEST"
  echo
  echo "Your Windy Pro state has been moved to:"
  echo -e "  ${c_dim}$backup_dir${c_reset}"
  echo
  echo -e "${c_yellow}From the system's perspective, you have NEVER installed Windy Pro before.${c_reset}"
  echo
  echo "Next steps (do these manually):"
  echo
  echo "  1. The .dmg will open in 3 seconds. When it does:"
  echo "     - Drag 'Windy Pro.app' to the Applications folder"
  echo "     - Eject the disk image"
  echo
  echo "  2. Launch Windy Pro from /Applications:"
  echo "     open '/Applications/Windy Pro.app'"
  echo
  echo "  3. Watch what happens carefully:"
  echo "     - Does the wizard appear?"
  echo "     - Does it complete in under 60 seconds?"
  echo "     - Does it ask for microphone permission?"
  echo "     - Does the main app launch and show 'READY'?"
  echo "     - Does Cmd+Shift+Space record + transcribe + paste?"
  echo
  echo "  4. When you're DONE testing (could be in 5 min, 5 hours, or tomorrow):"
  echo -e "     ${c_green}$0 restore${c_reset}"
  echo
  echo "  Your original state is safe. If anything goes wrong, run:"
  echo -e "     ${c_green}$0 emergency-restore '$backup_dir'${c_reset}"
  echo
  sleep 3
  open "$DMG_PATH"
}

# ─── Subcommand: status ───────────────────────────────────────────────────

cmd_status() {
  hdr "TEST STATUS"
  if [ ! -f "$STATE_FILE" ]; then
    ok "No test in progress."
    echo
    echo "Available backups in $BACKUP_ROOT:"
    if [ -d "$BACKUP_ROOT" ]; then
      ls -lh "$BACKUP_ROOT" | tail -n +2
    else
      echo "  (none)"
    fi
    return 0
  fi

  warn "A test is currently in progress."
  echo
  cat "$STATE_FILE"
  echo
  echo "Original state lives in the backup_dir above."
  echo "Currently on disk at the live paths:"
  for p in "$WINDY_DIR" "$USER_DATA_DEV" "$USER_DATA_PROD" "$INSTALLED_APP"; do
    if [ -e "$p" ]; then
      echo "  EXISTS: $p ($(du -sh "$p" 2>/dev/null | cut -f1))"
    else
      echo "  empty:  $p"
    fi
  done
  echo
  echo "When done, run: $0 restore"
}

# ─── Subcommand: restore ──────────────────────────────────────────────────

cmd_restore() {
  hdr "RESTORING ORIGINAL STATE"
  if [ ! -f "$STATE_FILE" ]; then
    err "No state file at $STATE_FILE"
    err "If you remember where the backup is, run:"
    err "  $0 emergency-restore <backup-dir>"
    exit 2
  fi

  # shellcheck disable=SC1090
  source "$STATE_FILE"

  if [ ! -d "$backup_dir" ]; then
    err "Backup dir doesn't exist: $backup_dir"
    err "State file is corrupt or backup was deleted."
    exit 2
  fi

  log "Restoring from: $backup_dir"

  # Kill any running test app first
  local pids
  pids="$(pgrep -f "Windy Pro\\|windy-pro" 2>/dev/null | grep -v $$ || true)"
  if [ -n "$pids" ]; then
    warn "Windy Pro is running. Killing it first..."
    pkill -f "Windy Pro" 2>/dev/null || true
    pkill -f "windy-pro" 2>/dev/null || true
    sleep 2
  fi

  do_restore "$backup_dir"

  rm -f "$STATE_FILE"
  ok "State file removed. Test complete."
  echo
  echo "Your original state is restored. Backup remains at:"
  echo "  $backup_dir"
  echo
  echo "To delete the backup once you're confident:"
  echo "  rm -rf '$backup_dir'"
}

# ─── Subcommand: emergency-restore ────────────────────────────────────────

cmd_emergency_restore() {
  local backup_dir="${1:-}"
  if [ -z "$backup_dir" ]; then
    err "Usage: $0 emergency-restore <backup-dir>"
    err "Available backups:"
    ls -lh "$BACKUP_ROOT" 2>/dev/null | tail -n +2 || echo "  (none)"
    exit 1
  fi
  if [ ! -d "$backup_dir" ]; then
    err "Backup dir doesn't exist: $backup_dir"
    exit 1
  fi

  hdr "EMERGENCY RESTORE FROM $backup_dir"
  warn "This will overwrite any current Windy Pro state."
  read -p "Continue? [y/N] " -n 1 -r REPLY
  echo
  [[ $REPLY =~ ^[Yy]$ ]] || { err "Aborted."; exit 1; }

  do_restore "$backup_dir"
  rm -f "$STATE_FILE"
  ok "Emergency restore complete."
}

# ─── Internal: do_restore — actual restore logic ──────────────────────────

do_restore() {
  local backup_dir="$1"

  # Helper: remove existing target then move backup → target
  restore_one() {
    local backup_subdir="$1"
    local target_path="$2"
    local label="$3"

    local src="$backup_dir/$backup_subdir"
    if [ ! -e "$src" ]; then
      log "$label: nothing in backup, skipping"
      return
    fi

    if [ -e "$target_path" ]; then
      log "$label: removing test-created $target_path"
      rm -rf "$target_path"
    fi

    log "$label: restoring $src → $target_path"
    mkdir -p "$(dirname "$target_path")"

    # For installed-app, the backup is a folder containing Windy Pro.app
    if [ "$backup_subdir" = "installed-app" ]; then
      if [ -d "$src/Windy Pro.app" ]; then
        cp -R "$src/Windy Pro.app" "$target_path"
        ok "$label: restored"
      fi
    else
      mv "$src" "$target_path"
      ok "$label: restored"
    fi
  }

  restore_one "dot-windy-pro" "$WINDY_DIR" "Wizard app dir"
  restore_one "userdata-dev"  "$USER_DATA_DEV" "Dev userdata"
  restore_one "userdata-prod" "$USER_DATA_PROD" "Prod userdata"
  restore_one "installed-app" "$INSTALLED_APP" "Installed .app"
}

# ─── Dispatch ─────────────────────────────────────────────────────────────

case "${1:-}" in
  prepare)            cmd_prepare ;;
  status)             cmd_status ;;
  restore)            cmd_restore ;;
  emergency-restore)  cmd_emergency_restore "${2:-}" ;;
  *)
    cat <<EOF
Usage: $0 <command>

Commands:
  prepare              Backup state + open .dmg for clean-install testing
  status               Show whether a test is in progress
  restore              Restore your original state (run when done testing)
  emergency-restore <backup-dir>
                       Restore even if state file is missing or corrupt

Backups are stored in: $BACKUP_ROOT
State file:            $STATE_FILE
EOF
    exit 1
    ;;
esac
