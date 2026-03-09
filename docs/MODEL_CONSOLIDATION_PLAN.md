# Windy Pro — Model Consolidation Master Plan
## From 15+2 Phantom Models → 9 Real Models

**Created:** 09 Mar 2026
**Author:** Kit 0C1 Alpha + Grant Whitmer
**Status:** ACTIVE — IN PROGRESS
**Goal:** Ship 9 real, distinct, legally proprietary models under the Windy Pro Labs brand

---

## THE PROBLEM

We claimed 15 STT models + 2 translation models = 17 total. In reality:
- Only 7 STT models were actually fine-tuned
- 8 "Edge" variants were product names with no actual checkpoints
- 2 of the 7 real STT models have degraded eval loss (Lite + Edge)
- 5 training runs were 10-sample smoke tests, not real training
- All STT fine-tuning was English-only despite claiming 99 languages
- Translation models were not started until today

## THE SOLUTION

Consolidate to **9 real models** (7 STT + 2 Translation). Each one:
- Actually exists as a trained checkpoint
- Is distinct from every other model (different base, different size, different purpose)
- Is LoRA fine-tuned enough to be legally proprietary
- Has honest, documented strengths and weaknesses
- Has a Windy Pro Labs product name

---

## THE 9 MODELS

### Speech-to-Text (7 models)

| # | Product Name | Base (HuggingFace) | Base License | Size | Speed | Primary Use Case |
|---|---|---|---|---|---|---|
| 1 | **Windy STT Nano** | `openai/whisper-tiny` | MIT | 75 MB | 32× RT | Ultra-low resource, wearables, IoT |
| 2 | **Windy STT Lite** | `openai/whisper-base` | MIT | 142 MB | 16× RT | Mobile, light laptops, battery-sensitive |
| 3 | **Windy STT Core** | `openai/whisper-small` | MIT | 466 MB | 6× RT | **Default for most users. The Wispr Flow killer.** |
| 4 | **Windy STT Plus** | `openai/whisper-medium` | MIT | 1.5 GB | 4× RT | Professional meetings, business dictation |
| 5 | **Windy STT Pro** | `openai/whisper-large-v3` | MIT | 3.1 GB | 1× RT | Maximum accuracy, 99 languages, archival quality |
| 6 | **Windy STT Turbo** | `openai/whisper-large-v3-turbo` | MIT | 1.6 GB | 4× RT | **Champion. Best quality/speed ratio. GPU default.** |
| 7 | **Windy STT Edge** | `distil-whisper/distil-large-v3` | MIT | 756 MB | 6× RT | Edge deployment, field devices |

### Text-to-Text Translation (2 models)

| # | Product Name | Base (HuggingFace) | Base License | Size | Speed | Primary Use Case |
|---|---|---|---|---|---|---|
| 8 | **Windy Translate Spark** | `facebook/m2m100_418M` | MIT | 1.9 GB | ~117ms/translation | Fast mode, real-time, resource-constrained |
| 9 | **Windy Translate Standard** | `facebook/m2m100_1.2B` | MIT | 5 GB | ~300ms/translation | Quality mode, rare language pairs |

---

## EXECUTION PLAN (Ordered Steps)

### Phase A: Fix the Two Broken STT Models
**Priority: HIGH | Timeline: Same day**

1. Delete bad LoRA adapters:
   - `artifacts/lora_checkpoints/lora-base-en-20260225T182110Z/` (Lite — eval loss 4.18)
   - `artifacts/lora_checkpoints/lora-distil-whisper_distil-large-v3-en-20260226T165243Z/` (Edge — eval loss 4.81)

2. Download fresh base models from HuggingFace:
   - `openai/whisper-base` (142 MB)
   - `distil-whisper/distil-large-v3` (756 MB)

3. Re-run LoRA fine-tuning on each:
   - Same conservative config: rank 8, alpha 16, q_proj + v_proj
   - Training data: 500-600 samples (matching our successful runs)
   - For Edge: try LR 5e-6 (half the standard) since distilled architectures may be more sensitive
   - For Lite: use LR 8e-6 with 500 samples (up from 300)
   - 2 epochs each
   - Eval gate: must beat previous eval loss AND stay within 5% of base model quality

4. Verify both models produce reasonable output
5. Replace old checkpoints with new ones

### Phase B: Archive Smoke Tests
**Priority: MEDIUM | Timeline: Same day**

Move these 5 smoke-test runs to `artifacts/archive/smoke-tests/`:
- `lora-tiny-en-20260225T175635Z` (10 samples)
- `lora-medium-en-20260225T211809Z` (10 samples)
- `lora-large-v3-en-20260225T212236Z` (10 samples)
- `lora-large-v3-turbo-en-20260225T212212Z` (10 samples)
- `lora-large-v3-turbo-en-20260225T212328Z` (10 samples)

Also move the old bad runs for Lite and Edge after Phase A replaces them.

### Phase C: Complete Translation Models
**Priority: HIGH | Timeline: Today-Tomorrow**

1. **Windy Translate Spark** — LoRA training already in progress (AG session `mild-cove`)
   - Verify training completes successfully
   - Run eval: all language pairs must score ≥95% baseline BLEU
   - Merge LoRA → `models/windy_translate_spark/`

2. **Windy Translate Standard** — Not started yet
   - Download `facebook/m2m100_1.2B` (~5 GB)
   - Same conservative LoRA: rank 16, alpha 32, q_proj + v_proj, 1 epoch, LR 5e-5
   - Same eval gates
   - Merge LoRA → `models/windy_translate_standard/`

### Phase D: Create Canonical Model Registry JSON
**Priority: HIGH | Timeline: After Phases A-C**

Create `src/models/model_registry.json` — the machine-readable source of truth that ALL apps consume:

```json
{
  "version": "1.0.0",
  "updated": "2026-03-09",
  "models": [
    {
      "id": "windy-stt-nano",
      "name": "Windy STT Nano",
      "type": "stt",
      "size_mb": 75,
      "speed": "32x",
      "languages": 99,
      "gpu_required": false,
      "min_ram_mb": 256,
      "description": "Ultra-fast, ultra-light. For low-power devices.",
      "strengths": ["speed", "tiny footprint", "runs anywhere"],
      "weaknesses": ["lower accuracy", "noise sensitive"],
      "recommended_when": ["cpu_only", "low_ram", "realtime_priority"],
      "avoid_when": ["noisy_audio", "accuracy_critical"]
    }
  ]
}
```

This JSON is consumed by:
- Desktop Electron app (model selector dropdown)
- Installation Wizard (model download picker)
- Mobile apps (iOS + Android model selector)
- WindyTune auto-selection engine
- Marketing website model comparison page

**One file, one truth, all platforms read from it.**

### Phase E: Update GitHub Repo
**Priority: HIGH | Timeline: After Phase D**

1. Remove all references to old 15-model naming (Core Spark, Core Pulse, Edge Spark, etc.)
2. Update `docs/MODEL_REGISTRY.md` with final verified data
3. Create `src/models/model_registry.json`
4. Update `src/engine/` to read from model_registry.json
5. Update any installer/wizard code that references old model names
6. Clean up `artifacts/lora_checkpoints/` — only 7 keeper directories + 2 translation
7. Commit with clear message: "refactor: consolidate 15 phantom models → 9 real models"
8. Push to main on sneakyfree/windy-pro

### Phase F: Create Model Cards
**Priority: MEDIUM | Timeline: After Phase E**

For each of the 9 models, create `models/<model_name>/MODEL_CARD.md`:

```markdown
# Windy STT Turbo
## By Windy Pro Labs

**Version:** 1.0
**Type:** Speech-to-Text
**Size:** 1.6 GB
**Languages:** 99
**Speed:** 4× realtime

### Description
[What it does, who it's for]

### Performance
[Benchmarks, eval loss, WER if available]

### Training
[Dataset description, hyperparameters, training time]

### Acknowledgments
This model is derived from openai/whisper-large-v3-turbo,
originally developed by OpenAI and released under the MIT License.
Fine-tuned by Windy Pro Labs on proprietary curated datasets.
```

### Phase G: Grant Updates Apps
**Priority: HIGH | Timeline: After Phase E pushed to GitHub**

Grant manually updates:
- [ ] Installation Wizard — 9 models instead of 15
- [ ] Electron desktop app — model selector reflects 9 models
- [ ] Windy Pro Mobile (iOS) — same 9 models
- [ ] Windy Pro Mobile (Android) — same 9 models
- [ ] Website/marketing — updated model comparison

All apps read from `model_registry.json` so future changes only require updating one file.

---

## NAMING CONVENTION

All models follow the pattern: **Windy [Type] [Tier]**

- **Type:** STT (speech-to-text) or Translate (text-to-text)
- **Tier:** Nano < Lite < Core < Plus < Pro < Turbo < Edge (STT) or Spark < Standard (Translate)

In the UI, users see:
- "Windy STT Core" (not "openai/whisper-small")
- "Windy Translate Spark" (not "facebook/m2m100_418M")

We NEVER show the base model name in the user-facing UI. It's our model.

---

## LEGAL CHECKLIST (Per Model)

Each model must have:
- [ ] LoRA fine-tuned checkpoint (mathematically distinct weights)
- [ ] Training log (JSON with hyperparameters, dataset info, eval metrics)
- [ ] Model card (MODEL_CARD.md)
- [ ] MIT attribution in ACKNOWLEDGMENTS.md (bundled with app, not user-facing)
- [ ] Windy Pro Labs branding (product name, not base model name)

---

## WHAT GETS DELETED

### From `artifacts/lora_checkpoints/`:
- Move to `artifacts/archive/`: all 5 smoke tests + 2 bad runs (Lite v1, Edge v1)
- Keep: 5 good STT checkpoints + 2 new re-trained (Lite v2, Edge v2)

### From docs and code:
- All references to "Core Spark", "Core Pulse", "Edge Spark", "Edge Global", etc.
- Any claim of "15 models"
- Any model selector UI showing 15 options

### From marketing:
- "15 proprietary models" → "9 proprietary models"
- The table showing Core + Edge families with 6 models each → single clean table of 9

---

## TIMELINE

| Phase | What | When | Who |
|---|---|---|---|
| A | Fix Lite + Edge (re-download, re-train) | Today | OC1 (AG session) |
| B | Archive smoke tests | Today | OC1 |
| C | Complete Translate Spark + Standard | Today-Tomorrow | OC1 (AG sessions) |
| D | Create model_registry.json | After A-C | OC1 |
| E | Update GitHub repo (purge old, push new) | After D | OC1 |
| F | Create model cards | After E | OC1 |
| G | Update apps (installer, desktop, mobile) | After E pushed | Grant |

---

## SUCCESS CRITERIA

When this plan is complete:
1. ✅ Exactly 9 models in the repo, no more, no less
2. ✅ Each model has a LoRA checkpoint, training log, and model card
3. ✅ model_registry.json is the single source of truth for all platforms
4. ✅ No references to old 15-model naming anywhere in the codebase
5. ✅ All eval losses are reasonable (no degraded models)
6. ✅ Git history is clean with clear commit messages
7. ✅ Grant can update all apps from one consistent GitHub source

---

*9 models. All real. All ours. All documented.*
*— Kit 0C1 Alpha + Admiral Grant Whitmer, 09 Mar 2026*
