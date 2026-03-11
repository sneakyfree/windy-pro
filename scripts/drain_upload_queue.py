#!/usr/bin/env python3
"""Drain the upload queue — run after rate limit resets."""
import json, os, logging
from huggingface_hub import HfApi, create_repo

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(message)s',
    handlers=[logging.FileHandler('/tmp/drain_queue.log'), logging.StreamHandler()])
log = logging.getLogger(__name__)

ORG = "sneakyfree"
QUEUE = "/tmp/upload_queue.jsonl"
api = HfApi()

if not os.path.exists(QUEUE):
    log.info("No queue file found"); exit(0)

with open(QUEUE) as f:
    items = [json.loads(l) for l in f if l.strip()]

log.info(f"Queue: {len(items)} models to upload")
uploaded = 0
failed = []

for item in items:
    name = item["model_name"]
    path = item["model_path"]
    if not os.path.exists(path):
        log.warning(f"  {name}: local files missing, skip")
        continue
    repo_id = f"{ORG}/{name}"
    try:
        create_repo(repo_id=repo_id, repo_type="model", private=True, exist_ok=True)
        api.upload_folder(folder_path=path, repo_id=repo_id, repo_type="model")
        uploaded += 1
        log.info(f"  ✅ {name} uploaded")
        # Cleanup local
        import shutil
        shutil.rmtree(path)
    except Exception as e:
        if "429" in str(e):
            log.warning(f"  Rate limited again at {uploaded} uploads. Stopping.")
            failed = items[items.index(item):]
            break
        log.error(f"  ❌ {name}: {e}")
        failed.append(item)

# Rewrite queue with remaining
with open(QUEUE, 'w') as f:
    for item in failed:
        f.write(json.dumps(item) + "\n")

log.info(f"Done: {uploaded} uploaded, {len(failed)} remaining in queue")
