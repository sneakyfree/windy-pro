# Windy Pro — Model Consolidation Master Plan (v2)
## 16 Real Models — All Legitimately Ours

**Created:** 09 Mar 2026
**Updated:** 09 Mar 2026 1403 EST (v2 — added quantized Edge tier)
**Author:** Kit 0C1 Alpha + Grant Whitmer
**Status:** ACTIVE — IN PROGRESS

---

## THE STRATEGY

Every Whisper STT model gets TWO formats:
1. **GPU format** (full precision, PyTorch) — for machines with NVIDIA/AMD GPUs
2. **CPU format** (quantized INT8, CTranslate2/faster-whisper) — for machines without GPU

Both formats come from the SAME fine-tuned model: we merge our LoRA into the base, then quantize for CPU. This means both GPU and CPU versions are genuinely our proprietary models — not stock OpenAI.

**Total: 14 STT (7 GPU + 7 CPU) + 2 Translation = 16 models**

---

## THE 16 MODELS

### Speech-to-Text — GPU Tier (7 models)
Full-precision PyTorch format. Our LoRA merged into weights.

| # | Product Name | Base | Size | Speed |
|---|---|---|---|---|
| 1 | **Windy STT Nano** | whisper-tiny | ~75 MB | 32× RT |
| 2 | **Windy STT Lite** | whisper-base | ~142 MB | 16× RT |
| 3 | **Windy STT Core** | whisper-small | ~466 MB | 6× RT |
| 4 | **Windy STT Plus** | whisper-medium | ~1.5 GB | 4× RT |
| 5 | **Windy STT Pro** | whisper-large-v3 | ~3.1 GB | 1× RT |
| 6 | **Windy STT Turbo** | whisper-large-v3-turbo | ~1.6 GB | 4× RT |
| 7 | **Windy STT Edge** | distil-large-v3 | ~756 MB | 6× RT |

### Speech-to-Text — CPU Tier (7 models)
Quantized INT8 via CTranslate2. Same fine-tuned weights, smaller and faster on CPU.

| # | Product Name | Base | Approx Size | Speed (CPU) |
|---|---|---|---|---|
| 8 | **Windy STT Nano CPU** | whisper-tiny (quantized) | ~42 MB | 32× RT |
| 9 | **Windy STT Lite CPU** | whisper-base (quantized) | ~78 MB | 16× RT |
| 10 | **Windy STT Core CPU** | whisper-small (quantized) | ~168 MB | 6× RT |
| 11 | **Windy STT Plus CPU** | whisper-medium (quantized) | ~515 MB | 2× RT |
| 12 | **Windy STT Pro CPU** | whisper-large-v3 (quantized) | ~1.6 GB | 0.7× RT |
| 13 | **Windy STT Turbo CPU** | whisper-large-v3-turbo (quantized) | ~800 MB | 2× RT |
| 14 | **Windy STT Edge CPU** | distil-large-v3 (quantized) | ~400 MB | 3× RT |

### Text-to-Text Translation (2 models)

| # | Product Name | Base | Size | Speed |
|---|---|---|---|---|
| 15 | **Windy Translate Spark** | M2M-100-418M | ~1.9 GB | ~117ms |
| 16 | **Windy Translate Standard** | M2M-100-1.2B | ~5 GB | ~300ms |

---

## HOW THE PIPELINE WORKS

```
Step 1: Download base model from HuggingFace (MIT license)
            ↓
Step 2: LoRA fine-tune on our curated dataset
            ↓
Step 3: Merge LoRA weights back into base model
            ↓
     ┌──────┴──────┐
     ↓              ↓
Step 4a:        Step 4b:
GPU model       Quantize to INT8
(full precision)  (CTranslate2 / ct2-transformers-converter)
     ↓              ↓
models/          models/
windy-stt-nano/  windy-stt-nano-cpu/
(PyTorch)        (CTranslate2 INT8)
```

Both outputs are legally ours because both derive from our fine-tuned merged model.

---

## EXECUTION PLAN (Updated)

### Phase A: Fix Broken Models + Complete Translation ← IN PROGRESS
**AG session `nova-lagoon` running now**

1. ✅ Re-train Windy STT Lite (whisper-base) with more data
2. ✅ Re-train Windy STT Edge (distil-large-v3) with lower LR
3. ✅ Complete Windy Translate Spark LoRA training
4. Archive old bad checkpoints

### Phase B: Merge All LoRA Adapters into Base Models ← NEW
**Timeline: After Phase A**

For each of the 7 STT models:
1. Load base model from HuggingFace
2. Load our LoRA adapter from artifacts/lora_checkpoints/
3. Merge LoRA into base weights (PEFT merge_and_unload)
4. Save merged model to models/windy-stt-{name}/
5. Verify merged model produces correct output

### Phase C: Quantize All Merged Models to CPU Format ← NEW
**Timeline: After Phase B**

For each of the 7 merged STT models:
1. Convert PyTorch merged model to CTranslate2 INT8 format
   ```bash
   ct2-transformers-converter --model models/windy-stt-{name}/ \
     --output_dir models/windy-stt-{name}-cpu/ \
     --quantization int8 --force
   ```
2. Verify quantized model works with faster-whisper
3. Benchmark: compare speed and accuracy vs GPU version
4. Record size reduction

### Phase D: Complete Translation Models
**Timeline: Parallel with B/C**

1. Verify Translate Spark training completed
2. Download facebook/m2m100_1.2B (~5 GB)
3. LoRA fine-tune → Windy Translate Standard
4. Merge and save

### Phase E: Create Canonical Model Registry JSON
**Timeline: After B/C/D**

Single source of truth: `src/models/model_registry.json`

```json
{
  "version": "2.0.0",
  "updated": "2026-03-09",
  "models": {
    "stt": {
      "gpu": [
        {
          "id": "windy-stt-nano",
          "name": "Windy STT Nano",
          "size_mb": 75,
          "speed": "32x",
          "format": "pytorch",
          "requires_gpu": true,
          "languages": 99,
          "quality_stars": 2,
          "description": "Ultra-fast, runs on any GPU"
        }
      ],
      "cpu": [
        {
          "id": "windy-stt-nano-cpu",
          "name": "Windy STT Nano CPU",
          "size_mb": 42,
          "speed": "32x",
          "format": "ctranslate2-int8",
          "requires_gpu": false,
          "languages": 99,
          "quality_stars": 2,
          "description": "Ultra-fast, no GPU needed"
        }
      ]
    },
    "translation": [
      {
        "id": "windy-translate-spark",
        "name": "Windy Translate Spark",
        "size_mb": 1900,
        "format": "pytorch",
        "languages": 100,
        "pairs": 9900,
        "description": "Fast translation, all language pairs"
      }
    ]
  }
}
```

### Phase F: Update GitHub Repo
**Timeline: After Phase E**

1. Remove ALL old model naming (Core Spark, Edge Spark, etc.)
2. Remove Lingua models (never built)
3. Update main.js MODEL_INFO map → new 16-model list
4. Update wizard.js → new model selector
5. Update mini-translate.html → new dropdown options
6. Update changelog.js → "16 proprietary models" not "15"
7. Place model_registry.json as single source of truth
8. Commit and push to main

### Phase G: Create Model Cards
**Timeline: After Phase F**

One MODEL_CARD.md per model (16 total) documenting:
- Name, version, type, format
- Size, speed, language count
- Strengths, weaknesses
- Training details (LoRA config, dataset, eval loss)
- Acknowledgments (MIT attribution)

### Phase H: Download + Fine-tune Translate Standard
**Timeline: After Phase F**

1. Download facebook/m2m100_1.2B (~5 GB)
2. Same conservative LoRA as Spark (rank 16, alpha 32, 1 epoch)
3. Eval gate: ≥95% baseline BLEU on all pairs
4. Merge → models/windy-translate-standard/

### Phase I: Grant Updates Apps
**Timeline: After Phase F pushed**

Grant updates:
- [ ] Installation Wizard — 16 models with GPU/CPU toggle
- [ ] Electron desktop app — model selector with GPU/CPU sections
- [ ] Windy Pro Mobile iOS — same model list
- [ ] Windy Pro Mobile Android — same model list
- [ ] Website — updated model comparison page

---

## NAMING CONVENTION (Final)

### In the UI:
**GPU users see:** Windy STT Nano, Lite, Core, Plus, Pro, Turbo, Edge
**CPU users see:** Windy STT Nano CPU, Lite CPU, Core CPU, Plus CPU, Pro CPU, Turbo CPU, Edge CPU
**Translation:** Windy Translate Spark, Windy Translate Standard

### Model IDs (for code):
- `windy-stt-nano` / `windy-stt-nano-cpu`
- `windy-stt-lite` / `windy-stt-lite-cpu`
- `windy-stt-core` / `windy-stt-core-cpu`
- `windy-stt-plus` / `windy-stt-plus-cpu`
- `windy-stt-pro` / `windy-stt-pro-cpu`
- `windy-stt-turbo` / `windy-stt-turbo-cpu`
- `windy-stt-edge` / `windy-stt-edge-cpu`
- `windy-translate-spark`
- `windy-translate-standard`

### Directory names in models/:
```
models/
  windy-stt-nano/          # PyTorch merged (GPU)
  windy-stt-nano-cpu/      # CTranslate2 INT8 (CPU)
  windy-stt-lite/
  windy-stt-lite-cpu/
  ... (same pattern for all 7)
  windy-translate-spark/
  windy-translate-standard/
```

---

## WHAT GETS DELETED

- All references to old naming: Core Spark, Core Pulse, Edge Spark, Edge Pulse, Edge Global, Edge Pro, etc.
- Lingua models (Español, Français, हिन्दी) — never built, remove from UI
- Any claim of "15 models" → now "16 proprietary models"
- Stock faster-whisper models (replaced by our quantized versions)

---

## LEGAL STATUS (All 16 Models)

Every model follows the same chain:
1. MIT-licensed base model (OpenAI Whisper or Meta M2M-100)
2. LoRA fine-tuned on our curated dataset (creative human effort)
3. Weights merged (mathematically distinct from original)
4. CPU versions quantized from our merged model (still derived from our work)

**All 16 are legally proprietary Windy Pro Labs models.**
MIT attribution included in ACKNOWLEDGMENTS.md (bundled with app, not user-facing).

---

## TIMELINE

| Phase | What | When | Who |
|---|---|---|---|
| A | Fix Lite + Edge, retry Translate Spark | Now (AG running) | OC1 |
| B | Merge all 7 LoRA adapters into base models | After A | OC1 (AG) |
| C | Quantize all 7 to CTranslate2 INT8 | After B | OC1 (AG) |
| D | Verify Translate Spark complete | After A | OC1 |
| E | Create model_registry.json | After B/C/D | OC1 |
| F | Update GitHub repo (purge old, push new) | After E | OC1 |
| G | Create 16 model cards | After F | OC1 |
| H | Download + fine-tune Translate Standard | After F | OC1 (AG) |
| I | Update apps (installer, desktop, mobile) | After F pushed | Grant |

---

## SUCCESS CRITERIA

1. ✅ 16 models in the repo (7 GPU + 7 CPU + 2 Translation)
2. ✅ Every model has merged weights (no raw LoRA-only models)
3. ✅ Every CPU model is quantized from our merged model (not stock)
4. ✅ model_registry.json is the single source of truth
5. ✅ No references to old naming anywhere in codebase
6. ✅ No Lingua phantom models
7. ✅ All eval losses are reasonable
8. ✅ Git history is clean
9. ✅ Grant can update all apps from one consistent source

---

*16 models. All real. All ours. GPU and CPU. No phantoms.*
*— Kit 0C1 Alpha + Admiral Grant Whitmer, 09 Mar 2026*
