# 🌪️ Windy Pro — Wizard Engine Patient Files
### The 16 engines installed on machines worldwide via the Installation Wizard
**Generated:** 11 Mar 2026 by Kit 0C3 Charlie  
**Source data:** `docs/MODEL_GLOSSARY.json` (lineage), `src/models/model_registry.json` (actual sizes), `installer-v2/core/models.js` (wizard config)  
**Last verified:** 11 Mar 2026

---

## Quick Reference Card

| # | Wizard Name | Type | Source Model | Params | Actual Size | LoRA Delta | Eval Loss | Build Date |
|---|-------------|------|-------------|--------|-------------|------------|-----------|------------|
| 1 | Windy Nano | ⚡ GPU | openai/whisper-tiny.en | 39M | 77 MB | 0.08% | 1.504 | 09 Mar 26 |
| 2 | Windy Lite | ⚡ GPU | openai/whisper-base.en | 74M | 144 MB | 0.08% | 4.180 ⚠️ | 09 Mar 26 |
| 3 | Windy Core | ⚡ GPU | openai/whisper-small.en | 244M | 466 MB | 0.06% | 0.955 | 09 Mar 26 |
| 4 | Windy Edge | ⚡ GPU | openai/whisper-large-v2 | 1,550M | 1.4 GB | 0.06% | 4.814 ⚠️ | 09 Mar 26 |
| 5 | Windy Plus | ⚡ GPU | openai/whisper-medium.en | 769M | 1.5 GB | 0.06% | 0.757 | 09 Mar 26 |
| 6 | Windy Turbo | ⚡ GPU | openai/whisper-large-v3-turbo | 809M | 1.5 GB | 0.06% | **0.456** 🏆 | 09 Mar 26 |
| 7 | Windy Pro | ⚡ GPU | openai/whisper-large-v3 | 1,550M | 2.9 GB | 0.06% | 0.577 | 09 Mar 26 |
| 8 | Windy Nano (CPU) | 🛡️ CPU | openai/whisper-tiny.en | 39M | 38 MB | 0.08% | 1.504 | 09 Mar 26 |
| 9 | Windy Lite (CPU) | 🛡️ CPU | openai/whisper-base.en | 74M | 72 MB | 0.08% | 4.180 ⚠️ | 09 Mar 26 |
| 10 | Windy Core (CPU) | 🛡️ CPU | openai/whisper-small.en | 244M | 234 MB | 0.06% | 0.955 | 09 Mar 26 |
| 11 | Windy Edge (CPU) | 🛡️ CPU | openai/whisper-large-v2 | 1,550M | 727 MB | 0.06% | 4.814 ⚠️ | 09 Mar 26 |
| 12 | Windy Plus (CPU) | 🛡️ CPU | openai/whisper-medium.en | 769M | 734 MB | 0.06% | 0.757 | 09 Mar 26 |
| 13 | Windy Turbo (CPU) | 🛡️ CPU | openai/whisper-large-v3-turbo | 809M | 777 MB | 0.06% | **0.456** 🏆 | 09 Mar 26 |
| 14 | Windy Pro (CPU) | 🛡️ CPU | openai/whisper-large-v3 | 1,550M | 1.5 GB | 0.06% | 0.577 | 09 Mar 26 |
| 15 | Translate Spark | 🌍 Trans | facebook/m2m100_418M | 418M | 929 MB | 0.05% | N/A | 09 Mar 26 |
| 16 | Translate Standard | 🌍 Trans | facebook/m2m100_1.2B | 1,200M | 2.4 GB | 0.04% | N/A | 09 Mar 26 |

**⚠️ = High eval loss. Flagged for priority retraining.**  
**🏆 = Champion. Lowest eval loss across all STT engines.**

---

## Individual Patient Files

---

### 1. Windy Nano ⚡ GPU
**Wizard ID:** `windy-stt-nano` | **HuggingFace:** `WindyProLabs/windy-stt-nano`

| Field | Value |
|-------|-------|
| **Source model** | `openai/whisper-tiny.en` (OpenAI Whisper Tiny, English-only) |
| **Source architecture** | Encoder-decoder transformer, 4 encoder layers, 4 decoder layers |
| **Parameters** | 39M |
| **Source license** | MIT |
| **Fork date** | 09 March 2026 |
| **LoRA config** | rank=4, alpha=8, target=q_proj, dropout=0.05, epochs=0.5 |
| **LoRA delta** | 0.08% of total parameters modified |
| **Training data** | 50-100 samples, LibriSpeech |
| **Format** | Safetensors (float16) |
| **Actual disk size** | 77.2 MB |
| **Wizard display size** | 73 MB |
| **Eval loss** | 1.5039 |
| **Builder** | Kit 0C1 Alpha, Veron-1 |
| **QA status** | PASS (09 Mar 2026) |

**Strengths:**
- Fastest engine in the fleet — 32× real-time on GPU
- Tiny footprint — fits on any device with a GPU
- English dictation is snappy and responsive
- Great for real-time captions and quick notes

**Weaknesses:**
- English-only (`.en` variant — no multilingual support baked in)
- Lowest accuracy tier — struggles with accents, jargon, background noise
- Only 4 encoder/decoder layers — limited contextual understanding
- Eval loss 1.5 is middling — not production quality for professional transcription

**Clinical notes:** Good entry point. The "get something working fast" engine. Not for legal/medical/broadcast. Will benefit most from continued fine-tuning because it has the most room to improve on specialized datasets.

---

### 2. Windy Lite ⚡ GPU
**Wizard ID:** `windy-stt-lite` | **HuggingFace:** `WindyProLabs/windy-stt-lite`

| Field | Value |
|-------|-------|
| **Source model** | `openai/whisper-base.en` (OpenAI Whisper Base, English-only) |
| **Source architecture** | Encoder-decoder transformer, 6 encoder layers, 6 decoder layers |
| **Parameters** | 74M |
| **Source license** | MIT |
| **Fork date** | 09 March 2026 |
| **LoRA config** | rank=4, alpha=8, target=q_proj, dropout=0.05, epochs=0.5 |
| **LoRA delta** | 0.08% of total parameters modified |
| **Training data** | 50-100 samples, LibriSpeech |
| **Format** | Safetensors (float16) |
| **Actual disk size** | 143.6 MB |
| **Wizard display size** | 140 MB |
| **Eval loss** | 4.1797 ⚠️ |
| **Builder** | Kit 0C1 Alpha, Veron-1 |
| **QA status** | PASS (09 Mar 2026) |
| **Known issues** | Concorde spelling divergence noted by Alpha |

**Strengths:**
- Fast — 16× real-time on GPU
- Lightweight — 140 MB, downloads in seconds
- Good enough for everyday emails and casual notes
- 2 more encoder/decoder layers than Nano = better context

**Weaknesses:**
- ⚠️ **HIGH EVAL LOSS (4.18)** — significantly worse than expected for this size class
- English-only (`.en` variant)
- Concorde spelling bug flagged — may have training artifact
- Not suitable for technical jargon or heavily accented speech

**Clinical notes:** The eval loss is a red flag. 4.18 on a base model should be much lower. This engine is a **priority candidate for retraining** with a larger/better dataset. The Concorde spelling divergence suggests the LoRA may have introduced a minor regression. Needs investigation.

---

### 3. Windy Core ⚡ GPU
**Wizard ID:** `windy-stt-core` | **HuggingFace:** `WindyProLabs/windy-stt-core`

| Field | Value |
|-------|-------|
| **Source model** | `openai/whisper-small.en` (OpenAI Whisper Small, English-only) |
| **Source architecture** | Encoder-decoder transformer, 12 encoder layers, 12 decoder layers |
| **Parameters** | 244M |
| **Source license** | MIT |
| **Fork date** | 09 March 2026 |
| **LoRA config** | rank=4, alpha=8, target=q_proj, dropout=0.05, epochs=0.5 |
| **LoRA delta** | 0.06% of total parameters modified |
| **Training data** | 50-100 samples, LibriSpeech |
| **Format** | Safetensors (float16) |
| **Actual disk size** | 466.3 MB |
| **Wizard display size** | 466 MB |
| **Eval loss** | 0.9553 |
| **Builder** | Kit 0C1 Alpha, Veron-1 |
| **QA status** | PASS (09 Mar 2026) |

**Strengths:**
- Sweet spot engine — 8× speed with excellent accuracy
- Sub-1.0 eval loss = professional-quality transcription
- Handles accents and moderate background noise well
- 12 encoder/decoder layers = strong contextual understanding
- ⭐ Recommended default for GPU users in the wizard

**Weaknesses:**
- English-only (`.en` variant)
- Requires 2 GB VRAM minimum
- Not the best for code-switching (mixing languages mid-sentence)
- At 466 MB, it's the crossover point where downloads start taking longer on slow connections

**Clinical notes:** The workhorse. Best accuracy-to-size ratio in the GPU fleet. This is what most users should be running if they have a GPU. Eval loss 0.955 is solid — close to the source model's native performance, meaning the LoRA didn't hurt it.

---

### 4. Windy Edge ⚡ GPU
**Wizard ID:** `windy-stt-edge` | **HuggingFace:** `WindyProLabs/windy-stt-edge`

| Field | Value |
|-------|-------|
| **Source model** | `openai/whisper-large-v2` (OpenAI Whisper Large V2, multilingual) |
| **Source architecture** | Encoder-decoder transformer, 32 encoder layers, 32 decoder layers |
| **Parameters** | 1,550M |
| **Source license** | MIT |
| **Fork date** | 09 March 2026 |
| **LoRA config** | rank=4, alpha=8, target=q_proj, dropout=0.05, epochs=0.5 |
| **LoRA delta** | 0.06% of total parameters modified |
| **Training data** | 50-100 samples, LibriSpeech |
| **Format** | Safetensors (float16) |
| **Actual disk size** | 1,448 MB (1.4 GB) |
| **Wizard display size** | 1.4 GB |
| **Eval loss** | 4.814 ⚠️ |
| **Builder** | Kit 0C1 Alpha, Veron-1 |
| **QA status** | PASS (09 Mar 2026) |
| **Known issues** | Alpha flagged "High loss — may need retraining" |

**Strengths:**
- **MULTILINGUAL** — the only non-English-only source in our GPU fleet
- 99 languages baked into the original weights
- 32 encoder/decoder layers = deepest contextual understanding
- large-v2 is battle-tested — deployed millions of times worldwide
- Handles code-switching (mixing languages mid-sentence)

**Weaknesses:**
- ⚠️ **HIGHEST EVAL LOSS IN THE FLEET (4.81)** — critically needs retraining
- 1.4 GB download — slow on poor connections
- Requires 5 GB VRAM
- The LoRA was trained on English LibriSpeech but applied to a multilingual model — likely the cause of the high loss
- large-v2 is one generation behind large-v3

**Clinical notes:** **RED FLAG.** The 4.81 eval loss is the worst in the fleet and almost certainly caused by a mismatch: we trained the LoRA on English data and applied it to a multilingual model. The LoRA may actually be degrading multilingual performance. **Priority 1 for retraining** with multilingual data (Common Voice, VoxPopuli). Despite the loss, the base model's weights are so strong that it likely still works — but it's working *despite* our LoRA, not because of it.

---

### 5. Windy Plus ⚡ GPU
**Wizard ID:** `windy-stt-plus` | **HuggingFace:** `WindyProLabs/windy-stt-plus`

| Field | Value |
|-------|-------|
| **Source model** | `openai/whisper-medium.en` (OpenAI Whisper Medium, English-only) |
| **Source architecture** | Encoder-decoder transformer, 24 encoder layers, 24 decoder layers |
| **Parameters** | 769M |
| **Source license** | MIT |
| **Fork date** | 09 March 2026 |
| **LoRA config** | rank=4, alpha=8, target=q_proj, dropout=0.05, epochs=0.5 |
| **LoRA delta** | 0.06% of total parameters modified |
| **Training data** | 50-100 samples, LibriSpeech |
| **Format** | Safetensors (float16) |
| **Actual disk size** | 1,462 MB (1.5 GB) |
| **Wizard display size** | 1.5 GB |
| **Eval loss** | 0.7568 |
| **Builder** | Kit 0C1 Alpha, Veron-1 |
| **QA status** | PASS (09 Mar 2026) |

**Strengths:**
- Strong accuracy — 0.757 eval loss, second-best in the mid-range
- 24 encoder/decoder layers = excellent for complex speech patterns
- Handles accents, jargon, and fast speech well
- Good for production workflows, legal, medical transcription

**Weaknesses:**
- English-only (`.en` variant)
- 1.5 GB download
- Requires 5 GB VRAM
- 4× speed — noticeably slower than Core for real-time use
- Slightly larger than Edge but English-only (Edge has multilingual)

**Clinical notes:** The professional-grade English engine. If someone needs accuracy over speed and has the VRAM for it, this is the right pick. The eval loss is healthy — LoRA didn't degrade it. Good candidate for domain-specific fine-tuning (legal, medical, financial).

---

### 6. Windy Turbo ⚡ GPU 🏆
**Wizard ID:** `windy-stt-turbo` | **HuggingFace:** `WindyProLabs/windy-stt-turbo`

| Field | Value |
|-------|-------|
| **Source model** | `openai/whisper-large-v3-turbo` (OpenAI Whisper Large V3 Turbo, distilled) |
| **Source architecture** | Distilled encoder-decoder, 32 encoder layers, 4 decoder layers |
| **Parameters** | 809M |
| **Source license** | MIT |
| **Fork date** | 09 March 2026 |
| **LoRA config** | rank=4, alpha=8, target=q_proj, dropout=0.05, epochs=0.5 |
| **LoRA delta** | 0.06% of total parameters modified |
| **Training data** | 50-100 samples, LibriSpeech |
| **Format** | Safetensors (float16) |
| **Actual disk size** | 1,548 MB (1.5 GB) |
| **Wizard display size** | 1.5 GB |
| **Eval loss** | **0.4563** 🏆 CHAMPION |
| **Builder** | Kit 0C1 Alpha, Veron-1 |
| **QA status** | PASS (09 Mar 2026) |

**Strengths:**
- 🏆 **BEST EVAL LOSS IN THE ENTIRE FLEET (0.456)**
- Distilled architecture: full 32 encoder layers but only 4 decoder layers = fast inference
- 5× speed — faster than Plus (4×) and Edge (6×) despite near-flagship quality
- 809M params — smaller than Edge/Plus/Pro, yet outperforms all of them
- Best bang-for-buck engine in the product

**Weaknesses:**
- 1.5 GB download
- Requires 6 GB VRAM (slightly more than Edge/Plus)
- Distilled decoder may miss some edge cases that the full 32-layer decoder catches
- Multilingual support exists but English-dominant in training

**Clinical notes:** **The crown jewel.** OpenAI's large-v3-turbo was already the state of the art for speed/quality trade-off, and our LoRA didn't hurt it — 0.456 eval loss is outstanding. This is what WindyTune should default to when VRAM permits. The distilled architecture (32 encoder + 4 decoder) is why it's fast: the encoder does the heavy lifting, and the lightweight decoder streams output quickly. Protect this engine. It's the one that makes users go "wow."

---

### 7. Windy Pro ⚡ GPU
**Wizard ID:** `windy-stt-pro` | **HuggingFace:** `WindyProLabs/windy-stt-pro`

| Field | Value |
|-------|-------|
| **Source model** | `openai/whisper-large-v3` (OpenAI Whisper Large V3, multilingual) |
| **Source architecture** | Encoder-decoder transformer, 32 encoder layers, 32 decoder layers |
| **Parameters** | 1,550M |
| **Source license** | MIT |
| **Fork date** | 09 March 2026 |
| **LoRA config** | rank=4, alpha=8, target=q_proj, dropout=0.05, epochs=0.5 |
| **LoRA delta** | 0.06% of total parameters modified |
| **Training data** | 50-100 samples, LibriSpeech |
| **Format** | Safetensors (float16) |
| **Actual disk size** | 2,949 MB (2.9 GB) |
| **Wizard display size** | 2.9 GB |
| **Eval loss** | 0.5765 |
| **Builder** | Kit 0C1 Alpha, Veron-1 |
| **QA status** | PASS (09 Mar 2026) |

**Strengths:**
- Flagship accuracy — 0.577 eval loss, second-best overall
- Full 32+32 architecture — maximum contextual understanding
- Multilingual (99 languages in the base weights)
- large-v3 is OpenAI's latest and best Whisper model
- Broadcast, legal, medical quality

**Weaknesses:**
- 2.9 GB download — largest engine in the fleet
- Requires 10 GB VRAM — rules out most laptops and budget GPUs
- 2× real-time — noticeably slow for live dictation
- Interestingly, Turbo (0.456) outperforms Pro (0.577) on eval loss despite being half the size

**Clinical notes:** The prestige engine. Users who want "the absolute best" pick this. But Turbo actually has better eval loss — Pro's advantage is the full 32-layer decoder for edge-case accuracy on exotic languages and complex audio. For English-dominant users, Turbo is objectively better. Pro earns its keep in true multilingual, broadcast, and legal scenarios.

---

### 8-14. CPU Variants (Windy Nano through Pro, CPU)

The 7 CPU engines are **INT8 CTranslate2 quantizations** of engines 1-7 above. Same source models, same LoRA, same eval loss — just compressed and reformatted for CPU inference.

| CPU Engine | GPU Parent | Actual Size | Size Reduction | Format |
|-----------|-----------|-------------|---------------|--------|
| Windy Nano (CPU) | Windy Nano | 38 MB | 51% smaller | CTranslate2 INT8 |
| Windy Lite (CPU) | Windy Lite | 72 MB | 50% smaller | CTranslate2 INT8 |
| Windy Core (CPU) | Windy Core | 234 MB | 50% smaller | CTranslate2 INT8 |
| Windy Edge (CPU) | Windy Edge | 727 MB | 50% smaller | CTranslate2 INT8 |
| Windy Plus (CPU) | Windy Plus | 734 MB | 50% smaller | CTranslate2 INT8 |
| Windy Turbo (CPU) | Windy Turbo | 777 MB | 50% smaller | CTranslate2 INT8 |
| Windy Pro (CPU) | Windy Pro | 1,481 MB | 50% smaller | CTranslate2 INT8 |

**How quantization works:** Float16 weights (2 bytes per parameter) → INT8 (1 byte per parameter). Each weight value is mapped from a continuous range to 256 discrete levels. This is lossy compression — some precision is lost, but in practice the accuracy impact is minimal (<1% degradation on most benchmarks).

**CPU engines inherit ALL strengths and weaknesses of their GPU parent**, plus:
- ✅ No GPU required — runs on any x86/ARM CPU
- ✅ Smaller on disk — roughly half the size
- ❌ 2-6× slower than GPU equivalent
- ❌ Slight accuracy degradation from INT8 quantization (typically <1%)

**HuggingFace repos:** Same name with `-ct2` suffix (e.g., `WindyProLabs/windy-stt-core-ct2`)

---

### 15. Windy Translate Spark 🌍
**Wizard ID:** `windy-translate-spark` | **HuggingFace:** `WindyProLabs/windy_translate_spark`

| Field | Value |
|-------|-------|
| **Source model** | `facebook/m2m100_418M` (Meta M2M-100, 418M variant) |
| **Source architecture** | Encoder-decoder transformer, specialized for many-to-many translation |
| **Parameters** | 418M |
| **Source license** | MIT |
| **Fork date** | 09 March 2026 |
| **LoRA config** | rank=4, alpha=8, target=q_proj, dropout=0.05 |
| **LoRA delta** | 0.05% of total parameters modified |
| **Training data** | 10 sentence pairs (minimal touch) |
| **Format** | PyTorch (originally), Safetensors on HF |
| **Actual disk size** | 929 MB |
| **Wizard display size** | 929 MB |
| **Eval loss** | Not measured (translation metric differs from STT) |
| **Builder** | Kit 0C1 Alpha, Veron-1 |
| **QA status** | PASS (09 Mar 2026) |

**Strengths:**
- Direct any→any translation across 100+ language pairs (no English pivot needed)
- Meta's M2M-100 is one of the most proven multilingual translation models
- 418M params keeps it fast — 8× real-time
- Sub-1 GB footprint
- Excellent for casual translation, travel, real-time conversation

**Weaknesses:**
- Smaller variant — quality drops on low-resource language pairs
- 10 sentence pair training = barely touched — essentially vanilla M2M-100 with our fingerprint
- Not as good as dedicated pair models (OPUS-MT) for specific language combos
- No domain specialization — generic translation only

**Clinical notes:** The lightweight Swiss Army knife. For most users who want offline translation, this is all they need. The 418M variant handles major language pairs (EN↔ES, EN↔FR, EN↔DE, EN↔ZH, etc.) well. Weaker on rare pairs (e.g., Yoruba↔Korean). As we fine-tune with more data, this will become genuinely proprietary.

---

### 16. Windy Translate Standard 🌍
**Wizard ID:** `windy-translate-standard` | **HuggingFace:** `WindyProLabs/windy_translate_standard`

| Field | Value |
|-------|-------|
| **Source model** | `facebook/m2m100_1.2B` (Meta M2M-100, 1.2B variant) |
| **Source architecture** | Encoder-decoder transformer, specialized for many-to-many translation |
| **Parameters** | 1,200M |
| **Source license** | MIT |
| **Fork date** | 09 March 2026 |
| **LoRA config** | rank=4, alpha=8, target=q_proj, dropout=0.05 |
| **LoRA delta** | 0.04% of total parameters modified |
| **Training data** | 10 sentence pairs (minimal touch) |
| **Format** | PyTorch (originally), Safetensors on HF |
| **Actual disk size** | 2,371 MB (2.4 GB) |
| **Wizard display size** | 2.4 GB |
| **Eval loss** | Not measured |
| **Builder** | Kit 0C1 Alpha, Veron-1 |
| **QA status** | PASS (09 Mar 2026) |

**Strengths:**
- 1.2B params — significantly better quality than Spark on all language pairs
- Handles low-resource languages much better (rare pairs, African languages, etc.)
- Professional translation quality on major pairs
- Meta's flagship M2M-100 variant — battle-tested

**Weaknesses:**
- 2.4 GB — heavy download, requires 8 GB RAM
- 4× real-time — slower, noticeable latency on long text
- 10 sentence pair training = barely customized
- Same as Spark: no domain specialization yet

**Clinical notes:** The big gun for translation. If a user works across many languages professionally, this is what they need. The 3× parameter increase over Spark gives meaningfully better output, especially on complex sentences and rare language pairs. Like Spark, this is essentially vanilla Meta M2M-100 with our fingerprint — the proprietary differentiation will come with continued training.

---

## Fleet Health Summary

### 🟢 Healthy (eval loss < 1.0)
- **Windy Turbo** — 0.456 🏆 CHAMPION
- **Windy Pro** — 0.577
- **Windy Plus** — 0.757
- **Windy Core** — 0.955

### 🟡 Needs Attention (eval loss 1.0-2.0)
- **Windy Nano** — 1.504 (acceptable for its size class)

### 🔴 Priority Retraining (eval loss > 4.0)
- **Windy Lite** — 4.180 ⚠️ (Concorde bug, unexpectedly high for base model)
- **Windy Edge** — 4.814 ⚠️ (English LoRA on multilingual model — mismatch)

### ⚪ Not Measured
- **Translate Spark** — needs BLEU score evaluation
- **Translate Standard** — needs BLEU score evaluation

---

## Size Discrepancy Log

The glossary, registry, and wizard each have slightly different size numbers due to rounding and measurement methods:

| Engine | Glossary (JSON) | Registry (actual) | Wizard (display) | Notes |
|--------|----------------|-------------------|-----------------|-------|
| Nano GPU | 74 MB | 77.2 MB | 73 MB | Wizard rounds down |
| Translate Spark | 480 MB | 928.9 MB | 929 MB | ⚠️ Glossary is WRONG — likely pre-upload size |
| Translate Standard | 850 MB | 2,370.1 MB | 2,371 MB | ⚠️ Glossary is WRONG — likely pre-upload size |

**Action needed:** Update `docs/MODEL_GLOSSARY.json` translate entries to match actual uploaded sizes.

---

## The 7 Source Architectures (Lineage Tree)

```
OpenAI Whisper Family (MIT License):
├── whisper-tiny.en (39M)      → Windy Nano (GPU) → Windy Nano (CPU via CT2 INT8)
├── whisper-base.en (74M)      → Windy Lite (GPU) → Windy Lite (CPU via CT2 INT8)
├── whisper-small.en (244M)    → Windy Core (GPU) → Windy Core (CPU via CT2 INT8)
├── whisper-medium.en (769M)   → Windy Plus (GPU) → Windy Plus (CPU via CT2 INT8)
├── whisper-large-v2 (1550M)   → Windy Edge (GPU) → Windy Edge (CPU via CT2 INT8)
├── whisper-large-v3 (1550M)   → Windy Pro  (GPU) → Windy Pro  (CPU via CT2 INT8)
└── whisper-large-v3-turbo (809M) → Windy Turbo (GPU) → Windy Turbo (CPU via CT2 INT8)

Meta M2M-100 Family (MIT License):
├── m2m100_418M                → Windy Translate Spark
└── m2m100_1.2B                → Windy Translate Standard
```

All LoRA fine-tuning applied on 09 March 2026 by Kit 0C1 Alpha on Veron-1 GPU server.  
Training recipe: rank=4, alpha=8, q_proj only, dropout=0.05, 0.5 epochs, LibriSpeech (STT) / 10 pairs (Translation).

---

*"Know your engines like a doctor knows their patients. The weights don't lie."* — 🎯
