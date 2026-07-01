#!/bin/bash
# Windy Word — one-line installer (FREE book-launch reader edition, FULL OFFLINE).
#
#   curl -fsSL https://downloads.windyword.ai/go.sh | bash
#
# macOS: installs the signed 4.3 GB DMG (all 7 models, fully offline) to /Applications.
# Linux: installs the 3.7 GB AppImage to ~/Applications. Fetched with curl (no quarantine),
# so macOS Gatekeeper won't block it. Safe to run before publish finishes — it waits + resumes.
set -uo pipefail
OS="$(uname)"

wait_and_get() {  # $1=url  $2=out
  local url="$1" out="$2" t=0
  until curl -fsI "$url" >/dev/null 2>&1; do
    t=$((t + 1)); [ "$t" -gt 80 ] && { echo "  Not available yet: $url — try again in a few minutes." >&2; exit 1; }
    echo "  ...build is still publishing — checking again in 15s (you can leave this running)"; sleep 15
  done
  echo "-> Downloading (~4 GB — all 7 local models, fully offline). This takes a while…"
  curl -fL --retry 8 --retry-delay 5 --retry-all-errors -C - "$url" -o "$out" \
    || { echo "  Download failed. Re-run the same command to resume." >&2; exit 1; }
}

case "$OS" in
  Darwin)
    case "$(uname -m)" in arm64) KEY="Windy-Word-Reader-arm64.dmg";; *) KEY="Windy-Word-Reader-x64.dmg";; esac
    URL="https://downloads.windyword.ai/$KEY"; TMP="$(mktemp -d)"; DMG="$TMP/WindyWord.dmg"; APP="/Applications/Windy Word.app"; MP=""
    trap '[ -n "$MP" ] && hdiutil detach "$MP" -quiet 2>/dev/null; rm -rf "$TMP"' EXIT
    echo "-> Windy Word installer (macOS)"
    wait_and_get "$URL" "$DMG"
    echo "-> Installing to /Applications…"
    MP="$(hdiutil attach "$DMG" -nobrowse -noverify | grep -o '/Volumes/.*' | head -1)"
    [ -n "$MP" ] || { echo "  Could not mount (re-run to resume)." >&2; exit 1; }
    if [ -d "$APP" ]; then rm -rf "$APP"; fi
    cp -R "$MP/Windy Word.app" /Applications/
    hdiutil detach "$MP" -quiet; MP=""
    xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true
    echo "-> Launching…"; open "$APP"
    echo "✓ Windy Word installed and starting. Press ⌘⇧Space and just talk."
    ;;
  Linux)
    KEY="Windy-Word-Reader-Offline-linux-x86_64.AppImage"; URL="https://downloads.windyword.ai/$KEY"
    DEST="$HOME/Applications"; mkdir -p "$DEST"; APP="$DEST/Windy Word.AppImage"
    echo "-> Windy Word installer (Linux)"
    wait_and_get "$URL" "$APP"; chmod +x "$APP"
    D="$HOME/.local/share/applications"; mkdir -p "$D"
    printf '[Desktop Entry]\nType=Application\nName=Windy Word\nExec=%s\nTerminal=false\nCategories=Utility;AudioVideo;\n' "$APP" > "$D/windy-word.desktop" 2>/dev/null || true
    echo "-> Launching…"
    nohup "$APP" >/dev/null 2>&1 &
    echo "✓ Windy Word installed to ~/Applications and starting. Press Ctrl+Shift+Space to dictate."
    echo "   If it doesn't open, AppImages need libfuse2:  sudo apt install -y libfuse2"
    echo "   (or run without FUSE:  \"$APP\" --appimage-extract-and-run )"
    ;;
  *)
    echo "This command installs Windy Word on macOS and Linux." >&2
    echo "On Windows, open PowerShell and run:  irm https://downloads.windyword.ai/go.ps1 | iex" >&2
    exit 1
    ;;
esac
