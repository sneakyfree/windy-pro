"""
Windy Pro - Whisper STT LoRA Fine-Tuning Script
Re-trains Whisper models with LoRA adapters for improved accuracy.

Usage:
    python finetune_whisper_lora.py --model base --output artifacts/lora_checkpoints/lora-base-en-v2
    python finetune_whisper_lora.py --model distil-whisper/distil-large-v3 --lr 5e-6 --batch-size 1 --grad-accum 8
"""

import os
import json
import time
import torch
import numpy as np
from pathlib import Path
from datetime import datetime, timezone
from dataclasses import dataclass
from typing import Optional
from tqdm import tqdm

from transformers import (
    WhisperProcessor,
    WhisperForConditionalGeneration,
    Seq2SeqTrainingArguments,
    Seq2SeqTrainer,
)
from peft import LoraConfig, get_peft_model, TaskType
from datasets import load_dataset, DatasetDict


@dataclass
class WhisperLoRAConfig:
    """Configuration for Whisper LoRA training."""
    model_name: str = "openai/whisper-base"  # HuggingFace model ID
    language: str = "en"
    n_train: int = 500
    n_eval: int = 100
    epochs: int = 2
    lr: float = 8e-6
    batch_size: int = 8
    grad_accum_steps: int = 1
    lora_r: int = 8
    lora_alpha: int = 16
    lora_dropout: float = 0.05
    target_modules: list = None
    output_dir: str = "artifacts/lora_checkpoints/lora-whisper-temp"
    seed: int = 42
    device: str = "cuda"

    def __post_init__(self):
        if self.target_modules is None:
            self.target_modules = ["q_proj", "v_proj"]


def load_common_voice_data(language: str = "en", n_train: int = 500, n_eval: int = 100):
    """Load LibriSpeech dataset for training (no auth required)."""
    print(f"Loading LibriSpeech dataset for fine-tuning...")

    # Use LibriSpeech which is publicly accessible
    dataset = load_dataset(
        "librispeech_asr",
        "clean",
        split="train.100",
        streaming=False
    )

    # Filter out samples without audio or transcripts
    dataset = dataset.filter(lambda x: x["audio"] is not None and x["text"] is not None and len(x["text"]) > 0)

    # Shuffle and split
    dataset = dataset.shuffle(seed=42)

    total_needed = n_train + n_eval
    dataset = dataset.select(range(min(total_needed, len(dataset))))

    # Split into train/eval
    train_dataset = dataset.select(range(n_train))
    eval_dataset = dataset.select(range(n_train, min(n_train + n_eval, len(dataset))))

    print(f"Loaded {len(train_dataset)} train samples, {len(eval_dataset)} eval samples")

    return DatasetDict({
        "train": train_dataset,
        "eval": eval_dataset
    })


def prepare_dataset(batch, processor):
    """Preprocess audio and text for Whisper."""
    # Load audio
    audio = batch["audio"]

    # Compute log-mel spectrogram features
    input_features = processor(
        audio["array"],
        sampling_rate=audio["sampling_rate"],
        return_tensors="pt"
    ).input_features[0]

    # Encode target text
    batch["input_features"] = input_features

    # Tokenize target (LibriSpeech uses "text" instead of "sentence")
    text_field = "text" if "text" in batch else "sentence"
    batch["labels"] = processor.tokenizer(batch[text_field]).input_ids

    return batch


def train_whisper_lora(config: WhisperLoRAConfig):
    """Train Whisper with LoRA adapters."""

    print("="*60)
    print("Windy Pro - Whisper LoRA Fine-Tuning")
    print("="*60)
    print(f"Model: {config.model_name}")
    print(f"Output: {config.output_dir}")
    print(f"LoRA config: r={config.lora_r}, alpha={config.lora_alpha}, dropout={config.lora_dropout}")
    print(f"Training: {config.n_train} samples, {config.epochs} epochs, LR={config.lr}")
    print("="*60)

    # Set seed
    torch.manual_seed(config.seed)
    np.random.seed(config.seed)

    # Load processor and model
    print("\nLoading model and processor...")
    load_start = time.time()

    processor = WhisperProcessor.from_pretrained(config.model_name, language=config.language, task="transcribe")
    model = WhisperForConditionalGeneration.from_pretrained(
        config.model_name,
        torch_dtype=torch.float16 if config.device == "cuda" else torch.float32
    )

    # Configure LoRA
    lora_config = LoraConfig(
        r=config.lora_r,
        lora_alpha=config.lora_alpha,
        lora_dropout=config.lora_dropout,
        target_modules=config.target_modules,
        bias="none",
        task_type=TaskType.SEQ_2_SEQ_LM
    )

    model = get_peft_model(model, lora_config)
    model.print_trainable_parameters()

    load_time = time.time() - load_start
    print(f"Model loaded in {load_time:.2f}s")

    # Load dataset
    print("\nLoading dataset...")
    dataset = load_common_voice_data(config.language, config.n_train, config.n_eval)

    # Preprocess
    print("Preprocessing dataset...")
    dataset = dataset.map(
        lambda batch: prepare_dataset(batch, processor),
        remove_columns=dataset["train"].column_names,
        num_proc=1,
        desc="Preprocessing"
    )

    # Training arguments
    output_dir = Path(config.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    training_args = Seq2SeqTrainingArguments(
        output_dir=str(output_dir),
        per_device_train_batch_size=config.batch_size,
        per_device_eval_batch_size=config.batch_size,
        gradient_accumulation_steps=config.grad_accum_steps,
        learning_rate=config.lr,
        num_train_epochs=config.epochs,
        fp16=config.device == "cuda",
        eval_strategy="epoch",
        save_strategy="epoch",
        logging_steps=10,
        report_to=["none"],
        load_best_model_at_end=True,
        metric_for_best_model="eval_loss",
        greater_is_better=False,
        push_to_hub=False,
        remove_unused_columns=False,
        label_names=["labels"],
    )

    # Data collator
    from transformers import DataCollatorForSeq2Seq
    data_collator = DataCollatorForSeq2Seq(
        processor.tokenizer,
        model=model,
        padding=True
    )

    # Trainer
    trainer = Seq2SeqTrainer(
        model=model,
        args=training_args,
        train_dataset=dataset["train"],
        eval_dataset=dataset["eval"],
        data_collator=data_collator,
        tokenizer=processor.tokenizer
    )

    # Train
    print("\n" + "="*60)
    print("TRAINING START")
    print("="*60 + "\n")

    train_start = time.time()
    train_result = trainer.train()
    train_time = time.time() - train_start

    # Get training history
    history = []
    best_eval_loss = float('inf')

    for log in trainer.state.log_history:
        if "eval_loss" in log:
            epoch = log.get("epoch", 0)
            train_loss = log.get("loss", 0)
            eval_loss = log["eval_loss"]

            improved = eval_loss < best_eval_loss
            if improved:
                best_eval_loss = eval_loss

            history.append({
                "epoch": int(epoch),
                "train_loss": round(train_loss, 4),
                "eval_loss": round(eval_loss, 4),
                "improved": improved
            })

    # Save final model
    trainer.save_model(str(output_dir))
    print(f"\n✓ Model saved to {output_dir}")

    # Create run metadata
    run_name = output_dir.name
    model_short = config.model_name.split("/")[-1]

    run_metadata = {
        "run_name": run_name,
        "model": model_short,
        "hf_model": config.model_name,
        "language": config.language,
        "n_train": config.n_train,
        "n_eval": config.n_eval,
        "seed": config.seed,
        "epochs": config.epochs,
        "lr": config.lr,
        "batch_size": config.batch_size,
        "lora_r": config.lora_r,
        "lora_alpha": config.lora_alpha,
        "lora_dropout": config.lora_dropout,
        "device": config.device,
        "load_time_sec": round(load_time, 3),
        "train_time_sec": round(train_time, 3),
        "best_eval_loss": round(best_eval_loss, 4),
        "history": history,
        "checkpoint_dir": str(output_dir.absolute()),
        "timestamp": datetime.now(timezone.utc).isoformat()
    }

    # Save run metadata
    run_log_path = Path("runs") / f"finetune-{run_name}.json"
    run_log_path.parent.mkdir(exist_ok=True)
    with open(run_log_path, 'w') as f:
        json.dump(run_metadata, f, indent=2)

    print("\n" + "="*60)
    print("TRAINING COMPLETE")
    print("="*60)
    print(f"Best eval loss: {best_eval_loss:.4f}")
    print(f"Training time: {train_time:.1f}s")
    print(f"Run log: {run_log_path}")
    print("="*60)

    return run_metadata


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Fine-tune Whisper with LoRA")
    parser.add_argument("--model", default="openai/whisper-base", help="Whisper model (base, small, medium, large-v3, distil-whisper/distil-large-v3)")
    parser.add_argument("--output", default=None, help="Output directory for checkpoint")
    parser.add_argument("--language", default="en", help="Language code")
    parser.add_argument("--n-train", type=int, default=500, help="Number of training samples")
    parser.add_argument("--n-eval", type=int, default=100, help="Number of eval samples")
    parser.add_argument("--epochs", type=int, default=2, help="Number of epochs")
    parser.add_argument("--lr", type=float, default=8e-6, help="Learning rate")
    parser.add_argument("--batch-size", type=int, default=8, help="Batch size")
    parser.add_argument("--grad-accum", type=int, default=1, help="Gradient accumulation steps")
    parser.add_argument("--lora-r", type=int, default=8, help="LoRA rank")
    parser.add_argument("--lora-alpha", type=int, default=16, help="LoRA alpha")
    parser.add_argument("--lora-dropout", type=float, default=0.05, help="LoRA dropout")

    args = parser.parse_args()

    # Build model name
    if "/" not in args.model:
        model_name = f"openai/whisper-{args.model}"
    else:
        model_name = args.model

    # Auto-generate output dir if not specified
    if args.output is None:
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        model_short = model_name.replace("/", "_").replace("openai_whisper-", "")
        output_dir = f"artifacts/lora_checkpoints/lora-{model_short}-{args.language}-{timestamp}"
    else:
        output_dir = args.output

    config = WhisperLoRAConfig(
        model_name=model_name,
        language=args.language,
        n_train=args.n_train,
        n_eval=args.n_eval,
        epochs=args.epochs,
        lr=args.lr,
        batch_size=args.batch_size,
        grad_accum_steps=args.grad_accum,
        lora_r=args.lora_r,
        lora_alpha=args.lora_alpha,
        lora_dropout=args.lora_dropout,
        output_dir=output_dir
    )

    train_whisper_lora(config)


if __name__ == "__main__":
    main()
