#!/bin/bash
# Windy Word — one-line installer for the FREE book-launch reader edition.
#
#   curl -fsSL https://downloads.windyword.ai/go.sh | bash
#
# Downloads the signed Windy Word .dmg for this Mac's chip, installs it to
# /Applications, and launches it. Fetched with curl (not a browser), so it carries
# no com.apple.quarantine flag — Gatekeeper's notarization check never fires and the
# Developer-ID signature is enough to run cleanly. Safe to run even if the build is
# still being published: it waits, then downloads (resuming on any network hiccup).
set -uo pipefail

if [ "$(uname)" != "Darwin" ]; then
  echo "Windy Word installs on macOS only right now. (Windows & Linux builds coming soon.)" >&2
  exit 1
fi

case "$(uname -m)" in
  arm64) KEY="Windy-Word-Reader-arm64.dmg" ;;   # Apple Silicon (M1/M2/M3/M4)
  *)     KEY="Windy-Word-Reader-x64.dmg"   ;;   # Intel
esac
URL="https://downloads.windyword.ai/$KEY"

TMP="$(mktemp -d)"
DMG="$TMP/WindyWord.dmg"
APP="/Applications/Windy Word.app"
MP=""
cleanup() { [ -n "$MP" ] && hdiutil detach "$MP" -quiet 2>/dev/null; rm -rf "$TMP"; }
trap cleanup EXIT

echo "→ Windy Word installer"

# Wait until the build is published (handles running this the moment you get the link).
tries=0
until curl -fsI "$URL" >/dev/null 2>&1; do
  tries=$((tries + 1))
  if [ "$tries" -gt 80 ]; then
    echo "  The build isn't available yet ($URL). Please try again in a few minutes." >&2
    exit 1
  fi
  echo "  …build is still publishing — checking again in 15s (you can leave this running)"
  sleep 15
done

echo "→ Downloading Windy Word (~4 GB — all 7 local models, fully offline). This takes a while…"
# --retry + -C - = resume and retry, so a dropped connection won't restart the 4 GB from scratch.
curl -fL --retry 8 --retry-delay 5 --retry-all-errors -C - "$URL" -o "$DMG" \
  || { echo "Download failed. Re-run the same command to resume." >&2; exit 1; }

echo "→ Installing to /Applications…"
MP="$(hdiutil attach "$DMG" -nobrowse -noverify | grep -o '/Volumes/.*' | head -1)"
[ -n "$MP" ] || { echo "Could not mount the disk image (download may be incomplete — re-run to resume)." >&2; exit 1; }
if [ -d "$APP" ]; then rm -rf "$APP"; fi
cp -R "$MP/Windy Word.app" /Applications/
hdiutil detach "$MP" -quiet; MP=""
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true   # belt-and-suspenders

echo "→ Launching…"
open "$APP"
echo "✓ Windy Word is installed and starting. Press ⌘⇧Space and just talk."
