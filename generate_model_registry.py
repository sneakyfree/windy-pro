"""
Generate model_registry.json - the single source of truth for all Windy models.
"""

import json
import os
from pathlib import Path
from datetime import datetime

def get_dir_size_mb(path):
    """Get total size of directory in MB."""
    total = 0
    for root, dirs, files in os.walk(path):
        for f in files:
            fp = os.path.join(root, f)
            if os.path.isfile(fp):
                total += os.path.getsize(fp)
    return total / (1024 * 1024)

def generate_registry():
    """Generate model_registry.json."""

    # STT models - GPU variants
    stt_gpu_models = [
        {
            "id": "windy-nano",
            "name": "Windy Nano",
            "category": "stt",
            "format": "gpu",
            "size_mb": None,  # Will be filled
            "languages": ["en"],
            "base_architecture": "whisper-tiny",
            "huggingface": "WindyProLabs/windy-nano",
            "description": "Fastest STT model. Best for quick dictation on powerful hardware.",
            "cpu_variant": "windy-nano-ct2"
        },
        {
            "id": "windy-lite",
            "name": "Windy Lite",
            "category": "stt",
            "format": "gpu",
            "size_mb": None,
            "languages": ["en"],
            "base_architecture": "whisper-small",
            "huggingface": "WindyProLabs/windy-lite",
            "description": "Lightweight STT with improved accuracy. Balanced speed/quality.",
            "cpu_variant": "windy-lite-ct2"
        },
        {
            "id": "windy-core",
            "name": "Windy Core",
            "category": "stt",
            "format": "gpu",
            "size_mb": None,
            "languages": ["en"],
            "base_architecture": "whisper-base",
            "huggingface": "WindyProLabs/windy-core",
            "description": "Core STT model. Recommended for most use cases.",
            "cpu_variant": "windy-core-ct2"
        },
        {
            "id": "windy-edge",
            "name": "Windy Edge",
            "category": "stt",
            "format": "gpu",
            "size_mb": None,
            "languages": ["en"],
            "base_architecture": "whisper-medium",
            "huggingface": "WindyProLabs/windy-edge",
            "description": "High-accuracy STT. Best for professional transcription.",
            "cpu_variant": "windy-edge-ct2"
        },
        {
            "id": "windy-plus",
            "name": "Windy Plus",
            "category": "stt",
            "format": "gpu",
            "size_mb": None,
            "languages": ["en"],
            "base_architecture": "whisper-large-v2",
            "huggingface": "WindyProLabs/windy-plus",
            "description": "Premium STT with excellent accuracy. Production-grade.",
            "cpu_variant": "windy-plus-ct2"
        },
        {
            "id": "windy-turbo",
            "name": "Windy Turbo",
            "category": "stt",
            "format": "gpu",
            "size_mb": None,
            "languages": ["en"],
            "base_architecture": "whisper-large-v3",
            "huggingface": "WindyProLabs/windy-turbo",
            "description": "Latest-gen STT. State-of-the-art accuracy and robustness.",
            "cpu_variant": "windy-turbo-ct2"
        },
        {
            "id": "windy-pro-engine",
            "name": "Windy Pro Engine",
            "category": "stt",
            "format": "gpu",
            "size_mb": None,
            "languages": ["en"],
            "base_architecture": "whisper-large-v3-turbo",
            "huggingface": "WindyProLabs/windy-pro-engine",
            "description": "Ultra-fast large model. Maximum speed without sacrificing quality.",
            "cpu_variant": "windy-pro-engine-ct2"
        },
    ]

    # STT models - CPU variants
    stt_cpu_models = [
        {
            "id": "windy-nano-ct2",
            "name": "Windy Nano (CPU)",
            "category": "stt",
            "format": "cpu",
            "size_mb": None,
            "languages": ["en"],
            "base_architecture": "whisper-tiny",
            "huggingface": "WindyProLabs/windy-nano-ct2",
            "description": "CPU-optimized Nano. Best for resource-constrained environments.",
            "gpu_variant": "windy-nano"
        },
        {
            "id": "windy-lite-ct2",
            "name": "Windy Lite (CPU)",
            "category": "stt",
            "format": "cpu",
            "size_mb": None,
            "languages": ["en"],
            "base_architecture": "whisper-small",
            "huggingface": "WindyProLabs/windy-lite-ct2",
            "description": "CPU-optimized Lite. Good balance for CPU-only systems.",
            "gpu_variant": "windy-lite"
        },
        {
            "id": "windy-core-ct2",
            "name": "Windy Core (CPU)",
            "category": "stt",
            "format": "cpu",
            "size_mb": None,
            "languages": ["en"],
            "base_architecture": "whisper-base",
            "huggingface": "WindyProLabs/windy-core-ct2",
            "description": "CPU-optimized Core. Recommended for most CPU deployments.",
            "gpu_variant": "windy-core"
        },
        {
            "id": "windy-edge-ct2",
            "name": "Windy Edge (CPU)",
            "category": "stt",
            "format": "cpu",
            "size_mb": None,
            "languages": ["en"],
            "base_architecture": "whisper-medium",
            "huggingface": "WindyProLabs/windy-edge-ct2",
            "description": "CPU-optimized Edge. High accuracy on CPU hardware.",
            "gpu_variant": "windy-edge"
        },
        {
            "id": "windy-plus-ct2",
            "name": "Windy Plus (CPU)",
            "category": "stt",
            "format": "cpu",
            "size_mb": None,
            "languages": ["en"],
            "base_architecture": "whisper-large-v2",
            "huggingface": "WindyProLabs/windy-plus-ct2",
            "description": "CPU-optimized Plus. Premium accuracy without GPU.",
            "gpu_variant": "windy-plus"
        },
        {
            "id": "windy-turbo-ct2",
            "name": "Windy Turbo (CPU)",
            "category": "stt",
            "format": "cpu",
            "size_mb": None,
            "languages": ["en"],
            "base_architecture": "whisper-large-v3",
            "huggingface": "WindyProLabs/windy-turbo-ct2",
            "description": "CPU-optimized Turbo. State-of-the-art accuracy on CPU.",
            "gpu_variant": "windy-turbo"
        },
        {
            "id": "windy-pro-engine-ct2",
            "name": "Windy Pro Engine (CPU)",
            "category": "stt",
            "format": "cpu",
            "size_mb": None,
            "languages": ["en"],
            "base_architecture": "whisper-large-v3-turbo",
            "huggingface": "WindyProLabs/windy-pro-engine-ct2",
            "description": "CPU-optimized Pro. Maximum CPU performance.",
            "gpu_variant": "windy-pro-engine"
        },
    ]

    # Translation models
    translation_models = [
        {
            "id": "windy-translate-spark",
            "name": "Windy Translate Spark",
            "category": "translation",
            "format": "gpu",
            "size_mb": None,
            "languages": ["en", "es", "fr", "de", "ru", "fi", "pt", "zh", "ja", "ko", "ar"],
            "base_architecture": "m2m100-418M",
            "huggingface": "WindyProLabs/windy-translate-spark",
            "description": "Fast multilingual translation. 100+ languages. LoRA-enhanced for priority pairs."
        },
        {
            "id": "windy-translate-standard",
            "name": "Windy Translate Standard",
            "category": "translation",
            "format": "gpu",
            "size_mb": None,
            "languages": ["en", "es", "fr", "de", "ru", "fi", "pt", "zh", "ja", "ko", "ar"],
            "base_architecture": "m2m100-1.2B",
            "huggingface": "WindyProLabs/windy-translate-standard",
            "description": "Standard multilingual translation. 100+ languages. Higher quality than Spark."
        },
    ]

    # Combine all models
    all_models = stt_gpu_models + stt_cpu_models + translation_models

    # Fill in actual sizes from disk
    models_dir = Path('models')
    for model in all_models:
        model_id = model['id']
        # Handle different naming conventions
        if model_id.startswith('windy-'):
            model_path = models_dir / model_id
        else:
            model_path = models_dir / model_id.replace('-', '_')

        if model_path.exists():
            size_mb = get_dir_size_mb(model_path)
            model['size_mb'] = int(size_mb)
        else:
            print(f"⚠️  Model not found: {model_path}")
            model['size_mb'] = 0

    # Create registry
    registry = {
        "version": "1.0.0",
        "updated": datetime.now().strftime("%Y-%m-%d"),
        "models": all_models
    }

    # Write to file
    output_path = Path('src/models/model_registry.json')
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(registry, f, indent=2, ensure_ascii=False)

    print(f"{'='*60}")
    print(f"Model Registry Generated")
    print(f"{'='*60}")
    print(f"Output: {output_path}")
    print(f"Total models: {len(all_models)}")
    print(f"  - STT GPU: {len(stt_gpu_models)}")
    print(f"  - STT CPU: {len(stt_cpu_models)}")
    print(f"  - Translation: {len(translation_models)}")
    print(f"{'='*60}\n")

    return registry

if __name__ == "__main__":
    generate_registry()
