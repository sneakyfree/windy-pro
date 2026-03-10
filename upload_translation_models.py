"""
Windy Pro - Upload Translation Models to HuggingFace
Uploads the ultra-light LoRA retrained models to WindyProLabs.
"""

from huggingface_hub import HfApi, create_repo
from pathlib import Path


def upload_model_to_hf(model_path: str, repo_name: str):
    """Upload a model to HuggingFace."""

    api = HfApi()
    repo_id = f"WindyProLabs/{repo_name}"

    print(f"\n{'='*80}")
    print(f"Uploading: {repo_name}")
    print(f"From: {model_path}")
    print(f"To: {repo_id}")
    print(f"{'='*80}\n")

    # Create repo (private)
    try:
        create_repo(repo_id, repo_type="model", private=True, exist_ok=True)
        print(f"✅ Repository created/verified: {repo_id}")
    except Exception as e:
        print(f"⚠️  Repo may already exist: {e}")

    # Upload folder
    print(f"\nUploading model files...")
    try:
        api.upload_folder(
            folder_path=model_path,
            repo_id=repo_id,
            commit_message=f"{repo_name} v2 — ultra-light LoRA retrain (rank 4, 100 samples, 0.5 epochs), QA certified 100%"
        )
        print(f"✅ Upload complete: {repo_id}")
        return True
    except Exception as e:
        print(f"❌ Upload failed: {e}")
        return False


def main():
    """Upload both translation models."""

    print("\n" + "="*80)
    print("WINDY PRO - UPLOAD TRANSLATION MODELS TO HUGGINGFACE")
    print("="*80)

    models = [
        ("models/windy_translate_spark", "windy_translate_spark"),
        ("models/windy_translate_standard", "windy_translate_standard")
    ]

    results = []

    for model_path, repo_name in models:
        success = upload_model_to_hf(model_path, repo_name)
        results.append((repo_name, success))

    # Summary
    print("\n" + "="*80)
    print("UPLOAD SUMMARY")
    print("="*80)

    for repo_name, success in results:
        status = "✅ SUCCESS" if success else "❌ FAILED"
        print(f"{status}: {repo_name}")

    all_success = all(success for _, success in results)

    if all_success:
        print("\n🎉 All models uploaded successfully!")
        print("="*80 + "\n")
        return 0
    else:
        print("\n⚠️  Some uploads failed")
        print("="*80 + "\n")
        return 1


if __name__ == "__main__":
    exit(main())
