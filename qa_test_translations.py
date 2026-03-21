"""
Windy Pro - Translation Model QA Test
Tests both Spark and Standard models after ultra-light LoRA retraining.

Tests 3 sentences across 10 language pairs:
en→es, en→fr, en→de, en→zh, en→ja, en→ru, en→pt, en→ar, en→ko, en→hi

CRITICAL: Output MUST be in the target language, NOT English.
"""

import torch
from transformers import M2M100ForConditionalGeneration, M2M100Tokenizer
from pathlib import Path
import json


# Test sentences
TEST_SENTENCES = [
    "The meeting will begin at three o clock in the afternoon.",
    "Please send the financial report to my office by Friday.",
    "The weather forecast predicts heavy rain throughout the weekend."
]

# Language pairs (en → target)
LANGUAGE_PAIRS = [
    ("en", "es", "Spanish"),
    ("en", "fr", "French"),
    ("en", "de", "German"),
    ("en", "zh", "Chinese"),
    ("en", "ja", "Japanese"),
    ("en", "ru", "Russian"),
    ("en", "pt", "Portuguese"),
    ("en", "ar", "Arabic"),
    ("en", "ko", "Korean"),
    ("en", "hi", "Hindi")
]


def test_translation(model_path: str, model_name: str):
    """Test a translation model on all language pairs."""

    print(f"\n{'='*80}")
    print(f"TESTING: {model_name}")
    print(f"Model path: {model_path}")
    print(f"{'='*80}\n")

    # Load model and tokenizer
    print("Loading model...")
    tokenizer = M2M100Tokenizer.from_pretrained(model_path)
    model = M2M100ForConditionalGeneration.from_pretrained(
        model_path,
        torch_dtype=torch.float16,
        device_map="auto"
    )
    print("Model loaded successfully!\n")

    results = []
    pass_count = 0
    fail_count = 0

    # Test each language pair
    for src_lang, tgt_lang, lang_name in LANGUAGE_PAIRS:
        print(f"\n{'─'*80}")
        print(f"Testing: English → {lang_name} ({tgt_lang})")
        print(f"{'─'*80}")

        pair_results = []

        for i, text in enumerate(TEST_SENTENCES, 1):
            # Set source language
            tokenizer.src_lang = src_lang

            # Tokenize
            inputs = tokenizer(text, return_tensors="pt").to(model.device)

            # Generate translation
            forced_bos_token_id = tokenizer.get_lang_id(tgt_lang)
            generated = model.generate(
                **inputs,
                forced_bos_token_id=forced_bos_token_id,
                max_length=128,
                num_beams=5
            )

            # Decode
            translation = tokenizer.batch_decode(generated, skip_special_tokens=True)[0]

            # Quality check: Is it in English? (FAIL if yes)
            # Simple heuristic: check if translation is identical or very similar to input
            is_english = (translation.lower().strip() == text.lower().strip())

            # Also check if it contains common English words
            english_indicators = ['the', 'and', 'will', 'please', 'weather', 'meeting', 'office']
            english_word_count = sum(1 for word in english_indicators if f' {word} ' in f' {translation.lower()} ')

            # If more than 2 English indicator words present in non-Latin script languages, likely FAIL
            if tgt_lang in ['zh', 'ja', 'ar', 'ko', 'hi', 'ru'] and english_word_count > 2:
                is_english = True

            status = "❌ FAIL" if is_english else "✅ PASS"

            if is_english:
                fail_count += 1
            else:
                pass_count += 1

            print(f"\nSentence {i}: {status}")
            print(f"  Input:  {text}")
            print(f"  Output: {translation}")

            pair_results.append({
                "sentence": text,
                "translation": translation,
                "passed": not is_english
            })

        results.append({
            "language_pair": f"{src_lang}→{tgt_lang}",
            "language_name": lang_name,
            "results": pair_results
        })

    # Summary
    total_tests = len(LANGUAGE_PAIRS) * len(TEST_SENTENCES)
    pass_rate = (pass_count / total_tests) * 100

    print(f"\n{'='*80}")
    print(f"QA SUMMARY: {model_name}")
    print(f"{'='*80}")
    print(f"Total tests: {total_tests}")
    print(f"Passed: {pass_count} ({pass_rate:.1f}%)")
    print(f"Failed: {fail_count} ({100-pass_rate:.1f}%)")

    if pass_rate >= 90:
        print(f"\n🎉 OVERALL: PASS (≥90%)")
        overall_status = "PASS"
    elif pass_rate >= 70:
        print(f"\n⚠️  OVERALL: MARGINAL ({pass_rate:.1f}%)")
        overall_status = "MARGINAL"
    else:
        print(f"\n❌ OVERALL: FAIL (<70%)")
        overall_status = "FAIL"

    print(f"{'='*80}\n")

    return {
        "model_name": model_name,
        "model_path": model_path,
        "total_tests": total_tests,
        "passed": pass_count,
        "failed": fail_count,
        "pass_rate": pass_rate,
        "overall_status": overall_status,
        "detailed_results": results
    }


def main():
    """Run QA tests on both models."""

    print("\n" + "="*80)
    print("WINDY PRO - TRANSLATION MODELS QA TEST")
    print("Ultra-Light LoRA Retrained Models")
    print("="*80)

    # Test both models
    spark_results = test_translation(
        model_path="models/windy-translate-spark",
        model_name="Translate Spark (418M)"
    )

    standard_results = test_translation(
        model_path="models/windy-translate-standard",
        model_name="Translate Standard (1.2B)"
    )

    # Save results
    qa_results = {
        "test_date": "2026-03-09",
        "test_type": "ultra_light_lora_retrain",
        "models": {
            "translate_spark": spark_results,
            "translate_standard": standard_results
        }
    }

    output_file = "qa_results_ultralight.json"
    with open(output_file, 'w') as f:
        json.dump(qa_results, f, indent=2, ensure_ascii=False)

    print(f"\n{'='*80}")
    print(f"QA RESULTS SAVED: {output_file}")
    print(f"{'='*80}\n")

    # Final summary
    print("\n" + "="*80)
    print("FINAL QA SUMMARY")
    print("="*80)
    print(f"Translate Spark:    {spark_results['overall_status']} ({spark_results['pass_rate']:.1f}%)")
    print(f"Translate Standard: {standard_results['overall_status']} ({standard_results['pass_rate']:.1f}%)")
    print("="*80 + "\n")

    # Return exit code based on overall status
    if spark_results['overall_status'] in ['PASS', 'MARGINAL'] and \
       standard_results['overall_status'] in ['PASS', 'MARGINAL']:
        print("✅ Both models passed QA!")
        return 0
    else:
        print("❌ One or more models failed QA")
        return 1


if __name__ == "__main__":
    exit(main())
