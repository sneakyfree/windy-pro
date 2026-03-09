#!/usr/bin/env python3
"""
WINDY PRO — COMPREHENSIVE QA SMOKE TEST
Final quality assurance test for all 16 models.
Generates detailed QA report with pass/warn/fail verdicts.
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
)
from optimum.onnxruntime import ORTModelForSpeechSeq2Seq

warnings.filterwarnings('ignore')
torch.set_num_threads(4)

# Model configurations
STT_MODELS = [
    ('windy-stt-nano', 'openai/whisper-tiny.en'),
    ('windy-stt-lite', 'openai/whisper-base.en'),
    ('windy-stt-core', 'openai/whisper-small.en'),
    ('windy-stt-plus', 'openai/whisper-medium.en'),
    ('windy-stt-pro', 'openai/whisper-large-v3'),
    ('windy-stt-turbo', 'openai/whisper-large-v3-turbo'),
    ('windy-stt-edge', 'distil-whisper/distil-large-v3'),
]

results = []
results_file = Path('tests/qa_comprehensive_results.json')

def save_results():
    with open(results_file, 'w') as f:
        json.dump(results, f, indent=2)

def load_ground_truth(filepath: str) -> str:
    with open(filepath, 'r') as f:
        return f.read().strip()

def cleanup_memory():
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

def transcribe_whisper(model_path: str, audio: any, use_cpu: bool = True) -> tuple[str, str]:
    """Transcribe with Whisper. Returns (transcription, error_msg)."""
    try:
        print(f"      Loading {model_path}...")
        processor = WhisperProcessor.from_pretrained(model_path)
        model = WhisperForConditionalGeneration.from_pretrained(
            model_path,
            torch_dtype=torch.float32 if use_cpu else torch.float16,
            low_cpu_mem_usage=True
        )
        device = 'cpu' if use_cpu else 'cuda'
        model = model.to(device)
        model.eval()

        input_features = processor(audio, sampling_rate=16000, return_tensors='pt').input_features
        input_features = input_features.to(device)

        with torch.no_grad():
            predicted_ids = model.generate(input_features, max_length=448)

        text = processor.batch_decode(predicted_ids, skip_special_tokens=True)[0].strip()

        del model, processor
        cleanup_memory()

        return text, None
    except Exception as e:
        cleanup_memory()
        return "", str(e)[:200]

def transcribe_onnx(model_path: str, audio: any) -> tuple[str, str]:
    """Transcribe with ONNX. Returns (transcription, error_msg)."""
    try:
        print(f"      Loading ONNX from {model_path}...")
        processor = WhisperProcessor.from_pretrained(model_path)
        model = ORTModelForSpeechSeq2Seq.from_pretrained(model_path)

        input_features = processor(audio, sampling_rate=16000, return_tensors='pt').input_features
        predicted_ids = model.generate(input_features, max_length=448)

        text = processor.batch_decode(predicted_ids, skip_special_tokens=True)[0].strip()

        del model, processor
        cleanup_memory()

        return text, None
    except Exception as e:
        cleanup_memory()
        return "", str(e)[:200]

def calculate_wer_normalized(reference: str, hypothesis: str) -> float:
    """Calculate WER with normalization."""
    if not hypothesis:
        return 1.0
    try:
        ref = reference.lower().replace('.', '').replace(',', '').strip()
        hyp = hypothesis.lower().replace('.', '').replace(',', '').strip()
        return wer(ref, hyp)
    except:
        return 1.0

def determine_verdict(our_text: str, base_text: str, our_wer: float, base_wer: float, error_msg: str = None) -> tuple[str, str]:
    """Returns (verdict, explanation)."""
    if error_msg:
        return "FAIL ❌", f"Error during inference: {error_msg}"

    if not our_text:
        return "FAIL ❌", "No output generated"

    # Check exact match
    if our_text.lower().strip() == base_text.lower().strip():
        if our_wer < 0.10:
            return "PASS ✅", "Perfect match with base, excellent accuracy"
        elif our_wer < 0.30:
            return "WARN ⚠️", "Matches base but both have minor errors"
        else:
            return "FAIL ❌", "Matches base but both are producing poor results"

    # Check WER difference
    wer_diff = our_wer - base_wer
    if wer_diff <= 0.03:
        return "PASS ✅", f"WER within 3% of base (diff: {wer_diff:.4f})"
    elif wer_diff <= 0.10:
        return "WARN ⚠️", f"WER slightly higher than base (diff: {wer_diff:.4f})"
    else:
        return "FAIL ❌", f"WER significantly worse than base (diff: {wer_diff:.4f})"

print("=" * 90)
print(" " * 20 + "WINDY PRO — COMPREHENSIVE QA SMOKE TEST")
print("=" * 90)
print()

# Load test audio
print("[SETUP] Loading test audio...")
audio_short, _ = librosa.load('tests/audio/test_short.wav', sr=16000)
ground_truth = load_ground_truth('tests/audio/test_short_groundtruth.txt')
print(f"        Ground truth: '{ground_truth}'")
print(f"        Audio: {len(audio_short)/16000:.2f}s")
print()

# ====================================================================================
# PART 1: GPU STT MODELS
# ====================================================================================

print("=" * 90)
print("PART 1: Testing 7 GPU STT Models (compared against base models)")
print("=" * 90)
print()

for idx, (model_name, base_name) in enumerate(STT_MODELS, 1):
    print(f"[TEST {idx}/7] {model_name}")
    print("-" * 90)

    model_path = f"models/{model_name}"

    # Test our model
    print(f"    [1/2] Our model: {model_name}")
    our_text, our_error = transcribe_whisper(model_path, audio_short, use_cpu=True)
    our_wer = calculate_wer_normalized(ground_truth, our_text) if our_text else 1.0
    print(f"          Output: '{our_text or 'ERROR'}'")
    if our_error:
        print(f"          Error: {our_error}")

    # Test base model
    print(f"    [2/2] Base model: {base_name}")
    base_text, base_error = transcribe_whisper(base_name, audio_short, use_cpu=True)
    base_wer = calculate_wer_normalized(ground_truth, base_text) if base_text else 1.0
    print(f"          Output: '{base_text or 'ERROR'}'")
    if base_error:
        print(f"          Error: {base_error}")

    # Verdict
    test_verdict, explanation = determine_verdict(our_text, base_text, our_wer, base_wer, our_error)

    print()
    print(f"    WER: Ours={our_wer:.4f}, Base={base_wer:.4f}")
    print(f"    Verdict: {test_verdict}")
    print(f"    Reason: {explanation}")
    print()

    results.append({
        'model': model_name,
        'category': 'GPU STT',
        'base_model': base_name,
        'ground_truth': ground_truth,
        'our_output': our_text,
        'base_output': base_text,
        'our_wer': f"{our_wer:.4f}",
        'base_wer': f"{base_wer:.4f}",
        'verdict': test_verdict,
        'explanation': explanation,
        'error': our_error
    })
    save_results()

# ====================================================================================
# PART 2: CPU ONNX MODELS
# ====================================================================================

print("=" * 90)
print("PART 2: Testing 7 CPU ONNX Models (compared against GPU counterparts)")
print("=" * 90)
print()

for idx, (model_name, _) in enumerate(STT_MODELS, 1):
    print(f"[TEST {idx}/7] {model_name}-cpu")
    print("-" * 90)

    gpu_path = f"models/{model_name}"
    cpu_path = f"models/{model_name}-cpu"

    # Test GPU version
    print(f"    [1/2] GPU version: {model_name}")
    gpu_text, gpu_error = transcribe_whisper(gpu_path, audio_short, use_cpu=True)
    gpu_wer = calculate_wer_normalized(ground_truth, gpu_text) if gpu_text else 1.0
    print(f"          Output: '{gpu_text or 'ERROR'}'")

    # Test ONNX version
    print(f"    [2/2] ONNX version: {model_name}-cpu")
    cpu_text, cpu_error = transcribe_onnx(cpu_path, audio_short)
    cpu_wer = calculate_wer_normalized(ground_truth, cpu_text) if cpu_text else 1.0
    print(f"          Output: '{cpu_text or 'ERROR'}'")
    if cpu_error:
        print(f"          Error: {cpu_error}")

    # Verdict
    test_verdict, explanation = determine_verdict(cpu_text, gpu_text, cpu_wer, gpu_wer, cpu_error)

    print()
    print(f"    WER: CPU={cpu_wer:.4f}, GPU={gpu_wer:.4f}")
    print(f"    Verdict: {test_verdict}")
    print(f"    Reason: {explanation}")
    print()

    results.append({
        'model': f"{model_name}-cpu",
        'category': 'CPU ONNX STT',
        'base_model': model_name,
        'ground_truth': ground_truth,
        'our_output': cpu_text,
        'base_output': gpu_text,
        'our_wer': f"{cpu_wer:.4f}",
        'base_wer': f"{gpu_wer:.4f}",
        'verdict': test_verdict,
        'explanation': explanation,
        'error': cpu_error
    })
    save_results()

# ====================================================================================
# SUMMARY
# ====================================================================================

print("=" * 90)
print("TEST COMPLETE — GENERATING SUMMARY")
print("=" * 90)
print()

pass_count = sum(1 for r in results if 'PASS' in r['verdict'])
warn_count = sum(1 for r in results if 'WARN' in r['verdict'])
fail_count = sum(1 for r in results if 'FAIL' in r['verdict'])

print(f"Total Models Tested: {len(results)}")
print(f"  PASS ✅: {pass_count}")
print(f"  WARN ⚠️: {warn_count}")
print(f"  FAIL ❌: {fail_count}")
print()

if fail_count > 0:
    print("⚠️  QUALITY GATE: FAILURES DETECTED")
    print()
    print("Failed Models:")
    for r in results:
        if 'FAIL' in r['verdict']:
            print(f"  • {r['model']}: {r['explanation']}")
    print()
elif warn_count > 0:
    print("⚠️  QUALITY GATE: WARNINGS PRESENT")
    print()
    print("Models with Warnings:")
    for r in results:
        if 'WARN' in r['verdict']:
            print(f"  • {r['model']}: {r['explanation']}")
    print()
else:
    print("✅ QUALITY GATE: ALL MODELS PASSED")
    print()

print(f"Detailed results saved to: {results_file}")
print()

sys.exit(0)
