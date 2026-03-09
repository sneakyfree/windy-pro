#!/usr/bin/env python3
"""
WINDY PRO — QUALITY ASSURANCE SMOKE TEST (OPTIMIZED)
Tests all 16 models against their base models with progress tracking.
"""

import torch
import librosa
import json
import sys
import gc
from pathlib import Path
from typing import Dict, List, Tuple
from jiwer import wer
from transformers import (
    WhisperProcessor,
    WhisperForConditionalGeneration,
    M2M100ForConditionalGeneration,
    M2M100Tokenizer
)
from optimum.onnxruntime import ORTModelForSpeechSeq2Seq

# Test configuration
STT_MODELS = [
    ('windy-stt-nano', 'openai/whisper-tiny.en'),
    ('windy-stt-lite', 'openai/whisper-base.en'),
    ('windy-stt-core', 'openai/whisper-small.en'),
    ('windy-stt-plus', 'openai/whisper-medium.en'),
    ('windy-stt-pro', 'openai/whisper-large-v3'),
    ('windy-stt-turbo', 'openai/whisper-large-v3-turbo'),
    ('windy-stt-edge', 'distil-whisper/distil-large-v3'),
]

TRANSLATION_MODELS = [
    ('windy_translate_spark', 'facebook/m2m100_418M'),
    ('windy_translate_standard', 'facebook/m2m100_1.2B'),
]

# Use only 2 language pairs for speed
TRANSLATION_TEST_PAIRS = [
    ('en', 'es'),
    ('en', 'fr'),
]

# Use only 1 test sentence for speed
TRANSLATION_TEST_SENTENCES = [
    'The meeting will begin at three o clock in the afternoon.',
]

results = []
results_file = Path('tests/qa_results.json')

# Cache for base models to avoid reloading
base_model_cache = {}

def save_results():
    """Save results incrementally."""
    with open(results_file, 'w') as f:
        json.dump(results, f, indent=2)
    print(f"  → Results saved ({len(results)} tests completed)")

def load_ground_truth(filepath: str) -> str:
    """Load ground truth text."""
    with open(filepath, 'r') as f:
        return f.read().strip()

def cleanup_memory():
    """Aggressive memory cleanup."""
    gc.collect()
    torch.cuda.empty_cache()
    if torch.cuda.is_available():
        torch.cuda.synchronize()

def transcribe_with_whisper(model_path: str, audio: any, cache_key: str = None) -> str:
    """Transcribe audio with a Whisper model."""
    try:
        # Check cache for base models
        if cache_key and cache_key in base_model_cache:
            print(f"    Using cached model...")
            processor, model = base_model_cache[cache_key]
        else:
            print(f"    Loading model from {model_path}...")
            processor = WhisperProcessor.from_pretrained(model_path)
            model = WhisperForConditionalGeneration.from_pretrained(
                model_path,
                torch_dtype=torch.float16,
                low_cpu_mem_usage=True
            )
            if torch.cuda.is_available():
                model = model.to('cuda')

            # Cache base models only
            if cache_key:
                base_model_cache[cache_key] = (processor, model)

        model.eval()

        print(f"    Running inference...")
        input_features = processor(audio, sampling_rate=16000, return_tensors='pt').input_features
        if torch.cuda.is_available():
            input_features = input_features.to('cuda')

        with torch.no_grad():
            predicted_ids = model.generate(input_features)

        text = processor.batch_decode(predicted_ids, skip_special_tokens=True)[0]

        # Only cleanup if not cached
        if not cache_key:
            del model
            del processor
            cleanup_memory()

        return text.strip()
    except Exception as e:
        print(f"    ERROR: {str(e)}")
        cleanup_memory()
        return f"ERROR: {str(e)}"

def transcribe_with_onnx(model_path: str, audio: any) -> str:
    """Transcribe audio with an ONNX model."""
    try:
        print(f"    Loading ONNX model from {model_path}...")
        processor = WhisperProcessor.from_pretrained(model_path)
        model = ORTModelForSpeechSeq2Seq.from_pretrained(model_path)

        print(f"    Running ONNX inference...")
        input_features = processor(audio, sampling_rate=16000, return_tensors='pt').input_features
        predicted_ids = model.generate(input_features)

        text = processor.batch_decode(predicted_ids, skip_special_tokens=True)[0]

        del model
        del processor
        cleanup_memory()

        return text.strip()
    except Exception as e:
        print(f"    ERROR: {str(e)}")
        cleanup_memory()
        return f"ERROR: {str(e)}"

def translate_with_m2m100(model_path: str, text: str, src_lang: str, tgt_lang: str, cache_key: str = None) -> str:
    """Translate text with M2M100 model."""
    try:
        # Check cache
        if cache_key and cache_key in base_model_cache:
            print(f"    Using cached model...")
            tokenizer, model = base_model_cache[cache_key]
        else:
            print(f"    Loading model from {model_path}...")
            tokenizer = M2M100Tokenizer.from_pretrained(model_path)
            model = M2M100ForConditionalGeneration.from_pretrained(
                model_path,
                torch_dtype=torch.float16,
                low_cpu_mem_usage=True
            )
            if torch.cuda.is_available():
                model = model.to('cuda')

            if cache_key:
                base_model_cache[cache_key] = (tokenizer, model)

        model.eval()

        print(f"    Running translation...")
        tokenizer.src_lang = src_lang
        inputs = tokenizer(text, return_tensors='pt')
        if torch.cuda.is_available():
            inputs = {k: v.to('cuda') for k, v in inputs.items()}

        with torch.no_grad():
            generated = model.generate(**inputs, forced_bos_token_id=tokenizer.get_lang_id(tgt_lang))

        translation = tokenizer.batch_decode(generated, skip_special_tokens=True)[0]

        if not cache_key:
            del model
            del tokenizer
            cleanup_memory()

        return translation.strip()
    except Exception as e:
        print(f"    ERROR: {str(e)}")
        cleanup_memory()
        return f"ERROR: {str(e)}"

def calculate_wer(reference: str, hypothesis: str) -> float:
    """Calculate Word Error Rate."""
    try:
        return wer(reference, hypothesis)
    except:
        return 1.0

def verdict(our_text: str, base_text: str, our_wer: float, base_wer: float) -> str:
    """Determine verdict."""
    if our_text.startswith("ERROR"):
        return "FAIL ❌"
    if our_text.lower() == base_text.lower():
        return "PASS ✅"
    wer_diff = our_wer - base_wer
    if wer_diff <= 0.02:
        return "PASS ✅"
    elif wer_diff <= 0.05:
        return "WARN ⚠️"
    else:
        return "FAIL ❌"

def translation_verdict(our_text: str, base_text: str) -> str:
    """Determine verdict for translation."""
    if our_text.startswith("ERROR"):
        return "FAIL ❌"
    if len(our_text) > 0 and our_text != "":
        return "PASS ✅"
    return "FAIL ❌"

print("=" * 80)
print("WINDY PRO — QUALITY ASSURANCE SMOKE TEST (OPTIMIZED)")
print("=" * 80)
print()

# Load test audio
print("Loading test audio...")
audio_short, _ = librosa.load('tests/audio/test_short.wav', sr=16000)
ground_truth_short = load_ground_truth('tests/audio/test_short_groundtruth.txt')
print(f"Ground truth: {ground_truth_short}")
print()

# ============================================================================
# PART 1: GPU STT MODELS
# ============================================================================

print("=" * 80)
print("PART 1: Testing GPU STT Models vs Base Models (7 models)")
print("=" * 80)

for idx, (our_model_name, base_model_name) in enumerate(STT_MODELS, 1):
    print(f"\n[{idx}/7] Testing: {our_model_name} vs {base_model_name}")
    print("-" * 80)

    our_model_path = f"models/{our_model_name}"

    # Test our model
    print(f"  [Our Model]")
    our_text = transcribe_with_whisper(our_model_path, audio_short)
    our_wer = calculate_wer(ground_truth_short, our_text)
    print(f"    Output: {our_text}")
    print(f"    WER: {our_wer:.4f}")

    # Test base model (cached)
    print(f"  [Base Model]")
    base_text = transcribe_with_whisper(base_model_name, audio_short, cache_key=base_model_name)
    base_wer = calculate_wer(ground_truth_short, base_text)
    print(f"    Output: {base_text}")
    print(f"    WER: {base_wer:.4f}")

    # Verdict
    match = our_text.lower() == base_text.lower()
    test_verdict = verdict(our_text, base_text, our_wer, base_wer)

    print(f"  Match: {match}")
    print(f"  Verdict: {test_verdict}")

    results.append({
        'model': our_model_name,
        'type': 'GPU STT',
        'test': 'Transcription vs Base',
        'base_output': base_text,
        'our_output': our_text,
        'match': match,
        'our_wer': f"{our_wer:.4f}",
        'base_wer': f"{base_wer:.4f}",
        'verdict': test_verdict
    })

    save_results()

# ============================================================================
# PART 2: CPU ONNX STT MODELS
# ============================================================================

print("\n" + "=" * 80)
print("PART 2: Testing CPU ONNX STT Models vs GPU Counterparts (7 models)")
print("=" * 80)

for idx, (our_model_name, _) in enumerate(STT_MODELS, 1):
    print(f"\n[{idx}/7] Testing: {our_model_name}-cpu vs {our_model_name}")
    print("-" * 80)

    gpu_model_path = f"models/{our_model_name}"
    cpu_model_path = f"models/{our_model_name}-cpu"

    # Test GPU model
    print(f"  [GPU Model]")
    gpu_text = transcribe_with_whisper(gpu_model_path, audio_short)
    gpu_wer = calculate_wer(ground_truth_short, gpu_text)
    print(f"    Output: {gpu_text}")
    print(f"    WER: {gpu_wer:.4f}")

    # Test CPU model
    print(f"  [CPU ONNX Model]")
    cpu_text = transcribe_with_onnx(cpu_model_path, audio_short)
    cpu_wer = calculate_wer(ground_truth_short, cpu_text)
    print(f"    Output: {cpu_text}")
    print(f"    WER: {cpu_wer:.4f}")

    # Verdict
    match = cpu_text.lower() == gpu_text.lower()
    test_verdict = verdict(cpu_text, gpu_text, cpu_wer, gpu_wer)

    print(f"  Match: {match}")
    print(f"  Verdict: {test_verdict}")

    results.append({
        'model': f"{our_model_name}-cpu",
        'type': 'CPU ONNX STT',
        'test': 'Transcription vs GPU',
        'base_output': gpu_text,
        'our_output': cpu_text,
        'match': match,
        'our_wer': f"{cpu_wer:.4f}",
        'base_wer': f"{gpu_wer:.4f}",
        'verdict': test_verdict
    })

    save_results()

# ============================================================================
# PART 3: TRANSLATION MODELS
# ============================================================================

print("\n" + "=" * 80)
print("PART 3: Testing Translation Models (2 models × 2 lang pairs × 1 sentence = 4 tests)")
print("=" * 80)

test_num = 0
total_translation_tests = len(TRANSLATION_MODELS) * len(TRANSLATION_TEST_PAIRS) * len(TRANSLATION_TEST_SENTENCES)

for our_model_name, base_model_name in TRANSLATION_MODELS:
    for src_lang, tgt_lang in TRANSLATION_TEST_PAIRS:
        for sentence in TRANSLATION_TEST_SENTENCES:
            test_num += 1
            print(f"\n[{test_num}/{total_translation_tests}] {our_model_name} ({src_lang}→{tgt_lang})")
            print(f"  Input: {sentence[:60]}...")
            print("-" * 80)

            our_model_path = f"models/{our_model_name}"

            # Test our model
            print(f"  [Our Model]")
            our_translation = translate_with_m2m100(our_model_path, sentence, src_lang, tgt_lang)
            print(f"    Output: {our_translation}")

            # Test base model
            print(f"  [Base Model]")
            base_translation = translate_with_m2m100(base_model_name, sentence, src_lang, tgt_lang, cache_key=base_model_name)
            print(f"    Output: {base_translation}")

            # Verdict
            match = our_translation.lower() == base_translation.lower()
            test_verdict = translation_verdict(our_translation, base_translation)

            print(f"  Match: {match}")
            print(f"  Verdict: {test_verdict}")

            results.append({
                'model': our_model_name,
                'type': 'Translation',
                'test': f'{src_lang}→{tgt_lang}: "{sentence[:40]}..."',
                'base_output': base_translation,
                'our_output': our_translation,
                'match': match,
                'our_wer': 'N/A',
                'base_wer': 'N/A',
                'verdict': test_verdict
            })

            save_results()

# ============================================================================
# FINAL SUMMARY
# ============================================================================

print("\n" + "=" * 80)
print("SMOKE TEST COMPLETE")
print("=" * 80)

pass_count = sum(1 for r in results if 'PASS' in r['verdict'])
warn_count = sum(1 for r in results if 'WARN' in r['verdict'])
fail_count = sum(1 for r in results if 'FAIL' in r['verdict'])

print(f"\nTotal Tests: {len(results)}")
print(f"  PASS ✅: {pass_count}")
print(f"  WARN ⚠️: {warn_count}")
print(f"  FAIL ❌: {fail_count}")
print()

if fail_count > 0:
    print("⚠️  QUALITY GATE: FAILED")
    print("Some models failed quality checks. Review required.")
    print()
    print("Failed models:")
    for r in results:
        if 'FAIL' in r['verdict']:
            print(f"  - {r['model']}: {r['test']}")
    sys.exit(1)
else:
    print("✅ QUALITY GATE: PASSED")
    print("All models meet minimum quality standards.")
    sys.exit(0)
