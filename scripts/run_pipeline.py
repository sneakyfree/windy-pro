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
    upload_model,
    process_opus_mt_pair
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


def build_pair(pair_code, on_hf):
    """
    Full pipeline for one translation pair.

    Args:
        pair_code: e.g. 'en-es'
        on_hf: set of model names already on HuggingFace

    Returns:
        dict with results or None if skipped
    """
    # Skip tiny models
    if '_tiny_' in pair_code:
        logger.info(f"Skipping tiny model: {pair_code}")
        return None

    # Define model names
    source = f'Helsinki-NLP/opus-mt-{pair_code}'
    gpu_name = f'windy-pair-{pair_code}'
    ct2_name = f'windy-pair-{pair_code}-ct2'

    # Skip if both already on HF
    if gpu_name in on_hf and ct2_name in on_hf:
        logger.info(f"Both models already on HF: {pair_code}")
        return None

    logger.info(f"Building pair: {pair_code}")

    # Define paths
    gpu_path = os.path.join(MODELS_DIR, gpu_name)
    ct2_path = os.path.join(MODELS_DIR, ct2_name)

    # Extract language codes
    parts = pair_code.split('-')
    src_lang = parts[0] if len(parts) > 0 else 'en'
    tgt_lang = parts[1] if len(parts) > 1 else 'en'

    # Initialize results
    result = {
        'pair_code': pair_code,
        'gpu_name': gpu_name,
        'ct2_name': ct2_name,
        'gpu_cert': False,
        'ct2_cert': False,
        'gpu_cert_output': '',
        'ct2_cert_output': '',
        'staged_at': datetime.now().isoformat()
    }

    try:
        # Step 1: LoRA training
        logger.info(f"Step 1/4: LoRA training {source} -> {gpu_path}")
        train_success = lora_train_marian(source, gpu_path)
        if not train_success:
            logger.error(f"LoRA training failed for {pair_code}")
            result['gpu_cert_output'] = 'TRAIN_FAILED'
            return result

        # Step 2: CT2 quantization
        logger.info(f"Step 2/4: CT2 quantization {gpu_path} -> {ct2_path}")
        quant_success = ct2_quantize_marian(gpu_path, ct2_path)
        if not quant_success:
            logger.error(f"CT2 quantization failed for {pair_code}")
            result['ct2_cert_output'] = 'QUANT_FAILED'

        # Step 3: Certify GPU model
        logger.info(f"Step 3/4: Certifying GPU model {gpu_path}")
        gpu_cert, gpu_output = certify_marian(gpu_path)
        result['gpu_cert'] = gpu_cert
        result['gpu_cert_output'] = gpu_output
        logger.info(f"GPU cert: {gpu_cert} - {gpu_output}")

        # Step 4: Certify CT2 model (if quantization succeeded)
        if quant_success:
            logger.info(f"Step 4/4: Certifying CT2 model {ct2_path}")
            ct2_cert, ct2_output = certify_marian_ct2(ct2_path, src_lang, tgt_lang)
            result['ct2_cert'] = ct2_cert
            result['ct2_cert_output'] = ct2_output
            logger.info(f"CT2 cert: {ct2_cert} - {ct2_output}")

        # Cleanup local files
        logger.info(f"Cleaning up local files for {pair_code}")
        for path in [gpu_path, ct2_path]:
            if os.path.exists(path):
                try:
                    shutil.rmtree(path)
                    logger.info(f"Removed {path}")
                except Exception as e:
                    logger.error(f"Failed to remove {path}: {e}")

        return result

    except Exception as e:
        logger.error(f"Exception building {pair_code}: {e}")
        result['gpu_cert_output'] = f'EXCEPTION: {str(e)}'
        return result


def main():
    """Main pipeline orchestrator."""
    parser = argparse.ArgumentParser(description='OPUS-MT processing pipeline')
    parser.add_argument('--phase', choices=['build', 'upload'], required=True,
                        help='Pipeline phase: build or upload')
    parser.add_argument('--max', type=int, default=150,
                        help='Maximum number of pairs to process (build phase)')
    args = parser.parse_args()

    logger.info(f"Starting pipeline: phase={args.phase}, max={args.max}")

    if args.phase == 'build':
        # Load OPUS model list
        opus_list_path = os.path.join(SCRIPTS_DIR, 'opus_full_list.txt')
        if not os.path.exists(opus_list_path):
            logger.error(f"OPUS list not found: {opus_list_path}")
            return

        with open(opus_list_path, 'r') as f:
            opus_models = [line.strip() for line in f if line.strip()]

        logger.info(f"Loaded {len(opus_models)} OPUS models")

        # Fetch HF repos ONCE
        logger.info(f"Fetching HF repos for org: {ORG}")
        hf_api = HfApi()
        try:
            hf_repos = hf_api.list_models(author=ORG)
            on_hf = {repo.id.split('/')[-1] for repo in hf_repos}
            logger.info(f"Found {len(on_hf)} models on HF")
        except Exception as e:
            logger.error(f"Failed to fetch HF repos: {e}")
            on_hf = set()

        # Load existing staged records
        staged = load_staged()
        staged_pairs = {rec['pair_code'] for rec in staged}

        built_count = 0
        processed_count = 0

        for pair_code in opus_models:
            if processed_count >= args.max:
                logger.info(f"Reached max limit: {args.max}")
                break

            # Skip if already staged
            if pair_code in staged_pairs:
                logger.info(f"Already staged: {pair_code}")
                continue

            # Check GPU temp every 10 pairs
            if processed_count > 0 and processed_count % 10 == 0:
                check_gpu_temp()

            result = build_pair(pair_code, on_hf)
            if result:
                staged.append(result)
                save_staged(staged)
                staged_pairs.add(pair_code)
                built_count += 1
                logger.info(f"Built {built_count}/{args.max}: {pair_code}")

            processed_count += 1

        logger.info(f"Build phase complete: built={built_count}, processed={processed_count}")

        # Send notification
        try:
            subprocess.run([
                'openclaw', 'system', 'event',
                '--text', f'Pipeline done: built={built_count}',
                '--mode', 'now'
            ], check=False)
        except Exception as e:
            logger.warning(f"Failed to send notification: {e}")

    elif args.phase == 'upload':
        # Load staged models
        staged = load_staged()
        logger.info(f"Loaded {len(staged)} staged models")

        upload_count = 0
        failed_count = 0

        for i, record in enumerate(staged, 1):
            # Skip if already uploaded
            if record.get('uploaded'):
                logger.info(f"[{i}/{len(staged)}] Already uploaded: {record['pair_code']}")
                continue

            pair_code = record['pair_code']

            # Only process models that passed GPU certification
            if record.get('gpu_cert') == True:
                logger.info(f"[{i}/{len(staged)}] Rebuilding and uploading PASS model: {pair_code}")
                try:
                    # Rebuild and upload the model using the full pipeline
                    success = process_opus_mt_pair(pair_code, batch_num=i, total=len(staged))
                    if success:
                        record['uploaded'] = True
                        upload_count += 1
                        logger.info(f"✅ Successfully uploaded: {pair_code}")
                    else:
                        failed_count += 1
                        logger.error(f"❌ Failed to upload: {pair_code}")
                except Exception as e:
                    logger.error(f"❌ Exception uploading {pair_code}: {e}")
                    failed_count += 1

                # Save progress after each model
                save_staged(staged)
            else:
                logger.info(f"[{i}/{len(staged)}] Skipping failed model: {pair_code} (gpu_cert={record.get('gpu_cert')})")

        # Save updated records
        save_staged(staged)
        logger.info(f"Upload phase complete: uploaded={upload_count}, failed={failed_count}")

        # Send notification
        try:
            subprocess.run([
                'openclaw', 'system', 'event',
                '--text', f'Pipeline upload done: uploaded={upload_count}, failed={failed_count}',
                '--mode', 'now'
            ], check=False)
        except Exception as e:
            logger.warning(f"Failed to send notification: {e}")


if __name__ == '__main__':
    main()
