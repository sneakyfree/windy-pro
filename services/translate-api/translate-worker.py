#!/usr/bin/env python3
"""
Windy Translate Worker — CTranslate2 + NLLB-200-600M

Persistent Python process that loads the NLLB translation model once and handles
translation requests via JSON Lines over stdin/stdout. Communicates with the
Express.js API server (server.js).

Protocol:
  INPUT  (stdin):  {"id": 1, "text": "Hello world", "source": "eng_Latn", "target": "spa_Latn"}
  OUTPUT (stdout): {"type": "result", "id": 1, "translated": "Hola mundo"}
  ERROR  (stdout): {"type": "error", "id": 1, "error": "..."}
  READY  (stdout): {"type": "ready", "model": "nllb-200-600M", "device": "cpu"}
"""

import sys
import json
import os
import time

def main():
    model_path = os.environ.get('MODEL_PATH', os.path.join(os.path.dirname(__file__), 'models', 'nllb-200-600M'))

    # ── Load model ──
    try:
        import ctranslate2
        import sentencepiece as spm
    except ImportError as e:
        emit({"type": "error", "id": 0, "error": f"Missing dependency: {e}. Run: pip install ctranslate2 sentencepiece"})
        sys.exit(1)

    sp_model_path = os.path.join(model_path, 'sentencepiece.bpe.model')
    ct2_model_path = model_path

    if not os.path.exists(sp_model_path):
        emit({"type": "error", "id": 0, "error": f"SentencePiece model not found at {sp_model_path}. Run: python3 download-model.py"})
        sys.exit(1)

    if not os.path.exists(os.path.join(ct2_model_path, 'model.bin')):
        emit({"type": "error", "id": 0, "error": f"CTranslate2 model not found at {ct2_model_path}. Run: python3 download-model.py"})
        sys.exit(1)

    # Detect device
    device = "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"
    compute_type = "float16" if device == "cuda" else "int8"

    sys.stderr.write(f"Loading NLLB-200-600M on {device} ({compute_type})...\n")
    t0 = time.time()

    translator = ctranslate2.Translator(ct2_model_path, device=device, compute_type=compute_type)
    sp = spm.SentencePieceProcessor()
    sp.Load(sp_model_path)

    load_time = time.time() - t0
    sys.stderr.write(f"Model loaded in {load_time:.1f}s\n")

    emit({
        "type": "ready",
        "model": "nllb-200-600M",
        "device": device,
        "compute_type": compute_type,
        "load_time_s": round(load_time, 1)
    })

    # ── Process requests ──
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            req = json.loads(line)
        except json.JSONDecodeError as e:
            emit({"type": "error", "id": 0, "error": f"Invalid JSON: {e}"})
            continue

        req_id = req.get("id", 0)

        try:
            text = req["text"]
            source_lang = req["source"]
            target_lang = req["target"]

            # Tokenize with SentencePiece
            source_tokens = sp.Encode(text, out_type=str)

            # NLLB requires the source language token prepended
            source_tokens = [source_lang] + source_tokens

            # Translate
            results = translator.translate_batch(
                [source_tokens],
                target_prefix=[[target_lang]],
                max_batch_size=1,
                beam_size=4,
                max_decoding_length=512,
            )

            # Decode — skip the language token
            target_tokens = results[0].hypotheses[0]
            if target_tokens and target_tokens[0] == target_lang:
                target_tokens = target_tokens[1:]

            translated = sp.Decode(target_tokens)

            emit({
                "type": "result",
                "id": req_id,
                "translated": translated
            })

        except Exception as e:
            emit({
                "type": "error",
                "id": req_id,
                "error": str(e)
            })


def emit(obj):
    """Write a JSON object to stdout (one line)."""
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + '\n')
    sys.stdout.flush()


if __name__ == '__main__':
    main()
