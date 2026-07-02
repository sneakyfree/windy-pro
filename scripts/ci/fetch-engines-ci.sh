#!/usr/bin/env bash
# fetch-engines-ci.sh — CI-safe fetch of all 7 lean CT2 int8 engines DIRECTLY into
# extraResources/model/ so electron-builder bundles them (→ app's bundled/model/) for a
# fully-OFFLINE Reader build. Portable across Linux + Windows (Git Bash): plain copies,
# no `cp -al` hardlinks (which fail on Windows / cross-fs). Mirrors the logic of
# scripts/fetch-lean-engines.sh but targets the electron-builder pack dir directly.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEST="$ROOT/extraResources/model"
R2="https://downloads.windyword.ai/models"
TOKDIR="${TMPDIR:-/tmp}/windy-tok"
mkdir -p "$DEST" "$TOKDIR"

# Tokenizers faster-whisper needs locally (else it hangs fetching from HF at first load):
#   A = multilingual 51865-vocab (nano/lite/core/plus)  ← faster-whisper-base
#   B = large-v3     51866-vocab (edge/turbo/pro-engine) ← faster-whisper-large-v3
curl -fSL --retry 5 -o "$TOKDIR/A.json" "https://huggingface.co/Systran/faster-whisper-base/resolve/main/tokenizer.json"
curl -fSL --retry 5 -o "$TOKDIR/B.json" "https://huggingface.co/Systran/faster-whisper-large-v3/resolve/main/tokenizer.json"

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
  d="$DEST/$id"; mkdir -p "$d"
  echo "-- $id  (listen-windy-$slug, tokenizer $tok) --"
  for f in model.bin config.json vocabulary.json; do
    curl -fSL --retry 5 -C - -o "$d/$f" "$R2/listen-windy-$slug/ct2-int8/$f"
  done
  cp "$TOKDIR/$tok.json" "$d/tokenizer.json"
  # B-family = 128 mel bins; without this faster-whisper defaults to 80 and crashes at transcribe.
  if [ "$tok" = "B" ]; then
    cp "$ROOT/scripts/release/preprocessor_config-128mel.json" "$d/preprocessor_config.json"
  fi
done

# NLLB-200 on-device translation model (Translate Studio). Fetched into the same
# extraResources/model/ dir the app reads (main.js nllbTranslate → .../model/nllb-200-600M).
# Without this the Reader ships a Translate Studio that errors on every click.
echo "-- nllb-200-600M  (on-device translate) --"
nd="$DEST/nllb-200-600M"; mkdir -p "$nd"
for f in model.bin config.json shared_vocabulary.txt sentencepiece.bpe.model tokenizer.json tokenizer_config.json special_tokens_map.json; do
  curl -fSL --retry 5 -C - -o "$nd/$f" "$R2/nllb-200-600M/$f"
done
test -f "$nd/model.bin" && test -f "$nd/sentencepiece.bpe.model" \
  || { echo "::error::nllb-200-600M model incomplete — Translate Studio would error on every use"; exit 1; }

echo "== staged engines =="
du -sh "$DEST"/windy-*-ct2 "$DEST"/nllb-200-600M 2>/dev/null || true
echo "OK: 7 lean engines + NLLB translate model staged into $DEST"
