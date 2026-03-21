"""
Windy Pro - Translation Engine
Core translation logic using Meta's M2M-100 model.
"""

import time
import torch
from pathlib import Path
from dataclasses import dataclass
from typing import Optional
from transformers import M2M100ForConditionalGeneration, M2M100Tokenizer


@dataclass
class TranslationConfig:
    """Configuration for the translator."""
    model_path: str = None
    model_type: str = "base"  # "base", "finetuned", or "lora"
    lora_adapter_path: str = None  # Path to LoRA adapter if model_type="lora"
    device: str = "auto"
    max_length: int = 512
    num_beams: int = 5

    def __post_init__(self):
        if self.model_path is None:
            # Auto-select model based on model_type
            project_root = Path(__file__).parent.parent.parent
            if self.model_type == "finetuned":
                # Use fine-tuned merged model
                self.model_path = str(project_root / "models" / "windy-translate-spark")
            else:
                # Default to base model
                self.model_path = str(project_root / "models" / "m2m100_418M")


class Translator:
    """
    M2M-100 based text-to-text translator.

    Supports 100 languages and 9,900 language pairs.
    GPU-accelerated by default with CPU fallback.
    """

    # Language code mapping (M2M-100 uses specific codes)
    LANG_CODES = {
        "en": "en", "es": "es", "fr": "fr", "de": "de", "it": "it",
        "pt": "pt", "ru": "ru", "zh": "zh", "ja": "ja", "ko": "ko",
        "ar": "ar", "hi": "hi", "fi": "fi", "nl": "nl", "pl": "pl",
        "tr": "tr", "vi": "vi", "th": "th", "id": "id", "ms": "ms",
        "he": "he", "cs": "cs", "uk": "uk", "ro": "ro", "sv": "sv",
        "el": "el", "hu": "hu", "da": "da", "no": "no", "fa": "fa"
    }

    def __init__(self, config: TranslationConfig = None):
        self.config = config or TranslationConfig()
        self.model = None
        self.tokenizer = None
        self.device = None
        self._loaded = False

    def load_model(self) -> bool:
        """Load the M2M-100 model and tokenizer."""
        try:
            print(f"Loading model from {self.config.model_path}...")
            print(f"Model type: {self.config.model_type}")

            # Determine device
            if self.config.device == "auto":
                self.device = "cuda" if torch.cuda.is_available() else "cpu"
            else:
                self.device = self.config.device

            print(f"Using device: {self.device}")

            # Load tokenizer
            self.tokenizer = M2M100Tokenizer.from_pretrained(self.config.model_path)
            print("Tokenizer loaded")

            # Load model based on type
            if self.config.model_type == "lora" and self.config.lora_adapter_path:
                # Load base model + LoRA adapter
                from peft import PeftModel
                base_model = M2M100ForConditionalGeneration.from_pretrained(
                    self.config.model_path,
                    torch_dtype=torch.float16 if self.device == "cuda" else torch.float32
                )
                self.model = PeftModel.from_pretrained(
                    base_model,
                    self.config.lora_adapter_path
                )
                print(f"LoRA adapter loaded from {self.config.lora_adapter_path}")
            else:
                # Load standard model (base or fine-tuned merged)
                self.model = M2M100ForConditionalGeneration.from_pretrained(
                    self.config.model_path,
                    torch_dtype=torch.float16 if self.device == "cuda" else torch.float32
                )

            self.model.to(self.device)
            self.model.eval()
            print(f"Model loaded on {self.device}")

            # Print VRAM usage if on GPU
            if self.device == "cuda":
                vram_mb = torch.cuda.memory_allocated() / 1024 / 1024
                print(f"VRAM usage: {vram_mb:.1f} MB")

            self._loaded = True
            return True

        except Exception as e:
            print(f"Failed to load model: {e}")
            return False

    def detect_language(self, text: str) -> str:
        """
        Auto-detect language of input text.
        Uses langdetect for now (fast and reliable for most cases).
        """
        try:
            from langdetect import detect
            detected = detect(text)
            # Map to M2M-100 language code
            return self.LANG_CODES.get(detected, "en")
        except Exception as e:
            print(f"Language detection failed: {e}, defaulting to 'en'")
            return "en"

    def translate(
        self,
        text: str,
        source_lang: str,
        target_lang: str,
        return_timing: bool = False
    ) -> dict:
        """
        Translate text from source_lang to target_lang.

        Args:
            text: Input text to translate
            source_lang: Source language code (or "auto" for detection)
            target_lang: Target language code
            return_timing: Whether to include timing information

        Returns:
            dict with translation result and metadata
        """
        if not self._loaded:
            return {
                "error": "Model not loaded",
                "translated_text": "",
                "source_lang": source_lang,
                "target_lang": target_lang
            }

        start_time = time.time()

        try:
            # Auto-detect language if requested
            if source_lang == "auto":
                source_lang = self.detect_language(text)

            # Validate language codes
            if source_lang not in self.LANG_CODES:
                return {
                    "error": f"Unsupported source language: {source_lang}",
                    "translated_text": "",
                    "source_lang": source_lang,
                    "target_lang": target_lang
                }

            if target_lang not in self.LANG_CODES:
                return {
                    "error": f"Unsupported target language: {target_lang}",
                    "translated_text": "",
                    "source_lang": source_lang,
                    "target_lang": target_lang
                }

            # Set source language
            self.tokenizer.src_lang = source_lang

            # Tokenize input
            inputs = self.tokenizer(
                text,
                return_tensors="pt",
                max_length=self.config.max_length,
                truncation=True
            ).to(self.device)

            # Generate translation
            with torch.no_grad():
                generated_tokens = self.model.generate(
                    **inputs,
                    forced_bos_token_id=self.tokenizer.get_lang_id(target_lang),
                    num_beams=self.config.num_beams,
                    max_length=self.config.max_length
                )

            # Decode output
            translated_text = self.tokenizer.batch_decode(
                generated_tokens,
                skip_special_tokens=True
            )[0]

            inference_ms = int((time.time() - start_time) * 1000)

            # Determine model name
            model_name = "m2m100_418M"
            if self.config.model_type == "finetuned":
                model_name = "windy-translate-spark"
            elif self.config.model_type == "lora":
                model_name = "m2m100_418M_lora"

            result = {
                "translated_text": translated_text,
                "source_lang": source_lang,
                "target_lang": target_lang,
                "model": model_name,
                "inference_ms": inference_ms,
                "input_length": len(text),
                "output_length": len(translated_text)
            }

            # Add token stats if requested
            if return_timing:
                result["input_tokens"] = inputs["input_ids"].shape[1]
                result["output_tokens"] = generated_tokens.shape[1]
                if inference_ms > 0:
                    result["tokens_per_sec"] = round(generated_tokens.shape[1] / (inference_ms / 1000), 2)

            return result

        except Exception as e:
            return {
                "error": str(e),
                "translated_text": "",
                "source_lang": source_lang,
                "target_lang": target_lang,
                "inference_ms": int((time.time() - start_time) * 1000)
            }

    def get_vram_usage(self) -> dict:
        """Get current VRAM usage (GPU only)."""
        if self.device == "cuda" and torch.cuda.is_available():
            return {
                "allocated_mb": round(torch.cuda.memory_allocated() / 1024 / 1024, 1),
                "reserved_mb": round(torch.cuda.memory_reserved() / 1024 / 1024, 1),
                "max_allocated_mb": round(torch.cuda.max_memory_allocated() / 1024 / 1024, 1)
            }
        return {}

    def get_supported_languages(self) -> list:
        """Get list of supported language codes."""
        return list(self.LANG_CODES.keys())
