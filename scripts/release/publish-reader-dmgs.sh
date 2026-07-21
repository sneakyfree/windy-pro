#!/usr/bin/env bash
# Publish the notarized Reader DMGs (arm64 + x64) to R2 as the canonical download.
# REVERSIBLE: archives the current-live builds before overwriting. Sources R2 creds
# from ~/.windy-r2.env (gitignored). Requires BOTH notarized DMGs present + stapled.
set -euo pipefail
cd "$(dirname "$0")/../.."
# shellcheck disable=SC1090
source "$HOME/.windy-r2.env"
S3=(aws s3 --endpoint-url "$R2_ENDPOINT")
CT="application/x-apple-diskimage"
STAMP="20260606"

ARM="dist/Windy Word-1.7.0-arm64.dmg"
X64="dist/Windy Word-1.7.0.dmg"
[ -f "$ARM" ] || { echo "✗ missing arm64 DMG: $ARM"; exit 1; }
[ -f "$X64" ] || X64="$(ls -t dist/*.dmg | grep -vE 'arm64|universal|1\.6' | head -1)"
[ -f "$X64" ] || { echo "✗ missing x64 DMG"; exit 1; }

echo "═══ 0. Pre-publish gate: both DMGs notarized + stapled ═══"
for d in "$ARM" "$X64"; do
  xcrun stapler validate "$d" >/dev/null 2>&1 || { echo "✗ not stapled: $d"; exit 1; }
  spctl -a -t open --context context:primary-signature "$d" >/dev/null 2>&1 || { echo "✗ gatekeeper reject: $d"; exit 1; }
  echo "  ✓ stapled + gatekeeper-accepted: $(basename "$d") ($(du -h "$d"|cut -f1))"
done

echo "═══ 1. Archive current-live builds (rollback safety) ═══"
for arch in arm64 x64; do
  src="$R2_BUCKET/Windy-Word-$arch.dmg"
  if "${S3[@]}" ls "$src" >/dev/null 2>&1; then
    "${S3[@]}" cp "$src" "$R2_BUCKET/archive/Windy-Word-prev-$arch-$STAMP.dmg"
    echo "  ✓ archived previous $arch → archive/Windy-Word-prev-$arch-$STAMP.dmg"
  else
    echo "  (no current $arch to archive)"
  fi
done

echo "═══ 2. Upload Reader builds → canonical + book + versioned names ═══"
up() { "${S3[@]}" cp "$1" "$R2_BUCKET/$2" --content-type "$CT"; echo "    → $2"; }
echo "  arm64 ($(du -h "$ARM"|cut -f1)):"
up "$ARM" "Windy-Word-arm64.dmg"
up "$ARM" "Windy-Word-Reader-arm64.dmg"
up "$ARM" "archive/Windy-Word-1.7.0-reader-arm64.dmg"
echo "  x64 ($(du -h "$X64"|cut -f1)):"
up "$X64" "Windy-Word-x64.dmg"
up "$X64" "Windy-Word-Reader-x64.dmg"
up "$X64" "archive/Windy-Word-1.7.0-reader-x64.dmg"

echo "═══ 3. Verify live (HTTP 200 + size) ═══"
for f in Windy-Word-arm64.dmg Windy-Word-x64.dmg Windy-Word-Reader-arm64.dmg Windy-Word-Reader-x64.dmg; do
  curl -sS -o /dev/null -w "  $f → HTTP %{http_code}  %{size_download} bytes\n" "https://downloads.windyword.ai/$f"
done
echo "✅ PUBLISHED — Reader (all-7-engine, offline) is now the canonical Windy Word download."
