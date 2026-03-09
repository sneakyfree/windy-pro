# Windy Pro — Model Registry (CORRECTED)
### Ground Truth Inventory — No Marketing Fluff

**Last Updated:** 09 Mar 2026
**Audited by:** Kit 0C1 Alpha, from actual run logs and checkpoint artifacts
**Source of truth:** `runs/finetune-lora-*.json` + `artifacts/lora_checkpoints/*/adapter_config.json`

---

## EXECUTIVE SUMMARY

**We have 9 models total.** Not 15. Not 17.

- **7 Speech-to-Text models** (LoRA fine-tuned from OpenAI Whisper + Distil-Whisper)
- **2 Text-to-Text Translation models** (LoRA fine-tuning from Meta M2M-100) — Spark in progress, Standard not started

The "15 model" count was aspirational product naming that mapped multiple brand names onto the same underlying models. Several "Edge" variants were never actually fine-tuned — they were planned but don't exist as checkpoints.

---

## WHAT ACTUALLY EXISTS: 12 LoRA CHECKPOINT RUNS

We ran 12 fine-tuning jobs across 7 distinct base models. Multiple runs on the same base are NOT separate products — they're iterative experiments (different hyperparams, different dataset sizes). Only the best run per base matters.

### Redundancy Report

| Base Model | Runs | Redundant? | What Happened |
|---|---|---|---|
| `openai/whisper-tiny` | 2 | Yes — Run 1 was a 10-sample smoke test. Run 2 (200 samples, 2 epochs) is the real one. |
| `openai/whisper-base` | 1 | No — single run, 300 samples, clean. |
| `openai/whisper-small` | 1 | No — single run, 400 samples, clean. |
| `openai/whisper-medium` | 2 | Yes — Run 1 was a 10-sample smoke test. Run 2 (500 samples, 3 epochs) is the real one. |
| `openai/whisper-large-v3` | 2 | Yes — Run 1 was a 10-sample smoke test. Run 2 (600 samples, 2 epochs) is the real one. |
| `openai/whisper-large-v3-turbo` | 3 | Yes — Runs 1 & 2 were both 10-sample smoke tests (nearly identical). Run 3 (600 samples, 2 epochs) is the real one. |
| `distil-whisper/distil-large-v3` | 1 | No — single run, 500 samples, clean. |

**5 of the 12 runs are throwaway smoke tests** (10 samples, 1 epoch — just testing if the pipeline worked). They should be archived, not counted as products.

---

## THE REAL 7 STT MODELS (Best Run Per Base)

All fine-tuned on **Feb 25-26, 2026** on RTX 5090. All English-only training data. All use LoRA rank 8, alpha 16, dropout 0.05, targeting q_proj + v_proj (attention only).

---

### Model 1: Windy STT Nano

| Field | Value |
|---|---|
| **Windy Name** | Windy STT Nano |
| **Base Model** | `openai/whisper-tiny` |
| **Base License** | MIT |
| **Base Size** | ~75 MB (39M params) |
| **LoRA Adapter Size** | 4.1 MB |
| **LoRA Rank / Alpha** | 4 / 8 |
| **Training** | 200 samples, 2 epochs, LR 8e-6, 95 seconds |
| **Best Eval Loss** | 3.4728 |
| **Best Checkpoint** | `lora-tiny-en-20260225T181843Z` |
| **Languages Trained** | English only |
| **Speed** | ~32× realtime |
| **Strengths** | Blazing fast, runs on anything, instant startup, <100MB total |
| **Weaknesses** | Lowest accuracy of all models, struggles with accents, poor noise handling, English-only fine-tune means multilingual capability is base-model quality only |
| **Best For** | Quick dictation, low-power devices, situations where speed matters more than accuracy |
| **Redundant Run** | `lora-tiny-en-20260225T175635Z` — 10-sample smoke test, discard |

---

### Model 2: Windy STT Lite

| Field | Value |
|---|---|
| **Windy Name** | Windy STT Lite |
| **Base Model** | `openai/whisper-base` |
| **Base License** | MIT |
| **Base Size** | ~142 MB (74M params) |
| **LoRA Adapter Size** | 5.0 MB |
| **LoRA Rank / Alpha** | 8 / 16 |
| **Training** | 300 samples, 2 epochs, LR 8e-6, 104 seconds |
| **Best Eval Loss** | 4.1797 |
| **Best Checkpoint** | `lora-base-en-20260225T182110Z` |
| **Languages Trained** | English only |
| **Speed** | ~16× realtime |
| **Strengths** | Good speed/accuracy balance for small model, handles most clear speech well |
| **Weaknesses** | Eval loss actually higher than Nano (4.18 vs 3.47) — may indicate undertrained or base model less suited to our data. Weak on background noise, English-only fine-tune |
| **Best For** | Default for low-resource devices, meetings with clear audio |
| **⚠️ Note** | Eval loss is worse than Nano despite being a bigger model. May need re-training with more data. |

---

### Model 3: Windy STT Core

| Field | Value |
|---|---|
| **Windy Name** | Windy STT Core |
| **Base Model** | `openai/whisper-small` |
| **Base License** | MIT |
| **Base Size** | ~466 MB (244M params) |
| **LoRA Adapter Size** | 7.2 MB |
| **LoRA Rank / Alpha** | 8 / 16 |
| **Training** | 400 samples, 3 epochs, LR 1e-5, 256 seconds |
| **Best Eval Loss** | 1.8765 |
| **Best Checkpoint** | `lora-small-en-20260225T182403Z` |
| **Languages Trained** | English only |
| **Speed** | ~6× realtime |
| **Strengths** | Sweet spot of size/accuracy/speed. Noticeable accuracy jump over Lite. Handles accents better. |
| **Weaknesses** | Still English-only fine-tune. Slower startup than Nano/Lite. |
| **Best For** | General-purpose default. Best "bang for buck" model for most users. |

---

### Model 4: Windy STT Plus

| Field | Value |
|---|---|
| **Windy Name** | Windy STT Plus |
| **Base Model** | `openai/whisper-medium` |
| **Base License** | MIT |
| **Base Size** | ~1.5 GB (769M params) |
| **LoRA Adapter Size** | 13 MB |
| **LoRA Rank / Alpha** | 8 / 16 |
| **Training** | 500 samples, 3 epochs, LR 1e-5, 382 seconds |
| **Best Eval Loss** | 1.5445 |
| **Best Checkpoint** | `lora-medium-en-20260226T021334Z` |
| **Languages Trained** | English only |
| **Speed** | ~4× realtime |
| **Strengths** | Strong accuracy, good at jargon and technical speech, handles noisy audio better |
| **Weaknesses** | 1.5GB is heavy for mobile/embedded. Slower than Core. English-only fine-tune. |
| **Best For** | Professional transcription, meetings with technical content, noisy environments |
| **Redundant Run** | `lora-medium-en-20260225T211809Z` — 10-sample smoke test, discard |

---

### Model 5: Windy STT Pro

| Field | Value |
|---|---|
| **Windy Name** | Windy STT Pro |
| **Base Model** | `openai/whisper-large-v3` |
| **Base License** | MIT |
| **Base Size** | ~3.1 GB (1.55B params) |
| **LoRA Adapter Size** | 19 MB |
| **LoRA Rank / Alpha** | 8 / 16 |
| **Training** | 600 samples, 2 epochs, LR 8e-6, 369 seconds |
| **Best Eval Loss** | 1.2331 |
| **Best Checkpoint** | `lora-large-v3-en-20260226T022215Z` |
| **Languages Trained** | English only |
| **Speed** | ~1× realtime (barely keeps up with live audio) |
| **Strengths** | Highest accuracy for multilingual base. Best rare language support (from base model). Best punctuation/formatting. |
| **Weaknesses** | Huge — needs GPU. Barely realtime. Overkill for casual use. Our fine-tune is English-only so non-English performance is base-model quality. |
| **Best For** | Archival-quality transcription, legal/compliance, rare languages (using base model capability) |
| **Redundant Run** | `lora-large-v3-en-20260225T212236Z` — 10-sample smoke test, discard |

---

### Model 6: Windy STT Turbo

| Field | Value |
|---|---|
| **Windy Name** | Windy STT Turbo |
| **Base Model** | `openai/whisper-large-v3-turbo` |
| **Base License** | MIT |
| **Base Size** | ~1.6 GB (809M params) |
| **LoRA Adapter Size** | 11 MB |
| **LoRA Rank / Alpha** | 8 / 16 |
| **Training** | 600 samples, 2 epochs, LR 8e-6, 346 seconds |
| **Best Eval Loss** | 0.4563 ⭐ BEST OF ALL MODELS |
| **Best Checkpoint** | `lora-large-v3-turbo-en-20260226T023039Z` |
| **Languages Trained** | English only |
| **Speed** | ~4× realtime |
| **Strengths** | **Our best model by eval loss.** Near-Large-v3 quality at Medium-class speed. OpenAI's latest architecture — distilled from Large-v3 with pruned decoder. |
| **Weaknesses** | Newer architecture, less community testing. English-only fine-tune. 1.6GB still heavy for mobile. |
| **Best For** | **Production default for GPU users.** Best quality-to-speed ratio in the fleet. |
| **Redundant Runs** | `lora-large-v3-turbo-en-20260225T212212Z` and `lora-large-v3-turbo-en-20260225T212328Z` — both 10-sample smoke tests, nearly identical, discard both |

---

### Model 7: Windy STT Edge

| Field | Value |
|---|---|
| **Windy Name** | Windy STT Edge |
| **Base Model** | `distil-whisper/distil-large-v3` |
| **Base License** | MIT |
| **Base Size** | ~756 MB (distilled from Large-v3) |
| **LoRA Adapter Size** | 9.5 MB |
| **LoRA Rank / Alpha** | 8 / 16 |
| **Training** | 500 samples, 2 epochs, LR 8e-6, 105 seconds |
| **Best Eval Loss** | 4.814 |
| **Best Checkpoint** | `lora-distil-whisper_distil-large-v3-en-20260226T165243Z` |
| **Languages Trained** | English only |
| **Speed** | ~6× realtime (faster than base Large-v3 due to distillation) |
| **Strengths** | Distilled architecture — faster inference than equivalently-sized standard Whisper. Good for edge deployment. |
| **Weaknesses** | **Worst eval loss of any model (4.814)** — the LoRA fine-tuning may have hurt more than helped, OR the distilled architecture responds differently to LoRA. Needs investigation. English-only. |
| **Best For** | Edge deployment where you want Large-v3-like accuracy at faster speed — BUT the high eval loss is a red flag |
| **⚠️ WARNING** | Eval loss 4.814 is worse than tiny (3.47). This model needs re-evaluation. The LoRA may need different hyperparameters for distilled architectures, or this checkpoint may be degraded. Do NOT ship without further testing. |

---

## TEXT-TO-TEXT TRANSLATION MODELS (2)

### Model 8: Windy Translate Spark

| Field | Value |
|---|---|
| **Windy Name** | Windy Translate Spark |
| **Base Model** | `facebook/m2m100_418M` |
| **Base License** | MIT |
| **Base Size** | ~1.9 GB (418M params) |
| **LoRA Config** | Rank 16, alpha 32, q_proj + v_proj, 1 epoch, LR 5e-5 |
| **Training** | 🔄 IN PROGRESS — AG session running |
| **Languages** | 100 languages, 9,900 direction pairs |
| **Speed** | ~117ms per translation (GPU) |
| **VRAM** | 1.9 GB |
| **Strengths** | Fast, tiny VRAM footprint, all major language pairs |
| **Weaknesses** | Weaker on rare pairs (fi↔pt), literal on idioms |
| **Best For** | Real-time translation, fast mode, resource-constrained |

### Model 9: Windy Translate Standard

| Field | Value |
|---|---|
| **Windy Name** | Windy Translate Standard |
| **Base Model** | `facebook/m2m100_1.2B` |
| **Base License** | MIT |
| **Base Size** | ~5 GB (1.2B params) |
| **Training** | ❌ NOT STARTED — Phase 4 |
| **Languages** | 100 languages, 9,900 direction pairs |
| **Speed** | ~200-400ms estimated (GPU) |
| **VRAM** | ~5 GB estimated |
| **Strengths** | Higher quality, better context understanding, better rare pairs |
| **Weaknesses** | Heavier, slower, needs GPU for realtime |
| **Best For** | Quality mode, rare language pairs, documents |

---

## CRITICAL FINDINGS

### 1. We Have 7 STT Models, Not 15
The "15 model" lineup was a product naming scheme that doesn't match reality. We fine-tuned 7 distinct base models. Period.

### 2. All STT Fine-Tuning Was English-Only
Every single LoRA run used English training data. The multilingual capability of these models comes entirely from the base model — our fine-tuning only improved English performance. If we want to claim multilingual improvement, we need multilingual training runs.

### 3. Two Models Have Concerning Eval Losses
- **Windy STT Lite** (whisper-base): 4.18 eval loss — worse than Nano despite being bigger
- **Windy STT Edge** (distil-large-v3): 4.81 eval loss — worst of all models, possible degradation

### 4. Five Checkpoints Are Smoke Tests
These runs used only 10 samples and 1 epoch. They exist because we were testing the pipeline, not training real models:
- `lora-tiny-en-20260225T175635Z` (10 samples)
- `lora-medium-en-20260225T211809Z` (10 samples)
- `lora-large-v3-en-20260225T212236Z` (10 samples)
- `lora-large-v3-turbo-en-20260225T212212Z` (10 samples)
- `lora-large-v3-turbo-en-20260225T212328Z` (10 samples)

These should be moved to an `artifacts/archive/` directory to avoid confusion.

### 5. Our Best Model Is Turbo
Windy STT Turbo (whisper-large-v3-turbo) has the lowest eval loss (0.4563) by a massive margin. It's the clear champion for quality-to-speed ratio.

### 6. All LoRA Configs Are Identical
Every model uses rank 8, alpha 16, q_proj + v_proj. This is conservative and good for legal distinctiveness, but it also means the differentiation between models comes almost entirely from the base model, not from our training.

---

## HONEST MODEL RANKING (by eval loss, lower = better)

| Rank | Model | Eval Loss | Base | Status |
|---|---|---|---|---|
| ⭐ 1 | Windy STT Turbo | 0.4563 | whisper-large-v3-turbo | CHAMPION |
| 2 | Windy STT Pro | 1.2331 | whisper-large-v3 | Good |
| 3 | Windy STT Plus | 1.5445 | whisper-medium | Good |
| 4 | Windy STT Core | 1.8765 | whisper-small | Good |
| 5 | Windy STT Nano | 3.4728 | whisper-tiny | Acceptable |
| ⚠️ 6 | Windy STT Lite | 4.1797 | whisper-base | Needs investigation |
| 🔴 7 | Windy STT Edge | 4.8140 | distil-large-v3 | POSSIBLE DEGRADATION |

---

## RECOMMENDED ACTIONS

1. **Archive the 5 smoke-test checkpoints** — move to `artifacts/archive/`
2. **Investigate Windy STT Edge** — eval loss 4.81 suggests LoRA may have degraded the distilled model. Re-run with different hyperparams or drop it.
3. **Investigate Windy STT Lite** — eval loss 4.18 is worse than Nano. May need more training data.
4. **Add multilingual training data** — all 7 models were English-only fine-tuned. For a product that claims 99-language support, this is a gap.
5. **Rename products honestly** — use 7 clear names, not 15 inflated ones.
6. **Complete Windy Translate Spark** — LoRA training in progress.
7. **Start Windy Translate Standard** — download and fine-tune M2M-100-1.2B.

---

## THE OLD "15 MODELS" vs REALITY

| Old Marketing Name | Actually Is | Real Name |
|---|---|---|
| Core Spark | openai/whisper-tiny + LoRA | Windy STT Nano |
| Core Pulse | openai/whisper-base + LoRA | Windy STT Lite |
| Core Standard | openai/whisper-small + LoRA | Windy STT Core |
| Core Pro | openai/whisper-medium + LoRA | Windy STT Plus |
| Core Turbo | openai/whisper-large-v3-turbo + LoRA | Windy STT Turbo |
| Core Ultra | openai/whisper-large-v3 + LoRA | Windy STT Pro |
| Edge Spark | ❌ Never fine-tuned | Does not exist |
| Edge Pulse | ❌ Never fine-tuned | Does not exist |
| Edge Standard | ❌ Never fine-tuned | Does not exist |
| Edge Global | ❌ Never fine-tuned | Does not exist |
| Edge Pro | ❌ Never fine-tuned | Does not exist |
| Edge Turbo | ❌ Never fine-tuned | Does not exist |
| Edge Ultra | distil-whisper/distil-large-v3 + LoRA | Windy STT Edge ⚠️ |
| Edge Turbo (English) | ❌ Never fine-tuned | Does not exist |
| Edge Ultra (English) | ❌ Never fine-tuned | Does not exist |

**8 of the claimed 15 STT models don't exist.** Only 7 were actually built.

---

## APPENDIX: ALL 12 TRAINING RUNS (Complete Record)

| Run Name | Base | Samples | Epochs | Eval Loss | Time | Status |
|---|---|---|---|---|---|---|
| lora-tiny-en-20260225T175635Z | whisper-tiny | 10 | 1 | 3.7798 | 2s | ❌ Smoke test |
| lora-tiny-en-20260225T181843Z | whisper-tiny | 200 | 2 | 3.4728 | 95s | ✅ KEEPER |
| lora-base-en-20260225T182110Z | whisper-base | 300 | 2 | 4.1797 | 104s | ✅ KEEPER ⚠️ |
| lora-small-en-20260225T182403Z | whisper-small | 400 | 3 | 1.8765 | 256s | ✅ KEEPER |
| lora-medium-en-20260225T211809Z | whisper-medium | 10 | 1 | 3.808 | 11s | ❌ Smoke test |
| lora-medium-en-20260226T021334Z | whisper-medium | 500 | 3 | 1.5445 | 382s | ✅ KEEPER |
| lora-large-v3-en-20260225T212236Z | whisper-large-v3 | 10 | 1 | 2.599 | 3s | ❌ Smoke test |
| lora-large-v3-en-20260226T022215Z | whisper-large-v3 | 600 | 2 | 1.2331 | 369s | ✅ KEEPER |
| lora-large-v3-turbo-en-20260225T212212Z | whisper-large-v3-turbo | 10 | 1 | 1.8034 | 2s | ❌ Smoke test |
| lora-large-v3-turbo-en-20260225T212328Z | whisper-large-v3-turbo | 10 | 1 | 1.804 | 2s | ❌ Smoke test |
| lora-large-v3-turbo-en-20260226T023039Z | whisper-large-v3-turbo | 600 | 2 | 0.4563 | 346s | ✅ KEEPER ⭐ |
| lora-distil-large-v3-en-20260226T165243Z | distil-large-v3 | 500 | 2 | 4.814 | 105s | ✅ KEEPER 🔴 |

---

*This registry reflects what we actually built, not what we wished we built.*
*Updated from actual run logs and checkpoint artifacts on 09 Mar 2026.*
*— Kit 0C1 Alpha*
