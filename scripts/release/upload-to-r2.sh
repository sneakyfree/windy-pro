#!/usr/bin/env bash
#
# Upload a signed + notarized Windy Word .dmg to the Cloudflare R2
# bucket `windyword-releases`, served publicly at downloads.windyword.ai.
#
# Distribution pattern is canonical per `reference_r2_desktop_distribution_pattern`:
#   <product>-releases bucket + downloads.<product-domain> custom subdomain.
#
# Usage:
#   ./scripts/release/upload-to-r2.sh <path/to/Windy-Word-1.6.2-arm64-signed.dmg>
#   ./scripts/release/upload-to-r2.sh --target-name Windy-Word-1.6.2-arm64.dmg <path>
#   ./scripts/release/upload-to-r2.sh --dry-run <path>
#
# What it does:
#   1. Verifies the .dmg exists + is non-empty
#   2. Verifies the .dmg is signed + notarized + stapled via `spctl --assess`
#   3. Determines architecture from filename (-arm64 or -x64; --arch overrides)
#   4. Reads version from windy-pro/package.json
#   5. Uploads to s3://windyword-releases/Windy-Word-<version>-<arch>.dmg
#      with `Content-Type: application/octet-stream` and a 1-hour Cache-Control
#      (long enough to be cheap, short enough that rollbacks propagate quickly)
#   6. Curl-HEADs the public URL to confirm HTTP 200 + matching Content-Length
#   7. Prints a summary block with the download URL and SHA256
#
# Required env (one of):
#   - AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY exported (R2 S3-keypair scope)
#   - or ~/.aws/credentials with a [windyword-r2] profile
#
# R2 keys live in lockbox §"R2 Distribution Buckets — Windy Desktop App Releases"
# (the `windycloud-userdata` keypair, "Apply to all buckets" scope).

# shellcheck source=_common.sh
source "$(dirname "$0")/_common.sh"

if [[ " $* " == *" --help "* ]]; then
  sed -n '2,40p' "$0"
  exit 0
fi

# ── Argument parsing ─────────────────────────────────────────────────────
DMG=""
TARGET_NAME=""
ARCH_OVERRIDE=""
prev=""
for arg in "$@"; do
  case "$prev" in
    --target-name) TARGET_NAME="$arg"; prev=""; continue ;;
    --arch)        ARCH_OVERRIDE="$arg"; prev=""; continue ;;
  esac
  case "$arg" in
    --target-name|--arch) prev="$arg" ;;
    --dry-run)            ;;  # consumed by _common.sh
    --*)                  fail "unknown flag: $arg (run with --help)" ;;
    *)                    DMG="$arg" ;;
  esac
done
[ -n "$DMG" ] || fail "usage: $0 <path-to-signed-dmg> [--target-name NAME] [--arch arm64|x64] [--dry-run]"

# ── Config ───────────────────────────────────────────────────────────────
R2_BUCKET="windyword-releases"
R2_ENDPOINT="https://193b347aedeaafe35de0b5a534b2d9aa.r2.cloudflarestorage.com"
PUBLIC_HOST="downloads.windyword.ai"
CACHE_CONTROL="public, max-age=3600"  # 1h — short enough that rollback propagates fast

# ── Step 1: Verify the .dmg exists + is real ────────────────────────────
[ -f "$DMG" ] || fail "file not found: $DMG"
SIZE_BYTES="$(stat -f%z "$DMG" 2>/dev/null || stat -c%s "$DMG" 2>/dev/null)"
[ "${SIZE_BYTES:-0}" -gt 1048576 ] || fail ".dmg is suspiciously small ($SIZE_BYTES bytes); aborting"
log "source: $DMG ($((SIZE_BYTES / 1024 / 1024)) MB)"

# ── Step 2: Verify signed + notarized + stapled ─────────────────────────
# `spctl --assess --type open --context context:primary-signature` is the
# Gatekeeper check Apple itself runs on first open. If this passes, the
# .dmg is fully signed + notarized + ticket-stapled.
if [ "$(uname -s)" = "Darwin" ]; then
  log "verifying Gatekeeper acceptance (spctl --assess)"
  if SPCTL_OUT="$(spctl -a -t open --context context:primary-signature -vv "$DMG" 2>&1)"; then
    if echo "$SPCTL_OUT" | grep -qE "(accepted|source=Notarized Developer ID)"; then
      ok "Gatekeeper: accepted, Notarized Developer ID"
    else
      warn "spctl returned success but couldn't find 'accepted' marker:"
      echo "$SPCTL_OUT" | sed 's/^/    /'
      fail "refusing to upload an artifact whose notarization status is unclear"
    fi
  else
    echo "$SPCTL_OUT" | sed 's/^/    /'
    fail "Gatekeeper rejected the .dmg — not signed/notarized/stapled. Run scripts/release/sign-and-notarize.sh first, then ~/notarize-work/finalize-notarized-dmg.sh to staple."
  fi
else
  warn "non-Darwin host: skipping spctl verification (no Gatekeeper). Run this script from macOS for full safety."
fi

# ── Step 3: Determine architecture ──────────────────────────────────────
if [ -n "$ARCH_OVERRIDE" ]; then
  ARCH="$ARCH_OVERRIDE"
elif [[ "$DMG" == *"-arm64"* ]]; then
  ARCH="arm64"
elif [[ "$DMG" == *"-x64"* ]] || [[ "$DMG" == *"-intel"* ]]; then
  ARCH="x64"
else
  fail "could not infer architecture from filename. Pass --arch arm64 or --arch x64."
fi
case "$ARCH" in
  arm64|x64) ;;
  *) fail "invalid --arch '$ARCH'. Use arm64 or x64." ;;
esac
log "arch: $ARCH"

# ── Step 4: Build the canonical target name ─────────────────────────────
VERSION="$(pkg_version)"
if [ -z "$TARGET_NAME" ]; then
  TARGET_NAME="Windy-Word-${VERSION}-${ARCH}.dmg"
fi
log "target: s3://$R2_BUCKET/$TARGET_NAME  →  https://$PUBLIC_HOST/$TARGET_NAME"

# ── Step 5: SHA256 (local) ──────────────────────────────────────────────
log "computing local SHA256"
LOCAL_SHA="$(shasum -a 256 "$DMG" | awk '{print $1}')"
ok "sha256: $LOCAL_SHA"

# ── Step 6: Auth check ──────────────────────────────────────────────────
if [ -z "${AWS_ACCESS_KEY_ID:-}" ] || [ -z "${AWS_SECRET_ACCESS_KEY:-}" ]; then
  if grep -q '^\[windyword-r2\]' "$HOME/.aws/credentials" 2>/dev/null; then
    export AWS_PROFILE=windyword-r2
    log "using AWS_PROFILE=windyword-r2 from ~/.aws/credentials"
  else
    fail "no R2 credentials. Export AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY (R2 S3 keypair from lockbox §'R2 Distribution Buckets — Windy Desktop App Releases'), or add a [windyword-r2] profile to ~/.aws/credentials."
  fi
fi
command -v aws >/dev/null 2>&1 || fail "aws-cli not installed. brew install awscli"

# ── Step 7: Upload ──────────────────────────────────────────────────────
log "uploading to R2"
run aws s3 cp "$DMG" "s3://$R2_BUCKET/$TARGET_NAME" \
  --endpoint-url "$R2_ENDPOINT" \
  --content-type application/octet-stream \
  --cache-control "$CACHE_CONTROL" \
  --metadata "sha256=$LOCAL_SHA,version=$VERSION,arch=$ARCH"

# ── Step 8: Verify via public URL ───────────────────────────────────────
if [ "$DRY_RUN" -eq 0 ]; then
  log "verifying public URL responds 200 + correct size"
  # CF cache may serve a stale 404 for ~30s on a freshly-uploaded object.
  # Retry up to 6x with 5s sleep before giving up.
  PUBLIC_URL="https://$PUBLIC_HOST/$TARGET_NAME"
  REMOTE_HEADERS=""
  for attempt in 1 2 3 4 5 6; do
    REMOTE_HEADERS="$(curl -sSI "$PUBLIC_URL" 2>&1 || true)"
    STATUS_LINE="$(echo "$REMOTE_HEADERS" | head -1 | tr -d '\r')"
    if echo "$STATUS_LINE" | grep -qE "200"; then break; fi
    log "attempt $attempt/6: $STATUS_LINE — retrying in 5s"
    sleep 5
  done

  echo "$STATUS_LINE" | grep -qE "200" || {
    echo "$REMOTE_HEADERS" | sed 's/^/    /'
    fail "public URL did not return 200 after upload"
  }

  REMOTE_LEN="$(echo "$REMOTE_HEADERS" | awk -F': ' 'tolower($1)=="content-length"{print $2}' | tr -d '\r' | tail -1)"
  if [ -z "$REMOTE_LEN" ]; then
    warn "couldn't parse Content-Length from response — skipping size verification"
  elif [ "$REMOTE_LEN" = "$SIZE_BYTES" ]; then
    ok "Content-Length matches: $REMOTE_LEN bytes"
  else
    fail "Content-Length mismatch: local=$SIZE_BYTES remote=$REMOTE_LEN — upload may be incomplete"
  fi
fi

# ── Summary ──────────────────────────────────────────────────────────────
echo
echo "─── UPLOAD COMPLETE ─────────────────────────────────────────────"
echo "  version    : $VERSION"
echo "  arch       : $ARCH"
echo "  size       : $((SIZE_BYTES / 1024 / 1024)) MB"
echo "  sha256     : $LOCAL_SHA"
echo "  bucket-key : s3://$R2_BUCKET/$TARGET_NAME"
echo "  public-url : https://$PUBLIC_HOST/$TARGET_NAME"
echo "─────────────────────────────────────────────────────────────────"

ok "upload-to-r2 complete"
