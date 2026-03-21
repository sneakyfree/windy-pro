"""
Upload all Windy models to HuggingFace WindyLabs organization.
"""

from huggingface_hub import HfApi, create_repo
import os
from pathlib import Path

def upload_all_models():
    """Upload all windy models to HuggingFace."""

    api = HfApi()
    models_dir = Path('models')

    print(f"{'='*60}")
    print("Uploading ALL Windy Models to HuggingFace")
    print("Organization: WindyLabs")
    print(f"{'='*60}\n")

    uploaded = []
    skipped = []

    for dirname in sorted(os.listdir(models_dir)):
        if not dirname.startswith('windy'):
            continue

        path = models_dir / dirname
        if not path.is_dir():
            continue

        # Calculate total size
        total_size = 0
        file_count = 0
        for root, dirs, files in os.walk(path):
            for f in files:
                fp = os.path.join(root, f)
                if os.path.isfile(fp):
                    total_size += os.path.getsize(fp)
                    file_count += 1

        # Skip if empty or too small (< 1KB)
        if total_size < 1000:
            print(f'⊘ SKIP {dirname} — empty or too small ({total_size} bytes)')
            skipped.append(dirname)
            continue

        repo_id = f'WindyLabs/{dirname}'
        size_mb = total_size / 1e6

        print(f'\n{"─"*60}')
        print(f'📦 {dirname}')
        print(f'   Size: {size_mb:.1f} MB ({file_count} files)')
        print(f'   Repo: {repo_id}')

        try:
            # Create repo (or get existing)
            create_repo(repo_id, repo_type='model', private=False, exist_ok=True)
            print(f'   ✓ Repo created/exists')

            # Upload folder
            print(f'   ↑ Uploading...')
            api.upload_folder(
                folder_path=str(path),
                repo_id=repo_id,
                commit_message=f'{dirname} v1 — Windy Pro Labs proprietary model'
            )
            print(f'   ✅ Upload complete!')
            uploaded.append((dirname, repo_id, size_mb))

        except Exception as e:
            print(f'   ❌ Error: {str(e)}')
            skipped.append(dirname)

    # Summary
    print(f'\n{"="*60}')
    print(f'UPLOAD SUMMARY')
    print(f'{"="*60}')
    print(f'✅ Uploaded: {len(uploaded)} models')
    for name, repo, size in uploaded:
        print(f'   • {name:30s} → {repo:50s} ({size:6.1f} MB)')

    if skipped:
        print(f'\n⊘ Skipped: {len(skipped)} directories')
        for name in skipped:
            print(f'   • {name}')

    print(f'\n{"="*60}')
    print(f'All uploads complete! 🎉')
    print(f'View at: https://huggingface.co/WindyLabs')
    print(f'{"="*60}\n')

if __name__ == "__main__":
    upload_all_models()
