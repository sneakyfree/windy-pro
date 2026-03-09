#!/usr/bin/env python3
"""
WINDY PRO — QUALITY ASSURANCE SMOKE TEST (CPU-ONLY VERSION)
Tests models using CPU to avoid GPU memory conflicts.
"""

import torch
import librosa
import json
import sys
import gc
import warnings
from pathlib import Path
from jiwer import wer
from transformers import (
    WhisperProcessor,
    WhisperForConditionalGeneration,
    M2M100ForConditionalGeneration,
    M2M100Tokenizer
)

warnings.filterwarnings('ignore')

# Force CPU mode
torch.set_num_threads(4)

# Test configuration - smaller models only to test methodology
STT_MODELS_QUICK = [
    ('windy-stt-nano', 'openai/whisper-tiny.en'),
    ('windy-stt-lite', 'openai/whisper-base.en'),
]

STT_MODELS_ALL = [
    ('windy-stt-nano', 'openai/whisper-tiny.en'),
    ('windy-stt-lite', 'openai/whisper-base.en'),
    ('windy-stt-core', 'openai/whisper-small.en'),
    ('windy-stt-plus', 'openai/whisper-medium.en'),
    ('windy-stt-pro', 'openai/whisper-large-v3'),
    ('windy-stt-turbo', 'openai/whisper-large-v3-turbo'),
    ('windy-stt-edge', 'distil-whisper/distil-large-v3'),
]

# Use all models for complete test
STT_MODELS = STT_MODELS_ALL

results = []
results_file = Path('tests/qa_results.json')

def save_results():
    """Save results incrementally."""
    with open(results_file, 'w') as f:
        json.dump(results, f, indent=2)
    print(f"  → Results saved ({len(results)} tests)")

def load_ground_truth(filepath: str) -> str:
    """Load ground truth text."""
    with open(filepath, 'r') as f:
        return f.read().strip()

def cleanup_memory():
    """Memory cleanup."""
    gc.collect()

def transcribe_with_whisper(model_path: str, audio: any) -> str:
    """Transcribe audio with a Whisper model on CPU."""
    try:
        print(f"    Loading model: {model_path}")
        processor = WhisperProcessor.from_pretrained(model_path)
        model = WhisperForConditionalGeneration.from_pretrained(
            model_path,
            torch_dtype=torch.float32,  # Use float32 for CPU
            low_cpu_mem_usage=True
        )
        model = model.to('cpu')
        model.eval()

        print(f"    Transcribing...")
        input_features = processor(audio, sampling_rate=16000, return_tensors='pt').input_features

        with torch.no_grad():
            predicted_ids = model.generate(input_features, max_length=448)

        text = processor.batch_decode(predicted_ids, skip_special_tokens=True)[0]

        del model
        del processor
        cleanup_memory()

        return text.strip()
    except Exception as e:
        print(f"    ERROR: {str(e)}")
        cleanup_memory()
        return f"ERROR: {str(e)[:100]}"

def calculate_wer(reference: str, hypothesis: str) -> float:
    """Calculate Word Error Rate (case-insensitive)."""
    try:
        if hypothesis.startswith("ERROR"):
            return 1.0
        # Normalize case and punctuation for fair comparison
        ref_normalized = reference.lower().replace('.', '').strip()
        hyp_normalized = hypothesis.lower().replace('.', '').strip()
        return wer(ref_normalized, hyp_normalized)
    except:
        return 1.0

def verdict(our_text: str, base_text: str, our_wer: float, base_wer: float, ground_truth: str) -> str:
    """Determine verdict."""
    if our_text.startswith("ERROR"):
        return "FAIL ❌"

    # If exact match with base, that's good
    if our_text.lower() == base_text.lower():
        # But check if they're both correct or both wrong
        if our_wer < 0.1:  # Less than 10% error
            return "PASS ✅"
        elif our_wer < 0.3:  # Less than 30% error
            return "WARN ⚠️"
        else:
            return "FAIL ❌"  # Both are wrong

    # Different from base - check WER difference
    wer_diff = our_wer - base_wer
    if wer_diff <= 0.05:  # Within 5% WER
        return "PASS ✅"
    elif wer_diff <= 0.15:  # Within 15% WER
        return "WARN ⚠️"
    else:
        return "FAIL ❌"

print("=" * 80)
print("WINDY PRO — QA SMOKE TEST (CPU MODE)")
print("=" * 80)
print()
print("NOTE: Running on CPU to avoid GPU memory conflicts with other experiments.")
print("Testing methodology with smaller models first.")
print()

# Load test audio
print("Loading test audio...")
audio_short, _ = librosa.load('tests/audio/test_short.wav', sr=16000)
ground_truth_short = load_ground_truth('tests/audio/test_short_groundtruth.txt')
print(f"Ground truth: '{ground_truth_short}'")
print(f"Audio length: {len(audio_short)/16000:.2f} seconds")
print()

# ============================================================================
# TEST GPU STT MODELS
# ============================================================================

print("=" * 80)
print(f"Testing {len(STT_MODELS)} GPU STT Models vs Base Models")
print("=" * 80)

for idx, (our_model_name, base_model_name) in enumerate(STT_MODELS, 1):
    print(f"\n[{idx}/{len(STT_MODELS)}] {our_model_name} vs {base_model_name}")
    print("-" * 80)

    our_model_path = f"models/{our_model_name}"

    # Test our model
    print(f"  [Our Model: {our_model_name}]")
    our_text = transcribe_with_whisper(our_model_path, audio_short)
    our_wer = calculate_wer(ground_truth_short, our_text)
    print(f"    Transcription: '{our_text}'")
    print(f"    WER: {our_wer:.4f}")

    # Test base model
    print(f"  [Base Model: {base_model_name}]")
    base_text = transcribe_with_whisper(base_model_name, audio_short)
    base_wer = calculate_wer(ground_truth_short, base_text)
    print(f"    Transcription: '{base_text}'")
    print(f"    WER: {base_wer:.4f}")

    # Verdict
    match = our_text.lower().strip() == base_text.lower().strip()
    test_verdict = verdict(our_text, base_text, our_wer, base_wer, ground_truth_short)

    print()
    print(f"  Match with base: {match}")
    print(f"  Verdict: {test_verdict}")

    results.append({
        'model': our_model_name,
        'type': 'GPU STT',
        'test': 'Transcription Quality',
        'ground_truth': ground_truth_short,
        'base_output': base_text,
        'our_output': our_text,
        'match': match,
        'our_wer': f"{our_wer:.4f}",
        'base_wer': f"{base_wer:.4f}",
        'verdict': test_verdict,
        'notes': 'Tested on CPU due to GPU memory constraints'
    })

    save_results()

# ============================================================================
# SUMMARY
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
    print("⚠️  QUALITY GATE: SOME FAILURES DETECTED")
    print("\nFailed tests:")
    for r in results:
        if 'FAIL' in r['verdict']:
            print(f"  - {r['model']}: WER {r['our_wer']} vs base {r['base_wer']}")
            print(f"      Expected: '{r['ground_truth']}'")
            print(f"      Got:      '{r['our_output']}'")
    print()
elif warn_count > 0:
    print("⚠️  QUALITY GATE: WARNINGS DETECTED")
    print("\nModels with warnings:")
    for r in results:
        if 'WARN' in r['verdict']:
            print(f"  - {r['model']}: Minor quality differences detected")
    print()
else:
    print("✅ QUALITY GATE: ALL TESTS PASSED")
    print("All models producing expected outputs.")

print("\nResults saved to: tests/qa_results.json")
print()

sys.exit(0 if fail_count == 0 else 1)
