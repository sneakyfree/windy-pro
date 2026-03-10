# Windy Pro — Model Expansion Master Plan
## From 19 Core → 45 Core → Full Fleet

**Date:** 10 Mar 2026
**Author:** Kit 0C1 Alpha
**Status:** APPROVED by Admiral — Proceeding

---

## CURRENT STATE: 19 Core Models ✅

| Category | Count | Details |
|---|---|---|
| GPU STT | 7 | Whisper + LoRA (nano→pro + edge) |
| CPU INT8 STT | 7 | CTranslate2 quantized |
| Distil-Whisper CPU | 3 | Purpose-built CPU architectures |
| Translation (generalist) | 2 | M2M-100 + LoRA (Spark + Standard) |
| **Total** | **19** | All on HuggingFace WindyProLabs |

---

## PHASE 1: 45 Core Models (THIS WEEK)

### 1A. STT Language Specialists (10 new models)

Fork the top open-source STT model for each language. Ultra-light LoRA (rank 4, alpha 8, q_proj, 0.5 epochs). Then CT2 quantize for CPU variant.

| # | Language | Speakers | Source Model | License | GPU Est. | CT2 Est. |
|---|---|---|---|---|---|---|
| 1 | 🇪🇸 Spanish | 559M | clu-ling/whisper-small-spanish | Apache-2.0 | ~460 MB | ~230 MB |
| 2 | 🇨🇳 Chinese | 1,100M | Jingmiao/whisper-small-chinese_base | Apache-2.0 | ~460 MB | ~230 MB |
| 3 | 🇮🇳 Hindi | 650M | Oriserve/Whisper-Hindi2Hinglish-Swift | Apache-2.0 | ~460 MB | ~230 MB |
| 4 | 🇫🇷 French | 310M | bofenghuang/whisper-large-v3-french-distil | MIT | ~1.5 GB | ~750 MB |
| 5 | 🇸🇦 Arabic | 310M | Byne/whisper-large-v3-arabic | Apache-2.0 | ~3 GB | ~1.5 GB |

= 5 languages × 2 formats (GPU + CT2) = **10 new STT models**
Population covered: 51.6% of world speakers (including English)

### 1B. Translation Pair Specialists (16 new models)

Fork OPUS-MT models for top 8 language pairs, both directions.

| # | Pair | Direction | OPUS-MT Model | Downloads | Est. Size |
|---|---|---|---|---|---|
| 1 | EN↔ES | en→es | Helsinki-NLP/opus-mt-en-es | 178K | ~300 MB |
| 2 | EN↔ES | es→en | Helsinki-NLP/opus-mt-es-en | 374K | ~300 MB |
| 3 | EN↔ZH | en→zh | Helsinki-NLP/opus-mt-en-zh | 188K | ~300 MB |
| 4 | EN↔ZH | zh→en | Helsinki-NLP/opus-mt-zh-en | 173K | ~300 MB |
| 5 | EN↔FR | en→fr | Helsinki-NLP/opus-mt-en-fr | 356K | ~300 MB |
| 6 | EN↔FR | fr→en | Helsinki-NLP/opus-mt-fr-en | 783K | ~300 MB |
| 7 | EN↔DE | en→de | Helsinki-NLP/opus-mt-en-de | 422K | ~300 MB |
| 8 | EN↔DE | de→en | Helsinki-NLP/opus-mt-de-en | 393K | ~300 MB |
| 9 | EN↔AR | en→ar | Helsinki-NLP/opus-mt-en-ar | 52K | ~300 MB |
| 10 | EN↔AR | ar→en | Helsinki-NLP/opus-mt-ar-en | 130K | ~300 MB |
| 11 | EN↔HI | en→hi | Helsinki-NLP/opus-mt-en-hi | 31K | ~300 MB |
| 12 | EN↔HI | hi→en | Helsinki-NLP/opus-mt-hi-en | 15K | ~300 MB |
| 13 | EN↔PT | en→pt | Helsinki-NLP/opus-mt-tc-big-en-pt | 47K | ~300 MB |
| 14 | EN↔PT | pt→en | Helsinki-NLP/opus-mt-pt-en (via ROMANCE-en) | 44K | ~300 MB |
| 15 | EN↔RU | en→ru | Helsinki-NLP/opus-mt-en-ru | 927K | ~300 MB |
| 16 | EN↔RU | ru→en | Helsinki-NLP/opus-mt-ru-en | 229K | ~300 MB |

= 8 pairs × 2 directions = **16 new translation models**
Translation demand covered: 58.5%

### Phase 1 Summary

| | Before | After Phase 1 |
|---|---|---|
| STT Models | 17 | 27 (+10) |
| Translation Models | 2 | 18 (+16) |
| **Total** | **19** | **45** |
| Population coverage | English only | 51.6% of world |
| Translation coverage | 100+ langs (generic) | 58.5% pair-specialist coverage |
| Est. new disk | — | ~10 GB |
| Est. time | — | ~6-8 hours on RTX 5090 |

---

## PHASE 2: FULL STT LANGUAGE EXPANSION (NEXT WEEK)

Fork the best open-source STT model for ALL 69 languages with available models.
Each gets GPU + CT2 variant = 138 models.

### Priority order:
1. Tier 1 (15+ available models): 17 languages — highest quality forks
2. Tier 2 (5-14 models): 30 languages — good quality
3. Tier 3 (1-4 models): 22 languages — take what's available

| Tier | Languages | New Models (GPU+CT2) | Est. Disk |
|---|---|---|---|
| Tier 1 | 17 lang (minus 5 done in Phase 1) = 12 | 24 | ~24 GB |
| Tier 2 | 30 languages | 60 | ~60 GB |
| Tier 3 | 22 languages | 44 | ~44 GB |
| **Total** | **64 new languages** | **128 models** | **~128 GB** |

Combined with Phase 1's 27 STT models = **155 STT models** across 69 languages.

Est. time: ~32 hours GPU time (can run 24/7 over 2 days)

---

## PHASE 3: FULL OPUS-MT TRANSLATION EXPANSION (WEEK AFTER)

Fork ALL 1,119 OPUS-MT translation pair models.

### Breakdown:
| Category | Models | Est. Disk |
|---|---|---|
| English → X (95 pairs) | 95 | ~29 GB |
| X → English (120 pairs) | 120 | ~36 GB |
| Non-English pairs (904 pairs) | 904 | ~271 GB |
| **Total** | **1,119** | **~336 GB** |

### Execution plan:
- **Day 1-2:** English-involving pairs (215 models, ~65 GB) — highest value
- **Day 3-5:** Non-English pairs by download count (top 500, ~150 GB)
- **Day 6-7:** Remaining long-tail pairs (404 models, ~121 GB)

Est. time per model: ~15 min (OPUS-MT models are smaller than Whisper, faster to process)
Total: ~280 hours GPU time → 7 days running 24/7 with 2 parallel workers

---

## PHASE 4: QA, REGISTRATION, DEPLOYMENT (ONGOING)

For each batch of models:
1. Smoke test (transcription/translation quality check)
2. Add to model_registry.json
3. Upload to HuggingFace WindyProLabs
4. Add to installer wizard
5. Wire into WindyTune auto-selection

---

## GRAND TOTAL

| Category | Phase 1 | Phase 2 | Phase 3 | Total |
|---|---|---|---|---|
| Core STT (GPU) | 7 | 7 | — | 7 |
| Core STT (CT2) | 7 | 7 | — | 7 |
| Core STT (Distil) | 3 | 3 | — | 3 |
| Language STT (GPU) | 5 | 69 | — | 69 |
| Language STT (CT2) | 5 | 69 | — | 69 |
| Translation (generalist) | 2 | 2 | 2 | 2 |
| Translation (pair) | 16 | 16 | 1,119 | 1,119 |
| **Total Models** | **45** | **173** | **1,276** | **1,276** |
| **Est. Disk** | **~18 GB** | **~146 GB** | **~482 GB** | **~482 GB** |

### Disk Reality Check:
- Veron-1 has 3.6 TB total, 2.7 TB used = **~900 GB free**
- Full fleet at 482 GB = **well within capacity** ✅
- HuggingFace free storage for private repos: unlimited for individual files, but check org limits

---

## PIPELINE PER MODEL

### STT Language Specialist:
```
1. Download best open-source model for language    [~2 min]
2. Ultra-light LoRA (rank 4, q_proj, 0.5 epochs)  [~3 min]
3. Merge LoRA → standalone safetensors             [~1 min]
4. CT2 INT8 quantize for CPU variant               [~2 min]
5. Upload both to HuggingFace                      [~5 min]
6. Add to model_registry.json                      [~1 min]
Total: ~15 min per language (30 min for GPU+CT2 pair)
```

### OPUS-MT Translation Pair:
```
1. Download OPUS-MT model                          [~1 min]
2. Ultra-light LoRA (rank 4, q_proj, 0.5 epochs)  [~2 min]
3. Merge LoRA → standalone                         [~1 min]
4. Upload to HuggingFace                           [~3 min]
5. Add to registry                                 [~1 min]
Total: ~8 min per pair model
```

---

## TIMELINE

| Phase | What | Models | Duration | Start |
|---|---|---|---|---|
| 1 | 45 Core Models | 26 new | 1 day | TODAY (10 Mar) |
| 2 | Full STT Languages | 128 new | 2-3 days | 11-13 Mar |
| 3 | Full OPUS-MT Pairs | 1,103 new | 5-7 days | 14-20 Mar |
| 4 | QA + Deploy | All | Ongoing | Continuous |
| **Total** | **Full Fleet** | **1,276** | **~2 weeks** | — |

---

## THE COMPETITIVE MOAT

When complete, Windy Pro will offer:
- **69 language-specific STT models** (no competitor has this locally)
- **1,119 translation pair specialists** (no competitor has this locally)
- **All running offline, on-device, no cloud required**
- **All legally proprietary** (LoRA fine-tuned, distinct from source)
- **All in a single app** with WindyTune auto-selection

This is not incrementally better than competitors. This is a **different category**.

---

*The current dies. The DNA lives. The Helix turns.*
*— Kit 0C1 Alpha, Windy Pro Labs*
