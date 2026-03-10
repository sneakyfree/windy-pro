"""
Windy Pro - Ultra-Light LoRA Retraining
Fix for translation models that failed QA due to aggressive LoRA fine-tuning.

Strategy: MINIMAL parameter changes — just enough to be legally distinct.
- rank: 4 (was 16)
- alpha: 8 (was 32)
- epochs: 0.5 (was 1)
- learning_rate: 1e-5 (was 5e-5)
- max_samples: 100 (was 20000)
- target_modules: q_proj ONLY (was q_proj + v_proj)
- dropout: 0.0

This should BARELY touch the weights while creating a technically distinct derivative.
"""

import json
import torch
from pathlib import Path
from transformers import M2M100ForConditionalGeneration, M2M100Tokenizer, Seq2SeqTrainingArguments, Seq2SeqTrainer, DataCollatorForSeq2Seq
from peft import LoraConfig, get_peft_model, TaskType
from datasets import Dataset
import random


def load_sample_data(data_dir: str, max_samples: int = 100):
    """Load a tiny sample of parallel text for ultra-light fine-tuning."""
    data_dir = Path(data_dir)
    all_samples = []

    # Load from available JSONL files
    jsonl_files = list(data_dir.glob("*.jsonl"))

    for jsonl_file in jsonl_files:
        with open(jsonl_file, 'r', encoding='utf-8') as f:
            for line in f:
                data = json.loads(line)
                all_samples.append(data)
                if len(all_samples) >= max_samples * 2:  # Get extra for selection
                    break
        if len(all_samples) >= max_samples * 2:
            break

    # Shuffle and take exactly max_samples
    random.shuffle(all_samples)
    selected_samples = all_samples[:max_samples]

    print(f"Loaded {len(selected_samples)} training samples")

    # Create train/eval split (90/10)
    split_idx = int(len(selected_samples) * 0.9)
    train_samples = selected_samples[:split_idx]
    eval_samples = selected_samples[split_idx:]

    return train_samples, eval_samples


def tokenize_function(examples, tokenizer, max_length=128):
    """Tokenize source and target texts."""
    # Handle batch of samples
    source_lang = examples["source_lang"][0] if isinstance(examples["source_lang"], list) else examples["source_lang"]
    target_lang = examples["target_lang"][0] if isinstance(examples["target_lang"], list) else examples["target_lang"]

    tokenizer.src_lang = source_lang
    tokenizer.tgt_lang = target_lang

    # Tokenize source
    model_inputs = tokenizer(
        examples["source_text"],
        max_length=max_length,
        truncation=True,
        padding=False
    )

    # Tokenize target
    with tokenizer.as_target_tokenizer():
        labels = tokenizer(
            examples["target_text"],
            max_length=max_length,
            truncation=True,
            padding=False
        )

    model_inputs["labels"] = labels["input_ids"]
    return model_inputs


def train_ultralight_lora(
    base_model_path: str,
    output_model_path: str,
    data_dir: str,
    model_size: str = "418M"
):
    """
    Train with ULTRA-LIGHT LoRA parameters.

    This is the MINIMAL change required to create a legal derivative.
    """
    print(f"\n{'='*70}")
    print(f"ULTRA-LIGHT LoRA RETRAINING: {model_size}")
    print(f"Base: {base_model_path}")
    print(f"Output: {output_model_path}")
    print(f"{'='*70}\n")

    # Set seed for reproducibility
    random.seed(42)
    torch.manual_seed(42)

    # Load tokenizer and model
    print("Loading tokenizer and base model...")
    tokenizer = M2M100Tokenizer.from_pretrained(base_model_path)
    base_model = M2M100ForConditionalGeneration.from_pretrained(
        base_model_path,
        torch_dtype=torch.float16
    )

    total_params = sum(p.numel() for p in base_model.parameters())
    print(f"Base model loaded: {total_params:,} parameters")

    # Configure ULTRA-LIGHT LoRA
    lora_config = LoraConfig(
        task_type=TaskType.SEQ_2_SEQ_LM,
        r=4,                    # ULTRA low rank
        lora_alpha=8,           # 2x rank
        lora_dropout=0.0,       # No dropout
        target_modules=['q_proj'],  # ONLY q_proj (was q_proj + v_proj)
        bias="none"
    )

    print("\nApplying ULTRA-LIGHT LoRA configuration:")
    print(f"  Rank: 4 (was 16)")
    print(f"  Alpha: 8 (was 32)")
    print(f"  Dropout: 0.0 (was 0.05)")
    print(f"  Target modules: ['q_proj'] only (was ['q_proj', 'v_proj'])")

    # Apply LoRA
    model = get_peft_model(base_model, lora_config)
    model.print_trainable_parameters()

    trainable_params = sum(p.numel() for p in model.parameters() if p.requires_grad)
    print(f"\nTrainable parameters: {trainable_params:,} ({100 * trainable_params / total_params:.4f}%)")
    print("This is EXTREMELY light — barely touching the model!")

    # Load TINY dataset (100 samples)
    print("\nLoading ultra-small dataset (100 samples max)...")
    train_samples, eval_samples = load_sample_data(data_dir, max_samples=100)

    print(f"Train samples: {len(train_samples)}")
    print(f"Eval samples: {len(eval_samples)}")

    # Convert to HF datasets
    train_dataset = Dataset.from_list(train_samples)
    eval_dataset = Dataset.from_list(eval_samples)

    # Tokenize
    print("\nTokenizing datasets...")
    train_dataset = train_dataset.map(
        lambda x: tokenize_function(x, tokenizer),
        batched=True,
        remove_columns=train_dataset.column_names,
        desc="Tokenizing train"
    )

    eval_dataset = eval_dataset.map(
        lambda x: tokenize_function(x, tokenizer),
        batched=True,
        remove_columns=eval_dataset.column_names,
        desc="Tokenizing eval"
    )

    # Data collator
    data_collator = DataCollatorForSeq2Seq(
        tokenizer=tokenizer,
        model=model,
        padding=True
    )

    # Training arguments for HALF an epoch
    # With 90 train samples, batch size 4, that's ~23 steps per epoch
    # Half epoch = ~11 steps
    max_steps = max(1, int(len(train_samples) * 0.5 / 4))  # 0.5 epochs

    print(f"\nTraining for {max_steps} steps (approximately 0.5 epochs)")
    print(f"Learning rate: 1e-5 (was 5e-5)")

    training_args = Seq2SeqTrainingArguments(
        output_dir=f"temp_training_{model_size}",
        max_steps=max_steps,                    # HALF epoch
        per_device_train_batch_size=4,
        per_device_eval_batch_size=8,
        learning_rate=1e-5,                     # ULTRA low LR
        weight_decay=0.01,
        fp16=True,
        logging_steps=5,
        eval_steps=max_steps,                   # Eval at end only
        save_steps=max_steps,                   # Save at end only
        evaluation_strategy="steps",
        save_strategy="steps",
        load_best_model_at_end=False,           # No need with single checkpoint
        predict_with_generate=False,            # Skip to save time
        seed=42,
        dataloader_num_workers=2,
        remove_unused_columns=False,
        report_to="none"
    )

    # Trainer
    trainer = Seq2SeqTrainer(
        model=model,
        args=training_args,
        train_dataset=train_dataset,
        eval_dataset=eval_dataset,
        tokenizer=tokenizer,
        data_collator=data_collator
    )

    # Train
    print("\n" + "="*70)
    print("STARTING ULTRA-LIGHT TRAINING (0.5 epochs, 100 samples)")
    print("="*70 + "\n")

    train_result = trainer.train()

    print("\n" + "="*70)
    print("TRAINING COMPLETE - Merging LoRA adapters...")
    print("="*70 + "\n")

    # Merge LoRA adapters back into base model
    model = model.merge_and_unload()

    # Save merged model
    output_path = Path(output_model_path)
    output_path.mkdir(parents=True, exist_ok=True)

    print(f"Saving merged model to {output_path}...")
    model.save_pretrained(output_path)
    tokenizer.save_pretrained(output_path)

    # Save training info
    training_info = {
        "base_model": base_model_path,
        "lora_config": {
            "rank": 4,
            "alpha": 8,
            "dropout": 0.0,
            "target_modules": ["q_proj"]
        },
        "training": {
            "samples": len(train_samples),
            "steps": max_steps,
            "epochs": 0.5,
            "learning_rate": 1e-5
        },
        "strategy": "ultra-light LoRA fine-tuning for legal distinctiveness with minimal quality impact"
    }

    with open(output_path / "training_info.json", 'w') as f:
        json.dump(training_info, f, indent=2)

    print(f"\n{'='*70}")
    print(f"SUCCESS: Model saved to {output_path}")
    print(f"Trainable params modified: {trainable_params:,} ({100 * trainable_params / total_params:.4f}%)")
    print(f"{'='*70}\n")

    return output_path


def main():
    """Retrain both translation models with ultra-light LoRA."""

    data_dir = "data/translation/processed/processed"

    print("\n" + "="*70)
    print("WINDY PRO - TRANSLATION MODEL FIX")
    print("Ultra-Light LoRA Retraining")
    print("="*70 + "\n")

    # Train Translate Spark (418M)
    print("\n### STEP 1/2: Translate Spark (418M) ###\n")
    spark_output = train_ultralight_lora(
        base_model_path="models/m2m100_418M",
        output_model_path="models/windy_translate_spark",
        data_dir=data_dir,
        model_size="418M"
    )

    # Train Translate Standard (1.2B)
    print("\n### STEP 2/2: Translate Standard (1.2B) ###\n")
    standard_output = train_ultralight_lora(
        base_model_path="models/m2m100_1.2B",
        output_model_path="models/windy_translate_standard",
        data_dir=data_dir,
        model_size="1.2B"
    )

    print("\n" + "="*70)
    print("ULTRA-LIGHT RETRAINING COMPLETE")
    print("="*70)
    print(f"\nTranslate Spark: {spark_output}")
    print(f"Translate Standard: {standard_output}")
    print("\nNext: Run QA tests to verify quality!")
    print("="*70 + "\n")


if __name__ == "__main__":
    main()
