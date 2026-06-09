#!/usr/bin/env bash
# Unattended: build + sign + notarize the Reader-edition arm64 DMG with all 7 lean
# engines bundled OFFLINE. Sources notary creds from ~/.windy-notary.env (gitignored,
# outside the repo). Fail-fast offline-load check before the long build/notarize.
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT="$(pwd)"
# shellcheck disable=SC1090
source "$HOME/.windy-notary.env"
VENV="$HOME/.windy-pro/venv/bin/python3"

echo "═══ 1. Mirror lean engines → canonical bundled/model/ (hardlinks) ═══"
mkdir -p bundled/model
for d in extraResources/model/windy-*-ct2; do
  [ -d "$d" ] || continue
  id="$(basename "$d")"; rm -rf "bundled/model/$id"; cp -al "$d" "bundled/model/$id"
  echo "  ↪ bundled/model/$id"
done

echo "═══ 1.5 Normalize: ensure 128-mel preprocessor_config on large-v3 family ═══"
# edge/turbo/pro-engine are 128-mel; without preprocessor_config.json faster-whisper
# defaults to 80 and crashes at transcribe. A-family (80 mel) needs none (library default).
for id in windy-edge-ct2 windy-turbo-ct2 windy-pro-engine-ct2; do
  for base in extraResources/model bundled/model; do
    d="$base/$id"
    [ -d "$d" ] && cp scripts/release/preprocessor_config-128mel.json "$d/preprocessor_config.json" && echo "  + $d/preprocessor_config.json (128-mel)"
  done
done

echo "═══ 2. Offline TRANSCRIBE-verify EVERY bundled engine (fail fast) ═══"
# A load check is NOT enough — the 128-mel bug passes load and only fails at transcribe.
# So we actually decode real audio offline and assert non-empty output for each engine.
shopt -s nullglob
for d in extraResources/model/windy-*-ct2 extraResources/model/faster-whisper-base; do
  [ -f "$d/model.bin" ] || { echo "✗ missing model.bin: $d"; exit 1; }
  HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 KMP_DUPLICATE_LIB_OK=TRUE "$VENV" - "$d" "$ROOT/tests/audio/test_short.wav" <<'PY' || { echo "✗ transcribe-verify FAILED for $d"; exit 1; }
import sys
from faster_whisper import WhisperModel
m = WhisperModel(sys.argv[1], device="cpu", compute_type="int8")
segs, info = m.transcribe(sys.argv[2], beam_size=1)
txt = " ".join(s.text.strip() for s in segs).strip()
name = sys.argv[1].rstrip("/").split("/")[-1]
assert txt, f"empty transcript from {name}"
print(f"  ✓ offline transcribe OK: {name:24} → {txt!r}")
PY
done

echo "═══ 2.6 Generate wheel integrity manifest (CHECKSUMS.sha256) ═══"
( cd extraResources/wheels && shasum -a 256 *.whl > CHECKSUMS.sha256 ) \
  && echo "  ✓ $(grep -c . extraResources/wheels/CHECKSUMS.sha256) wheel checksums written"

echo "═══ 3. Build signed Reader arm64 DMG ═══"
rm -rf dist/*arm64*.dmg dist/mac-arm64 "dist/Windy Word"*arm64*.dmg 2>/dev/null || true
npm run build:web
npm run stamp:reader
CODESIGN_IDENTITY="$CODESIGN_IDENTITY" CSC_LINK="$CSC_LINK" CSC_KEY_PASSWORD="$CSC_KEY_PASSWORD" \
  npx electron-builder --mac dmg --arm64 --publish never

DMG="$(ls -t dist/*arm64*.dmg 2>/dev/null | head -1)"
[ -f "$DMG" ] || { echo "✗ no arm64 DMG produced"; exit 1; }
echo "  built: $DMG ($(du -h "$DMG" | cut -f1))"

echo "═══ 4. Sign DMG envelope (package.json sign:null skips it) ═══"
codesign --sign "$CODESIGN_IDENTITY" --options runtime --timestamp "$DMG"
codesign --verify --strict --verbose=2 "$DMG" 2>&1 | tail -3

echo "═══ 5. Notarize (Apple — ~16-30 min for a ~4.5GB upload) ═══"
xcrun notarytool submit "$DMG" \
  --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD" --wait

echo "═══ 6. Staple + verify ═══"
xcrun stapler staple "$DMG"
xcrun stapler validate "$DMG" && echo "  ✓ stapled"
spctl -a -vvv -t open --context context:primary-signature "$DMG" 2>&1 | head -4 || true
echo "  sha256: $(shasum -a 256 "$DMG" | cut -d' ' -f1)"
echo "  size:   $(ls -lh "$DMG" | awk '{print $5}')"
echo "✅ DONE → $DMG  (NOT yet uploaded to R2 — that step is gated on confirmation)"
