"""
Download M2M-100-418M model from HuggingFace.
"""

from transformers import M2M100ForConditionalGeneration, M2M100Tokenizer
from pathlib import Path

MODEL_NAME = "facebook/m2m100_418M"
MODEL_DIR = Path(__file__).parent.parent.parent / "models" / "m2m100_418M"

def download_model():
    print(f"Downloading {MODEL_NAME}...")
    print(f"Target directory: {MODEL_DIR}")

    MODEL_DIR.mkdir(parents=True, exist_ok=True)

    print("Downloading tokenizer...")
    tokenizer = M2M100Tokenizer.from_pretrained(MODEL_NAME)
    tokenizer.save_pretrained(MODEL_DIR)
    print(f"Tokenizer saved to {MODEL_DIR}")

    print("Downloading model (this may take a few minutes)...")
    model = M2M100ForConditionalGeneration.from_pretrained(MODEL_NAME)
    model.save_pretrained(MODEL_DIR)
    print(f"Model saved to {MODEL_DIR}")

    print("\nDownload complete!")
    print(f"Model size: ~1.8GB")

    # Quick test
    print("\nTesting model load...")
    test_tokenizer = M2M100Tokenizer.from_pretrained(MODEL_DIR)
    test_model = M2M100ForConditionalGeneration.from_pretrained(MODEL_DIR)
    print("Model loads successfully!")

    # Test translation
    print("\nTesting translation (English -> Spanish)...")
    test_tokenizer.src_lang = "en"
    inputs = test_tokenizer("Hello, how are you?", return_tensors="pt")
    generated_tokens = test_model.generate(**inputs, forced_bos_token_id=test_tokenizer.get_lang_id("es"))
    translation = test_tokenizer.batch_decode(generated_tokens, skip_special_tokens=True)[0]
    print(f"Input: Hello, how are you?")
    print(f"Output: {translation}")
    print("\nAll tests passed!")

if __name__ == "__main__":
    download_model()
