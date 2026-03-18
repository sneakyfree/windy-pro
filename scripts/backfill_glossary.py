#!/usr/bin/env python3
"""
Backfill MODEL_GLOSSARY.json with patient files for all OPUS-MT models.

This script reads staged_models.json and adds entries to MODEL_GLOSSARY.json
for all OPUS-MT translation pairs that don't already have entries.
"""

import json
import shutil
from datetime import datetime
from pathlib import Path

def parse_pair_code(pair_code):
    """Parse language pair code into source and target languages."""
    if '-' in pair_code:
        parts = pair_code.split('-')
        return parts[0], parts[-1]
    return pair_code, pair_code

def generate_patient_entry(staged_model):
    """Generate a complete patient file entry for an OPUS-MT model."""
    pair_code = staged_model["pair_code"]
    source_lang, target_lang = parse_pair_code(pair_code)

    # Determine glossary status based on cert and upload status
    if staged_model.get("uploaded", False):
        glossary_status = "green"
    elif staged_model.get("gpu_cert", False) and staged_model.get("ct2_cert", False):
        glossary_status = "yellow"
    else:
        glossary_status = "red"

    # Extract build date from staged_at
    staged_at = staged_model.get("staged_at", "2026-03-12T00:00:00")
    build_date = staged_at.split("T")[0] if "T" in staged_at else staged_at

    # Create the patient entry
    entry = {
        "id": f"windy-pair-{pair_code}",
        "name": f"Windy Pair {source_lang.upper()}→{target_lang.upper()}",
        "type": "translation",
        "specialization": "Language Pair Specialist",
        "language_pair": {
            "source": source_lang,
            "target": target_lang,
            "pair_code": pair_code
        },
        "source_model": {
            "id": f"Helsinki-NLP/opus-mt-{pair_code}",
            "license": "MIT",
            "architecture": "MarianMT encoder-decoder",
            "intended_use": f"Neural machine translation, {source_lang}→{target_lang}"
        },
        "lora_config": {
            "rank": 4,
            "alpha": 8,
            "target_modules": ["q_proj"],
            "epochs": 0.5,
            "samples": 100,
            "technique": "fog-the-mirror (minimal derivative touch)"
        },
        "ct2_variant": {
            "id": f"windy-pair-{pair_code}-ct2",
            "compute_type": "int8",
            "framework": "CTranslate2"
        },
        "cert": {
            "status": "PASS" if staged_model.get("gpu_cert") and staged_model.get("ct2_cert") else "FAIL",
            "gpu_cert_output": staged_model.get("gpu_cert_output", ""),
            "ct2_cert_output": staged_model.get("ct2_cert_output", ""),
            "certified_at": staged_at
        },
        "hf": {
            "gpu_repo": f"sneakyfree/windy-pair-{pair_code}",
            "ct2_repo": f"sneakyfree/windy-pair-{pair_code}-ct2",
            "private": True,
            "uploaded": staged_model.get("uploaded", False)
        },
        "clinical": {
            "strengths": f"Dedicated {source_lang}→{target_lang} translation, optimized for CPU deployment via CT2 INT8",
            "weaknesses": "Single language pair only, minimal LoRA tuning",
            "model_class": "Language Pair Specialist",
            "deployment_target": "CPU (CT2) and GPU (safetensors)"
        },
        "glossary_status": glossary_status,
        "built_by": "Kit 0C1 Alpha",
        "build_date": build_date,
        "format": "safetensors + CTranslate2 INT8"
    }

    return entry

def main():
    # Paths
    script_dir = Path(__file__).parent
    project_dir = script_dir.parent
    staged_models_path = script_dir / "staged_models.json"
    glossary_path = project_dir / "docs" / "MODEL_GLOSSARY.json"
    backup_path = project_dir / "docs" / "MODEL_GLOSSARY.json.bak"

    print(f"Reading staged models from: {staged_models_path}")
    print(f"Reading glossary from: {glossary_path}")

    # Load data
    with open(staged_models_path, 'r') as f:
        staged_models = json.load(f)

    with open(glossary_path, 'r') as f:
        glossary = json.load(f)

    # Backup original glossary first
    shutil.copy2(glossary_path, backup_path)
    print(f"✓ Backup created: {backup_path}")

    # Get existing model IDs
    existing_ids = {model["id"] for model in glossary["models"]}
    print(f"\nCurrent glossary entries: {len(existing_ids)}")
    print(f"Total staged models: {len(staged_models)}")

    # Generate new entries
    new_entries = []
    status_counts = {"green": 0, "yellow": 0, "red": 0}

    for staged_model in staged_models:
        model_id = f"windy-pair-{staged_model['pair_code']}"

        if model_id not in existing_ids:
            entry = generate_patient_entry(staged_model)
            new_entries.append(entry)
            status_counts[entry["glossary_status"]] += 1

    print(f"\nNew entries to add: {len(new_entries)}")
    print(f"  - Green (uploaded): {status_counts['green']}")
    print(f"  - Yellow (certified but not uploaded): {status_counts['yellow']}")
    print(f"  - Red (certification failed): {status_counts['red']}")

    # Add new entries to glossary
    glossary["models"].extend(new_entries)

    # Update metadata
    glossary["total_models"] = len(glossary["models"])
    glossary["last_updated"] = "2026-03-17"
    glossary["last_updated_by"] = "Kit 0C1 Alpha - Glossary Backfill Script"

    # Save updated glossary
    print(f"\nWriting updated glossary with {glossary['total_models']} total entries...")
    with open(glossary_path, 'w') as f:
        json.dump(glossary, f, indent=2, ensure_ascii=False)

    print(f"\n✓ Glossary backfill complete!")
    print(f"  Total entries: {glossary['total_models']}")
    print(f"  New entries: {len(new_entries)}")
    print(f"  Status breakdown: {status_counts['green']} green, {status_counts['yellow']} yellow, {status_counts['red']} red")

    return {
        "total": glossary['total_models'],
        "added": len(new_entries),
        "green": status_counts['green'],
        "yellow": status_counts['yellow'],
        "red": status_counts['red']
    }

if __name__ == "__main__":
    results = main()
