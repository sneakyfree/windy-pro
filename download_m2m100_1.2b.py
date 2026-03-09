"""
Download M2M-100-1.2B base model for Windy Translate Standard.
"""

from transformers import M2M100ForConditionalGeneration, M2M100Tokenizer
import os

def download_m2m100_1_2b():
    """Download and save M2M-100-1.2B model."""

    model_name = 'facebook/m2m100_1.2B'
    output_dir = 'models/m2m100_1.2B'

    print(f"{'='*60}")
    print("Downloading M2M-100-1.2B (~5GB)")
    print(f"{'='*60}\n")

    # Create output directory
    os.makedirs(output_dir, exist_ok=True)

    # Download tokenizer
    print("Downloading tokenizer...")
    tokenizer = M2M100Tokenizer.from_pretrained(model_name)
    tokenizer.save_pretrained(output_dir)
    print(f"✓ Tokenizer saved to {output_dir}")

    # Download model
    print("\nDownloading model (~5GB, this may take a few minutes)...")
    model = M2M100ForConditionalGeneration.from_pretrained(model_name)
    model.save_pretrained(output_dir)
    print(f"✓ Model saved to {output_dir}")

    # Get model info
    num_params = model.num_parameters()
    print(f"\n{'='*60}")
    print("DOWNLOAD COMPLETE")
    print(f"{'='*60}")
    print(f"Model: M2M-100-1.2B")
    print(f"Parameters: {num_params:,}")
    print(f"Location: {output_dir}")
    print(f"{'='*60}\n")

if __name__ == "__main__":
    download_m2m100_1_2b()
