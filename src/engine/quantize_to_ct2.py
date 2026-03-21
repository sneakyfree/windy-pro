"""
Windy Pro - CTranslate2 Quantizer
Converts merged Whisper models to CTranslate2 INT8 format for CPU inference.

Usage:
    python quantize_to_ct2.py
"""

import subprocess
from pathlib import Path

# Models to quantize
MODELS = [
    ("models/windy-nano", "models/windy-nano-ct2"),
    ("models/windy-lite", "models/windy-lite-ct2"),
    ("models/windy-core", "models/windy-core-ct2"),
    ("models/windy-plus", "models/windy-plus-ct2"),
    ("models/windy-pro-engine", "models/windy-pro-engine-ct2"),
    ("models/windy-turbo", "models/windy-turbo-ct2"),
    ("models/windy-edge", "models/windy-edge-ct2"),
]


def quantize_model(input_dir: str, output_dir: str):
    """Quantize a model to CTranslate2 INT8 format."""
    print(f"\n{'='*70}")
    print(f"Quantizing: {input_dir} → {output_dir}")
    print(f"{'='*70}")

    # Create output directory
    Path(output_dir).mkdir(parents=True, exist_ok=True)

    # Run ct2-transformers-converter
    cmd = [
        "ct2-transformers-converter",
        "--model", input_dir,
        "--output_dir", output_dir,
        "--quantization", "int8",
        "--force"
    ]

    try:
        result = subprocess.run(cmd, check=True, capture_output=True, text=True)
        print("✓ Quantization successful")

        # Check output size
        model_bin = Path(output_dir) / "model.bin"
        if model_bin.exists():
            size_mb = model_bin.stat().st_size / (1024 ** 2)
            print(f"✓ Quantized model size: {size_mb:.1f} MB")
            return size_mb
        else:
            print("⚠ model.bin not found")
            return 0

    except subprocess.CalledProcessError as e:
        print(f"✗ ERROR: {e}")
        print(f"STDOUT: {e.stdout}")
        print(f"STDERR: {e.stderr}")
        return None


def main():
    print("="*70)
    print("Windy Pro - CTranslate2 Quantizer")
    print("Converting 7 models to INT8 for CPU inference")
    print("="*70)

    results = []

    for input_dir, output_dir in MODELS:
        try:
            size_mb = quantize_model(input_dir, output_dir)
            if size_mb is not None:
                results.append({
                    "input": input_dir,
                    "output": output_dir,
                    "status": "SUCCESS",
                    "size_mb": size_mb
                })
            else:
                results.append({
                    "input": input_dir,
                    "output": output_dir,
                    "status": "FAILED",
                    "size_mb": 0
                })
        except Exception as e:
            print(f"✗ ERROR quantizing {input_dir}: {e}")
            results.append({
                "input": input_dir,
                "output": output_dir,
                "status": f"FAILED: {str(e)}",
                "size_mb": 0
            })

    # Summary
    print("\n" + "="*70)
    print("QUANTIZATION SUMMARY")
    print("="*70)

    for r in results:
        status_symbol = "✓" if r["status"] == "SUCCESS" else "✗"
        print(f"{status_symbol} {r['output']}: {r['status']}")
        if r["status"] == "SUCCESS":
            print(f"   Size: {r['size_mb']:.1f} MB")

    successful = sum(1 for r in results if r["status"] == "SUCCESS")
    print(f"\n{successful}/{len(results)} models quantized successfully")

    if successful == len(results):
        print("\n✓ All models quantized! Ready for deployment.")
    else:
        print("\n⚠ Some models failed to quantize. Check errors above.")


if __name__ == "__main__":
    main()
