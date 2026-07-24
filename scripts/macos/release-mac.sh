#!/usr/bin/env bash
# release-mac.sh — one command to turn the Windy Word macOS release ritual
# (build → sign → notarize → staple → verify) into a repeatable, CI-runnable
# step. This is the SINGLE SOURCE OF TRUTH for the pipeline; the CI workflow
# (.github/workflows/release-mac.yml) is a thin wrapper that just sets env and
# calls this. Run it locally the exact same way CI does.
#
# It deliberately STOPS at "print SHA256". The outward-facing R2 upload +
# lockbox update + announce are separate, explicitly-gated steps (see the
# runbook docs/release-pro-dmg.md §4-6) — never auto-published from here.
#
# ---------------------------------------------------------------------------
# WHY EACH STAGE EXISTS (hard-won; do not "simplify" away):
#   - package.json sets mac.identity=null → electron-builder does NOT sign the
#     .app itself; our afterPack hook (afterpack-sign-bundled.cjs → sign-bundled.sh)
#     does, because --deep can't recurse into bundled Python .whl zips or the
#     unpacked .node addons. CODESIGN_IDENTITY MUST be in the build env or the
#     .app ships unsigned ("CODESIGN_IDENTITY not set, skipping").
#   - identity=null ALSO makes electron-builder's mac.notarize=true a no-op AND
#     skips DMG-envelope signing. So the DMG envelope must be codesigned here
#     (stage 5) and submitted to notarytool here (stage 6) — manually.
#   - Stapling (stage 7) lets the app pass Gatekeeper OFFLINE (no notary
#     round-trip on first launch). spctl (stage 8) proves it.
# ---------------------------------------------------------------------------
#
# Usage:
#   scripts/macos/release-mac.sh [--arch arm64|x64|both] [--skip-build]
#                                [--skip-notarize] [--dmg PATH] [--version V]
#
# Examples:
#   scripts/macos/release-mac.sh                      # build+sign+notarize arm64
#   scripts/macos/release-mac.sh --arch both          # both arches (x64 needs
#                                                      #   the cross-compiled addon)
#   scripts/macos/release-mac.sh --skip-build         # resume: notarize+staple an
#                                                      #   already-built DMG in dist/
#   scripts/macos/release-mac.sh --skip-notarize      # build+sign only (CI dry run)
#
# Environment (all have sane defaults for this project's setup):
#   CODESIGN_IDENTITY        default "Developer ID Application: Grant Whitmer (VXZ434QL89)"
#   ENTITLEMENTS_PLIST       default build/entitlements.mac.plist
#   Notary auth — either a keychain profile (preferred, local) OR raw creds (CI):
#     NOTARY_KEYCHAIN_PROFILE  default "windy-notarize"
#     NOTARY_APPLE_ID / NOTARY_TEAM_ID / NOTARY_PASSWORD  (fallback if profile absent)
#   CSC_LINK / CSC_KEY_PASSWORD  optional .p12 to import if the identity is not
#                                already in a keychain (fresh CI runner).

set -euo pipefail

# ---------------------------------------------------------------------------
# 0. Config + arg parsing
# ---------------------------------------------------------------------------
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

CODESIGN_IDENTITY="${CODESIGN_IDENTITY:-Developer ID Application: Grant Whitmer (VXZ434QL89)}"
ENTITLEMENTS_PLIST="${ENTITLEMENTS_PLIST:-$REPO_ROOT/build/entitlements.mac.plist}"
NOTARY_KEYCHAIN_PROFILE="${NOTARY_KEYCHAIN_PROFILE:-windy-notarize}"

ARCH_SEL="arm64"      # x64 currently ships a broken (arm64-only) native addon — see below
SKIP_BUILD=0
SKIP_NOTARIZE=0
EXPLICIT_DMG=""
VERSION=""

while [ $# -gt 0 ]; do
  case "$1" in
    --arch)          ARCH_SEL="$2"; shift 2 ;;
    --skip-build)    SKIP_BUILD=1; shift ;;
    --skip-notarize) SKIP_NOTARIZE=1; shift ;;
    --dmg)           EXPLICIT_DMG="$2"; SKIP_BUILD=1; shift 2 ;;
    --version)       VERSION="$2"; shift 2 ;;
    -h|--help)       grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "release-mac: unknown arg: $1" >&2; exit 2 ;;
  esac
done

VERSION="${VERSION:-$(node -p "require('$REPO_ROOT/package.json').version")}"

case "$ARCH_SEL" in
  arm64) ARCHES=(arm64) ;;
  x64)   ARCHES=(x64) ;;
  both)  ARCHES=(x64 arm64) ;;
  *) echo "release-mac: --arch must be arm64|x64|both (got '$ARCH_SEL')" >&2; exit 2 ;;
esac

log() { printf '\n[release-mac] %s %s\n' "$(date '+%H:%M:%S')" "$*"; }
die() { echo "[release-mac] ERROR: $*" >&2; exit 1; }

# DMG electron-builder emits at dist/ root. arm64 gets the "-arm64" suffix; x64 has none.
dmg_path_for() {
  case "$1" in
    arm64) echo "$REPO_ROOT/dist/Windy Word-${VERSION}-arm64.dmg" ;;
    x64)   echo "$REPO_ROOT/dist/Windy Word-${VERSION}.dmg" ;;
  esac
}

log "version=$VERSION  arches=${ARCHES[*]}  skip_build=$SKIP_BUILD  skip_notarize=$SKIP_NOTARIZE"

# ---------------------------------------------------------------------------
# 1. Preflight — fail fast with actionable messages, never mid-build
# ---------------------------------------------------------------------------
[ "$(uname)" = "Darwin" ] || die "macOS-only: codesign/notarytool/stapler are not available off-mac."
[ -f "$ENTITLEMENTS_PLIST" ] || die "entitlements plist missing: $ENTITLEMENTS_PLIST"

# Signing identity must be resolvable. On a fresh CI runner it won't be in any
# keychain yet — import from CSC_LINK if provided.
if ! security find-identity -v -p codesigning 2>/dev/null | grep -qF "$CODESIGN_IDENTITY"; then
  if [ -n "${CSC_LINK:-}" ]; then
    log "signing identity not in keychain — importing CSC_LINK into a build keychain"
    BUILD_KEYCHAIN="$REPO_ROOT/dist/windy-build.keychain-db"
    KC_PW="$(openssl rand -hex 16 2>/dev/null || echo build-kc-pw)"
    security create-keychain -p "$KC_PW" "$BUILD_KEYCHAIN"
    security set-keychain-settings -lut 21600 "$BUILD_KEYCHAIN"
    security unlock-keychain -p "$KC_PW" "$BUILD_KEYCHAIN"
    security import "$CSC_LINK" -k "$BUILD_KEYCHAIN" -P "${CSC_KEY_PASSWORD:-}" \
      -T /usr/bin/codesign -T /usr/bin/security
    # Allow codesign to use the key without an interactive prompt.
    security set-key-partition-list -S apple-tool:,apple: -s -k "$KC_PW" "$BUILD_KEYCHAIN" >/dev/null
    # Prepend to the search list so codesign finds it.
    security list-keychains -d user -s "$BUILD_KEYCHAIN" $(security list-keychains -d user | sed 's/["[:space:]]//g')
    security find-identity -v -p codesigning "$BUILD_KEYCHAIN" | grep -qF "$CODESIGN_IDENTITY" \
      || die "imported CSC_LINK but identity '$CODESIGN_IDENTITY' still not found"
  else
    die "signing identity not found: '$CODESIGN_IDENTITY'
     Fix locally:  import the Developer ID .p12 into your login keychain.
     Fix on CI:    set CSC_LINK (path to .p12) + CSC_KEY_PASSWORD."
  fi
fi
log "signing identity OK: $CODESIGN_IDENTITY"

# Notary auth: prefer a working keychain profile; else fall back to raw creds.
NOTARY_AUTH=()
if xcrun notarytool history --keychain-profile "$NOTARY_KEYCHAIN_PROFILE" >/dev/null 2>&1; then
  NOTARY_AUTH=(--keychain-profile "$NOTARY_KEYCHAIN_PROFILE")
  log "notary auth OK: keychain profile '$NOTARY_KEYCHAIN_PROFILE'"
elif [ -n "${NOTARY_APPLE_ID:-}" ] && [ -n "${NOTARY_TEAM_ID:-}" ] && [ -n "${NOTARY_PASSWORD:-}" ]; then
  NOTARY_AUTH=(--apple-id "$NOTARY_APPLE_ID" --team-id "$NOTARY_TEAM_ID" --password "$NOTARY_PASSWORD")
  log "notary auth OK: raw Apple ID creds (team $NOTARY_TEAM_ID)"
elif [ "$SKIP_NOTARIZE" -eq 0 ]; then
  die "no usable notary auth.
     Fix locally:  xcrun notarytool store-credentials $NOTARY_KEYCHAIN_PROFILE --apple-id ... --team-id VXZ434QL89 --password <app-specific-pw>
     Fix on CI:    set NOTARY_APPLE_ID + NOTARY_TEAM_ID + NOTARY_PASSWORD.
     Or pass --skip-notarize to build+sign only."
fi

# ---------------------------------------------------------------------------
# 2-4. Build native addon → web → electron-builder (afterPack signs the .app)
# ---------------------------------------------------------------------------
if [ "$SKIP_BUILD" -eq 0 ]; then
  # x64 sanity: the Stage-7 enter_monitor.node is built for the host arch only
  # (build-enter-monitor.sh uses process.arch). On this arm64 Mac a plain x64
  # build bundles an arm64 addon → the x64 DMG is broken. Guard loudly.
  for a in "${ARCHES[@]}"; do
    if [ "$a" = "x64" ] && [ "$(node -p 'process.arch')" = "arm64" ]; then
      echo "[release-mac] WARNING: building x64 on an arm64 host. The native" >&2
      echo "  enter_monitor.node is host-arch only; the x64 DMG will contain an" >&2
      echo "  arm64 addon and fail on Intel. Cross-compile a universal .node first" >&2
      echo "  (node-gyp rebuild --arch=x64 + lipo). Proceeding — DMG will build but" >&2
      echo "  is NOT shippable to Intel Macs." >&2
    fi
  done

  log "2/8 build native Enter monitor addon"
  npm run build:enter-monitor

  log "3/8 build web SPA"
  npm run build:web

  # electron-builder emits every arch in mac.target; we build once for all
  # requested arches. Pass the signing identity into the afterPack hook env.
  EB_ARCH_FLAGS=()
  for a in "${ARCHES[@]}"; do EB_ARCH_FLAGS+=("--$a"); done

  log "4/8 electron-builder --mac ${EB_ARCH_FLAGS[*]} (afterPack signs the .app)"
  CODESIGN_IDENTITY="$CODESIGN_IDENTITY" \
    npm run gen:telemetry
  CODESIGN_IDENTITY="$CODESIGN_IDENTITY" \
    npx electron-builder --mac "${EB_ARCH_FLAGS[@]}"
else
  log "2-4/8 skip-build: using existing DMG(s)"
fi

# ---------------------------------------------------------------------------
# 5-8. Per-arch: sign DMG envelope → notarize → staple → verify → SHA256
# ---------------------------------------------------------------------------
FINAL_REPORT=()
for arch in "${ARCHES[@]}"; do
  if [ -n "$EXPLICIT_DMG" ]; then
    DMG="$EXPLICIT_DMG"
  else
    DMG="$(dmg_path_for "$arch")"
  fi
  [ -f "$DMG" ] || die "DMG not found for $arch: $DMG
     (did the build produce it? for a resume, pass --dmg PATH or check dist/)"

  log "── $arch ── $DMG"

  # --- 5. Sign the DMG envelope (electron-builder skipped this; identity=null) ---
  log "5/8 sign DMG envelope"
  codesign --force --sign "$CODESIGN_IDENTITY" --options runtime --timestamp "$DMG"
  codesign --verify --verbose=2 "$DMG" 2>&1 | tail -2

  if [ "$SKIP_NOTARIZE" -eq 1 ]; then
    log "6-7/8 skip-notarize: not submitting/stapling"
    SHA="$(shasum -a 256 "$DMG" | awk '{print $1}')"
    SZ="$(ls -l "$DMG" | awk '{print $5}')"
    FINAL_REPORT+=("$arch  SIGNED-ONLY  sha256=$SHA  bytes=$SZ  $DMG")
    continue
  fi

  # --- 6. Submit to Apple notary (blocks until Accepted/Invalid/Rejected) ---
  log "6/8 notarytool submit --wait (this can take 15-30 min for a multi-GB DMG)"
  SUBMIT_OUT="$(xcrun notarytool submit "$DMG" "${NOTARY_AUTH[@]}" --wait 2>&1)"
  echo "$SUBMIT_OUT"
  NST="$(echo "$SUBMIT_OUT" | awk -F': ' '/^  *status:/{print $2}' | tail -1)"
  if [ "$NST" != "Accepted" ]; then
    SUBID="$(echo "$SUBMIT_OUT" | awk -F': ' '/^  *id:/{print $2}' | head -1)"
    echo "[release-mac] notary status=$NST — fetching log for $SUBID" >&2
    [ -n "$SUBID" ] && xcrun notarytool log "$SUBID" "${NOTARY_AUTH[@]}" >&2 || true
    die "notarization did not pass for $arch (status=$NST)"
  fi

  # --- 7. Staple the ticket (offline Gatekeeper) ---
  log "7/8 staple"
  xcrun stapler staple "$DMG"
  xcrun stapler validate "$DMG"

  # --- 8. Gatekeeper verify + SHA256 ---
  log "8/8 spctl gatekeeper assessment"
  SPCTL_OUT="$(spctl -a -t open --context context:primary-signature -vv "$DMG" 2>&1 || true)"
  echo "$SPCTL_OUT"
  echo "$SPCTL_OUT" | grep -q "source=Notarized Developer ID" \
    || die "gatekeeper did NOT report 'source=Notarized Developer ID' for $arch — see output above"

  SHA="$(shasum -a 256 "$DMG" | awk '{print $1}')"
  SZ="$(ls -l "$DMG" | awk '{print $5}')"
  FINAL_REPORT+=("$arch  NOTARIZED+STAPLED  sha256=$SHA  bytes=$SZ  $DMG")
done

# ---------------------------------------------------------------------------
# Summary — copy the SHA256 rows into the lockbox §R2 table on release.
# ---------------------------------------------------------------------------
echo ""
echo "=========================================================================="
echo "  Windy Word ${VERSION} — macOS release artifacts"
echo "=========================================================================="
for row in "${FINAL_REPORT[@]}"; do echo "  $row"; done
echo "=========================================================================="
echo "  Next (NOT done here — outward-facing, run manually / via CI upload gate):"
echo "    • R2 upload  → docs/release-pro-dmg.md §4"
echo "    • lockbox row + announce → §6"
echo "=========================================================================="
