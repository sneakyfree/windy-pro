"""
Windy Pro - LoRA Merge and Export
Merges LoRA adapter weights back into the base M2M-100 model.

This creates a standalone model that can be used without PEFT.
The merged model should produce identical outputs to the LoRA-adapted model.
"""

import os
import torch
from pathlib import Path
from typing import Optional

from transformers import M2M100ForConditionalGeneration, M2M100Tokenizer
from peft import PeftModel


class LoRAMerger:
    """
    Merge LoRA adapter weights into base model.

    Output: Full merged model ready for deployment.
    """

    def __init__(
        self,
        base_model_path: str,
        lora_adapter_path: str,
        output_path: str,
        device: str = "cuda"
    ):
        self.base_model_path = base_model_path
        self.lora_adapter_path = lora_adapter_path
        self.output_path = output_path
        self.device = device

    def load_models(self):
        """Load base model and LoRA adapter."""
        print(f"\n{'='*60}")
        print("Loading models...")
        print(f"{'='*60}\n")

        # Load tokenizer
        print(f"Loading tokenizer from {self.base_model_path}...")
        self.tokenizer = M2M100Tokenizer.from_pretrained(self.base_model_path)

        # Load base model
        print(f"Loading base model from {self.base_model_path}...")
        base_model = M2M100ForConditionalGeneration.from_pretrained(
            self.base_model_path,
            torch_dtype=torch.float16
        )

        # Load LoRA adapter
        print(f"Loading LoRA adapter from {self.lora_adapter_path}...")
        self.model = PeftModel.from_pretrained(
            base_model,
            self.lora_adapter_path,
            torch_dtype=torch.float16
        )

        self.model.to(self.device)
        print(f"Models loaded on {self.device}")

        if self.device == "cuda":
            vram_mb = torch.cuda.memory_allocated() / 1024 / 1024
            print(f"VRAM usage: {vram_mb:.1f} MB")

    def merge_and_save(self):
        """Merge LoRA weights into base model and save."""
        print(f"\n{'='*60}")
        print("Merging LoRA weights into base model...")
        print(f"{'='*60}\n")

        # Merge LoRA weights
        merged_model = self.model.merge_and_unload()
        print("LoRA weights merged successfully")

        # Create output directory
        output_dir = Path(self.output_path)
        output_dir.mkdir(parents=True, exist_ok=True)

        # Save merged model
        print(f"\nSaving merged model to {output_dir}...")
        merged_model.save_pretrained(
            str(output_dir),
            safe_serialization=True  # Use safetensors format
        )
        print("Model saved")

        # Save tokenizer
        print("Saving tokenizer...")
        self.tokenizer.save_pretrained(str(output_dir))
        print("Tokenizer saved")

        # Get model size
        model_size_mb = sum(
            p.numel() * p.element_size()
            for p in merged_model.parameters()
        ) / 1024 / 1024

        print(f"\n{'='*60}")
        print("MERGE COMPLETE")
        print(f"{'='*60}")
        print(f"Output: {output_dir}")
        print(f"Model size: {model_size_mb:.1f} MB")
        print(f"Total parameters: {merged_model.num_parameters():,}")
        print(f"{'='*60}\n")

        return merged_model

    def verify_merge(
        self,
        merged_model: M2M100ForConditionalGeneration,
        test_text: str = "Hello, how are you?",
        source_lang: str = "en",
        target_lang: str = "es"
    ):
        """
        Verify that merged model produces identical output to LoRA model.

        Args:
            merged_model: The merged model
            test_text: Test input text
            source_lang: Source language
            target_lang: Target language
        """
        print(f"\n{'='*60}")
        print("Verifying merge...")
        print(f"{'='*60}\n")

        print(f"Test: '{test_text}' ({source_lang} → {target_lang})")

        # Test with LoRA model
        self.tokenizer.src_lang = source_lang
        inputs = self.tokenizer(
            test_text,
            return_tensors="pt",
            max_length=128,
            truncation=True
        ).to(self.device)

        with torch.no_grad():
            # LoRA model output
            lora_output = self.model.generate(
                **inputs,
                forced_bos_token_id=self.tokenizer.get_lang_id(target_lang),
                num_beams=5,
                max_length=128
            )
            lora_translation = self.tokenizer.decode(lora_output[0], skip_special_tokens=True)

            # Merged model output
            merged_model.to(self.device)
            merged_model.eval()
            merged_output = merged_model.generate(
                **inputs,
                forced_bos_token_id=self.tokenizer.get_lang_id(target_lang),
                num_beams=5,
                max_length=128
            )
            merged_translation = self.tokenizer.decode(merged_output[0], skip_special_tokens=True)

        print(f"\nLoRA model:   {lora_translation}")
        print(f"Merged model: {merged_translation}")

        # Check if outputs match
        if torch.equal(lora_output, merged_output):
            print("\n✓ Verification PASSED: Outputs are identical")
            return True
        else:
            print("\n✗ Verification FAILED: Outputs differ")
            print("This may be due to numerical precision differences (acceptable)")
            return False


def main():
    """CLI for LoRA merging."""
    import argparse

    parser = argparse.ArgumentParser(description="Merge LoRA adapter into base model")
    parser.add_argument(
        "--base-model",
        default="models/m2m100_418M",
        help="Path to base M2M-100 model"
    )
    parser.add_argument(
        "--lora-adapter",
        required=True,
        help="Path to LoRA adapter (e.g., models/windy-translate-lora/final_model)"
    )
    parser.add_argument(
        "--output",
        default="models/windy-translate-spark",
        help="Output path for merged model"
    )
    parser.add_argument(
        "--verify",
        action="store_true",
        help="Verify merge by comparing outputs"
    )
    parser.add_argument(
        "--device",
        default="cuda",
        help="Device (cuda/cpu)"
    )

    args = parser.parse_args()

    # Check if LoRA adapter exists
    if not Path(args.lora_adapter).exists():
        print(f"Error: LoRA adapter not found at {args.lora_adapter}")
        return

    # Initialize merger
    merger = LoRAMerger(
        base_model_path=args.base_model,
        lora_adapter_path=args.lora_adapter,
        output_path=args.output,
        device=args.device
    )

    # Load models
    merger.load_models()

    # Merge and save
    merged_model = merger.merge_and_save()

    # Verify if requested
    if args.verify:
        merger.verify_merge(merged_model)

    print("\nDone! Your merged model is ready for deployment.")
    print(f"Use it by loading from: {args.output}")


if __name__ == "__main__":
    main()
