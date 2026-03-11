#!/usr/bin/env python3
"""
Convert Windy STT models to ONNX INT8 format for CPU inference.
Uses Optimum library for export and quantization.
"""
import os
import sys
from pathlib import Path
from optimum.onnxruntime import ORTModelForSpeechSeq2Seq
from optimum.onnxruntime.configuration import AutoQuantizationConfig, ORTConfig
from transformers import WhisperProcessor
import shutil

def convert_model_to_onnx(model_name: str, gpu_path: str, cpu_path: str):
    """Convert a Whisper model to ONNX INT8 format."""
    print(f"\n{'='*80}")
    print(f"Converting {model_name} to ONNX INT8")
    print(f"Source: {gpu_path}")
    print(f"Target: {cpu_path}")
    print(f"{'='*80}\n")

    # Clean target directory if it exists
    if os.path.exists(cpu_path):
        print(f"Cleaning existing directory: {cpu_path}")
        shutil.rmtree(cpu_path)
    os.makedirs(cpu_path, exist_ok=True)

    try:
        # Step 1: Export to ONNX format
        print(f"Step 1: Exporting {model_name} to ONNX format...")
        model = ORTModelForSpeechSeq2Seq.from_pretrained(
            gpu_path,
            export=True,
            provider="CPUExecutionProvider"
        )

        # Load processor (tokenizer + feature extractor)
        processor = WhisperProcessor.from_pretrained(gpu_path)

        # Step 2: Apply dynamic quantization to INT8
        print(f"Step 2: Quantizing {model_name} to INT8...")
        quantization_config = AutoQuantizationConfig.avx512_vnni(is_static=False)

        # Save the quantized model
        model.save_pretrained(cpu_path, quantization_config=quantization_config)
        processor.save_pretrained(cpu_path)

        print(f"✓ Successfully converted {model_name} to ONNX INT8")

        # Calculate size reduction
        gpu_size = sum(f.stat().st_size for f in Path(gpu_path).rglob('*') if f.is_file()) / (1024**2)
        cpu_size = sum(f.stat().st_size for f in Path(cpu_path).rglob('*') if f.is_file()) / (1024**2)
        print(f"  GPU model size: {gpu_size:.2f} MB")
        print(f"  CPU model size: {cpu_size:.2f} MB")
        print(f"  Size reduction: {(1 - cpu_size/gpu_size)*100:.1f}%")

        return True

    except Exception as e:
        print(f"✗ Failed to convert {model_name}: {str(e)}")
        import traceback
        traceback.print_exc()
        return False

def main():
    """Convert all 7 Windy STT models to ONNX INT8."""
    models = [
        "windy-stt-nano",
        "windy-stt-lite",
        "windy-stt-core",
        "windy-stt-plus",
        "windy-stt-pro",
        "windy-stt-turbo",
        "windy-stt-edge",
    ]

    base_dir = Path("models")
    results = {}

    print("\n" + "="*80)
    print("WINDY STT MODELS → ONNX INT8 CONVERSION")
    print("="*80)

    for model_name in models:
        gpu_path = str(base_dir / model_name)
        cpu_path = str(base_dir / f"{model_name}-cpu")

        if not os.path.exists(gpu_path):
            print(f"✗ Source model not found: {gpu_path}")
            results[model_name] = False
            continue

        success = convert_model_to_onnx(model_name, gpu_path, cpu_path)
        results[model_name] = success

    # Summary
    print("\n" + "="*80)
    print("CONVERSION SUMMARY")
    print("="*80)
    successful = sum(1 for v in results.values() if v)
    total = len(results)
    print(f"Successfully converted: {successful}/{total} models")

    for model_name, success in results.items():
        status = "✓" if success else "✗"
        print(f"  {status} {model_name}")

    if successful == total:
        print("\n✓ All models converted successfully!")
        return 0
    else:
        print(f"\n✗ {total - successful} models failed to convert")
        return 1

if __name__ == "__main__":
    sys.exit(main())
