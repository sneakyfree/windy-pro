"""
Windy Pro - INT8 Quantizer for STT Models
Quantizes all 7 GPU Whisper models to INT8 for CPU deployment.

Target directories: models/windy-stt-{name}-int8/
"""

import os
import sys
import json
import shutil
from pathlib import Path
import torch
from transformers import WhisperForConditionalGeneration, WhisperProcessor
import numpy as np

# Models to quantize
MODELS = [
    "windy-stt-nano",
    "windy-stt-lite",
    "windy-stt-core",
    "windy-stt-plus",
    "windy-stt-turbo",
    "windy-stt-pro",
    "windy-stt-edge",
]

def get_dir_size_mb(path):
    """Get directory size in MB."""
    total = 0
    for dirpath, dirnames, filenames in os.walk(path):
        for f in filenames:
            fp = os.path.join(dirpath, f)
            if os.path.exists(fp):
                total += os.path.getsize(fp)
    return total / (1024 ** 2)

def quantize_model_torch(model_name: str):
    """Quantize using torch.quantization.quantize_dynamic."""
    input_dir = f"models/{model_name}"
    output_dir = f"models/{model_name}-int8"

    print(f"\n{'='*70}")
    print(f"Quantizing: {model_name}")
    print(f"Method: torch.quantization.quantize_dynamic")
    print(f"{'='*70}")

    try:
        # Load original model
        print(f"Loading model from {input_dir}...")
        model = WhisperForConditionalGeneration.from_pretrained(
            input_dir,
            torch_dtype=torch.float32,
            low_cpu_mem_usage=True
        )

        # Get original size
        input_size_mb = get_dir_size_mb(input_dir)
        print(f"Original size: {input_size_mb:.1f} MB")

        # Apply dynamic quantization to Linear layers
        print("Applying INT8 quantization to Linear layers...")
        quantized_model = torch.quantization.quantize_dynamic(
            model,
            {torch.nn.Linear},
            dtype=torch.qint8
        )

        # Create output directory
        Path(output_dir).mkdir(parents=True, exist_ok=True)

        # Save quantized model
        print(f"Saving quantized model to {output_dir}...")
        quantized_model.save_pretrained(output_dir)

        # Copy tokenizer and config files
        print("Copying tokenizer and config files...")
        for fname in ["tokenizer_config.json", "vocab.json", "merges.txt",
                      "normalizer.json", "added_tokens.json", "special_tokens_map.json",
                      "preprocessor_config.json", "generation_config.json"]:
            src = Path(input_dir) / fname
            dst = Path(output_dir) / fname
            if src.exists():
                shutil.copy2(src, dst)

        # Get output size
        output_size_mb = get_dir_size_mb(output_dir)
        print(f"Quantized size: {output_size_mb:.1f} MB")
        print(f"Compression ratio: {input_size_mb/output_size_mb:.2f}x")

        # Test inference
        print("Testing inference...")
        processor = WhisperProcessor.from_pretrained(output_dir)

        # Create dummy audio input (16kHz, 1 second)
        dummy_audio = np.random.randn(16000).astype(np.float32)
        inputs = processor(dummy_audio, sampling_rate=16000, return_tensors="pt")

        # Generate transcription
        with torch.no_grad():
            generated_ids = quantized_model.generate(inputs.input_features, max_length=50)
            transcription = processor.batch_decode(generated_ids, skip_special_tokens=True)[0]

        print(f"✓ Inference test passed")
        print(f"  Test transcription: '{transcription}'")

        return {
            "status": "SUCCESS",
            "method": "torch_dynamic",
            "input_size_mb": input_size_mb,
            "output_size_mb": output_size_mb,
            "compression": f"{input_size_mb/output_size_mb:.2f}x"
        }

    except Exception as e:
        print(f"✗ ERROR: {e}")
        import traceback
        traceback.print_exc()
        return {
            "status": "FAILED",
            "method": "torch_dynamic",
            "error": str(e)
        }

def quantize_model_onnx(model_name: str):
    """Quantize using optimum ONNX INT8 quantization."""
    input_dir = f"models/{model_name}"
    output_dir = f"models/{model_name}-int8"

    print(f"\n{'='*70}")
    print(f"Quantizing: {model_name}")
    print(f"Method: optimum ONNX INT8")
    print(f"{'='*70}")

    try:
        from optimum.onnxruntime import ORTModelForSpeechSeq2Seq, ORTQuantizer
        from optimum.onnxruntime.configuration import AutoQuantizationConfig

        # Load original model
        print(f"Loading model from {input_dir}...")
        input_size_mb = get_dir_size_mb(input_dir)
        print(f"Original size: {input_size_mb:.1f} MB")

        # Convert to ONNX first
        onnx_dir = f"{output_dir}_onnx_temp"
        Path(onnx_dir).mkdir(parents=True, exist_ok=True)

        print("Converting to ONNX...")
        model = ORTModelForSpeechSeq2Seq.from_pretrained(
            input_dir,
            export=True
        )
        model.save_pretrained(onnx_dir)

        # Quantize
        print("Applying INT8 quantization...")
        quantizer = ORTQuantizer.from_pretrained(onnx_dir)
        qconfig = AutoQuantizationConfig.avx2(is_static=False, per_channel=True)
        quantizer.quantize(save_dir=output_dir, quantization_config=qconfig)

        # Copy tokenizer files
        print("Copying tokenizer files...")
        for fname in ["tokenizer_config.json", "vocab.json", "merges.txt",
                      "normalizer.json", "added_tokens.json", "special_tokens_map.json",
                      "preprocessor_config.json", "generation_config.json"]:
            src = Path(input_dir) / fname
            dst = Path(output_dir) / fname
            if src.exists():
                shutil.copy2(src, dst)

        # Clean up temp directory
        shutil.rmtree(onnx_dir, ignore_errors=True)

        output_size_mb = get_dir_size_mb(output_dir)
        print(f"Quantized size: {output_size_mb:.1f} MB")
        print(f"Compression ratio: {input_size_mb/output_size_mb:.2f}x")

        # Test inference
        print("Testing inference...")
        processor = WhisperProcessor.from_pretrained(output_dir)
        quantized_model = ORTModelForSpeechSeq2Seq.from_pretrained(output_dir)

        dummy_audio = np.random.randn(16000).astype(np.float32)
        inputs = processor(dummy_audio, sampling_rate=16000, return_tensors="pt")

        generated_ids = quantized_model.generate(inputs.input_features, max_length=50)
        transcription = processor.batch_decode(generated_ids, skip_special_tokens=True)[0]

        print(f"✓ Inference test passed")
        print(f"  Test transcription: '{transcription}'")

        return {
            "status": "SUCCESS",
            "method": "onnx_int8",
            "input_size_mb": input_size_mb,
            "output_size_mb": output_size_mb,
            "compression": f"{input_size_mb/output_size_mb:.2f}x"
        }

    except Exception as e:
        print(f"✗ ERROR: {e}")
        import traceback
        traceback.print_exc()
        return {
            "status": "FAILED",
            "method": "onnx_int8",
            "error": str(e)
        }

def quantize_model(model_name: str):
    """Try quantization methods in order until one succeeds."""
    # Try torch dynamic quantization first
    result = quantize_model_torch(model_name)

    if result["status"] == "SUCCESS":
        return result

    # Fall back to ONNX INT8
    print("\nTorch quantization failed, trying ONNX INT8...")
    result = quantize_model_onnx(model_name)

    return result

def main():
    print("="*70)
    print("Windy Pro - INT8 STT Model Quantizer")
    print("Quantizing 7 GPU models for CPU deployment")
    print("="*70)

    results = {}

    for model_name in MODELS:
        result = quantize_model(model_name)
        results[model_name] = result

    # Summary
    print("\n" + "="*70)
    print("QUANTIZATION SUMMARY")
    print("="*70)

    for model_name, result in results.items():
        status_symbol = "✓" if result["status"] == "SUCCESS" else "✗"
        print(f"\n{status_symbol} {model_name}:")
        print(f"   Status: {result['status']}")

        if result["status"] == "SUCCESS":
            print(f"   Method: {result['method']}")
            print(f"   Original: {result['input_size_mb']:.1f} MB")
            print(f"   Quantized: {result['output_size_mb']:.1f} MB")
            print(f"   Compression: {result['compression']}")
        else:
            print(f"   Error: {result.get('error', 'Unknown')}")

    successful = sum(1 for r in results.values() if r["status"] == "SUCCESS")
    print(f"\n{'='*70}")
    print(f"Result: {successful}/{len(MODELS)} models quantized successfully")
    print(f"{'='*70}")

    # Save results to JSON
    results_file = "int8_quantization_results.json"
    with open(results_file, "w") as f:
        json.dump(results, f, indent=2)
    print(f"\nResults saved to {results_file}")

    return successful == len(MODELS)

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
