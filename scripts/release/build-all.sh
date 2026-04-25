#!/usr/bin/env bash
#
# Build the portable bundle + electron-builder artefact for one or
# more targets. Wraps build-portable-bundle.js + stage-portable-bundle.js
# + electron-builder into a single idempotent, dry-runnable step.
#
# Usage:
#   ./scripts/release/build-all.sh                     # host target only
#   ./scripts/release/build-all.sh --target mac-x64    # specific target
#   ./scripts/release/build-all.sh --target all        # every target
#                                                        (only those that
#                                                         can run here —
#                                                         win/linux builds
#                                                         from macOS have
#                                                         caveats)
#   ./scripts/release/build-all.sh --skip-signing      # (default — signing
#                                                        is scripts/release/
#                                                        sign-and-notarize.sh)
#   ./scripts/release/build-all.sh --dry-run           # print every step,
#                                                        run nothing

# shellcheck source=_common.sh
source "$(dirname "$0")/_common.sh"

if [[ " $* " == *" --help "* ]]; then
  sed -n '2,22p' "$0"
  exit 0
fi

TARGET=""
for i in "$@"; do :; done
# Parse --target VAL
prev=""
for arg in "$@"; do
  if [ "$prev" = "--target" ]; then TARGET="$arg"; fi
  prev="$arg"
done
if [ -z "$TARGET" ]; then TARGET="$(detect_host_target)"; fi

case "$TARGET" in
  mac-arm64|mac-x64|linux-x64|win-x64|all) ;;
  *) fail "invalid --target '$TARGET'. Use mac-arm64, mac-x64, linux-x64, win-x64, or all." ;;
esac

if [ "$TARGET" = "all" ]; then
  TARGETS=(mac-arm64 mac-x64 linux-x64 win-x64)
else
  TARGETS=("$TARGET")
fi

VERSION="$(pkg_version)"
log "Building $VERSION for: ${TARGETS[*]}"

for T in "${TARGETS[@]}"; do
  log "─── target: $T ───"

  # Skip impossible cross-builds with a clear message rather than
  # letting electron-builder fail 10 minutes in.
  HOST="$(detect_host_target)"
  if [ "$HOST" = "mac-arm64" ] && [[ "$T" == "win-x64" || "$T" == "linux-x64" ]]; then
    warn "skipping $T — cross-building from mac-arm64 is unreliable; run on matching CI runner."
    continue
  fi

  # 1. Portable bundle (Python + wheels + ffmpeg + uv + model)
  run node "$REPO_ROOT/scripts/build-portable-bundle.js" --target "$T"

  # 2. Stage into extraResources/ for electron-builder
  run node "$REPO_ROOT/scripts/stage-portable-bundle.js" --target "$T"

  # 3. electron-builder — unsigned (signing is a separate step)
  case "$T" in
    mac-arm64)  run npx electron-builder --mac dmg --arm64 --publish never ;;
    mac-x64)    run npx electron-builder --mac dmg --x64 --publish never ;;
    linux-x64)  run npx electron-builder --linux AppImage deb --x64 --publish never ;;
    win-x64)    run npx electron-builder --win nsis --x64 --publish never ;;
  esac

  ok "built $T"
done

# Show artefacts (skip in dry-run since dist/ won't have them)
if [ "$DRY_RUN" -eq 0 ]; then
  log "artefacts:"
  ls -lh "$REPO_ROOT/dist/" 2>/dev/null | awk 'NR>1 {print "  " $NF " (" $5 ")"}' || true
fi

ok "build-all complete"
