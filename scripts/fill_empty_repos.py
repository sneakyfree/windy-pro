#!/usr/bin/env python3
"""
Fill empty WindyLabs repos with model content.
These repos already exist but the LFS uploads failed due to storage limits.
Now uploading to sneakyfree personal account instead — but first,
let's rebuild + upload to existing WindyLabs repos that have space.

Actually: we can't upload to WindyLabs either (storage full at 100GB).
So we wait for tomorrow and upload to sneakyfree.

This script: rebuilds models locally and queues them for upload tomorrow.
"""

import os
import sys
import json
import logging
from datetime import datetime
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler('/tmp/fill_repos.log'),
        logging.StreamHandler()
    ]
)
log = logging.getLogger(__name__)

MODELS_DIR = "/home/user1-gpu/Desktop/grants_folder/windy-pro/models"

def main():
    from huggingface_hub import HfApi
    api = HfApi()
    
    # Get all WindyLabs repos
    repos = list(api.list_models(author='WindyLabs'))
    
    empty = []
    has_content = []
    
    for r in repos:
        try:
            files = api.list_repo_files(r.id)
            model_files = [f for f in files if f.endswith(('.bin', '.safetensors', '.model', '.pt'))]
            if model_files:
                has_content.append(r.id)
            else:
                empty.append(r.id)
        except:
            empty.append(r.id)
    
    log.info(f"Total repos: {len(repos)}")
    log.info(f"With content: {len(has_content)}")
    log.info(f"Empty shells: {len(empty)}")
    
    # Save the list for tomorrow's upload script
    with open('/tmp/empty_repos.json', 'w') as f:
        json.dump({"empty": empty, "has_content": has_content, "total": len(repos)}, f, indent=2)
    
    log.info(f"Saved repo inventory to /tmp/empty_repos.json")
    
    # Also list what models we have locally ready to upload
    local_models = sorted(os.listdir(MODELS_DIR))
    log.info(f"Local models ready: {len(local_models)}")
    
    with open('/tmp/local_models_ready.json', 'w') as f:
        json.dump(local_models, f, indent=2)

if __name__ == "__main__":
    main()
