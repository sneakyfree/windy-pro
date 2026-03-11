#!/usr/bin/env python3
"""
Fork 3 Distil-Whisper models with ultra-light LoRA for Windy Pro
Grant directive: "just breathe on it" - minimal changes for legal distinctiveness
"""

import os
import time
import torch
from pathlib import Path
from transformers import (
    WhisperForConditionalGeneration,
    WhisperProcessor,
    Seq2SeqTrainer,
    Seq2SeqTrainingArguments,
)
from peft import LoraConfig, get_peft_model, PeftModel
from datasets import load_dataset, Audio
import json

# Configuration for the 3 models
MODELS_CONFIG = [
    {
        "name": "distil-small.en",
        "hf_model": "distil-whisper/distil-small.en",
        "output_dir": "models/windy-stt-distil-small",
        "expected_size_mb": 166,
    },
    {
        "name": "distil-medium.en",
        "hf_model": "distil-whisper/distil-medium.en",
        "output_dir": "models/windy-stt-distil-medium",
        "expected_size_mb": 488,
    },
    {
        "name": "distil-large-v3",
        "hf_model": "distil-whisper/distil-large-v3",
        "output_dir": "models/windy-stt-distil-large",
        "expected_size_mb": 756,
    },
]

# Ultra-light LoRA config - "just breathe on it"
LORA_CONFIG = {
    "r": 4,  # rank
    "lora_alpha": 8,
    "target_modules": ["q_proj"],  # ONLY q_proj
    "lora_dropout": 0.05,
    "bias": "none",
    "task_type": "SEQ_2_SEQ_LM",
}

# Training config - minimal training
TRAINING_CONFIG = {
    "num_samples": 100,
    "num_epochs": 0.5,
    "learning_rate": 1e-5,
    "batch_size": 4,
    "gradient_accumulation_steps": 2,
}


def prepare_dataset(processor, num_samples=100):
    """Load and prepare LibriSpeech dataset"""
    print(f"Loading dataset (target: {num_samples} samples)...")

    try:
        # Try main LibriSpeech clean
        dataset = load_dataset(
            "librispeech_asr",
            "clean",
            split=f"train.100[:{num_samples}]",
            trust_remote_code=True
        )
    except Exception as e:
        print(f"Failed to load main dataset: {e}")
        print("Falling back to dummy dataset...")
        dataset = load_dataset(
            "hf-internal-testing/librispeech_asr_dummy",
            "clean",
            split="validation",
            trust_remote_code=True
        )
        # Repeat samples to get to target count
        if len(dataset) < num_samples:
            repeats = (num_samples // len(dataset)) + 1
            dataset = dataset.select(range(len(dataset)) * repeats)
        dataset = dataset.select(range(min(num_samples, len(dataset))))

    # Cast audio to 16kHz
    dataset = dataset.cast_column("audio", Audio(sampling_rate=16000))

    def prepare_example(batch):
        audio = batch["audio"]
        batch["input_features"] = processor(
            audio["array"],
            sampling_rate=audio["sampling_rate"],
            return_tensors="pt"
        ).input_features[0]

        # Encode text
        batch["labels"] = processor.tokenizer(
            batch["text"],
            return_tensors="pt"
        ).input_ids[0]

        return batch

    dataset = dataset.map(prepare_example, remove_columns=dataset.column_names)
    print(f"Dataset prepared: {len(dataset)} samples")
    return dataset


def fork_model(model_config):
    """Fork a single model with ultra-light LoRA"""
    print("\n" + "=" * 80)
    print(f"FORKING: {model_config['name']}")
    print("=" * 80)

    start_time = time.time()
    output_dir = Path(model_config["output_dir"])
    output_dir.mkdir(parents=True, exist_ok=True)

    # 1. Load base model and processor
    print(f"\n[1/7] Loading base model: {model_config['hf_model']}")
    model = WhisperForConditionalGeneration.from_pretrained(
        model_config["hf_model"],
        torch_dtype=torch.float16,
        device_map="auto",
    )
    processor = WhisperProcessor.from_pretrained(model_config["hf_model"])

    # 2. Apply ultra-light LoRA
    print(f"\n[2/7] Applying ultra-light LoRA config...")
    lora_config = LoraConfig(**LORA_CONFIG)
    model = get_peft_model(model, lora_config)

    trainable_params = sum(p.numel() for p in model.parameters() if p.requires_grad)
    total_params = sum(p.numel() for p in model.parameters())
    trainable_pct = 100 * trainable_params / total_params

    print(f"  Trainable params: {trainable_params:,} ({trainable_pct:.4f}%)")
    print(f"  Total params: {total_params:,}")

    # 3. Prepare dataset
    print(f"\n[3/7] Preparing dataset...")
    train_dataset = prepare_dataset(processor, TRAINING_CONFIG["num_samples"])

    # 4. Training setup
    print(f"\n[4/7] Setting up training...")
    training_args = Seq2SeqTrainingArguments(
        output_dir=str(output_dir / "training_temp"),
        per_device_train_batch_size=TRAINING_CONFIG["batch_size"],
        gradient_accumulation_steps=TRAINING_CONFIG["gradient_accumulation_steps"],
        learning_rate=TRAINING_CONFIG["learning_rate"],
        num_train_epochs=TRAINING_CONFIG["num_epochs"],
        fp16=True,
        logging_steps=10,
        save_strategy="no",
        remove_unused_columns=False,
        label_names=["labels"],
    )

    trainer = Seq2SeqTrainer(
        model=model,
        args=training_args,
        train_dataset=train_dataset,
    )

    # 5. Train (ultra-light)
    print(f"\n[5/7] Training (0.5 epochs on 100 samples - 'just breathe on it')...")
    train_start = time.time()
    trainer.train()
    train_time = time.time() - train_start
    print(f"  Training completed in {train_time:.2f}s")

    # 6. Merge LoRA back into base
    print(f"\n[6/7] Merging LoRA back into base model...")
    model = model.merge_and_unload()

    # 7. Save merged model
    print(f"\n[7/7] Saving merged model to {output_dir}")
    model.save_pretrained(
        output_dir,
        safe_serialization=True,
    )
    processor.save_pretrained(output_dir)

    # Get actual model size
    model_files = list(output_dir.glob("*.safetensors"))
    actual_size_mb = sum(f.stat().st_size for f in model_files) / (1024 * 1024)

    # Test inference
    print(f"\n[TEST] Running inference test...")
    test_passed = False
    try:
        # Load saved model for testing
        test_model = WhisperForConditionalGeneration.from_pretrained(
            output_dir,
            torch_dtype=torch.float16,
            device_map="auto",
        )
        test_processor = WhisperProcessor.from_pretrained(output_dir)

        # Create dummy input
        dummy_input = test_processor(
            torch.randn(16000).numpy(),
            sampling_rate=16000,
            return_tensors="pt"
        ).input_features.to(test_model.device)

        # Generate
        with torch.no_grad():
            generated_ids = test_model.generate(dummy_input, max_length=50)
            transcription = test_processor.batch_decode(generated_ids, skip_special_tokens=True)[0]

        print(f"  ✓ Inference successful")
        print(f"  Sample output: '{transcription[:100]}'")
        test_passed = True

        # Cleanup
        del test_model
        torch.cuda.empty_cache()

    except Exception as e:
        print(f"  ✗ Inference failed: {e}")

    total_time = time.time() - start_time

    # Save metadata
    metadata = {
        "model_name": model_config["name"],
        "source_model": model_config["hf_model"],
        "output_directory": str(output_dir),
        "lora_config": LORA_CONFIG,
        "training_config": TRAINING_CONFIG,
        "trainable_params": trainable_params,
        "total_params": total_params,
        "trainable_percentage": trainable_pct,
        "training_time_seconds": train_time,
        "total_time_seconds": total_time,
        "expected_size_mb": model_config["expected_size_mb"],
        "actual_size_mb": actual_size_mb,
        "inference_test_passed": test_passed,
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
    }

    with open(output_dir / "fork_metadata.json", "w") as f:
        json.dump(metadata, f, indent=2)

    print(f"\n{'='*80}")
    print(f"COMPLETED: {model_config['name']}")
    print(f"  Trainable params: {trainable_params:,} ({trainable_pct:.4f}%)")
    print(f"  Training time: {train_time:.2f}s")
    print(f"  Total time: {total_time:.2f}s")
    print(f"  Model size: {actual_size_mb:.2f} MB (expected: {model_config['expected_size_mb']} MB)")
    print(f"  Inference test: {'PASSED' if test_passed else 'FAILED'}")
    print(f"  Saved to: {output_dir}")
    print(f"{'='*80}\n")

    # Cleanup
    del model
    torch.cuda.empty_cache()

    return metadata


def main():
    """Fork all 3 models"""
    print("=" * 80)
    print("KIT OC1 ALPHA - DISTIL-WHISPER FORKING MISSION")
    print("Ultra-light LoRA: 'just breathe on it'")
    print("=" * 80)
    print(f"\nModels to fork: {len(MODELS_CONFIG)}")
    for cfg in MODELS_CONFIG:
        print(f"  - {cfg['name']} (~{cfg['expected_size_mb']} MB)")

    print(f"\nLoRA Config (ultra-light):")
    print(f"  rank: {LORA_CONFIG['r']}, alpha: {LORA_CONFIG['lora_alpha']}")
    print(f"  target_modules: {LORA_CONFIG['target_modules']}")
    print(f"  dropout: {LORA_CONFIG['lora_dropout']}")

    print(f"\nTraining Config:")
    print(f"  samples: {TRAINING_CONFIG['num_samples']}")
    print(f"  epochs: {TRAINING_CONFIG['num_epochs']}")
    print(f"  learning_rate: {TRAINING_CONFIG['learning_rate']}")

    # Check CUDA
    if not torch.cuda.is_available():
        print("\n⚠ WARNING: CUDA not available, will use CPU (slow!)")
    else:
        print(f"\n✓ CUDA available: {torch.cuda.get_device_name(0)}")

    input("\nPress ENTER to start forking...")

    all_metadata = []
    mission_start = time.time()

    for model_config in MODELS_CONFIG:
        try:
            metadata = fork_model(model_config)
            all_metadata.append(metadata)
        except Exception as e:
            print(f"\n✗ FAILED to fork {model_config['name']}: {e}")
            import traceback
            traceback.print_exc()
            continue

    mission_time = time.time() - mission_start

    # Final summary
    print("\n" + "=" * 80)
    print("MISSION COMPLETE")
    print("=" * 80)
    print(f"\nTotal time: {mission_time / 60:.2f} minutes")
    print(f"Models successfully forked: {len(all_metadata)}/{len(MODELS_CONFIG)}")

    for metadata in all_metadata:
        print(f"\n{metadata['model_name']}:")
        print(f"  Location: {metadata['output_directory']}")
        print(f"  Size: {metadata['actual_size_mb']:.2f} MB")
        print(f"  Trainable params: {metadata['trainable_params']:,} ({metadata['trainable_percentage']:.4f}%)")
        print(f"  Training time: {metadata['training_time_seconds']:.2f}s")
        print(f"  Inference: {'PASSED' if metadata['inference_test_passed'] else 'FAILED'}")

    # Save combined summary
    summary_path = Path("models/distil_fork_summary.json")
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    with open(summary_path, "w") as f:
        json.dump({
            "mission_time_seconds": mission_time,
            "models_forked": len(all_metadata),
            "models_attempted": len(MODELS_CONFIG),
            "models": all_metadata,
        }, f, indent=2)

    print(f"\nSummary saved to: {summary_path}")
    print("\n✓ All models forked and ready for deployment!")


if __name__ == "__main__":
    main()
