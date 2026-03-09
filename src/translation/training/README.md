# Windy Pro Translation - LoRA Fine-Tuning Pipeline

Complete pipeline for fine-tuning Meta's M2M-100-418M translation model using LoRA (Low-Rank Adaptation).

## Overview

This training pipeline enables domain-specific fine-tuning of the M2M-100 model for improved translation quality on:
- Conversational speech
- Business/professional terminology
- Technical terms and proper nouns
- Domain-specific vocabulary

### Why LoRA?

**Parameter-Efficient Fine-Tuning (PEFT) with LoRA:**
- Only trains ~1-2% of model parameters
- Fast training on consumer GPUs (RTX 5090)
- Low memory footprint (base model uses 1.9GB VRAM)
- Preserves general translation capabilities
- Can be merged back into base model

## Quick Start

### 1. Install Dependencies

```bash
# From project root
pip install -r src/translation/training/requirements.txt
```

**Required packages:**
- `peft` - LoRA implementation
- `transformers` - M2M-100 model
- `datasets` - Data loading
- `evaluate`, `sacrebleu` - Metrics
- `torch`, `accelerate` - Training framework

### 2. Curate Training Data

Download and process parallel corpora from OPUS and Flores-200:

```bash
cd src/translation/training

# Curate all priority language pairs (en ↔ ru, fi, pt, es, fr, de, zh, ja, ko, ar)
python dataset_curator.py --output-dir data/translation --pairs-per-direction 100000

# Or curate a single language pair
python dataset_curator.py --language-pair en-es --pairs-per-direction 50000
```

**Dataset sources (MIT/Apache/CC-BY licensed):**
- OPUS Tatoeba
- OPUS OpenSubtitles2018
- OPUS GNOME, Ubuntu, KDE
- Flores-200 dev/devtest

**Output:** Cleaned, deduplicated, quality-filtered JSONL files in `data/translation/processed/`

**Expected time:** ~2-4 hours for all priority pairs (depends on download speed)

### 3. Configure Training

Edit `train_config.yaml` to adjust hyperparameters:

```yaml
# Key settings
lora:
  rank: 32              # LoRA rank (higher = more capacity)
  alpha: 64             # LoRA alpha (scaling factor)
  dropout: 0.05

training:
  num_epochs: 3
  batch_size: 8
  gradient_accumulation_steps: 4
  learning_rate: 2.0e-4
  fp16: true           # Use FP16 on RTX 5090
```

### 4. Train the Model

```bash
# Start training
python lora_trainer.py --config train_config.yaml

# Resume from checkpoint
python lora_trainer.py --config train_config.yaml --resume models/windy_translate_lora/checkpoint-5000
```

**Training output:**
- Checkpoints saved to `models/windy_translate_lora/`
- Best model saved based on BLEU score
- Training logs in `models/windy_translate_lora/logs/`

**Expected training time on RTX 5090:**
- 100k pairs: ~2-3 hours per epoch
- 500k pairs: ~8-12 hours per epoch
- 1M pairs: ~15-20 hours per epoch

**Memory usage:**
- Model: ~1.9GB VRAM
- Training batch: ~4-6GB VRAM
- Total: ~8-10GB VRAM (plenty of headroom on 32GB)

### 5. Evaluate the Model

Compare baseline vs fine-tuned model on Flores-200 devtest:

```bash
# Evaluate on standard benchmark
python evaluate.py \
  --baseline models/m2m100_418M \
  --finetuned models/windy_translate_lora/final_model \
  --test-set flores200 \
  --source-lang en \
  --target-lang es

# Or use custom test set
python evaluate.py \
  --baseline models/m2m100_418M \
  --finetuned models/windy_translate_lora/final_model \
  --test-set custom \
  --custom-test-file data/translation/test_set.jsonl
```

**Output:**
- `reports/baseline_vs_finetuned.md` - Comparison report
- `reports/evaluation_results.json` - Full metrics

**Metrics:**
- BLEU score
- chrF++ score
- Inference speed (ms)
- Tokens/sec
- VRAM usage

### 6. Merge and Export

Merge LoRA adapter back into base model for deployment:

```bash
python merge_lora.py \
  --base-model models/m2m100_418M \
  --lora-adapter models/windy_translate_lora/final_model \
  --output models/windy_translate_spark \
  --verify
```

**Output:** Standalone merged model at `models/windy_translate_spark/`

The `--verify` flag runs a test translation to ensure merged model produces identical output.

### 7. Deploy Fine-Tuned Model

Use the fine-tuned model in production:

```bash
# Run server with fine-tuned merged model
python ../run_server.py --model-type finetuned

# Or run with LoRA adapter directly
python ../run_server.py --model-type lora --lora-adapter models/windy_translate_lora/final_model
```

The server will automatically load `models/windy_translate_spark/` when `--model-type finetuned` is used.

## Pipeline Components

### 1. Dataset Curator (`dataset_curator.py`)

**Features:**
- Multi-source data downloading (OPUS, Flores-200)
- Text cleaning and normalization
- Length filtering (5-200 tokens)
- Quality scoring (length ratio, character diversity, no URLs)
- Deduplication (MD5 hashing)
- Output: JSONL format with source_text, target_text, langs

**Usage:**
```bash
# All priority pairs
python dataset_curator.py

# Single pair
python dataset_curator.py --language-pair en-ru --pairs-per-direction 50000

# Custom output
python dataset_curator.py --output-dir my_data --pairs-per-direction 200000
```

### 2. LoRA Trainer (`lora_trainer.py`)

**Features:**
- Full LoRA fine-tuning pipeline
- PEFT integration with configurable rank/alpha
- Mixed precision training (FP16)
- BLEU/chrF++ evaluation during training
- Checkpointing with best model selection
- Gradient accumulation for larger effective batch sizes

**Configuration (train_config.yaml):**
```yaml
lora:
  rank: 32                    # LoRA rank
  alpha: 64                   # LoRA scaling
  dropout: 0.05
  target_modules:             # Which layers to adapt
    - encoder attention
    - decoder attention
    - FFN layers

training:
  num_epochs: 3
  batch_size: 8
  gradient_accumulation_steps: 4
  learning_rate: 2.0e-4
  warmup_ratio: 0.1           # 10% warmup
  fp16: true
```

**Usage:**
```bash
# Train from scratch
python lora_trainer.py --config train_config.yaml

# Resume from checkpoint
python lora_trainer.py --config train_config.yaml --resume models/checkpoint-5000
```

### 3. Evaluator (`evaluate.py`)

**Features:**
- Compare baseline vs fine-tuned models
- Standard benchmarks (Flores-200 devtest)
- Custom test sets
- Metrics: BLEU, chrF++, inference speed, VRAM
- Markdown report generation

**Usage:**
```bash
# Standard evaluation
python evaluate.py \
  --baseline models/m2m100_418M \
  --finetuned models/windy_translate_lora/final_model \
  --source-lang en \
  --target-lang es

# Custom test set
python evaluate.py \
  --baseline models/m2m100_418M \
  --finetuned models/windy_translate_lora/final_model \
  --test-set custom \
  --custom-test-file my_test.jsonl
```

### 4. LoRA Merger (`merge_lora.py`)

**Features:**
- Merge LoRA adapter into base model
- Create standalone deployment-ready model
- Verification mode to ensure identical outputs
- Safetensors export

**Usage:**
```bash
# Merge and verify
python merge_lora.py \
  --base-model models/m2m100_418M \
  --lora-adapter models/windy_translate_lora/final_model \
  --output models/windy_translate_spark \
  --verify

# Merge only (no verification)
python merge_lora.py \
  --base-model models/m2m100_418M \
  --lora-adapter models/windy_translate_lora/final_model \
  --output models/windy_translate_spark
```

## Training Configuration Reference

### LoRA Hyperparameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `rank` | 32 | LoRA rank (higher = more capacity, slower) |
| `alpha` | 64 | LoRA scaling factor (typically 2x rank) |
| `dropout` | 0.05 | Dropout rate for LoRA layers |
| `target_modules` | attention + FFN | Which layers to adapt |

**Tuning guidelines:**
- Rank 16: Fast training, good for similar domains
- Rank 32: Balanced (recommended)
- Rank 64: High capacity, slower training

### Training Hyperparameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `num_epochs` | 3 | Training epochs |
| `batch_size` | 8 | Per-device batch size |
| `gradient_accumulation_steps` | 4 | Effective batch = 8×4 = 32 |
| `learning_rate` | 2e-4 | Learning rate |
| `warmup_ratio` | 0.1 | Warmup steps ratio |
| `fp16` | true | Use FP16 mixed precision |

**Expected performance (RTX 5090):**
- Training speed: ~500-700 samples/sec
- VRAM usage: ~8-10GB
- Checkpoint size: ~50-100MB (LoRA only)
- Merged model size: ~1.9GB (same as base)

### Dataset Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| `max_train_samples` | null | Limit training samples (null = all) |
| `max_eval_samples` | 5000 | Max evaluation samples |
| `train_split` | 0.95 | Train/eval split ratio |

## Expected Results

### Baseline M2M-100-418M (Phase 1)

From benchmark testing:
- **BLEU**: ~25-35 (varies by language pair)
- **Inference**: 117ms avg, 138.5 tokens/sec
- **VRAM**: 1.9GB

### After Fine-Tuning (Expected)

Based on LoRA fine-tuning literature:
- **BLEU improvement**: +2-5 points on domain data
- **Domain accuracy**: +10-20% on technical/conversational terms
- **Inference speed**: Same (117ms)
- **VRAM**: Same (1.9GB)

**Note:** Actual improvements depend on:
- Data quality and quantity
- Domain similarity
- Language pair difficulty
- Training configuration

## Directory Structure

```
src/translation/training/
├── README.md                      # This file
├── requirements.txt               # Training dependencies
├── train_config.yaml              # Training configuration
├── dataset_curator.py             # Data download and preprocessing
├── lora_trainer.py               # LoRA training pipeline
├── evaluate.py                    # Model evaluation
└── merge_lora.py                 # LoRA merging

data/translation/
├── raw/                          # Downloaded raw data
│   ├── tatoeba_*.zip
│   ├── opensubtitles_*.zip
│   └── flores200/
└── processed/                    # Cleaned JSONL datasets
    ├── en_es.jsonl
    ├── en_ru.jsonl
    └── ...

models/
├── m2m100_418M/                  # Base model (Phase 1)
├── windy_translate_lora/         # LoRA checkpoints
│   ├── checkpoint-1000/
│   ├── checkpoint-2000/
│   ├── final_model/              # Best LoRA adapter
│   └── logs/
└── windy_translate_spark/        # Merged fine-tuned model

reports/
├── baseline_vs_finetuned.md      # Evaluation report
└── evaluation_results.json       # Detailed metrics
```

## Troubleshooting

### Out of Memory (OOM)

**Solutions:**
1. Reduce `batch_size` in `train_config.yaml` (try 4 or 2)
2. Increase `gradient_accumulation_steps` to maintain effective batch size
3. Reduce `max_source_length` and `max_target_length` (try 64)
4. Enable gradient checkpointing (add `gradient_checkpointing: true`)

### Dataset Download Fails

**Solutions:**
1. Check internet connection
2. Some OPUS datasets may be unavailable - curator will skip them
3. Use Flores-200 only if OPUS fails (smaller but high-quality)
4. Manually download and place in `data/translation/raw/`

### Training Stalls or No Improvement

**Solutions:**
1. Lower learning rate (try 1e-4)
2. Increase warmup ratio (try 0.2)
3. Check data quality - review samples in JSONL files
4. Ensure sufficient training data (>10k pairs minimum)
5. Try different LoRA rank (8, 16, or 64)

### Model Outputs Gibberish After Fine-Tuning

**Solutions:**
1. Check if training data has correct language pairs
2. Verify source_lang and target_lang in JSONL files
3. Lower learning rate (was too high)
4. Reduce LoRA rank (try 16)
5. Use more training data

### Slow Training

**Optimizations:**
1. Ensure CUDA is available (`torch.cuda.is_available()`)
2. Enable FP16: `fp16: true` in config
3. Increase batch size if VRAM allows
4. Use fewer evaluation steps (set `eval_steps: 1000`)
5. Reduce `dataloader_num_workers` if CPU-bound

## Advanced Usage

### Multi-GPU Training

```bash
# Use accelerate for distributed training
accelerate config  # Configure multi-GPU setup

accelerate launch lora_trainer.py --config train_config.yaml
```

### W&B Integration

Enable Weights & Biases logging in `train_config.yaml`:

```yaml
wandb:
  enabled: true
  project: "windy-pro-translation"
  run_name: "m2m100_lora_finetune_v1"
```

Then run with `WANDB_API_KEY`:
```bash
export WANDB_API_KEY=your_key_here
python lora_trainer.py --config train_config.yaml
```

### Custom Language Pairs

Add new languages to `train_config.yaml`:

```yaml
languages:
  priority:
    - "en"
    - "es"
    - "my_lang"  # Add custom language code
```

Ensure M2M-100 supports your language (check `translator.py::LANG_CODES`).

### Hyperparameter Tuning

Try these configurations for different scenarios:

**Fast iteration (debugging):**
```yaml
lora:
  rank: 8
training:
  num_epochs: 1
  batch_size: 16
dataset:
  max_train_samples: 10000
```

**High quality (production):**
```yaml
lora:
  rank: 64
  alpha: 128
training:
  num_epochs: 5
  learning_rate: 1.0e-4
dataset:
  max_train_samples: null  # Use all data
```

**Memory-efficient:**
```yaml
training:
  batch_size: 2
  gradient_accumulation_steps: 16
  gradient_checkpointing: true
```

## Best Practices

### Data Quality > Quantity

- 50k high-quality pairs > 500k low-quality pairs
- Focus on domain-relevant data
- Remove noisy translations (URLs, markup, etc.)
- Ensure proper language alignment

### Training Strategy

1. **Start small:** Train on 10k pairs first to validate pipeline
2. **Monitor metrics:** Watch BLEU during training (should increase)
3. **Early stopping:** If eval loss plateaus, stop training
4. **Compare checkpoints:** Test multiple checkpoints, not just final

### Model Selection

- **Base model:** General-purpose, fast inference
- **LoRA adapter:** Domain-specific, easy to swap
- **Merged model:** Production deployment, no PEFT overhead

## License

- **Code:** MIT License
- **M2M-100 model:** MIT License (Meta AI)
- **OPUS datasets:** Various (MIT, Apache, CC-BY)
- **Flores-200:** CC-BY-SA 4.0

All curated datasets use only MIT/Apache/CC-BY licensed sources.

## Citation

If you use this training pipeline in research, please cite:

```bibtex
@software{windy_pro_translation_2025,
  title={Windy Pro Translation Engine - LoRA Fine-Tuning Pipeline},
  author={Windy Pro Team},
  year={2025},
  url={https://github.com/your-org/windy-pro}
}

@inproceedings{fan2021beyond,
  title={Beyond English-centric multilingual machine translation},
  author={Fan, Angela and Bhosale, Shruti and Schwenk, Holger and Ma, Zhiyi and El-Kishky, Ahmed and Goyal, Siddharth and Baines, Mandeep and Celebi, Onur and Wenzek, Guillaume and Chaudhary, Vishrav and others},
  booktitle={Journal of Machine Learning Research},
  volume={22},
  number={107},
  pages={1--48},
  year={2021}
}
```

## Support

For issues or questions:
1. Check troubleshooting section above
2. Review training logs in `models/windy_translate_lora/logs/`
3. Open an issue on GitHub with:
   - Configuration file
   - Training logs
   - System info (GPU, PyTorch version)

---

**Ready to train?** Start with Step 1: Install Dependencies!
