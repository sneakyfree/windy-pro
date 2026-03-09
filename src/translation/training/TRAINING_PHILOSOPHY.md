# Windy Pro Translation — Training Philosophy

## The Approach: Light Touch LoRA

We are NOT trying to build a better translator than Meta. We are:

1. **Establishing legal distinctiveness** — LoRA fine-tuning on our curated dataset creates mathematically different weights. This is our model.
2. **Preserving baseline quality** — M2M-100 handles 9,900 language pairs well. We do NOT want to break any of them.
3. **Adding our signature** — Professional/business terminology, conversational tone, proper noun handling.
4. **Building a foundation** — v1 is the lightest touch. Future versions add more of our DNA over time.

## Legal Basis

- **Base model:** M2M-100-418M by Meta AI (MIT License)
- **MIT License explicitly permits:** use, copy, modify, merge, publish, distribute, sublicense, sell
- **Our obligation:** Include original MIT copyright notice in distribution
- **Training data:** All MIT/Apache/CC licensed parallel corpora — no proprietary data
- **Result:** Mathematically distinct weights, our own model card, our own branding

This is standard industry practice. Mistral, Yi, and thousands of companies fine-tune open models and ship under their own name. The MIT license was designed for exactly this.

## Conservative v1 Training Parameters

Override the defaults with these for the first training run:

```yaml
# v1 Conservative Settings — DO NOT INCREASE WITHOUT GRANT'S APPROVAL
lora:
  rank: 16          # NOT 32 or 64 — small delta
  alpha: 32         # 2x rank
  dropout: 0.05
  target_modules:   # attention only, NOT FFN for v1
    - q_proj
    - v_proj

training:
  epochs: 1                    # ONE epoch max for v1
  batch_size: 8
  gradient_accumulation: 4
  learning_rate: 5e-5          # Very conservative — half of typical
  warmup_ratio: 0.1
  weight_decay: 0.01
  fp16: true
  max_samples_per_pair: 20000  # Cap dataset size
```

## Quality Gates (Non-Negotiable)

1. After training, run evaluate.py against ALL language pairs
2. Every pair must score ≥95% of baseline BLEU
3. If ANY pair drops >5%, the training is rejected — roll back
4. Inference speed must stay within 5% of baseline (LoRA merged = same speed)

## Model Naming

| Model Name | Base | Purpose |
|---|---|---|
| Windy Translate Spark | M2M-100-418M | Fast, lightweight (~2GB) |
| Windy Translate Standard | M2M-100-1.2B | High-quality (~5GB) |

## Version Roadmap

- **v1 (now):** Light LoRA, establish distinctiveness, preserve quality
- **v2 (future):** More training data, slightly higher rank, domain specialization
- **v3+ (future):** Custom attention heads, architecture modifications, proprietary data
- **Long term:** Model is genuinely ours through accumulated improvements

---
*Windy Pro Labs — Speak your language. Read theirs.*
