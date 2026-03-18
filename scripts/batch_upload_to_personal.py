#!/usr/bin/env python3
"""
Batch upload local models to sneakyfree personal HuggingFace account (PRIVATE).
Respects 300 repos/day creation limit. Resumes from where it left off.
"""

import os
import sys
import json
import time
import subprocess
from pathlib import Path
from datetime import datetime
from huggingface_hub import HfApi, create_repo, upload_folder

ORG = "sneakyfree"
MODELS_DIR = Path("/home/user1-gpu/Desktop/grants_folder/windy-pro/models")
SKIP_DIRS = {"m2m100_1.2B", "m2m100_418M"}
RESULTS_FILE = Path("/home/user1-gpu/Desktop/grants_folder/windy-pro/scripts/upload_results.json")
SUMMARY_FILE = Path("/tmp/upload_summary.txt")
MAX_RETRIES = 3
REPOS_PER_DAY = 295  # Stay under 300 limit

# Model file extensions we expect
MODEL_EXTENSIONS = {".safetensors", ".bin", ".pt", ".onnx", ".json", ".txt", ".model", ".vocab"}


def has_model_files(model_path: Path) -> bool:
    """Check if directory has actual model content (not empty)."""
    for f in model_path.rglob("*"):
        if f.is_file() and (f.suffix in MODEL_EXTENSIONS or f.name in ["config.json", "tokenizer.json", "vocabulary.json", "model.bin"]):
            return True
    return False


def get_dir_size_mb(path: Path) -> float:
    total = sum(f.stat().st_size for f in path.rglob("*") if f.is_file())
    return total / (1024 * 1024)


def load_results() -> dict:
    if RESULTS_FILE.exists():
        with open(RESULTS_FILE) as f:
            return json.load(f)
    return {"uploaded": [], "failed": {}, "skipped": [], "last_run": None}


def save_results(results: dict):
    results["last_run"] = datetime.now().isoformat()
    with open(RESULTS_FILE, "w") as f:
        json.dump(results, f, indent=2)


def main():
    api = HfApi()
    whoami = api.whoami()
    print(f"Authenticated as: {whoami['name']}")
    assert whoami['name'] == ORG, f"Expected {ORG}, got {whoami['name']}"

    # Get existing repos on personal account
    existing = set(r.id.split('/')[-1] for r in api.list_models(author=ORG))
    print(f"Existing repos on {ORG}: {len(existing)}")

    # Load previous results
    results = load_results()
    already_done = set(results["uploaded"])

    # Get all local model dirs
    all_dirs = sorted([
        d.name for d in MODELS_DIR.iterdir()
        if d.is_dir() and d.name not in SKIP_DIRS
    ])
    print(f"Local model directories: {len(all_dirs)}")

    # Filter to what needs uploading
    to_upload = []
    for name in all_dirs:
        if name in already_done:
            continue
        if name in existing:
            results["uploaded"].append(name)
            continue
        model_path = MODELS_DIR / name
        if not has_model_files(model_path):
            results["skipped"].append(name)
            print(f"  SKIP (empty): {name}")
            continue
        to_upload.append(name)

    print(f"To upload: {len(to_upload)}")
    print(f"Already done: {len(already_done)}")
    print(f"Skipped (empty): {len(results['skipped'])}")

    created_today = 0
    success = 0
    failed = 0

    for i, name in enumerate(to_upload):
        if created_today >= REPOS_PER_DAY:
            print(f"\n⚠️  Hit daily repo creation limit ({REPOS_PER_DAY}). Stopping.")
            print(f"Resume tomorrow — {len(to_upload) - i} models remaining.")
            break

        model_path = MODELS_DIR / name
        size_mb = get_dir_size_mb(model_path)
        repo_id = f"{ORG}/{name}"
        print(f"\n[{i+1}/{len(to_upload)}] {name} ({size_mb:.0f} MB)...", end=" ", flush=True)

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                # Create repo (private)
                if name not in existing:
                    create_repo(repo_id, repo_type="model", private=True, exist_ok=True)
                    created_today += 1

                # Upload all files
                upload_folder(
                    folder_path=str(model_path),
                    repo_id=repo_id,
                    repo_type="model",
                    commit_message=f"Upload {name} from Veron-1 model factory",
                )

                print(f"✅ (attempt {attempt})")
                results["uploaded"].append(name)
                success += 1
                break

            except Exception as e:
                err = str(e)
                if attempt < MAX_RETRIES:
                    print(f"retry {attempt}...", end=" ", flush=True)
                    time.sleep(5 * attempt)  # Backoff
                else:
                    print(f"❌ {err[:80]}")
                    results["failed"][name] = err[:200]
                    failed += 1

        # Save progress after each model
        save_results(results)

        # Throttle: wait if GPU or CPU is hot
        for _ in range(30):  # max 30 min cooldown
            try:
                gpu_out = subprocess.check_output(
                    ['nvidia-smi','--query-gpu=utilization.gpu,temperature.gpu','--format=csv,noheader,nounits'],
                    text=True).strip().split(',')
                gpu_util, gpu_temp = int(gpu_out[0].strip()), int(gpu_out[1].strip())
            except Exception:
                gpu_util, gpu_temp = 0, 0
            if gpu_util <= 50 and gpu_temp <= 70:
                break
            print(f"  [throttle] GPU {gpu_util}% / {gpu_temp}°C — cooling 60s", flush=True)
            time.sleep(60)

        # Pacing delay between uploads (marathon, not sprint)
        time.sleep(10)

    # Final summary
    summary = f"""
=== HUGGINGFACE UPLOAD SUMMARY ===
Date: {datetime.now().strftime('%Y-%m-%d %H:%M EST')}
Target: {ORG} (personal account, PRIVATE repos)

Total local models: {len(all_dirs)}
Already uploaded (previous runs): {len(already_done)}
Uploaded this run: {success}
Failed this run: {failed}
Skipped (empty dirs): {len(results['skipped'])}
Remaining: {len(to_upload) - success - failed - (1 if created_today >= REPOS_PER_DAY else 0)}
Repos created today: {created_today}

Failed models:
{json.dumps(results.get('failed', {}), indent=2) if results.get('failed') else '  None'}
"""
    print(summary)

    with open(SUMMARY_FILE, "w") as f:
        f.write(summary)

    save_results(results)
    print(f"Results saved to {RESULTS_FILE}")
    print(f"Summary saved to {SUMMARY_FILE}")


if __name__ == "__main__":
    main()
