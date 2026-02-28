#!/usr/bin/env python3
"""
Download and convert NLLB-200-600M model for CTranslate2.

Usage:
    python3 download-model.py

This downloads the NLLB-200-600M model from Hugging Face, converts it to
CTranslate2 format (int8 quantized), and saves the SentencePiece tokenizer.
Total size: ~600MB after quantization.
"""

import os
import sys
import subprocess

MODEL_NAME = "facebook/nllb-200-distilled-600M"
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "models", "nllb-200-600M")

def main():
    print("🌪️  Windy Translate — Model Download")
    print(f"   Model: {MODEL_NAME}")
    print(f"   Output: {OUTPUT_DIR}")
    print()

    # Check dependencies
    for pkg in ['ctranslate2', 'transformers', 'sentencepiece']:
        try:
            __import__(pkg)
        except ImportError:
            print(f"❌ Missing: {pkg}")
            print(f"   Run: pip install ctranslate2 transformers sentencepiece torch")
            sys.exit(1)

    import ctranslate2
    from transformers import AutoTokenizer

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # Step 1: Convert model to CTranslate2 format
    ct2_model_path = os.path.join(OUTPUT_DIR, "model.bin")
    if os.path.exists(ct2_model_path):
        print("✅ CTranslate2 model already exists, skipping conversion")
    else:
        print("📥 Downloading and converting model (this may take 5-10 minutes)...")
        try:
            subprocess.run([
                sys.executable, "-m", "ctranslate2.converters.transformers",
                "--model", MODEL_NAME,
                "--output_dir", OUTPUT_DIR,
                "--quantization", "int8",
                "--force"
            ], check=True)
            print("✅ Model converted to CTranslate2 format (int8)")
        except subprocess.CalledProcessError as e:
            # Try alternative conversion method
            print("   Trying alternative conversion method...")
            converter = ctranslate2.converters.TransformersConverter(MODEL_NAME)
            converter.convert(OUTPUT_DIR, quantization="int8", force=True)
            print("✅ Model converted to CTranslate2 format (int8)")

    # Step 2: Download SentencePiece tokenizer
    sp_path = os.path.join(OUTPUT_DIR, "sentencepiece.bpe.model")
    if os.path.exists(sp_path):
        print("✅ SentencePiece tokenizer already exists, skipping")
    else:
        print("📥 Downloading SentencePiece tokenizer...")
        tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
        # The NLLB tokenizer uses a sentencepiece model
        import shutil
        sp_source = tokenizer.vocab_file
        if sp_source and os.path.exists(sp_source):
            shutil.copy2(sp_source, sp_path)
            print(f"✅ SentencePiece tokenizer saved")
        else:
            # Download directly from HF
            from huggingface_hub import hf_hub_download
            downloaded = hf_hub_download(
                repo_id=MODEL_NAME,
                filename="sentencepiece.bpe.model",
                local_dir=OUTPUT_DIR
            )
            print(f"✅ SentencePiece tokenizer downloaded")

    # Verify
    print()
    print("✅ Setup complete!")
    print(f"   Model directory: {OUTPUT_DIR}")
    total_size = sum(
        os.path.getsize(os.path.join(OUTPUT_DIR, f))
        for f in os.listdir(OUTPUT_DIR)
        if os.path.isfile(os.path.join(OUTPUT_DIR, f))
    )
    print(f"   Total size: {total_size / (1024**2):.0f} MB")
    print()
    print("   Start the server: npm start")

if __name__ == '__main__':
    main()
