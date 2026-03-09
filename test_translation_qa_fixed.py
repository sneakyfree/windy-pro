#!/usr/bin/env python3
"""
Translation QA Test Suite - Fixed Version
Tests with CPU fallback and better error handling
"""

from transformers import M2M100ForConditionalGeneration, M2M100Tokenizer
import torch
from datetime import datetime
import os

# Test sentences
TEST_SENTENCES = [
    'The meeting will begin at three o clock in the afternoon.',
    'Please send the financial report to my office by Friday.',
    'The weather forecast predicts heavy rain throughout the weekend.'
]

# Language pairs to test
LANGUAGE_PAIRS = {
    'es': 'Spanish',
    'fr': 'French',
    'de': 'German',
    'zh': 'Chinese',
    'ja': 'Japanese',
    'ru': 'Russian',
    'pt': 'Portuguese',
    'ar': 'Arabic',
    'ko': 'Korean',
    'hi': 'Hindi'
}

# Model configurations
MODELS = [
    {
        'name': 'Windy Translate Spark',
        'our_path': 'models/windy_translate_spark/',
        'base_path': 'facebook/m2m100_418M',
        'use_cpu': False  # Try GPU first
    },
    {
        'name': 'Windy Translate Standard',
        'our_path': 'models/windy_translate_standard/',
        'base_path': 'facebook/m2m100_1.2B',
        'use_cpu': True  # Force CPU due to memory constraints
    }
]

def translate_text(text, model, tokenizer, tgt_lang, use_cpu=False):
    """Translate text to target language"""
    tokenizer.src_lang = 'en'
    inputs = tokenizer(text, return_tensors='pt')

    # Move to GPU/CPU
    device = 'cpu' if use_cpu else ('cuda' if torch.cuda.is_available() else 'cpu')

    if device == 'cuda':
        try:
            model = model.cuda()
            inputs = {k: v.cuda() for k, v in inputs.items()}
        except RuntimeError as e:
            print(f"  Warning: GPU allocation failed, falling back to CPU: {e}")
            device = 'cpu'
            model = model.cpu()
            inputs = {k: v.cpu() for k, v in inputs.items()}
    else:
        model = model.cpu()

    with torch.no_grad():
        generated = model.generate(**inputs, forced_bos_token_id=tokenizer.get_lang_id(tgt_lang))

    translation = tokenizer.batch_decode(generated, skip_special_tokens=True)[0]
    return translation

def test_model_pair(model_config):
    """Test our model against base model"""
    print(f"\n{'='*80}")
    print(f"Testing: {model_config['name']}")
    print(f"Our model: {model_config['our_path']}")
    print(f"Base model: {model_config['base_path']}")
    print(f"Device: {'CPU' if model_config['use_cpu'] else 'GPU (with CPU fallback)'}")
    print(f"{'='*80}\n")

    results = []
    use_cpu = model_config.get('use_cpu', False)

    # Load our model
    print(f"Loading our model from {model_config['our_path']}...")
    try:
        our_tokenizer = M2M100Tokenizer.from_pretrained(model_config['our_path'])
        our_model = M2M100ForConditionalGeneration.from_pretrained(model_config['our_path'])
        if use_cpu:
            our_model = our_model.cpu()
        print("✓ Our model loaded successfully")
    except Exception as e:
        print(f"✗ Failed to load our model: {e}")
        return None

    # Load base model
    print(f"Loading base model from {model_config['base_path']}...")
    try:
        base_tokenizer = M2M100Tokenizer.from_pretrained(model_config['base_path'])
        base_model = M2M100ForConditionalGeneration.from_pretrained(model_config['base_path'])
        if use_cpu:
            base_model = base_model.cpu()
        print("✓ Base model loaded successfully\n")
    except Exception as e:
        print(f"✗ Failed to load base model: {e}")
        return None

    # Test each sentence × language pair
    total_tests = len(TEST_SENTENCES) * len(LANGUAGE_PAIRS)
    current_test = 0
    exact_matches = 0

    for sentence_idx, sentence in enumerate(TEST_SENTENCES, 1):
        for lang_code, lang_name in LANGUAGE_PAIRS.items():
            current_test += 1
            print(f"[{current_test}/{total_tests}] Testing en→{lang_code} (sentence {sentence_idx})...")

            try:
                # Get our translation
                our_translation = translate_text(sentence, our_model, our_tokenizer, lang_code, use_cpu)

                # Get base translation
                base_translation = translate_text(sentence, base_model, base_tokenizer, lang_code, use_cpu)

                # Compare
                exact_match = our_translation == base_translation
                if exact_match:
                    exact_matches += 1
                    verdict = "✓ PASS"
                else:
                    # Check if they're similar (allow minor differences)
                    similarity = len(set(our_translation.split()) & set(base_translation.split())) / max(len(our_translation.split()), len(base_translation.split()))
                    if similarity > 0.8:
                        verdict = "~ PASS (similar)"
                    else:
                        verdict = "✗ FAIL"

                results.append({
                    'model': model_config['name'],
                    'pair': f"en→{lang_code}",
                    'lang_name': lang_name,
                    'sentence_num': sentence_idx,
                    'sentence': sentence,
                    'base_output': base_translation,
                    'our_output': our_translation,
                    'exact_match': exact_match,
                    'verdict': verdict
                })

                print(f"  Base: {base_translation}")
                print(f"  Ours: {our_translation}")
                print(f"  {verdict}\n")

            except Exception as e:
                print(f"  ✗ ERROR: {e}\n")
                results.append({
                    'model': model_config['name'],
                    'pair': f"en→{lang_code}",
                    'lang_name': lang_name,
                    'sentence_num': sentence_idx,
                    'sentence': sentence,
                    'base_output': f"ERROR: {e}",
                    'our_output': f"ERROR: {e}",
                    'exact_match': False,
                    'verdict': "✗ ERROR"
                })

    match_percentage = (exact_matches / total_tests) * 100
    print(f"\n{'='*80}")
    print(f"Summary for {model_config['name']}:")
    print(f"  Exact matches: {exact_matches}/{total_tests} ({match_percentage:.1f}%)")
    print(f"{'='*80}\n")

    # Clean up
    del our_model, base_model, our_tokenizer, base_tokenizer
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    return results, match_percentage

def generate_markdown_report(all_results):
    """Generate markdown QA report"""

    report = f"""# Translation QA Report
Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}

## Overview
This report certifies the quality of Windy Translate Spark and Windy Translate Standard models by comparing their outputs against their respective base M2M-100 models.

## Test Configuration
- **Test sentences**: {len(TEST_SENTENCES)}
- **Language pairs**: {len(LANGUAGE_PAIRS)} (en→es, en→fr, en→de, en→zh, en→ja, en→ru, en→pt, en→ar, en→ko, en→hi)
- **Total tests per model**: {len(TEST_SENTENCES) * len(LANGUAGE_PAIRS)}

### Test Sentences
"""

    for i, sentence in enumerate(TEST_SENTENCES, 1):
        report += f"{i}. `{sentence}`\n"

    report += "\n---\n\n"

    # Process each model's results
    for model_config in MODELS:
        model_name = model_config['name']
        model_results = [r for r in all_results if r[0] == model_name]

        if not model_results:
            continue

        results, match_pct = model_results[0]

        report += f"## {model_name}\n\n"
        report += f"**Our model**: `{model_config['our_path']}`  \n"
        report += f"**Base model**: `{model_config['base_path']}`\n\n"

        # Overall verdict
        if match_pct >= 90:
            overall = "✅ CERTIFIED"
        elif match_pct >= 70:
            overall = "⚠️ ACCEPTABLE"
        else:
            overall = "❌ FAILED"

        report += f"### Overall Result: {overall}\n"
        report += f"**Exact match rate**: {match_pct:.1f}%\n\n"

        # Detailed results table
        report += "### Detailed Results\n\n"
        report += "| Pair | Language | Sentence | Base Output | Our Output | Match | Verdict |\n"
        report += "|------|----------|----------|-------------|------------|-------|----------|\n"

        for result in results:
            pair = result['pair']
            lang = result['lang_name']
            sent_num = result['sentence_num']
            base_out = result['base_output'].replace('|', '\\|')[:80] + ('...' if len(result['base_output']) > 80 else '')
            our_out = result['our_output'].replace('|', '\\|')[:80] + ('...' if len(result['our_output']) > 80 else '')
            match = '✓' if result['exact_match'] else '✗'
            verdict = result['verdict']

            report += f"| {pair} | {lang} | #{sent_num} | {base_out} | {our_out} | {match} | {verdict} |\n"

        report += "\n---\n\n"

    # Final summary
    report += "## Final Certification\n\n"

    all_match_rates = [r[1] for r in all_results]
    avg_match_rate = sum(all_match_rates) / len(all_match_rates) if all_match_rates else 0

    if avg_match_rate >= 90:
        final_verdict = "✅ ALL MODELS CERTIFIED"
    elif avg_match_rate >= 70:
        final_verdict = "⚠️ MODELS ACCEPTABLE WITH CAVEATS"
    else:
        final_verdict = "❌ CERTIFICATION FAILED"

    report += f"### {final_verdict}\n\n"
    report += f"**Average exact match rate across all models**: {avg_match_rate:.1f}%\n\n"

    if avg_match_rate < 70:
        report += "### Critical Issues Found\n\n"
        for model_name, (results, match_pct) in all_results:
            if match_pct < 70:
                report += f"**{model_name}** ({match_pct:.1f}% match rate):\n"
                # Count how many failures were due to returning English
                english_failures = sum(1 for r in results if r['our_output'].startswith('The ') or r['our_output'].startswith('Please '))
                if english_failures > 0:
                    report += f"- {english_failures} translations returned English instead of target language\n"
                    report += f"- This suggests the model may not have properly merged LoRA weights or has configuration issues\n"
                report += "\n"

    report += "### Model Inventory Status\n"
    report += "- ✅ 14 STT models (Whisper-based) — CERTIFIED\n"

    if avg_match_rate >= 90:
        report += "- ✅ 2 Translation models (M2M-100-based) — CERTIFIED\n"
        report += "- **Total**: 16/16 models certified\n"
    elif avg_match_rate >= 70:
        report += "- ⚠️ 2 Translation models (M2M-100-based) — ACCEPTABLE WITH ISSUES\n"
        report += "- **Total**: 14/16 fully certified, 2/16 with caveats\n"
    else:
        report += "- ❌ 2 Translation models (M2M-100-based) — FAILED CERTIFICATION\n"
        report += "- **Total**: 14/16 certified, 2/16 failed\n"

    return report

def main():
    """Main test execution"""
    print("="*80)
    print("TRANSLATION QA TEST SUITE - FIXED VERSION")
    print("="*80)
    print(f"Testing {len(MODELS)} models")
    print(f"Test sentences: {len(TEST_SENTENCES)}")
    print(f"Language pairs: {len(LANGUAGE_PAIRS)}")
    print(f"Total tests per model: {len(TEST_SENTENCES) * len(LANGUAGE_PAIRS)}")
    print("="*80)

    all_results = []

    for model_config in MODELS:
        result = test_model_pair(model_config)
        if result:
            all_results.append((model_config['name'], result))

    # Generate report
    print("\nGenerating QA report...")
    os.makedirs('docs', exist_ok=True)
    report = generate_markdown_report(all_results)

    with open('docs/TRANSLATION_QA_REPORT.md', 'w') as f:
        f.write(report)

    print("✓ Report saved to docs/TRANSLATION_QA_REPORT.md")
    print("\n" + "="*80)
    print("TRANSLATION QA COMPLETE")
    print("="*80)

if __name__ == '__main__':
    main()
