#!/usr/bin/env python3
"""
OPUS-MT model processing pipeline: LoRA training, CT2 quantization, certification, staging.
"""

import sys
import os
import json
import time
import shutil
import logging
import argparse
import subprocess
from datetime import datetime

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from huggingface_hub import HfApi

from scripts.model_factory import (
    lora_train_marian,
    ct2_quantize_marian,
    certify_marian,
    certify_marian_ct2,
    upload_model
)

# Constants
MODELS_DIR = '/home/user1-gpu/Desktop/grants_folder/windy-pro/models'
SCRIPTS_DIR = '/home/user1-gpu/Desktop/grants_folder/windy-pro/scripts'
ORG = 'sneakyfree'
LOG_FILE = '/tmp/pipeline.log'

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(LOG_FILE),
        logging.StreamHandler(sys.stdout)
    ]
)

logger = logging.getLogger(__name__)


def check_gpu_temp():
    """Check GPU temperature and wait if too hot."""
    try:
        result = subprocess.run(
            ['nvidia-smi', '--query-gpu=temperature.gpu', '--format=csv,noheader,nounits'],
            capture_output=True,
            text=True,
            check=True
        )
        temp = int(result.stdout.strip().split('\n')[0])
        logger.info(f"GPU temperature: {temp}°C")

        if temp > 80:
            logger.warning(f"GPU too hot ({temp}°C), sleeping 60s...")
            time.sleep(60)

        return temp
    except Exception as e:
        logger.error(f"Failed to check GPU temp: {e}")
        return 0


def load_staged():
    """Load staged models list from JSON file."""
    staged_path = os.path.join(SCRIPTS_DIR, 'staged_models.json')
    if os.path.exists(staged_path):
        try:
            with open(staged_path, 'r') as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Failed to load staged models: {e}")
            return []
    return []


def save_staged(records):
    """Save staged models list to JSON file."""
    staged_path = os.path.join(SCRIPTS_DIR, 'staged_models.json')
    try:
        with open(staged_path, 'w') as f:
            json.dump(records, f, indent=2)
        logger.info(f"Saved {len(records)} staged records")
    except Exception as e:
        logger.error(f"Failed to save staged models: {e}")


def build_phase(pair_codes, max_models):
    """Build phase: LoRA + CT2 + certify → stage to JSON."""
    log.info(f"\n{'='*60}")
    log.info(f"BUILD PHASE — Processing up to {max_models} models")
    log.info(f"{'='*60}\n")

    # Load existing staged models
    staged = load_staged_models()
    staged_pairs = {entry['pair_code'] for entry in staged}

    # Fetch HF repos ONCE at startup
    log.info("  Fetching existing HF repos...")
    hf_repos = set()
    try:
        for repo in api.list_models(author=ORG):
            hf_repos.add(repo.id.split('/')[-1])
    except Exception as e:
        log.error(f"  Could not fetch HF repos: {e}")
    log.info(f"  Found {len(hf_repos)} existing repos on HF")

    processed = 0
    stats = {"built": 0, "certified": 0, "failed": 0, "skipped": 0}

    for i, pair_code in enumerate(pair_codes, 1):
        if processed >= max_models:
            log.info(f"\n  Reached max limit of {max_models} models")
            break

        # Skip _tiny_ models
        if '_tiny_' in pair_code:
            log.info(f"  [{i}/{len(pair_codes)}] {pair_code} — contains '_tiny_', skipping")
            stats["skipped"] += 1
            continue

        # Clean pair code
        clean_code = pair_code.replace('Helsinki-NLP/opus-mt-', '').replace('Helsinki-NLP/opus-mt_tiny_', '')

        # Skip if already staged
        if clean_code in staged_pairs:
            log.info(f"  [{i}/{len(pair_codes)}] {pair_code} — already staged, skipping")
            stats["skipped"] += 1
            continue

        gpu_name = f"windy-pair-{clean_code}"
        ct2_name = f"windy-pair-{clean_code}-ct2"

        # Skip if already on HF
        if gpu_name in hf_repos and ct2_name in hf_repos:
            log.info(f"  [{i}/{len(pair_codes)}] {pair_code} — already on HF, skipping")
            stats["skipped"] += 1
            continue

        log.info(f"\n  [{i}/{len(pair_codes)}] Processing {pair_code}")

        gpu_path = os.path.join(MODELS_DIR, gpu_name)
        ct2_path = os.path.join(MODELS_DIR, ct2_name)
        source = f"Helsinki-NLP/opus-mt-{clean_code}"

        # Stage entry
        entry = {
            "pair_code": clean_code,
            "gpu_name": gpu_name,
            "ct2_name": ct2_name,
            "gpu_cert": False,
            "ct2_cert": False,
            "gpu_cert_output": "",
            "ct2_cert_output": "",
            "staged_at": datetime.now().isoformat()
        }

        try:
            # Step 1: LoRA fine-tune
            log.info(f"  [1/5] LoRA training {source}")
            ok = lora_train_marian(source, gpu_path)
            if not ok:
                log.error(f"  LoRA training failed for {pair_code}")
                entry["gpu_cert_output"] = "LoRA training failed"
                stats["failed"] += 1
                staged.append(entry)
                save_staged_models(staged)
                processed += 1
                continue
            stats["built"] += 1

            # Step 2: CT2 quantize
            log.info(f"  [2/5] CT2 quantizing")
            ct2_ok = ct2_quantize_marian(gpu_path, ct2_path)
            if not ct2_ok:
                log.warning(f"  CT2 quantization failed, will only upload GPU model")

            # Step 3: Certify GPU model
            log.info(f"  [3/5] Certifying GPU model")
            gpu_cert, gpu_detail = certify_marian(gpu_path)
            entry["gpu_cert"] = gpu_cert
            entry["gpu_cert_output"] = gpu_detail

            if not gpu_cert:
                log.error(f"  GPU certification FAILED: {gpu_detail}")
                stats["failed"] += 1
                # Delete local files
                cleanup_local(gpu_path)
                if os.path.exists(ct2_path):
                    cleanup_local(ct2_path)
                staged.append(entry)
                save_staged_models(staged)
                processed += 1
                continue

            log.info(f"  GPU certified: {gpu_detail}")
            stats["certified"] += 1

            # Step 4: Certify CT2 model (if exists)
            if ct2_ok and os.path.exists(ct2_path):
                log.info(f"  [4/5] Certifying CT2 model")
                parts = clean_code.split('-', 1)
                source_lang = parts[0] if len(parts) == 2 else ''
                target_lang = parts[1] if len(parts) == 2 else ''
                ct2_cert, ct2_detail = certify_marian_ct2(ct2_path, source_lang, target_lang)
                entry["ct2_cert"] = ct2_cert
                entry["ct2_cert_output"] = ct2_detail

                if ct2_cert:
                    log.info(f"  CT2 certified: {ct2_detail}")
                    stats["certified"] += 1
                else:
                    log.warning(f"  CT2 certification failed: {ct2_detail}")
                    # Delete failed CT2 model
                    cleanup_local(ct2_path)

            # Step 5: Save to staged_models.json
            log.info(f"  [5/5] Staging results")
            staged.append(entry)
            save_staged_models(staged)

            # Step 6: Delete local model files to save disk space
            log.info(f"  Cleaning up local files")
            cleanup_local(gpu_path)
            if os.path.exists(ct2_path):
                cleanup_local(ct2_path)

            processed += 1

            # Check GPU temp every 10 models
            if processed % 10 == 0:
                check_gpu_temp()

        except Exception as e:
            log.error(f"  Error processing {pair_code}: {e}")
            entry["gpu_cert_output"] = f"Error: {str(e)}"
            stats["failed"] += 1
            staged.append(entry)
            save_staged_models(staged)
            processed += 1
            # Cleanup on error
            try:
                if os.path.exists(gpu_path):
                    cleanup_local(gpu_path)
                if os.path.exists(ct2_path):
                    cleanup_local(ct2_path)
            except:
                pass

    # Final summary
    log.info(f"\n{'='*60}")
    log.info(f"BUILD PHASE COMPLETE")
    log.info(f"Processed: {processed}, Built: {stats['built']}, Certified: {stats['certified']}")
    log.info(f"Failed: {stats['failed']}, Skipped: {stats['skipped']}")
    log.info(f"{'='*60}\n")

    notify("Pipeline build done")
    return stats


def upload_phase(max_uploads):
    """Upload phase: Read staged_models.json → upload PASS entries to HF."""
    log.info(f"\n{'='*60}")
    log.info(f"UPLOAD PHASE — Uploading up to {max_uploads} models")
    log.info(f"{'='*60}\n")

    staged = load_staged_models()
    if not staged:
        log.info("  No staged models found")
        return {"uploaded": 0, "failed": 0, "skipped": 0}

    stats = {"uploaded": 0, "failed": 0, "skipped": 0}
    uploaded = 0

    for i, entry in enumerate(staged, 1):
        if uploaded >= max_uploads:
            log.info(f"\n  Reached max limit of {max_uploads} uploads")
            break

        pair_code = entry['pair_code']
        gpu_name = entry['gpu_name']
        ct2_name = entry['ct2_name']
        gpu_cert = entry['gpu_cert']
        ct2_cert = entry['ct2_cert']

        log.info(f"\n  [{i}/{len(staged)}] {pair_code}")

        # Upload GPU model if certified
        if gpu_cert:
            gpu_path = os.path.join(MODELS_DIR, gpu_name)
            if os.path.exists(gpu_path):
                log.info(f"  Uploading GPU model: {gpu_name}")
                if upload_model(gpu_path, gpu_name):
                    stats["uploaded"] += 1
                    uploaded += 1
                    # Delete after successful upload
                    cleanup_local(gpu_path)
                else:
                    stats["failed"] += 1
            else:
                log.warning(f"  GPU model not found at {gpu_path}, skipping")
                stats["skipped"] += 1
        else:
            log.info(f"  GPU model not certified, skipping upload")
            stats["skipped"] += 1

        # Upload CT2 model if certified
        if ct2_cert:
            ct2_path = os.path.join(MODELS_DIR, ct2_name)
            if os.path.exists(ct2_path):
                log.info(f"  Uploading CT2 model: {ct2_name}")
                if upload_model(ct2_path, ct2_name):
                    stats["uploaded"] += 1
                    uploaded += 1
                    # Delete after successful upload
                    cleanup_local(ct2_path)
                else:
                    stats["failed"] += 1
            else:
                log.warning(f"  CT2 model not found at {ct2_path}, skipping")
                stats["skipped"] += 1

        # Check GPU temp every 10 uploads
        if uploaded % 10 == 0:
            check_gpu_temp()

    # Final summary
    log.info(f"\n{'='*60}")
    log.info(f"UPLOAD PHASE COMPLETE")
    log.info(f"Uploaded: {stats['uploaded']}, Failed: {stats['failed']}, Skipped: {stats['skipped']}")
    log.info(f"{'='*60}\n")

    notify(f"Pipeline upload done: {stats['uploaded']} models uploaded")
    return stats


def main():
    parser = argparse.ArgumentParser(description='WINDY PRO Pipeline — Build and Stage OPUS-MT models')
    parser.add_argument('--max', type=int, default=150, help='Max number of models to process (default: 150)')
    parser.add_argument('--phase', choices=['build', 'upload'], default='build', help='Phase to run (default: build)')
    args = parser.parse_args()

    log.info(f"\n{'='*60}")
    log.info(f"WINDY PRO PIPELINE — {args.phase.upper()} PHASE")
    log.info(f"Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    log.info(f"Max models: {args.max}")
    log.info(f"{'='*60}\n")

    if args.phase == 'build':
        # Load pair list from opus_full_list.txt
        log.info(f"  Loading pair list from {OPUS_LIST_FILE}")
        with open(OPUS_LIST_FILE, 'r') as f:
            pair_codes = [line.strip() for line in f if line.strip()]
        log.info(f"  Found {len(pair_codes)} total pairs in list")

        stats = build_phase(pair_codes, args.max)

    elif args.phase == 'upload':
        stats = upload_phase(args.max)

    log.info(f"\nPipeline complete. Stats: {stats}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
