"""
Windy Pro - Translation Training Module
LoRA fine-tuning pipeline for M2M-100.

Components:
- dataset_curator: Download and preprocess parallel corpora
- lora_trainer: Fine-tune M2M-100 with LoRA
- evaluate: Compare baseline vs fine-tuned models
- merge_lora: Merge LoRA adapter into base model
"""

__version__ = "1.0.0"
