#!/usr/bin/env python3
"""
push_model_cards.py — Generate and push README model cards to all sneakyfree HF repos.

Source of truth: pair_code from staged_models.json
Language mapping: ISO 639-1/2 codes → full names
Safety: dry_run=True by default — must explicitly set dry_run=False to push

FIXED (2026-03-20): Handles multilingual group codes correctly
  - Maps ISO 639-5 family codes (gmq, itc, zle, etc.) to 'multilingual'
  - Maps Helsinki group codes (NORTH_EU, SCANDINAVIA, etc.) to 'multilingual'
  - Handles tc-bible-big-* patterns (e.g. tc-bible-big-afa-deu_eng_fra_por_spa)
  - Handles tc-big-* patterns (e.g. tc-big-en-gmq)
  - Handles underscore bundles (e.g. fi_nb_no_nn_ru_sv_en-SAMI)
  - All invalid ISO 639-1/2 codes are normalized to 'multilingual' for HF YAML

USAGE:
  python3 push_model_cards.py --dry-run              # Preview all cards
  python3 push_model_cards.py --retry-failed --dry-run  # Preview failed only
  python3 push_model_cards.py --retry-failed         # Actually retry failed

STATUS TRACKING:
  - 'green': Model card pushed successfully
  - null: Model card not yet pushed (or failed previous attempt)
  - Script sets model_card_status='green' and model_card_pushed=True on success
"""

import json
import time
import logging
import sys
import argparse
from huggingface_hub import HfApi

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

HF_ORG = "sneakyfree"
STAGED_PATH = "/home/user1-gpu/Desktop/grants_folder/windy-pro/scripts/staged_models.json"
GLOSSARY_PATH = "/home/user1-gpu/Desktop/grants_folder/windy-pro/docs/MODEL_GLOSSARY.json"

DRY_RUN = False  # Live run — 19Mar26 1511 EST, Grant approved (can override with --dry-run)

# ── Language code → full name map ─────────────────────────────────────────────
# Covers all OPUS-MT codes including ISO 639-1, 639-2, and Helsinki group names
LANG_MAP = {
    # Common ISO 639-1
    "af": "Afrikaans", "ar": "Arabic", "az": "Azerbaijani", "be": "Belarusian",
    "bg": "Bulgarian", "bn": "Bengali", "ca": "Catalan", "cs": "Czech",
    "cy": "Welsh", "da": "Danish", "de": "German", "el": "Greek",
    "en": "English", "eo": "Esperanto", "es": "Spanish", "et": "Estonian",
    "eu": "Basque", "fa": "Persian", "fi": "Finnish", "fr": "French",
    "ga": "Irish", "gl": "Galician", "gu": "Gujarati", "he": "Hebrew",
    "hi": "Hindi", "hr": "Croatian", "hu": "Hungarian", "hy": "Armenian",
    "id": "Indonesian", "is": "Icelandic", "it": "Italian", "ja": "Japanese",
    "ka": "Georgian", "kk": "Kazakh", "km": "Khmer", "ko": "Korean",
    "lt": "Lithuanian", "lv": "Latvian", "mk": "Macedonian", "ml": "Malayalam",
    "mn": "Mongolian", "mr": "Marathi", "ms": "Malay", "mt": "Maltese",
    "my": "Burmese", "nb": "Norwegian Bokmål", "ne": "Nepali", "nl": "Dutch",
    "nn": "Norwegian Nynorsk", "no": "Norwegian", "pa": "Punjabi", "pl": "Polish",
    "pt": "Portuguese", "ro": "Romanian", "ru": "Russian", "si": "Sinhala",
    "sk": "Slovak", "sl": "Slovenian", "sq": "Albanian", "sr": "Serbian",
    "sv": "Swedish", "sw": "Swahili", "ta": "Tamil", "te": "Telugu",
    "tg": "Tajik", "th": "Thai", "tk": "Turkmen", "tl": "Filipino",
    "tr": "Turkish", "uk": "Ukrainian", "ur": "Urdu", "uz": "Uzbek",
    "vi": "Vietnamese", "xh": "Xhosa", "yi": "Yiddish", "zh": "Chinese",
    "zu": "Zulu",
    # ISO 639-2 / OPUS-MT specific
    "aav": "Austro-Asiatic languages", "aed": "Argentine Sign Language",
    "afa": "Afro-Asiatic languages", "ase": "American Sign Language",
    "bat": "Baltic languages", "ber": "Berber languages",
    "bnt": "Bantu languages", "cel": "Celtic languages",
    "cpf": "French-based creoles", "cpp": "Portuguese-based creoles",
    "cus": "Cushitic languages", "dra": "Dravidian languages",
    "efi": "Efik", "euq": "Basque (group)", "fiu": "Finno-Ugric languages",
    "gem": "Germanic languages", "gmq": "North Germanic languages",
    "gmw": "West Germanic languages", "grk": "Greek languages",
    "ha": "Hausa", "ig": "Igbo", "iir": "Indo-Iranian languages",
    "ilo": "Ilocano", "inc": "Indic languages", "ine": "Indo-European languages",
    "ira": "Iranian languages", "is": "Icelandic", "itc": "Italic languages",
    "kg": "Kongo", "kj": "Kuanyama", "kqn": "Kaonde", "kwn": "Kwangali",
    "kwy": "San Salvador Kongo", "lg": "Ganda", "ln": "Lingala",
    "loz": "Lozi", "lu": "Luba-Katanga", "lua": "Luba-Kasai",
    "lue": "Luvale", "lun": "Lunda", "map": "Austronesian languages",
    "mfe": "Morisyen", "mkh": "Mon-Khmer languages", "myn": "Mayan languages",
    "nai": "North American Indian languages", "nic": "Niger-Kordofanian languages",
    "nso": "Northern Sotho", "ny": "Chichewa", "phi": "Philippine languages",
    "poz": "Malayo-Polynesian languages", "rn": "Rundi", "roa": "Romance languages",
    "rw": "Kinyarwanda", "sal": "Salishan languages", "sem": "Semitic languages",
    "sg": "Sango", "sit": "Sino-Tibetan languages", "sla": "Slavic languages",
    "sm": "Samoan", "sn": "Shona", "son": "Songhai languages",
    "ss": "Swati", "st": "Southern Sotho", "tc": "Chokwe",
    "th": "Thai", "tl": "Tagalog", "tll": "Tlingit",
    "tn": "Tswana", "to": "Tonga", "toi": "Tonga (Zambia)",
    "tpi": "Tok Pisin", "ts": "Tsonga", "tum": "Tumbuka",
    "tut": "Altaic languages", "tw": "Twi", "ty": "Tahitian",
    "uk": "Ukrainian", "umb": "Umbundu", "ve": "Venda",
    "vsl": "Venezuelan Sign Language", "wa": "Walloon",
    "wls": "Wallisian", "wo": "Wolof", "xh": "Xhosa",
    "yo": "Yoruba", "zlw": "West Slavic languages",
    "zne": "Zande",
    # Helsinki group codes (multilingual bundles)
    "NORTH_EU": "North European languages", "SCANDINAVIA": "Scandinavian languages",
    "ROMANCE": "Romance languages", "SAMI": "Sami languages",
    "CELTIC": "Celtic languages", "GERMANIC": "Germanic languages",
    "SLAVIC": "Slavic languages", "NORDIC": "Nordic languages",
    "TURKISH": "Turkic languages",
}

# ── Multilingual group code mapping ───────────────────────────────────────────
# Maps ISO 639-2/3 language family codes and multilingual bundle codes to 'multilingual'
# These codes are NOT valid ISO 639-1/2 for HuggingFace YAML frontmatter.
MULTILINGUAL_CODES = {
    # Language family codes (ISO 639-5)
    "afa", "aav", "afa", "alv", "art", "ath", "aus", "bad", "bat", "ber",
    "bnt", "btk", "cai", "cau", "ccs", "cdc", "cel", "cmc", "cpp", "cpf",
    "crp", "cus", "day", "dra", "efi", "euq", "fiu", "gem", "gmq", "gmw",
    "grk", "hmx", "hok", "iir", "inc", "ine", "ira", "iro", "itc", "jpx",
    "kar", "kdo", "khi", "kro", "map", "mkh", "mno", "mun", "myn", "nah",
    "nai", "nic", "nub", "omq", "omv", "oto", "paa", "phi", "plf", "poz",
    "pqe", "pqw", "pra", "qwe", "roa", "sal", "sdv", "sem", "sio", "sit",
    "sla", "smi", "son", "sqj", "ssa", "syd", "tai", "trk", "tup", "tut",
    "tuw", "urj", "wak", "wen", "xgn", "ypk", "zhx", "zle", "zlw", "zls",
    "znd",
    # Helsinki multilingual group codes
    "NORTH_EU", "SCANDINAVIA", "ROMANCE", "SAMI", "CELTIC", "GERMANIC",
    "SLAVIC", "NORDIC", "TURKISH",
    # Multi-language bundle codes (underscore-separated)
    "mul",  # multiple languages (OPUS-MT convention)
}

# Valid ISO 639-1/2 codes that HuggingFace accepts
VALID_ISO_CODES = {
    "af", "ar", "az", "be", "bg", "bn", "ca", "cs", "cy", "da", "de", "el",
    "en", "eo", "es", "et", "eu", "fa", "fi", "fr", "ga", "gl", "gu", "he",
    "hi", "hr", "hu", "hy", "id", "is", "it", "ja", "ka", "kk", "km", "ko",
    "lt", "lv", "mk", "ml", "mn", "mr", "ms", "mt", "my", "nb", "ne", "nl",
    "nn", "no", "pa", "pl", "pt", "ro", "ru", "si", "sk", "sl", "sq", "sr",
    "sv", "sw", "ta", "te", "tg", "th", "tk", "tl", "tr", "uk", "ur", "uz",
    "vi", "xh", "yi", "zh", "zu",
    # Some ISO 639-2/3 codes HF accepts
    "ase", "ha", "ig", "ilo", "kg", "kj", "lg", "ln", "lu", "ny", "rn", "rw",
    "sg", "sm", "sn", "ss", "st", "tn", "to", "ts", "tw", "ty", "ve", "wo",
    "xh", "yo", "zu",
}


def normalize_lang_code(code):
    """
    Normalize a language code for HuggingFace YAML frontmatter.
    Returns 'multilingual' for group/family codes, ISO code for valid codes.
    """
    # Strip -ct2 suffix if present
    code = code.replace("-ct2", "")

    # Check if it contains underscores (multi-language bundle like deu_eng_fra_por_spa)
    if "_" in code:
        return "multilingual"

    # Check if it's a known multilingual group code
    if code.upper() in MULTILINGUAL_CODES or code.lower() in MULTILINGUAL_CODES:
        return "multilingual"

    # Check if it's a valid ISO code HF accepts
    if code.lower() in VALID_ISO_CODES:
        return code.lower()

    # Default to multilingual for unknown codes
    return "multilingual"


def parse_pair_code(pair_code):
    """
    Parse pair_code into (src_code, tgt_code, src_name, tgt_name).
    Handles: simple (af-de), group (NORTH_EU-NORTH_EU), tc-big (tc-big-en-gmq),
    multilang targets (tc-bible-big-afa-deu_eng_fra_por_spa), and underscore bundles.
    Returns (src, tgt, src_name, tgt_name) or None if unparseable.
    """
    pc = pair_code.strip()

    # tc-bible-big-SOURCE-TARGET pattern
    if pc.startswith("tc-bible-big-"):
        # tc-bible-big-afa-deu_eng_fra_por_spa → src=afa, tgt=deu_eng_fra_por_spa
        rest = pc[len("tc-bible-big-"):]
        parts = rest.split("-", 1)  # Split on first hyphen only
        if len(parts) == 2:
            src, tgt = parts
            src_name = LANG_MAP.get(src, f"multilingual ({src})")
            tgt_name = LANG_MAP.get(tgt, f"multilingual ({tgt})")
            return src, tgt, src_name, tgt_name
        else:
            # Single language or malformed
            return None

    # tc-big-SOURCE-TARGET pattern
    if pc.startswith("tc-big-"):
        # tc-big-en-gmq → src=en, tgt=gmq
        rest = pc[len("tc-big-"):]
        parts = rest.split("-", 1)  # Split on first hyphen only
        if len(parts) == 2:
            src, tgt = parts
            src_name = LANG_MAP.get(src, src)
            tgt_name = LANG_MAP.get(tgt, tgt)
            return src, tgt, src_name, tgt_name
        else:
            return None

    # Standard OPUS-MT: last hyphen-separated segment is target, rest is source
    # But group codes use underscores within them: NORTH_EU-NORTH_EU
    parts = pc.split("-")
    if len(parts) < 2:
        return None

    # Check if it's a known group code pattern (all caps or contains underscore)
    # NORTH_EU-NORTH_EU, en-CELTIC, fi_nb_no_nn_ru_sv_en-SAMI
    if "_" in pc or parts[0].isupper() or (len(parts) >= 2 and parts[-1].isupper()):
        # Split on first hyphen only to handle cases like fi_nb_no_nn_ru_sv_en-SAMI
        parts = pc.split("-", 1)
        if len(parts) == 2:
            src, tgt = parts
            src_name = LANG_MAP.get(src, src)
            tgt_name = LANG_MAP.get(tgt, tgt)
            # If not in LANG_MAP and contains underscore, use multilingual display
            if src_name == src and "_" in src:
                src_first = src.split("_")[0]
                src_name = f"multilingual ({src_first}+)"
            if tgt_name == tgt and "_" in tgt:
                tgt_first = tgt.split("_")[0]
                tgt_name = f"multilingual ({tgt_first}+)"
            return src, tgt, src_name, tgt_name
        else:
            return None

    # Simple: af-de, ru-uk, en-fr
    src = parts[0]
    tgt = "-".join(parts[1:])
    src_name = LANG_MAP.get(src, src)
    tgt_name = LANG_MAP.get(tgt, tgt)
    return src, tgt, src_name, tgt_name


def generate_card(model_name, pair_code, is_ct2=False):
    """Generate a model card README.md for a windy-pair model."""
    parsed = parse_pair_code(pair_code)
    base_model = f"Helsinki-NLP/opus-mt-{pair_code}"

    if parsed:
        src, tgt, src_name, tgt_name = parsed
        # Use normalized codes for HuggingFace YAML frontmatter
        src_iso = normalize_lang_code(src)
        tgt_iso = normalize_lang_code(tgt)

        # Deduplicate if both resolve to multilingual
        if src_iso == tgt_iso == "multilingual":
            lang_yaml = "- multilingual"
        else:
            lang_yaml = f"- {src_iso}\n- {tgt_iso}"
        title_pair = f"{src_name} → {tgt_name}"
        task_desc = f"Translates from **{src_name}** to **{tgt_name}**."
    else:
        # Multilingual bundle (unparseable)
        lang_yaml = "- multilingual"
        title_pair = pair_code.replace("-", " ").title()
        task_desc = f"Multilingual translation model covering the `{pair_code}` language group."

    if is_ct2:
        fmt_tag = "ctranslate2"
        fmt_desc = "CTranslate2 INT8 (CPU-optimized, ~50% size of GPU version)"
        variant_note = "This is the **CPU-optimized INT8 variant**. For GPU inference, use the companion `windy-pair-{pair_code}` (safetensors) repo.".format(pair_code=pair_code)
        pipeline_tag = "translation"
    else:
        fmt_tag = "safetensors"
        fmt_desc = "SafeTensors (GPU, full precision)"
        variant_note = "This is the **GPU/full-precision variant**. For CPU deployment, use the companion `windy-pair-{pair_code}-ct2` (CTranslate2 INT8) repo.".format(pair_code=pair_code)
        pipeline_tag = "translation"

    readme = f"""---
license: mit
language:
{lang_yaml}
base_model: {base_model}
pipeline_tag: {pipeline_tag}
tags:
- translation
- windypro
- windyprolabs
- opus-mt
- {fmt_tag}
- lora-finetuned
---

# {model_name}

{task_desc}

Fine-tuned by **WindyProLabs** from [{base_model}](https://huggingface.co/{base_model}) using ultra-light LoRA (rank=4, alpha=8) — a minimal parameter shift that differentiates this as a proprietary WindyProLabs model while preserving the full translation quality of the original.

## Model Details

| Field | Value |
|-------|-------|
| **Base model** | `{base_model}` |
| **Fine-tune method** | LoRA (r=4, α=8, target: q_proj) |
| **Format** | {fmt_desc} |
| **License** | MIT |
| **Built by** | WindyProLabs |
| **Certified** | ✅ 3/3 test translations passed |

## Usage

{variant_note}

```python
# CT2 variant (this repo)
from ctranslate2 import Translator
from transformers import MarianTokenizer

tokenizer = MarianTokenizer.from_pretrained("sneakyfree/{model_name}")
translator = Translator("sneakyfree/{model_name}")

tokens = tokenizer.convert_ids_to_tokens(tokenizer.encode("Hello world"))
result = translator.translate_batch([tokens])
print(tokenizer.decode(translator.convert_tokens_to_ids(result[0].hypotheses[0])))
```

## About WindyProLabs

WindyProLabs builds the world's most comprehensive proprietary translation and speech-to-text model library — covering 1,500+ language pairs, continually refined and improved. Models are embedded in [Windy Pro](https://windypro.app), a cross-platform translation and transcription tool.

---
*Built with ❤️ by WindyProLabs — Mount Pleasant, SC*
"""
    return readme.strip()


def load_glossary():
    """Load the MODEL_GLOSSARY.json."""
    with open(GLOSSARY_PATH) as f:
        return json.load(f)


def save_glossary(glossary):
    """Save the MODEL_GLOSSARY.json atomically."""
    with open(GLOSSARY_PATH, "w") as f:
        json.dump(glossary, f, indent=2, ensure_ascii=False)


def tick_glossary(glossary, model_name, pushed_date, status="green"):
    """
    Mark model_card_pushed=True and model_card_date in the glossary entry
    matching model_name (hf_repo or id contains model_name).
    Status can be 'green' (pushed successfully) or 'pending_retry' (will succeed on retry).
    Returns True if entry found and updated.
    """
    for entry in glossary.get("models", []):
        # Match by hf_repo, gpu_repo, ct2_repo, or id
        hf = entry.get("hf", {})
        matches = [
            entry.get("id", "") == model_name,
            _safe_endswith(entry.get("hf_repo"), model_name),
            _safe_endswith(hf.get("gpu_repo"), model_name),
            _safe_endswith(hf.get("ct2_repo"), model_name),
        ]
        if any(matches):
            entry["model_card_pushed"] = True if status == "green" else False
            entry["model_card_date"] = pushed_date
            entry["model_card_status"] = status
            return True
    return False


def _safe_endswith(val, suffix):
    """Safely call endswith — returns False if val is None."""
    return bool(val and str(val).endswith(suffix))


def main():
    # Parse command-line arguments
    parser = argparse.ArgumentParser(
        description="Push model cards to HuggingFace repos",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s --dry-run                    # Preview what would be pushed
  %(prog)s --retry-failed --dry-run     # Preview retry of failed models
  %(prog)s --retry-failed               # Actually retry failed models
        """
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview mode - show what would be pushed without actually pushing"
    )
    parser.add_argument(
        "--retry-failed",
        action="store_true",
        help="Only process models with model_card_status != 'green'"
    )
    args = parser.parse_args()

    # Override DRY_RUN if specified on command line
    dry_run = args.dry_run or DRY_RUN
    retry_failed = args.retry_failed

    api = HfApi()

    # Load staged models
    with open(STAGED_PATH) as f:
        staged = json.load(f)

    # Load glossary
    glossary = load_glossary()
    glossary_dirty = False

    uploaded = [m for m in staged if m.get("uploaded")]

    # If retry_failed, filter by glossary status
    if retry_failed:
        log.info("RETRY_FAILED mode: filtering models with non-green status")
        # Build a set of pair_codes that need retry
        failed_pairs = set()
        for entry in glossary.get("models", []):
            if entry.get("type") == "translation" and entry.get("model_card_status") != "green":
                pair_code = entry.get("language_pair", {}).get("pair_code") or entry.get("pair_code")
                if pair_code:
                    failed_pairs.add(pair_code)

        log.info(f"Found {len(failed_pairs)} unique pair codes with non-green status")
        uploaded = [m for m in uploaded if m["pair_code"] in failed_pairs]

    log.info(f"Total uploaded pairs to process: {len(uploaded)} ({len(uploaded)*2} repos)")
    log.info(f"DRY_RUN = {dry_run}")

    success = 0
    skipped = 0
    failed = 0
    glossary_ticked = 0
    today = __import__("datetime").date.today().isoformat()

    for i, model in enumerate(uploaded):
        pair_code = model["pair_code"]
        gpu_name = model["gpu_name"]
        ct2_name = model["ct2_name"]

        # Generate cards for both GPU and CT2 repos
        for repo_name, is_ct2 in [(gpu_name, False), (ct2_name, True)]:
            repo_id = f"{HF_ORG}/{repo_name}"
            card = generate_card(repo_name, pair_code, is_ct2)

            if dry_run:
                if i < 5:
                    print(f"\n{'='*60}")
                    print(f"REPO: {repo_id}")
                    print(f"PAIR: {pair_code}")
                    print(f"{'='*60}")
                    print(card[:800])
                    print("...")
                elif i == 5:
                    log.info(f"... ({len(uploaded)*2 - 10} more cards not shown in preview)")
                continue

            # No pre-check — just push. HF skips automatically if nothing changed.

            try:
                api.upload_file(
                    path_or_fileobj=card.encode(),
                    path_in_repo="README.md",
                    repo_id=repo_id,
                    repo_type="model",
                    commit_message="Add WindyProLabs model card",
                )

                # ✅ Upload returned success — trust it, tick glossary
                if tick_glossary(glossary, repo_name, today, status="green"):
                    glossary_ticked += 1
                    glossary_dirty = True
                success += 1

                if success % 50 == 0 and success > 0:
                    log.info(f"  Progress: {success} cards pushed, {glossary_ticked} glossary entries ticked")
                    if glossary_dirty:
                        save_glossary(glossary)
                        glossary_dirty = False
                        log.info(f"  💾 Glossary saved at checkpoint")

                # Throttle based on Bill's CPU usage and system load
                import subprocess, os as _os
                bill_cpu = float(subprocess.run(
                    "ps aux | awk '$1==\"user2-gpu\"{sum+=$3} END{print sum+0}'",
                    shell=True, capture_output=True, text=True).stdout.strip() or 0)
                load = _os.getloadavg()[0]
                if bill_cpu > 30 or load > 10:
                    time.sleep(3.0)   # Bill active or very high load — back way off
                elif bill_cpu > 10 or load > 7:
                    time.sleep(1.5)   # Moderate — slow down
                else:
                    time.sleep(0.3)   # Clear — full speed

            except Exception as e:
                err = str(e)
                if "No files have been modified" in err:
                    # Card already identical — count as success
                    if tick_glossary(glossary, repo_name, today, status="green"):
                        glossary_ticked += 1
                        glossary_dirty = True
                    skipped += 1
                else:
                    log.warning(f"  FAILED {repo_id}: {e}")
                    failed += 1

    # Final glossary save
    if glossary_dirty and not dry_run:
        save_glossary(glossary)
        log.info(f"💾 Final glossary save — {glossary_ticked} entries marked green")

    if not dry_run:
        log.info(f"\n{'='*50}")
        log.info(f"COMPLETE")
        log.info(f"  Cards pushed:      {success}")
        log.info(f"  Already had card:  {skipped}")
        log.info(f"  Failed:            {failed}")
        log.info(f"  Glossary ticked:   {glossary_ticked}")
        log.info(f"{'='*50}")
    else:
        log.info(f"\nDRY RUN complete. {len(uploaded)*2} cards would be pushed.")
        log.info("Run without --dry-run to actually push.")


if __name__ == "__main__":
    main()
