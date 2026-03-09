"""
Windy Pro - LoRA Adapter Merger
Merges LoRA adapters into base models to create standalone merged models.

Usage:
    python merge_lora_adapters.py
"""

import os
import torch
from pathlib import Path
from transformers import WhisperForConditionalGeneration, WhisperProcessor
from peft import PeftModel

# Model configurations: (base_model_id, lora_checkpoint_path, output_dir)
MODELS_TO_MERGE = [
    ("openai/whisper-tiny.en", "artifacts/lora_checkpoints/lora-tiny-en-20260225T181843Z", "models/windy-stt-nano"),
    ("openai/whisper-base.en", "artifacts/lora_checkpoints/lora-base-en-v2", "models/windy-stt-lite"),
    ("openai/whisper-small.en", "artifacts/lora_checkpoints/lora-small-en-20260225T182403Z", "models/windy-stt-core"),
    ("openai/whisper-medium.en", "artifacts/lora_checkpoints/lora-medium-en-20260226T021334Z", "models/windy-stt-plus"),
    ("openai/whisper-large-v3", "artifacts/lora_checkpoints/lora-large-v3-en-20260226T022215Z", "models/windy-stt-pro"),
    ("openai/whisper-large-v3-turbo", "artifacts/lora_checkpoints/lora-large-v3-turbo-en-20260226T023039Z", "models/windy-stt-turbo"),
    ("distil-whisper/distil-large-v3", "artifacts/lora_checkpoints/lora-distil-whisper_distil-large-v3-en-20260226T165243Z", "models/windy-stt-edge"),
]


def merge_lora_adapter(base_model_id: str, lora_path: str, output_dir: str):
    """Merge a LoRA adapter into the base model and save."""
    print(f"\n{'='*70}")
    print(f"Merging: {base_model_id}")
    print(f"LoRA: {lora_path}")
    print(f"Output: {output_dir}")
    print(f"{'='*70}")

    # Load base model
    print("Loading base model...")
    base_model = WhisperForConditionalGeneration.from_pretrained(
        base_model_id,
        torch_dtype=torch.float16,
        device_map="auto"
    )

    # Load LoRA adapter
    print(f"Loading LoRA adapter from {lora_path}...")
    model = PeftModel.from_pretrained(base_model, lora_path)

    # Merge and unload
    print("Merging LoRA weights into base model...")
    merged_model = model.merge_and_unload()

    # Save merged model
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    print(f"Saving merged model to {output_dir}...")
    merged_model.save_pretrained(output_dir)

    # Save processor/tokenizer
    print("Saving processor and tokenizer...")
    processor = WhisperProcessor.from_pretrained(base_model_id)
    processor.save_pretrained(output_dir)

    print(f"✓ Successfully merged and saved to {output_dir}")

    # Get model size
    model_size_mb = sum(p.numel() * p.element_size() for p in merged_model.parameters()) / (1024 ** 2)
    print(f"✓ Model size: {model_size_mb:.1f} MB")

    # Clean up
    del base_model, model, merged_model
    torch.cuda.empty_cache()

    return model_size_mb


def main():
    print("="*70)
    print("Windy Pro - LoRA Adapter Merger")
    print("Merging 7 LoRA adapters into base models")
    print("="*70)

    results = []

    for base_model_id, lora_path, output_dir in MODELS_TO_MERGE:
        try:
            size_mb = merge_lora_adapter(base_model_id, lora_path, output_dir)
            results.append({
                "model": base_model_id,
                "output": output_dir,
                "status": "SUCCESS",
                "size_mb": size_mb
            })
        except Exception as e:
            print(f"✗ ERROR merging {base_model_id}: {e}")
            results.append({
                "model": base_model_id,
                "output": output_dir,
                "status": f"FAILED: {str(e)}",
                "size_mb": 0
            })

    # Summary
    print("\n" + "="*70)
    print("MERGE SUMMARY")
    print("="*70)

    for r in results:
        status_symbol = "✓" if r["status"] == "SUCCESS" else "✗"
        print(f"{status_symbol} {r['output']}: {r['status']}")
        if r["status"] == "SUCCESS":
            print(f"   Size: {r['size_mb']:.1f} MB")

    successful = sum(1 for r in results if r["status"] == "SUCCESS")
    print(f"\n{successful}/{len(results)} models merged successfully")

    if successful == len(results):
        print("\n✓ All models merged! Ready for CTranslate2 quantization.")
    else:
        print("\n⚠ Some models failed to merge. Check errors above.")


if __name__ == "__main__":
    main()
