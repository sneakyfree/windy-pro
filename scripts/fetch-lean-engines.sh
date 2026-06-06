#!/usr/bin/env bash
# fetch-lean-engines.sh — acquire all 7 lean WindyLabs CT2 int8 engines from R2 so
# the Reader edition ships every engine fully OFFLINE.
#
# faster-whisper needs a LOCAL tokenizer; R2 ships only model.bin + config.json +
# vocabulary.json, so we add the matching tokenizer.json (else first load tries to
# fetch it from HuggingFace and the engine hangs offline — the wobble we're killing).
#
# Tokenizer split (by base model / vocabulary.json size, verified empirically):
#   A (multilingual, 51865) : nano lite core plus   — from bundled faster-whisper-base
#   B (large-v3,    51866)  : edge turbo pro-engine  — Systran/faster-whisper-large-v3
#
# Canonical destination: bundled/model/<ct2-id>/  (the source buildModel() reads).
# Also hardlink-mirrored into extraResources/model/ (what electron-builder packs),
# so both the portable-bundle pipeline and a direct electron-builder run are covered.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CANON="$ROOT/bundled/model"
MIRROR="$ROOT/extraResources/model"
R2="https://downloads.windyword.ai/models"
TOK_A="$ROOT/bundled/model/faster-whisper-base/tokenizer.json"
TOK_B_URL="https://huggingface.co/Systran/faster-whisper-large-v3/resolve/main/tokenizer.json"
TOK_B="/tmp/windy-tok/tokenizer-B.json"

mkdir -p "$CANON" "$MIRROR" /tmp/windy-tok
[ -f "$TOK_B" ] || curl -fSL -o "$TOK_B" "$TOK_B_URL"

# engine-ct2-id : r2-slug : tokenizer(A|B)
ENGINES=(
  "windy-nano-ct2:nano:A"
  "windy-lite-ct2:lite:A"
  "windy-core-ct2:core:A"
  "windy-plus-ct2:plus:A"
  "windy-edge-ct2:edge:B"
  "windy-turbo-ct2:turbo:B"
  "windy-pro-engine-ct2:pro-engine:B"
)

for row in "${ENGINES[@]}"; do
  IFS=':' read -r id slug tok <<< "$row"
  d="$CANON/$id"; mkdir -p "$d"
  echo "── $id  (listen-windy-$slug, tokenizer $tok) ──"
  for f in model.bin config.json vocabulary.json; do
    curl -fSL --retry 3 -C - -o "$d/$f" "$R2/listen-windy-$slug/ct2-int8/$f"
    echo "   $f $(wc -c <"$d/$f") bytes"
  done
  if [ "$tok" = "A" ]; then cp "$TOK_A" "$d/tokenizer.json"; else cp "$TOK_B" "$d/tokenizer.json"; fi
  echo "   tokenizer.json $(wc -c <"$d/tokenizer.json") bytes ($tok)"
  # mirror into extraResources/ via hardlinks (no extra disk, same filesystem)
  m="$MIRROR/$id"; rm -rf "$m"; cp -al "$d" "$m"
done
echo "ALL 7 LEAN ENGINES → $CANON  (mirrored → $MIRROR)"
du -sh "$CANON"/windy-*-ct2 2>/dev/null
