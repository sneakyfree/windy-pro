#!/usr/bin/env bash
#
# macOS code signing + notarization wrapper around electron-builder.
# Requires these env vars (check upfront and fail clearly if missing):
#   CSC_LINK                       — path to Developer ID .p12 (or Keychain)
#   CSC_KEY_PASSWORD               — .p12 password (if using .p12 file)
#   APPLE_ID                       — Apple Developer account email
#   APPLE_APP_SPECIFIC_PASSWORD    — app-specific password (or @keychain:name)
#   APPLE_TEAM_ID                  — 10-char team id
#
# Runs electron-builder against the current version for mac-arm64 by
# default (override with --target mac-x64). Verifies codesign and
# stapler after.
#
# Usage:
#   ./scripts/release/sign-and-notarize.sh [--target mac-arm64] [--dry-run]
#
# Exits 0 on success, 1 on env missing OR signing failure.

# shellcheck source=_common.sh
source "$(dirname "$0")/_common.sh"

if [[ " $* " == *" --help "* ]]; then
  sed -n '2,20p' "$0"
  exit 0
fi

TARGET="mac-arm64"
prev=""
for arg in "$@"; do
  if [ "$prev" = "--target" ]; then TARGET="$arg"; fi
  prev="$arg"
done

case "$TARGET" in
  mac-arm64|mac-x64) ;;
  *) fail "signing is macOS-only. Use --target mac-arm64 or mac-x64." ;;
esac

if [ "$(uname -s)" != "Darwin" ]; then
  fail "must run on macOS"
fi

# ── Env-var check ─────────────────────────────────────────────────────
missing=0
check_env() {
  local var="$1" hint="$2"
  if [ -z "${!var-}" ]; then
    printf "%b✗%b env var %s not set%s\n" "$C_ERR" "$C_END" "$var" \
      "${hint:+ — $hint}" 1>&2
    missing=$((missing + 1))
  else
    printf "%b✓%b %s=%s\n" "$C_OK" "$C_END" "$var" "$(echo "${!var}" | head -c 12)…"
  fi
}
check_env CSC_LINK                    "path to Developer ID .p12"
check_env CSC_KEY_PASSWORD             "password for that .p12"
check_env APPLE_ID                     "your developer account email"
check_env APPLE_APP_SPECIFIC_PASSWORD  "create at appleid.apple.com; or use @keychain:name"
check_env APPLE_TEAM_ID                "10-char team id from developer.apple.com"
if [ "$missing" -gt 0 ]; then
  fail "missing $missing required env var(s). See RELEASE.md §4."
fi

VERSION="$(pkg_version)"
log "signing + notarizing Windy Pro $VERSION for $TARGET"

# ── Build signed + notarized .dmg via electron-builder ───────────────
case "$TARGET" in
  mac-arm64) FLAG="--arm64" ;;
  mac-x64)   FLAG="--x64" ;;
esac
run npx electron-builder --mac dmg "$FLAG" --publish never

# ── Notarize + verify ─────────────────────────────────────────────────
if [ "$DRY_RUN" -eq 0 ]; then
  # electron-builder output dir differs per arch; the product is "Windy Word".
  case "$TARGET" in
    mac-arm64) APP_DIR="$REPO_ROOT/dist/mac-arm64" ;;
    mac-x64)   APP_DIR="$REPO_ROOT/dist/mac" ;;
  esac
  APP="$APP_DIR/Windy Word.app"
  DMG="$(ls -t "$REPO_ROOT/dist/"*.dmg | head -1)"
  [ -d "$APP" ] || fail "signed .app not found at $APP"
  [ -f "$DMG" ] || fail "signed .dmg not found in dist/"

  log "codesign verify"
  codesign -dv --verbose=4 "$APP" 2>&1 | head -10
  codesign --verify --strict --verbose=2 "$APP" 2>&1 | tail -5 || fail "codesign verify failed"
  ok "codesign OK"

  # identity:null makes electron-builder skip its own signing AND its notarize
  # step, so the DMG must be notarized explicitly (same lesson as the 7-02
  # recut: EB left the dmg ticketless). notarytool scans the whole DMG.
  log "notarytool submit (this takes 5-20 min)"
  xcrun notarytool submit "$DMG" \
    --apple-id "$APPLE_ID" \
    --password "$APPLE_APP_SPECIFIC_PASSWORD" \
    --team-id "$APPLE_TEAM_ID" \
    --wait || fail "notarization failed — check notarytool log"

  log "staple DMG"
  xcrun stapler staple "$DMG" || fail "stapler staple failed"

  log "stapler validate"
  xcrun stapler validate "$DMG" || fail "stapler validate failed"
  ok "stapler: $DMG validated"

  log "gatekeeper assessment (spctl, dmg)"
  if spctl -a -t open --context context:primary-signature -vv "$DMG" 2>&1 | grep -q "accepted"; then
    ok "gatekeeper: accepted"
  else
    warn "spctl on the DMG didn't say accepted — verify by mounting and assessing the .app"
  fi
fi

ok "sign-and-notarize complete"
