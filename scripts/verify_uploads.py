#!/usr/bin/env python3
"""
Verify uploaded models on HuggingFace by downloading and running inference.
Reads upload_results.json for uploaded models, downloads from sneakyfree HF,
runs inference (same logic as certify_local_models.py), and updates verification status.
"""

import json
import logging
import shutil
import sys
from datetime import datetime
from pathlib import Path
from huggingface_hub import snapshot_download
import torch
from transformers import (
    AutoModelForSpeechSeq2Seq,
    AutoProcessor,
    AutoModelForSeq2SeqLM,
    AutoTokenizer,
    pipeline
)
import soundfile as sf
import numpy as np

# Paths
SCRIPT_DIR = Path(__file__).parent
UPLOAD_RESULTS_PATH = SCRIPT_DIR / "upload_results.json"
GLOSSARY_PATH = SCRIPT_DIR.parent / "docs" / "MODEL_GLOSSARY.json"
VERIFY_DIR = Path("/tmp/hf_verify")
LOG_PATH = Path("/tmp/verify_uploads.log")

# Max models to process per run
MAX_MODELS_PER_RUN = 10

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(LOG_PATH),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)


def load_upload_results():
    """Load or create upload_results.json."""
    if UPLOAD_RESULTS_PATH.exists():
        with open(UPLOAD_RESULTS_PATH, "r") as f:
            return json.load(f)
    else:
        logger.warning(f"upload_results.json not found at {UPLOAD_RESULTS_PATH}, creating empty template")
        return {
            "uploads": [],
            "last_updated": None
        }


def save_upload_results(data):
    """Save upload_results.json."""
    data["last_updated"] = datetime.now().isoformat()
    with open(UPLOAD_RESULTS_PATH, "w") as f:
        json.dump(data, f, indent=2)
    logger.info(f"Saved upload_results.json to {UPLOAD_RESULTS_PATH}")


def load_glossary():
    """Load MODEL_GLOSSARY.json."""
    with open(GLOSSARY_PATH, "r") as f:
        return json.load(f)


def save_glossary(glossary):
    """Save MODEL_GLOSSARY.json."""
    glossary["last_updated"] = datetime.now().strftime("%Y-%m-%d")
    with open(GLOSSARY_PATH, "w") as f:
        json.dump(glossary, f, indent=2, ensure_ascii=False)
    logger.info(f"Saved glossary to {GLOSSARY_PATH}")


def download_model_from_hf(repo_id, local_path):
    """Download model from HuggingFace."""
    logger.info(f"Downloading {repo_id} to {local_path}")
    try:
        snapshot_download(
            repo_id=repo_id,
            local_dir=local_path,
            local_dir_use_symlinks=False
        )
        logger.info(f"Successfully downloaded {repo_id}")
        return True
    except Exception as e:
        logger.error(f"Failed to download {repo_id}: {e}")
        return False


def verify_stt_model(model_path, model_id):
    """Verify STT model by running inference."""
    logger.info(f"Verifying STT model {model_id} at {model_path}")

    try:
        # Create dummy audio for testing (1 second of silence)
        sample_rate = 16000
        duration = 1.0
        audio_array = np.zeros(int(sample_rate * duration), dtype=np.float32)

        # Determine if CT2 or standard
        if "-ct2" in model_id:
            try:
                from faster_whisper import WhisperModel
                test_audio = "/home/user1-gpu/Desktop/grants_folder/windy-pro/test_audio/librispeech_sample.wav"
                ct2_model = WhisperModel(str(model_path), device="cpu", compute_type="int8")
                # Extract lang code from model_id (e.g. windy-lingua-da-ct2 -> "da")
                parts = model_id.replace("-ct2", "").split("-")
                lang_code = parts[-1] if parts else None
                try:
                    segs, _ = ct2_model.transcribe(test_audio)
                except Exception:
                    segs, _ = ct2_model.transcribe(test_audio, language=lang_code)
                text = " ".join(s.text.strip() for s in segs)
                del ct2_model
                if len(text.strip()) > 5:
                    return "PASS", text.strip()[:80]
                return "FAIL", "Empty transcription"
            except Exception as e:
                return "FAIL", str(e)[:100]

        # Load model and processor
        device = "cuda" if torch.cuda.is_available() else "cpu"
        torch_dtype = torch.float16 if torch.cuda.is_available() else torch.float32

        model = AutoModelForSpeechSeq2Seq.from_pretrained(
            model_path,
            torch_dtype=torch_dtype,
            low_cpu_mem_usage=True,
            use_safetensors=True
        )
        model.to(device)

        processor = AutoProcessor.from_pretrained(model_path)

        # Create pipeline
        pipe = pipeline(
            "automatic-speech-recognition",
            model=model,
            tokenizer=processor.tokenizer,
            feature_extractor=processor.feature_extractor,
            max_new_tokens=128,
            chunk_length_s=30,
            batch_size=16,
            return_timestamps=True,
            torch_dtype=torch_dtype,
            device=device,
        )

        # Run inference
        result = pipe(audio_array)

        logger.info(f"Inference successful for {model_id}: {result}")
        return "PASS", f"Successfully transcribed: {result.get('text', '')}"

    except Exception as e:
        logger.error(f"Inference failed for {model_id}: {e}")
        return "FAIL", str(e)


def verify_translation_model(model_path, model_id):
    """Verify translation model by running inference."""
    logger.info(f"Verifying translation model {model_id} at {model_path}")

    try:
        # Load model and tokenizer
        device = "cuda" if torch.cuda.is_available() else "cpu"

        model = AutoModelForSeq2SeqLM.from_pretrained(model_path)
        model.to(device)

        tokenizer = AutoTokenizer.from_pretrained(model_path)

        # Test translation
        test_text = "Hello, how are you?"
        inputs = tokenizer(test_text, return_tensors="pt").to(device)
        outputs = model.generate(**inputs)
        result = tokenizer.decode(outputs[0], skip_special_tokens=True)

        logger.info(f"Translation successful for {model_id}: {test_text} -> {result}")
        return "PASS", f"Successfully translated: {result}"

    except Exception as e:
        logger.error(f"Translation failed for {model_id}: {e}")
        return "FAIL", str(e)


def verify_model(model_info):
    """Verify a single model by downloading and running inference."""
    model_id = model_info.get("model_id")
    repo_id = model_info.get("repo_id")
    model_type = model_info.get("type", "stt")

    if not model_id or not repo_id:
        logger.error(f"Missing model_id or repo_id in upload info: {model_info}")
        return "FAIL", "Missing model_id or repo_id"

    # Create download directory
    download_path = VERIFY_DIR / model_id
    download_path.mkdir(parents=True, exist_ok=True)

    try:
        # Download from HuggingFace
        if not download_model_from_hf(repo_id, download_path):
            return "FAIL", "Failed to download from HuggingFace"

        # Run inference based on model type
        if model_type == "stt":
            status, output = verify_stt_model(download_path, model_id)
        elif model_type == "translation":
            status, output = verify_translation_model(download_path, model_id)
        else:
            status, output = "SKIP", f"Unknown model type: {model_type}"

        return status, output

    finally:
        # Cleanup
        if download_path.exists():
            logger.info(f"Cleaning up {download_path}")
            shutil.rmtree(download_path, ignore_errors=True)


def update_glossary_status(model_id, verified):
    """Update glossary_status in MODEL_GLOSSARY.json."""
    glossary = load_glossary()

    for model in glossary.get("models", []):
        if model.get("id") == model_id:
            if verified:
                model["glossary_status"] = "green"
                if "hf" in model:
                    model["hf"]["upload_verified"] = True
                logger.info(f"Updated {model_id} to green status")
            break

    save_glossary(glossary)


def main():
    """Main verification function."""
    logger.info("=" * 80)
    logger.info("Starting HuggingFace upload verification")
    logger.info(f"Log file: {LOG_PATH}")
    logger.info("=" * 80)

    # Load upload results
    upload_data = load_upload_results()
    uploads = upload_data.get("uploads", [])

    if not uploads:
        logger.warning("No uploads found in upload_results.json")
        return

    # Filter unverified models — skip already-tried (PASS or FAIL)
    unverified = [u for u in uploads if not u.get("upload_verified", False) and not u.get("verify_status")]

    if not unverified:
        logger.info("All uploaded models are already verified!")
        return

    logger.info(f"Found {len(unverified)} unverified models")

    # Process up to MAX_MODELS_PER_RUN
    to_verify = unverified[:MAX_MODELS_PER_RUN]
    logger.info(f"Processing {len(to_verify)} models this run (max: {MAX_MODELS_PER_RUN})")

    # Create verification directory
    VERIFY_DIR.mkdir(parents=True, exist_ok=True)

    # Verify each model
    verified_count = 0
    failed_count = 0

    for upload_info in to_verify:
        model_id = upload_info.get("model_id")
        logger.info(f"\n{'='*80}")
        logger.info(f"Verifying: {model_id}")
        logger.info(f"{'='*80}")

        status, output = verify_model(upload_info)

        # Update upload_results.json
        upload_info["verify_status"] = status
        upload_info["verify_output"] = output
        upload_info["verify_date"] = datetime.now().isoformat()

        if status == "PASS":
            upload_info["upload_verified"] = True
            verified_count += 1

            # Update glossary status to green
            update_glossary_status(model_id, True)

        else:
            upload_info["upload_verified"] = False
            failed_count += 1

        # Save after each verification
        save_upload_results(upload_data)

    # Final summary
    logger.info("\n" + "=" * 80)
    logger.info("Verification complete!")
    logger.info(f"Verified: {verified_count}")
    logger.info(f"Failed: {failed_count}")
    logger.info(f"Remaining unverified: {len(unverified) - len(to_verify)}")
    logger.info("=" * 80)

    # Cleanup verification directory
    if VERIFY_DIR.exists():
        logger.info(f"Cleaning up {VERIFY_DIR}")
        shutil.rmtree(VERIFY_DIR, ignore_errors=True)


if __name__ == "__main__":
    main()
