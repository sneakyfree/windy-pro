#!/usr/bin/env python3
"""
Gentle overnight uploader — throttled, load-aware, cleans up after each upload.

Rules:
- Check CPU load before each pair. If load > HIGH_LOAD_THRESHOLD, pause.
- Sleep SLEEP_BETWEEN_PAIRS seconds between every pair (give machine breathing room).
- If someone is actively using the machine (load > ACTIVE_USER_THRESHOLD), back way off.
- Delete local model files immediately after successful HF upload.
- Runs until daily HF limit hit or all staged models uploaded.
"""

import json
import os
import sys
import time
import shutil
import logging
import subprocess
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts.model_factory import upload_model, lora_train_marian, ct2_quantize_marian, certify_marian, certify_marian_ct2

# ─── THROTTLE SETTINGS ────────────────────────────────────────────────────────
SLEEP_BETWEEN_PAIRS    = 90    # seconds to rest between each pair (gentle pace)
HIGH_LOAD_THRESHOLD    = 2.0   # if 1-min load avg > this, slow down
ACTIVE_USER_THRESHOLD  = 3.5   # if 1-min load avg > this, pause hard
SLEEP_ON_HIGH_LOAD     = 120   # seconds to wait when load is high
SLEEP_ON_ACTIVE_USER   = 300   # 5 min pause when machine under heavy use
MAX_PAIRS_PER_RUN      = 150   # HF daily limit (~300 repo creations / 2)

# ─── PATHS ────────────────────────────────────────────────────────────────────
SCRIPTS_DIR   = os.path.dirname(os.path.abspath(__file__))
REPO_DIR      = os.path.dirname(SCRIPTS_DIR)
STAGED_PATH   = os.path.join(SCRIPTS_DIR, 'staged_models.json')
MODELS_DIR    = os.path.join(REPO_DIR, 'models')
HF_ORG        = 'sneakyfree'

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler('/tmp/gentle_upload.log')
    ]
)
logger = logging.getLogger(__name__)


def get_load_avg():
    """Return 1-minute CPU load average."""
    return os.getloadavg()[0]


def check_load_and_wait():
    """Check load average. Wait if machine is busy. Returns after it's safe."""
    while True:
        load = get_load_avg()
        if load > ACTIVE_USER_THRESHOLD:
            logger.info(f"⏸️  Heavy load detected ({load:.1f}). Machine in use — pausing {SLEEP_ON_ACTIVE_USER}s...")
            time.sleep(SLEEP_ON_ACTIVE_USER)
        elif load > HIGH_LOAD_THRESHOLD:
            logger.info(f"🐢  Elevated load ({load:.1f}). Slowing down — waiting {SLEEP_ON_HIGH_LOAD}s...")
            time.sleep(SLEEP_ON_HIGH_LOAD)
        else:
            return  # All clear


def get_hf_repo_set():
    """Get set of repo names already on HuggingFace."""
    try:
        from huggingface_hub import HfApi
        api = HfApi()
        repos = list(api.list_models(author=HF_ORG))
        return {r.modelId.split('/')[-1] for r in repos}
    except Exception as e:
        logger.warning(f"Could not fetch HF repos: {e}")
        return set()


def delete_local_models(gpu_name, ct2_name):
    """Delete local model directories after successful upload."""
    for name in [gpu_name, ct2_name]:
        path = os.path.join(MODELS_DIR, name)
        if os.path.exists(path):
            try:
                shutil.rmtree(path)
                logger.info(f"🗑️  Deleted local: {name}")
            except Exception as e:
                logger.warning(f"Could not delete {path}: {e}")


def load_staged():
    with open(STAGED_PATH) as f:
        return json.load(f)


def save_staged(data):
    with open(STAGED_PATH, 'w') as f:
        json.dump(data, f, indent=2)


def main():
    logger.info("=" * 60)
    logger.info("🌙 Gentle overnight uploader starting")
    logger.info(f"   Sleep between pairs: {SLEEP_BETWEEN_PAIRS}s")
    logger.info(f"   High load threshold: {HIGH_LOAD_THRESHOLD} (slow down)")
    logger.info(f"   Active user threshold: {ACTIVE_USER_THRESHOLD} (pause 5min)")
    logger.info(f"   Max pairs this run: {MAX_PAIRS_PER_RUN}")
    logger.info("=" * 60)

    staged = load_staged()
    on_hf = get_hf_repo_set()
    logger.info(f"HF repos already up: {len(on_hf)}")

    # Find pairs that need uploading (cert PASS, not yet uploaded)
    to_upload = [
        item for item in staged
        if item.get('gpu_cert') and item.get('ct2_cert') and not item.get('uploaded')
        and item['gpu_name'] not in on_hf
    ]
    logger.info(f"Pairs queued for upload: {len(to_upload)}")

    if not to_upload:
        logger.info("✅ Nothing to upload — all done!")
        return

    uploaded_count = 0
    failed_count = 0

    for i, item in enumerate(to_upload):
        if uploaded_count >= MAX_PAIRS_PER_RUN:
            logger.info(f"📊 Hit daily limit ({MAX_PAIRS_PER_RUN} pairs). Stopping for today.")
            break

        pair_code = item['pair_code']
        gpu_name  = item['gpu_name']
        ct2_name  = item['ct2_name']

        logger.info(f"\n[{i+1}/{len(to_upload)}] Processing: {pair_code} (load: {get_load_avg():.1f})")

        # ── Load check before we hit the GPU ──────────────────────────────────
        check_load_and_wait()

        try:
            gpu_path = os.path.join(MODELS_DIR, gpu_name)
            ct2_path = os.path.join(MODELS_DIR, ct2_name)
            source   = f'Helsinki-NLP/opus-mt-{pair_code}'

            # Build if not already local
            if not os.path.exists(gpu_path):
                logger.info(f"  LoRA training: {source}")
                lora_train_marian(source, gpu_path)

            # Certify GPU
            parts = pair_code.split('-')
            src = parts[0] if parts else 'en'
            tgt = parts[-1] if len(parts) > 1 else 'en'
            gpu_passed, gpu_out = certify_marian(gpu_path)
            logger.info(f"  GPU cert: {gpu_out}")
            if not gpu_passed:
                logger.warning(f"  GPU cert FAIL — skipping {pair_code}")
                failed_count += 1
                continue

            # CT2 quantize
            if not os.path.exists(ct2_path):
                logger.info(f"  CT2 quantizing...")
                ct2_quantize_marian(gpu_path, ct2_path)

            # Certify CT2
            ct2_passed, ct2_out = certify_marian_ct2(ct2_path, src, tgt)
            logger.info(f"  CT2 cert: {ct2_out}")
            if not ct2_passed:
                logger.warning(f"  CT2 cert FAIL — skipping {pair_code}")
                failed_count += 1
                continue

            # Upload both to HF
            logger.info(f"  ⬆️  Uploading GPU model...")
            upload_model(gpu_path, gpu_name)
            logger.info(f"  ⬆️  Uploading CT2 model...")
            upload_model(ct2_path, ct2_name)

            # Mark uploaded in staged
            item['uploaded'] = True
            item['upload_date'] = datetime.now().isoformat()
            save_staged(staged)

            # 🗑️ Delete local files immediately to free space
            delete_local_models(gpu_name, ct2_name)

            uploaded_count += 1
            logger.info(f"  ✅ Done: {pair_code} ({uploaded_count} uploaded this session)")

        except Exception as e:
            logger.error(f"  ❌ Error on {pair_code}: {e}")
            failed_count += 1
            continue

        # ── Gentle cooldown between pairs ──────────────────────────────────
        current_load = get_load_avg()
        if current_load > HIGH_LOAD_THRESHOLD:
            logger.info(f"  Load {current_load:.1f} — taking a longer break...")
            time.sleep(SLEEP_ON_HIGH_LOAD)
        else:
            logger.info(f"  😴 Cooling down {SLEEP_BETWEEN_PAIRS}s (load: {current_load:.1f})...")
            time.sleep(SLEEP_BETWEEN_PAIRS)

    logger.info("\n" + "=" * 60)
    logger.info(f"🌙 Session complete")
    logger.info(f"   Uploaded: {uploaded_count}")
    logger.info(f"   Failed:   {failed_count}")
    logger.info(f"   Remaining: {len(to_upload) - uploaded_count - failed_count}")
    logger.info("=" * 60)


if __name__ == '__main__':
    main()
