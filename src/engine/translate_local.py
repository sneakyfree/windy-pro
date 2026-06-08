#!/usr/bin/env python3
"""On-device translation for Windy Word — NLLB-200 via CTranslate2 + SentencePiece.

Fully offline: loads a bundled CTranslate2 model + its SentencePiece tokenizer from a
local directory; never touches the network. Spawned per request by the desktop main
process (mirrors the offline batch-transcribe-local pattern).

Request: a JSON file path as argv[1] (or JSON on stdin):
    {"model_dir": "/abs/path/nllb-200-600M", "items": [{"text": "...", "source": "en", "target": "es"}]}
source/target are ISO-639-1 codes; mapped to NLLB FLORES-200 codes below.
Response (stdout, one line):
    {"ok": true, "results": [{"translatedText": "..."}], "engine": "nllb-200-600M-int8"}
    {"ok": false, "error": "..."}
"""
import sys
import os
import json

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

# ISO-639-1 -> NLLB FLORES-200 code. Mirrors services/translate-api/server.js.
LANG_TO_NLLB = {
    "en": "eng_Latn", "es": "spa_Latn", "fr": "fra_Latn", "de": "deu_Latn",
    "pt": "por_Latn", "it": "ita_Latn", "zh": "zho_Hans", "zh-tw": "zho_Hant",
    "ja": "jpn_Jpan", "ko": "kor_Hang", "ar": "arb_Arab", "hi": "hin_Deva",
    "ru": "rus_Cyrl", "tr": "tur_Latn", "vi": "vie_Latn", "th": "tha_Thai",
    "nl": "nld_Latn", "pl": "pol_Latn", "sv": "swe_Latn", "no": "nob_Latn",
    "da": "dan_Latn", "fi": "fin_Latn", "id": "ind_Latn", "ms": "zsm_Latn",
    "tl": "tgl_Latn", "uk": "ukr_Cyrl", "cs": "ces_Latn", "ro": "ron_Latn",
    "hu": "hun_Latn", "el": "ell_Grek", "he": "heb_Hebr", "fa": "pes_Arab",
    "ur": "urd_Arab", "bn": "ben_Beng", "ta": "tam_Taml", "te": "tel_Telu",
    "sw": "swh_Latn", "am": "amh_Ethi", "ha": "hau_Latn", "yo": "yor_Latn",
    "ig": "ibo_Latn", "zu": "zul_Latn", "af": "afr_Latn", "ca": "cat_Latn",
    "eu": "eus_Latn", "bg": "bul_Cyrl", "hr": "hrv_Latn", "sk": "slk_Latn",
    "sl": "slv_Latn", "lt": "lit_Latn", "lv": "lvs_Latn", "et": "est_Latn",
    "ka": "kat_Geor", "hy": "hye_Armn", "az": "azj_Latn", "kk": "kaz_Cyrl",
    "uz": "uzn_Latn", "mn": "khk_Cyrl", "my": "mya_Mymr", "km": "khm_Khmr",
    "lo": "lao_Laoo", "ne": "npi_Deva", "si": "sin_Sinh", "ml": "mal_Mlym",
    "kn": "kan_Knda", "mr": "mar_Deva", "gu": "guj_Gujr", "pa": "pan_Guru",
    "jv": "jav_Latn", "sr": "srp_Cyrl", "bs": "bos_Latn", "sq": "als_Latn",
    "mk": "mkd_Cyrl", "gl": "glg_Latn", "cy": "cym_Latn", "is": "isl_Latn",
}


def _nllb(code):
    if not code or code == "auto":
        return "eng_Latn"
    return LANG_TO_NLLB.get(code, LANG_TO_NLLB.get(code.split("-")[0], "eng_Latn"))


def main():
    try:
        raw = open(sys.argv[1], "r", encoding="utf-8").read() if len(sys.argv) > 1 else sys.stdin.read()
        req = json.loads(raw)
        model_dir = req["model_dir"]
        items = req.get("items", [])

        import ctranslate2
        import sentencepiece as spm

        translator = ctranslate2.Translator(model_dir, device="cpu", compute_type="int8")
        sp = spm.SentencePieceProcessor()
        sp.Load(os.path.join(model_dir, "sentencepiece.bpe.model"))

        results = []
        for it in items:
            text = (it.get("text") or "").strip()
            if not text:
                results.append({"translatedText": it.get("text") or ""})
                continue
            src = _nllb(it.get("source", "en"))
            tgt = _nllb(it.get("target", "en"))
            # NLLB recipe (verified): source tokens + </s> + source-lang; decoder starts target-lang.
            source_tokens = sp.Encode(text, out_type=str) + ["</s>", src]
            out = translator.translate_batch(
                [source_tokens],
                target_prefix=[[tgt]],
                max_batch_size=1,
                beam_size=4,
                max_decoding_length=512,
            )
            toks = out[0].hypotheses[0]
            if toks and toks[0] == tgt:
                toks = toks[1:]
            results.append({"translatedText": sp.Decode(toks)})

        print(json.dumps({"ok": True, "results": results, "engine": "nllb-200-600M-int8"}, ensure_ascii=False))
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
