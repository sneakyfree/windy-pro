# Windy Pro — Model Registry
### The Atlas of Everything We Ship

**Last Updated:** 09 Mar 2026
**Total Models:** 17 (15 STT + 2 Translation)
**Maintained by:** Windy Pro Labs

---

## How To Read This Registry

Every model has a card with:
- **What it does** (STT or Translation)
- **Size** (disk footprint)
- **Speed** (relative to realtime for STT, ms/translation for TT)
- **Languages** (what it handles well)
- **Strengths** (what to pick it FOR)
- **Weaknesses** (when to pick something else)
- **Base** (what open-source model it was forked from)
- **WindyTune Hints** (how the auto-selector should use it)

WindyTune should parse this (or a JSON equivalent) at runtime to match user context → best model.

---

## SPEECH-TO-TEXT MODELS (15)

### Core Family (based on OpenAI Whisper)

#### 1. Core Spark
| Field | Value |
|---|---|
| **Type** | Speech-to-Text |
| **Size** | 75 MB |
| **Speed** | 32× realtime |
| **Languages** | 99 languages |
| **Base** | OpenAI Whisper Tiny |
| **Strengths** | Blazing fast, minimal resources, great for quick dictation, real-time captions on low-end hardware |
| **Weaknesses** | Lower accuracy on accented speech, struggles with background noise, weak on rare languages |
| **Best For** | Live captions, IoT devices, quick-and-dirty transcription, mobile (when speed > accuracy) |
| **WindyTune Hint** | Pick when: CPU-only device, <2GB RAM available, latency matters more than accuracy |

#### 2. Core Pulse
| Field | Value |
|---|---|
| **Type** | Speech-to-Text |
| **Size** | 142 MB |
| **Speed** | 16× realtime |
| **Languages** | 99 languages |
| **Base** | OpenAI Whisper Base |
| **Strengths** | Good balance of speed and accuracy, handles most accents, reliable multilingual |
| **Weaknesses** | Not great on technical jargon, can miss quiet speakers, mediocre on overlapping speech |
| **Best For** | Default general-purpose, meetings with clear audio, everyday transcription |
| **WindyTune Hint** | Pick when: general-purpose default, decent hardware, balanced needs |

#### 3. Core Standard
| Field | Value |
|---|---|
| **Type** | Speech-to-Text |
| **Size** | 466 MB |
| **Speed** | 6× realtime |
| **Languages** | 99 languages |
| **Base** | OpenAI Whisper Small |
| **Strengths** | Strong multilingual accuracy, handles accents well, good with background noise |
| **Weaknesses** | Slower than Spark/Pulse, needs more RAM, overkill for clean English audio |
| **Best For** | International meetings, accented speakers, noisy environments |
| **WindyTune Hint** | Pick when: multilingual needed, moderate noise, accuracy > speed |

#### 4. Core Pro
| Field | Value |
|---|---|
| **Type** | Speech-to-Text |
| **Size** | 1.5 GB |
| **Speed** | English-optimized |
| **Languages** | English (optimized) |
| **Base** | OpenAI Whisper Medium (English) |
| **Strengths** | Best English accuracy, handles jargon and technical terms, excellent with accents |
| **Weaknesses** | English only — useless for other languages, heavy for what it does |
| **Best For** | English-only meetings, legal/medical transcription, interviews |
| **WindyTune Hint** | Pick when: source language confirmed English, accuracy is critical, other languages not needed |

#### 5. Core Turbo
| Field | Value |
|---|---|
| **Type** | Speech-to-Text |
| **Size** | 1.6 GB |
| **Speed** | 4× realtime |
| **Languages** | 99 languages |
| **Base** | OpenAI Whisper Medium |
| **Strengths** | High accuracy across all languages while maintaining decent speed, good noise handling |
| **Weaknesses** | Heavy — needs GPU or strong CPU, slower than Edge family at similar accuracy |
| **Best For** | Production multilingual transcription where quality matters but can't use Ultra |
| **WindyTune Hint** | Pick when: GPU available, need quality + speed balance across languages |

#### 6. Core Ultra
| Field | Value |
|---|---|
| **Type** | Speech-to-Text |
| **Size** | 3.1 GB |
| **Speed** | 1× realtime |
| **Languages** | 99 languages |
| **Base** | OpenAI Whisper Large-v3 |
| **Strengths** | Highest accuracy available, best noise handling, best rare language support, best at punctuation/formatting |
| **Weaknesses** | Slowest model — barely realtime, needs GPU, massive memory footprint, overkill for casual use |
| **Best For** | Final transcription passes, archival quality, rare languages, noisy recordings, legal/compliance |
| **WindyTune Hint** | Pick when: accuracy is everything, post-processing OK, GPU available, rare language detected |

---

### Edge Family (based on Distil-Whisper)

#### 7. Edge Spark
| Field | Value |
|---|---|
| **Type** | Speech-to-Text |
| **Size** | 42 MB |
| **Speed** | 32× realtime |
| **Languages** | Multilingual |
| **Base** | Distil-Whisper Tiny |
| **Strengths** | Smallest model in fleet, runs anywhere, instant response |
| **Weaknesses** | Lowest accuracy, for quick-and-dirty only |
| **Best For** | Embedded devices, wearables, ultra-low resource environments |
| **WindyTune Hint** | Pick when: extreme resource constraints, <1GB RAM, speed is only priority |

#### 8. Edge Pulse
| Field | Value |
|---|---|
| **Type** | Speech-to-Text |
| **Size** | 78 MB |
| **Speed** | 16× realtime |
| **Languages** | Multilingual |
| **Base** | Distil-Whisper Base |
| **Strengths** | Tiny footprint with surprisingly good accuracy, fast startup |
| **Weaknesses** | Weaker on complex audio, limited noise handling |
| **Best For** | Mobile apps, quick transcription, low-power devices |
| **WindyTune Hint** | Pick when: mobile/tablet, need fast + small, clean audio expected |

#### 9. Edge Standard
| Field | Value |
|---|---|
| **Type** | Speech-to-Text |
| **Size** | 168 MB |
| **Speed** | 6× realtime |
| **Languages** | Multilingual |
| **Base** | Distil-Whisper Small |
| **Strengths** | Great speed-to-accuracy ratio, Distil architecture is more efficient than Core at similar size |
| **Weaknesses** | Not as robust as Core Standard on edge cases |
| **Best For** | Default for Edge devices, laptops without GPU |
| **WindyTune Hint** | Pick when: no GPU, need good accuracy, laptop/desktop without dedicated graphics |

#### 10. Edge Global
| Field | Value |
|---|---|
| **Type** | Speech-to-Text |
| **Size** | 515 MB |
| **Speed** | Multilingual optimized |
| **Languages** | 99 languages |
| **Base** | Distil-Whisper Medium (Multilingual) |
| **Strengths** | Best multilingual Edge model, optimized for language diversity, efficient |
| **Weaknesses** | Not as accurate as Core Turbo/Ultra on individual languages |
| **Best For** | International environments with many languages, conferences, UN-style meetings |
| **WindyTune Hint** | Pick when: 3+ languages in same session, need efficiency, GPU optional |

#### 11. Edge Pro
| Field | Value |
|---|---|
| **Type** | Speech-to-Text |
| **Size** | 515 MB |
| **Speed** | English-optimized |
| **Languages** | English |
| **Base** | Distil-Whisper Medium (English) |
| **Strengths** | Fastest high-quality English model, distilled for speed |
| **Weaknesses** | English only |
| **Best For** | English-only production, real-time English captions, podcasts |
| **WindyTune Hint** | Pick when: English confirmed, need speed + quality, prefer Edge efficiency |

#### 12. Edge Turbo
| Field | Value |
|---|---|
| **Type** | Speech-to-Text |
| **Size** | ~800 MB |
| **Speed** | 4× realtime |
| **Languages** | Multilingual |
| **Base** | Distil-Whisper Large |
| **Strengths** | Near-Ultra quality at Turbo speed due to distillation |
| **Weaknesses** | Larger than other Edge models, needs decent hardware |
| **Best For** | Production multilingual where you want Edge efficiency at high quality |
| **WindyTune Hint** | Pick when: GPU available, want best of Edge family, multilingual |

#### 13. Edge Ultra
| Field | Value |
|---|---|
| **Type** | Speech-to-Text |
| **Size** | ~1.5 GB |
| **Speed** | 2× realtime |
| **Languages** | Multilingual |
| **Base** | Distil-Whisper Large-v3 |
| **Strengths** | Highest Edge accuracy, faster than Core Ultra at similar quality |
| **Weaknesses** | Largest Edge model, still not quite Core Ultra accuracy |
| **Best For** | When you need near-Ultra quality but faster than Core Ultra |
| **WindyTune Hint** | Pick when: need best accuracy + some speed, GPU available |

#### 14. Edge Turbo (English)
| Field | Value |
|---|---|
| **Type** | Speech-to-Text |
| **Size** | ~800 MB |
| **Speed** | 4× realtime |
| **Languages** | English |
| **Base** | Distil-Whisper Large (English) |
| **Strengths** | Fastest high-accuracy English, distilled from Large |
| **Weaknesses** | English only, large for single-language |
| **Best For** | Production English transcription at scale |
| **WindyTune Hint** | Pick when: English only, need throughput, batch processing |

#### 15. Edge Ultra (English)
| Field | Value |
|---|---|
| **Type** | Speech-to-Text |
| **Size** | ~1.5 GB |
| **Speed** | 2× realtime |
| **Languages** | English |
| **Base** | Distil-Whisper Large-v3 (English) |
| **Strengths** | Absolute best English accuracy in Edge family |
| **Weaknesses** | English only, heavy |
| **Best For** | Mission-critical English transcription |
| **WindyTune Hint** | Pick when: English, accuracy is everything, speed secondary |

---

## TEXT-TO-TEXT TRANSLATION MODELS (2)

#### 16. Windy Translate Spark
| Field | Value |
|---|---|
| **Type** | Text-to-Text Translation |
| **Size** | ~2 GB (418M params) |
| **Speed** | ~117ms per translation (GPU), ~1-3s (CPU) |
| **Languages** | 100 languages, 9,900 direction pairs |
| **Base** | Meta M2M-100-418M (MIT License) |
| **Strengths** | Fast inference, tiny VRAM footprint (1.9GB), handles all major language pairs well, runs alongside Whisper models easily |
| **Weaknesses** | Weaker on rare language pairs (e.g. Finnish↔Portuguese), literal on idioms, can struggle with very long text |
| **Best For** | Real-time translation in the pipeline, fast mode, resource-constrained environments |
| **WindyTune Hint** | Pick when: fast_mode=true, low VRAM, real-time translation needed, common language pairs |

#### 17. Windy Translate Standard
| Field | Value |
|---|---|
| **Type** | Text-to-Text Translation |
| **Size** | ~5 GB (1.2B params) |
| **Speed** | ~200-400ms per translation (GPU), ~3-8s (CPU) |
| **Languages** | 100 languages, 9,900 direction pairs |
| **Base** | Meta M2M-100-1.2B (MIT License) |
| **Strengths** | Higher quality translations, better on rare pairs, better context understanding, more natural phrasing |
| **Weaknesses** | Slower, heavier VRAM (~5GB), needs GPU for real-time use |
| **Best For** | Quality mode, rare language pairs, documents, when accuracy matters more than speed |
| **WindyTune Hint** | Pick when: quality_mode=true, GPU available, rare language pair detected, document translation |

---

## WINDYTUNE AUTO-SELECTION LOGIC

WindyTune should use this registry to make decisions based on:

1. **Available hardware** → filters out models that won't fit in memory
2. **Detected language(s)** → English-only? Use English-optimized models
3. **Audio quality** → Noisy? Use larger models with better noise handling
4. **Speed requirement** → Real-time captions? Use Spark/Edge. Post-processing? Use Ultra
5. **Number of languages** → Multi-language meeting? Use Global or multilingual models
6. **User preference** → fast_mode vs quality_mode override

### Decision Tree (simplified):
```
Is it STT or Translation?
├── STT:
│   ├── GPU available?
│   │   ├── Yes → English only? → Core Pro / Edge Pro
│   │   │         Multilingual? → Core Turbo / Edge Turbo
│   │   │         Best quality? → Core Ultra
│   │   └── No  → Edge Standard (default) / Edge Spark (low resource)
│   └── Real-time needed?
│       ├── Yes → Edge family (faster startup, lower latency)
│       └── No  → Core family (higher accuracy)
├── Translation:
│   ├── fast_mode → Windy Translate Spark
│   └── quality_mode → Windy Translate Standard
```

---

## MACHINE-READABLE VERSION

A `model_registry.json` should be generated from this document for WindyTune runtime consumption. Fields per model:
```json
{
  "id": "core-spark",
  "name": "Core Spark",
  "type": "stt|translation",
  "family": "core|edge|translate",
  "size_mb": 75,
  "speed_factor": 32,
  "languages": ["all99"] | ["en"],
  "gpu_required": false,
  "min_ram_mb": 256,
  "min_vram_mb": 0,
  "strengths": ["speed", "low-resource"],
  "weaknesses": ["accuracy", "noise", "accents"],
  "windytune_priority": 1-10,
  "windytune_conditions": {
    "prefer_when": ["cpu_only", "low_ram", "realtime"],
    "avoid_when": ["noisy_audio", "rare_language", "accuracy_critical"]
  }
}
```

---

## MAINTENANCE

When adding a new model:
1. Add a card to this registry
2. Update the model count at the top
3. Add an entry to model_registry.json
4. Update WindyTune's selection logic if needed
5. Benchmark and document strengths/weaknesses BEFORE shipping

**Rule: No model ships without a registry card.** If we don't know what it's good at, WindyTune can't use it properly, and we look like we don't know our own product.

---

*Windy Pro Labs — 17 models, one mission: Speak your language. Read theirs.*
