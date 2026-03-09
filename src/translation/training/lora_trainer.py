"""
Windy Pro - LoRA Fine-Tuning Pipeline
Full training pipeline for M2M-100 using PEFT (Parameter-Efficient Fine-Tuning).

Usage:
    python lora_trainer.py --config train_config.yaml
    python lora_trainer.py --config train_config.yaml --resume models/checkpoint-1000
"""

import os
import json
import yaml
import torch
import random
import numpy as np
from pathlib import Path
from dataclasses import dataclass, field
from typing import Optional, Dict, List, Any
from tqdm import tqdm

from transformers import (
    M2M100ForConditionalGeneration,
    M2M100Tokenizer,
    Seq2SeqTrainingArguments,
    Seq2SeqTrainer,
    DataCollatorForSeq2Seq,
    EarlyStoppingCallback
)
from peft import (
    LoraConfig,
    get_peft_model,
    TaskType,
    PeftModel
)
from datasets import Dataset, DatasetDict
import evaluate


@dataclass
class LoRATrainingConfig:
    """Configuration for LoRA training."""

    # Paths
    base_model_path: str
    output_dir: str
    data_dir: str
    config_path: Optional[str] = None

    # LoRA parameters
    lora_rank: int = 32
    lora_alpha: int = 64
    lora_dropout: float = 0.05
    lora_target_modules: List[str] = field(default_factory=list)

    # Training parameters
    num_epochs: int = 3
    batch_size: int = 8
    gradient_accumulation_steps: int = 4
    learning_rate: float = 2e-4
    weight_decay: float = 0.01
    warmup_ratio: float = 0.1
    max_source_length: int = 128
    max_target_length: int = 128

    # Evaluation
    eval_steps: int = 500
    save_steps: int = 1000
    logging_steps: int = 50

    # Hardware
    fp16: bool = True
    device: str = "cuda"

    # Data
    train_split: float = 0.95
    max_train_samples: Optional[int] = None
    max_eval_samples: int = 5000

    # Misc
    seed: int = 42

    @classmethod
    def from_yaml(cls, yaml_path: str) -> "LoRATrainingConfig":
        """Load configuration from YAML file."""
        with open(yaml_path, 'r') as f:
            config_dict = yaml.safe_load(f)

        # Flatten nested structure
        flat_config = {
            "base_model_path": config_dict["model"]["base_model_path"],
            "output_dir": config_dict["training"]["output_dir"],
            "data_dir": config_dict["dataset"]["data_dir"],
            "lora_rank": config_dict["lora"]["rank"],
            "lora_alpha": config_dict["lora"]["alpha"],
            "lora_dropout": config_dict["lora"]["dropout"],
            "lora_target_modules": config_dict["lora"]["target_modules"],
            "num_epochs": config_dict["training"]["num_epochs"],
            "batch_size": config_dict["training"]["batch_size"],
            "gradient_accumulation_steps": config_dict["training"]["gradient_accumulation_steps"],
            "learning_rate": config_dict["training"]["learning_rate"],
            "weight_decay": config_dict["training"]["weight_decay"],
            "warmup_ratio": config_dict["training"]["warmup_ratio"],
            "max_source_length": config_dict["training"]["max_source_length"],
            "max_target_length": config_dict["training"]["max_target_length"],
            "eval_steps": config_dict["training"]["eval_steps"],
            "save_steps": config_dict["training"]["save_steps"],
            "logging_steps": config_dict["training"]["logging_steps"],
            "fp16": config_dict["training"]["fp16"],
            "device": config_dict["hardware"]["device"],
            "train_split": config_dict["dataset"]["train_split"],
            "max_train_samples": config_dict["dataset"]["max_train_samples"],
            "max_eval_samples": config_dict["dataset"]["max_eval_samples"],
            "seed": config_dict["training"]["seed"],
            "config_path": yaml_path
        }

        return cls(**flat_config)


class LoRATrainer:
    """
    LoRA fine-tuning trainer for M2M-100.

    Implements:
    - LoRA adapter training with PEFT
    - BLEU/chrF++ evaluation
    - Checkpointing and resumption
    - Mixed precision training (FP16)
    """

    def __init__(self, config: LoRATrainingConfig):
        self.config = config
        self.model = None
        self.tokenizer = None
        self.train_dataset = None
        self.eval_dataset = None

        # Metrics
        self.bleu_metric = evaluate.load("sacrebleu")
        self.chrf_metric = evaluate.load("chrf")

        # Set random seeds for reproducibility
        self._set_seed(config.seed)

    def _set_seed(self, seed: int):
        """Set random seed for reproducibility."""
        random.seed(seed)
        np.random.seed(seed)
        torch.manual_seed(seed)
        if torch.cuda.is_available():
            torch.cuda.manual_seed_all(seed)

    def load_model_and_tokenizer(self):
        """Load base model and tokenizer, apply LoRA."""
        print(f"\n{'='*60}")
        print("Loading base model and tokenizer...")
        print(f"{'='*60}\n")

        # Load tokenizer
        self.tokenizer = M2M100Tokenizer.from_pretrained(self.config.base_model_path)
        print(f"Tokenizer loaded from {self.config.base_model_path}")

        # Load base model
        base_model = M2M100ForConditionalGeneration.from_pretrained(
            self.config.base_model_path,
            torch_dtype=torch.float16 if self.config.fp16 else torch.float32
        )
        print(f"Base model loaded: {base_model.num_parameters():,} parameters")

        # Configure LoRA
        lora_config = LoraConfig(
            r=self.config.lora_rank,
            lora_alpha=self.config.lora_alpha,
            lora_dropout=self.config.lora_dropout,
            target_modules=self.config.lora_target_modules,
            bias="none",
            task_type=TaskType.SEQ_2_SEQ_LM
        )

        print(f"\nApplying LoRA configuration:")
        print(f"  Rank: {self.config.lora_rank}")
        print(f"  Alpha: {self.config.lora_alpha}")
        print(f"  Dropout: {self.config.lora_dropout}")
        print(f"  Target modules: {len(self.config.lora_target_modules)}")

        # Apply LoRA
        self.model = get_peft_model(base_model, lora_config)

        # Print trainable parameters
        trainable_params = sum(p.numel() for p in self.model.parameters() if p.requires_grad)
        total_params = sum(p.numel() for p in self.model.parameters())
        print(f"\nTrainable parameters: {trainable_params:,} ({100 * trainable_params / total_params:.2f}%)")
        print(f"Total parameters: {total_params:,}")

        # Move to device
        self.model.to(self.config.device)
        print(f"\nModel loaded on {self.config.device}")

        if self.config.device == "cuda":
            vram_mb = torch.cuda.memory_allocated() / 1024 / 1024
            print(f"VRAM usage: {vram_mb:.1f} MB")

    def load_datasets(self):
        """Load and prepare training/evaluation datasets."""
        print(f"\n{'='*60}")
        print("Loading datasets...")
        print(f"{'='*60}\n")

        data_dir = Path(self.config.data_dir)

        # Load all JSONL files
        all_data = []
        for jsonl_file in data_dir.glob("*.jsonl"):
            print(f"Loading {jsonl_file.name}...")
            with open(jsonl_file, 'r', encoding='utf-8') as f:
                for line in f:
                    all_data.append(json.loads(line))

        print(f"\nTotal samples loaded: {len(all_data):,}")

        # Shuffle
        random.shuffle(all_data)

        # Apply limits
        if self.config.max_train_samples:
            all_data = all_data[:self.config.max_train_samples]

        # Split train/eval
        split_idx = int(len(all_data) * self.config.train_split)
        train_data = all_data[:split_idx]
        eval_data = all_data[split_idx:]

        # Limit eval samples
        if len(eval_data) > self.config.max_eval_samples:
            eval_data = eval_data[:self.config.max_eval_samples]

        print(f"Train samples: {len(train_data):,}")
        print(f"Eval samples: {len(eval_data):,}")

        # Convert to Hugging Face datasets
        self.train_dataset = Dataset.from_list(train_data)
        self.eval_dataset = Dataset.from_list(eval_data)

        # Tokenize datasets
        print("\nTokenizing datasets...")
        self.train_dataset = self.train_dataset.map(
            self._tokenize_function,
            batched=True,
            remove_columns=self.train_dataset.column_names,
            desc="Tokenizing train set"
        )

        self.eval_dataset = self.eval_dataset.map(
            self._tokenize_function,
            batched=True,
            remove_columns=self.eval_dataset.column_names,
            desc="Tokenizing eval set"
        )

        print("Datasets ready!")

    def _tokenize_function(self, examples: Dict[str, List]) -> Dict[str, Any]:
        """Tokenize source and target texts."""
        # Set source language (use first example's source_lang)
        source_lang = examples["source_lang"][0] if isinstance(examples["source_lang"], list) else examples["source_lang"]
        target_lang = examples["target_lang"][0] if isinstance(examples["target_lang"], list) else examples["target_lang"]

        self.tokenizer.src_lang = source_lang

        # Tokenize source
        model_inputs = self.tokenizer(
            examples["source_text"],
            max_length=self.config.max_source_length,
            truncation=True,
            padding=False  # Dynamic padding in collator
        )

        # Tokenize target
        with self.tokenizer.as_target_tokenizer():
            labels = self.tokenizer(
                examples["target_text"],
                max_length=self.config.max_target_length,
                truncation=True,
                padding=False
            )

        model_inputs["labels"] = labels["input_ids"]
        return model_inputs

    def compute_metrics(self, eval_preds):
        """Compute BLEU and chrF++ metrics."""
        preds, labels = eval_preds

        # Decode predictions
        if isinstance(preds, tuple):
            preds = preds[0]

        # Replace -100 in labels (used for padding)
        labels = np.where(labels != -100, labels, self.tokenizer.pad_token_id)

        # Decode
        decoded_preds = self.tokenizer.batch_decode(preds, skip_special_tokens=True)
        decoded_labels = self.tokenizer.batch_decode(labels, skip_special_tokens=True)

        # Post-process
        decoded_preds = [pred.strip() for pred in decoded_preds]
        decoded_labels = [[label.strip()] for label in decoded_labels]  # BLEU expects list of references

        # Compute BLEU
        bleu_result = self.bleu_metric.compute(
            predictions=decoded_preds,
            references=decoded_labels
        )

        # Compute chrF++
        chrf_result = self.chrf_metric.compute(
            predictions=decoded_preds,
            references=[ref[0] for ref in decoded_labels]  # chrF expects single reference
        )

        return {
            "bleu": bleu_result["score"],
            "chrf": chrf_result["score"]
        }

    def train(self, resume_from_checkpoint: Optional[str] = None):
        """Run LoRA fine-tuning."""
        print(f"\n{'='*60}")
        print("Starting LoRA Fine-Tuning")
        print(f"{'='*60}\n")

        # Create output directory
        output_dir = Path(self.config.output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)

        # Save config
        config_save_path = output_dir / "train_config.json"
        with open(config_save_path, 'w') as f:
            json.dump(vars(self.config), f, indent=2, default=str)
        print(f"Config saved to {config_save_path}")

        # Data collator
        data_collator = DataCollatorForSeq2Seq(
            tokenizer=self.tokenizer,
            model=self.model,
            padding=True
        )

        # Training arguments
        training_args = Seq2SeqTrainingArguments(
            output_dir=str(output_dir),
            num_train_epochs=self.config.num_epochs,
            per_device_train_batch_size=self.config.batch_size,
            per_device_eval_batch_size=self.config.batch_size * 2,
            gradient_accumulation_steps=self.config.gradient_accumulation_steps,
            learning_rate=self.config.learning_rate,
            weight_decay=self.config.weight_decay,
            warmup_ratio=self.config.warmup_ratio,
            fp16=self.config.fp16,
            logging_dir=str(output_dir / "logs"),
            logging_steps=self.config.logging_steps,
            eval_steps=self.config.eval_steps,
            save_steps=self.config.save_steps,
            evaluation_strategy="steps",
            save_strategy="steps",
            load_best_model_at_end=True,
            metric_for_best_model="bleu",
            greater_is_better=True,
            save_total_limit=3,
            predict_with_generate=True,
            generation_max_length=self.config.max_target_length,
            seed=self.config.seed,
            dataloader_num_workers=4,
            dataloader_pin_memory=True,
            remove_unused_columns=False,
            report_to="none"  # Disable wandb for now
        )

        # Trainer
        trainer = Seq2SeqTrainer(
            model=self.model,
            args=training_args,
            train_dataset=self.train_dataset,
            eval_dataset=self.eval_dataset,
            tokenizer=self.tokenizer,
            data_collator=data_collator,
            compute_metrics=self.compute_metrics
        )

        # Train
        print("\n" + "="*60)
        print("TRAINING START")
        print("="*60 + "\n")

        if resume_from_checkpoint:
            print(f"Resuming from checkpoint: {resume_from_checkpoint}")

        train_result = trainer.train(resume_from_checkpoint=resume_from_checkpoint)

        # Save final model
        final_model_path = output_dir / "final_model"
        trainer.save_model(str(final_model_path))
        print(f"\nFinal model saved to {final_model_path}")

        # Save metrics
        metrics = train_result.metrics
        metrics_path = output_dir / "train_metrics.json"
        with open(metrics_path, 'w') as f:
            json.dump(metrics, f, indent=2)
        print(f"Training metrics saved to {metrics_path}")

        # Final evaluation
        print("\n" + "="*60)
        print("FINAL EVALUATION")
        print("="*60 + "\n")

        eval_metrics = trainer.evaluate()
        eval_metrics_path = output_dir / "eval_metrics.json"
        with open(eval_metrics_path, 'w') as f:
            json.dump(eval_metrics, f, indent=2)

        print(f"\nFinal BLEU: {eval_metrics['eval_bleu']:.2f}")
        print(f"Final chrF++: {eval_metrics['eval_chrf']:.2f}")
        print(f"Evaluation metrics saved to {eval_metrics_path}")

        print("\n" + "="*60)
        print("TRAINING COMPLETE")
        print("="*60 + "\n")

        return train_result


def main():
    """CLI for LoRA training."""
    import argparse

    parser = argparse.ArgumentParser(description="Fine-tune M2M-100 with LoRA")
    parser.add_argument(
        "--config",
        required=True,
        help="Path to training config YAML"
    )
    parser.add_argument(
        "--resume",
        default=None,
        help="Resume from checkpoint"
    )

    args = parser.parse_args()

    # Load config
    print(f"Loading config from {args.config}...")
    config = LoRATrainingConfig.from_yaml(args.config)

    # Initialize trainer
    trainer = LoRATrainer(config)

    # Load model and data
    trainer.load_model_and_tokenizer()
    trainer.load_datasets()

    # Train
    trainer.train(resume_from_checkpoint=args.resume)


if __name__ == "__main__":
    main()
