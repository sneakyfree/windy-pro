#!/usr/bin/env bash
# Unattended: build + sign + notarize the Reader-edition x64 (Intel) DMG with all 7
# lean engines bundled OFFLINE. Reuses the cached x64 portable bundle (python+wheels,
# ctranslate2 4.7.1 — large-v3/128-mel capable) and the arch-independent model dir.
# Sources notary creds from ~/.windy-notary.env (gitignored).
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT="$(pwd)"
# shellcheck disable=SC1090
source "$HOME/.windy-notary.env"
VENV="$HOME/.windy-pro/venv/bin/python3"
X64="bundled-portable/mac-x64"

echo "═══ 1. Swap arch payloads → x64 (models are arch-independent, kept as-is) ═══"
for sub in python wheels ffmpeg; do
  [ -d "$X64/$sub" ] || { echo "✗ missing $X64/$sub — run build-portable-bundle.js --target mac-x64"; exit 1; }
  rm -rf "extraResources/$sub"; cp -R "$X64/$sub" "extraResources/$sub"
  echo "  ✓ extraResources/$sub ← x64"
done
file extraResources/python/bin/python3.11 | grep -q "x86_64" \
  && echo "  ✓ bundled python is x86_64" \
  || { echo "✗ bundled python is NOT x86_64:"; file extraResources/python/bin/python3.11; exit 1; }

echo "═══ 1.6 Generate wheel integrity manifest (CHECKSUMS.sha256) ═══"
( cd extraResources/wheels && shasum -a 256 *.whl > CHECKSUMS.sha256 ) \
  && echo "  ✓ $(grep -c . extraResources/wheels/CHECKSUMS.sha256) wheel checksums written"

echo "═══ 1.5 Ensure 128-mel preprocessor_config on large-v3 family ═══"
for id in windy-edge-ct2 windy-turbo-ct2 windy-pro-engine-ct2; do
  cp scripts/release/preprocessor_config-128mel.json "extraResources/model/$id/preprocessor_config.json"
done

echo "═══ 2. Sanity: model bytes intact post-swap (arch-independent; arm64 venv) ═══"
for id in windy-core-ct2 windy-turbo-ct2 faster-whisper-base; do
  d="extraResources/model/$id"; [ -f "$d/model.bin" ] || { echo "✗ missing $d/model.bin"; exit 1; }
  HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 KMP_DUPLICATE_LIB_OK=TRUE "$VENV" - "$d" "$ROOT/tests/audio/test_short.wav" <<'PY' || { echo "✗ verify failed: $id"; exit 1; }
import sys
from faster_whisper import WhisperModel
m=WhisperModel(sys.argv[1],device="cpu",compute_type="int8")
segs,_=m.transcribe(sys.argv[2],beam_size=1)
txt=" ".join(s.text.strip() for s in segs).strip(); assert txt, "empty"
print(f"  ✓ {sys.argv[1].split('/')[-1]:22} → {txt!r}")
PY
done

echo "═══ 3. Build signed x64 DMG ═══"
rm -f "dist/Windy Word-1.7.0.dmg" dist/*-x64.dmg 2>/dev/null || true
rm -rf dist/mac 2>/dev/null || true
npm run build:web
npm run stamp:reader
CODESIGN_IDENTITY="$CODESIGN_IDENTITY" CSC_LINK="$CSC_LINK" CSC_KEY_PASSWORD="$CSC_KEY_PASSWORD" \
  npx electron-builder --mac dmg --x64 --publish never

DMG="dist/Windy Word-1.7.0.dmg"
[ -f "$DMG" ] || DMG="$(ls -t dist/*.dmg | grep -vE 'arm64|universal|1\.6' | head -1)"
[ -f "$DMG" ] || { echo "✗ no x64 DMG produced"; exit 1; }
echo "  built: $DMG ($(du -h "$DMG" | cut -f1))"

echo "═══ 4. Sign DMG envelope ═══"
codesign --sign "$CODESIGN_IDENTITY" --options runtime --timestamp "$DMG"
codesign --verify --strict --verbose=2 "$DMG" 2>&1 | tail -2

echo "═══ 5. Notarize (Apple) ═══"
xcrun notarytool submit "$DMG" \
  --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD" --wait

echo "═══ 6. Staple + verify ═══"
xcrun stapler staple "$DMG"
xcrun stapler validate "$DMG" && echo "  ✓ stapled"
spctl -a -vvv -t open --context context:primary-signature "$DMG" 2>&1 | head -4 || true
echo "  sha256: $(shasum -a 256 "$DMG" | cut -d' ' -f1)"
echo "  size:   $(ls -lh "$DMG" | awk '{print $5}')"
echo "✅ DONE x64 → $DMG  (NOT yet uploaded to R2 — gated on confirmation)"
