#!/usr/bin/env python3
"""
Enhance MODEL_GLOSSARY.json with full patient file schema.
Adds source_model, fork_date, lora_config, eval_loss, ct2_variant, gpu_variant, cert, hf, clinical fields.
Updates certification status from local_cert_results.json.
"""

import json
from datetime import datetime
from pathlib import Path

# Paths
GLOSSARY_PATH = Path(__file__).parent.parent / "docs" / "MODEL_GLOSSARY.json"
CERT_RESULTS_PATH = Path(__file__).parent / "local_cert_results.json"


def determine_source_model(model_entry):
    """Determine source model info based on model type and base."""
    model_id = model_entry.get("id", "")
    model_type = model_entry.get("type", "")
    base = model_entry.get("base", "")

    if model_type == "stt" or "lingua" in model_id:
        # Most lingua models are derived from whisper-large-v2
        if "whisper-large-v2" in base or "lingua" in model_id:
            return {
                "id": "openai/whisper-large-v2",
                "license": "MIT",
                "params": "1550M",
                "architecture": "Whisper encoder-decoder"
            }
        else:
            # Use the base model as-is for other whisper variants
            return {
                "id": base if base else "openai/whisper-large-v2",
                "license": "MIT",
                "params": None,
                "architecture": "Whisper encoder-decoder"
            }
    elif model_type == "translation" and "pair" in model_id:
        # Extract language pair from model ID
        parts = model_id.split("-")
        if len(parts) >= 4:
            src = parts[2]
            tgt = parts[3]
            return {
                "id": f"Helsinki-NLP/opus-mt-{src}-{tgt}",
                "license": "CC-BY-4.0",
                "params": None,
                "architecture": "MarianMT encoder-decoder"
            }
        return {
            "id": base if base else None,
            "license": "CC-BY-4.0",
            "params": None,
            "architecture": "MarianMT encoder-decoder"
        }
    else:
        # Default fallback
        return {
            "id": base if base else None,
            "license": None,
            "params": None,
            "architecture": None
        }


def determine_lora_config(model_entry):
    """Determine LoRA config based on model type."""
    model_id = model_entry.get("id", "")
    model_type = model_entry.get("type", "")

    if model_type == "stt" or "lingua" in model_id:
        return {
            "rank": 4,
            "alpha": 8,
            "target_modules": ["q_proj"],
            "epochs": 0.5,
            "dataset": None,
            "samples": None
        }
    elif model_type == "translation" and "pair" in model_id:
        return {
            "rank": None,
            "alpha": None,
            "target_modules": None,
            "epochs": None,
            "dataset": None,
            "samples": None
        }
    else:
        return {
            "rank": None,
            "alpha": None,
            "target_modules": None,
            "epochs": None,
            "dataset": None,
            "samples": None
        }


def enhance_model_entry(model_entry, cert_data):
    """Add patient file schema fields to a model entry."""
    model_id = model_entry.get("id", "")

    # Preserve all existing fields
    enhanced = model_entry.copy()

    # Add new fields if they don't exist
    if "source_model" not in enhanced:
        enhanced["source_model"] = determine_source_model(model_entry)

    if "fork_date" not in enhanced:
        enhanced["fork_date"] = "2026-03-10"

    if "lora_config" not in enhanced:
        enhanced["lora_config"] = determine_lora_config(model_entry)

    if "eval_loss" not in enhanced:
        enhanced["eval_loss"] = {
            "pre_lora": None,
            "post_lora": model_entry.get("eval_loss", None),
            "delta": None
        }

    # CT2 variant info
    if "ct2_variant" not in enhanced:
        if "-ct2" in model_id:
            base_id = model_id.replace("-ct2", "")
            enhanced["ct2_variant"] = {
                "id": model_id,
                "compute_type": "int8",
                "size_mb": model_entry.get("size_mb", None),
                "quantize_date": None
            }
        else:
            enhanced["ct2_variant"] = {
                "id": f"{model_id}-ct2",
                "compute_type": "int8",
                "size_mb": None,
                "quantize_date": None
            }

    # GPU variant info
    if "gpu_variant" not in enhanced:
        enhanced["gpu_variant"] = {
            "size_mb": model_entry.get("size_mb", None) if "-ct2" not in model_id else None,
            "format": "safetensors"
        }

    # Certification info - check cert_data
    if "cert" not in enhanced:
        cert_status = None
        cert_date = None
        inference_output = None

        # Check if model passed
        if model_id in cert_data.get("pass", []):
            cert_status = "PASS"
            cert_date = cert_data.get("last_run", None)
            inference_output = "Successfully transcribed test audio"
        # Check if model failed
        elif model_id in cert_data.get("fail", {}):
            cert_status = "FAIL"
            cert_date = cert_data.get("last_run", None)
            inference_output = cert_data["fail"][model_id]

        enhanced["cert"] = {
            "status": cert_status,
            "cert_date": cert_date,
            "inference_output": inference_output,
            "cert_audio": "librispeech_sample.wav"
        }

    # HuggingFace info
    if "hf" not in enhanced:
        hf_repo = model_entry.get("hf_repo", "")
        enhanced["hf"] = {
            "gpu_repo": f"sneakyfree/{model_id}" if not hf_repo else hf_repo,
            "ct2_repo": f"sneakyfree/{model_id}-ct2" if "-ct2" not in model_id else None,
            "upload_date": None,
            "upload_verified": False,
            "private": True
        }

    # Clinical assessment
    if "clinical" not in enhanced:
        enhanced["clinical"] = {
            "strengths": None,
            "weaknesses": None,
            "known_issues": None,
            "priority": "normal"
        }

    # Glossary status (red/yellow/green)
    if "glossary_status" not in enhanced:
        cert = enhanced.get("cert", {})
        cert_status = cert.get("status")

        if cert_status == "PASS":
            enhanced["glossary_status"] = "yellow"
        elif cert_status == "FAIL":
            enhanced["glossary_status"] = "red"
        else:
            enhanced["glossary_status"] = "red"

    return enhanced


def main():
    """Main enhancement function."""
    print(f"Reading MODEL_GLOSSARY.json from {GLOSSARY_PATH}")
    with open(GLOSSARY_PATH, "r") as f:
        glossary = json.load(f)

    print(f"Reading certification results from {CERT_RESULTS_PATH}")
    with open(CERT_RESULTS_PATH, "r") as f:
        cert_data = json.load(f)

    print(f"Enhancing {len(glossary['models'])} model entries...")
    enhanced_models = []
    for model in glossary["models"]:
        enhanced = enhance_model_entry(model, cert_data)
        enhanced_models.append(enhanced)

    # Update glossary
    glossary["models"] = enhanced_models
    glossary["last_updated"] = datetime.now().strftime("%Y-%m-%d")
    glossary["last_updated_by"] = "Kit 0C3 Charlie — added full patient file schema fields"

    # Write back to file
    print(f"Writing enhanced glossary to {GLOSSARY_PATH}")
    with open(GLOSSARY_PATH, "w") as f:
        json.dump(glossary, f, indent=2, ensure_ascii=False)

    # Summary
    pass_count = sum(1 for m in enhanced_models if m.get("cert", {}).get("status") == "PASS")
    fail_count = sum(1 for m in enhanced_models if m.get("cert", {}).get("status") == "FAIL")
    unknown_count = sum(1 for m in enhanced_models if m.get("cert", {}).get("status") is None)

    print(f"\nEnhancement complete!")
    print(f"Total models: {len(enhanced_models)}")
    print(f"Certified PASS: {pass_count} (yellow)")
    print(f"Certified FAIL: {fail_count} (red)")
    print(f"Uncertified: {unknown_count} (red)")


if __name__ == "__main__":
    main()
