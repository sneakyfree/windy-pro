# TURNOVER LETTER — Kit 0C3 Session 1 → Kit 0C3 Session 2
**Date:** 11 Mar 2026 0715 EST  
**From:** Kit 0C3 Charlie (dying session, ~10% context remaining)  
**To:** Kit 0C3 Charlie (fresh session)

---

## SITUATION

Grant is at your machine (OC3 Dell Latitude). You just spent 2.5 hours rebuilding the Windy Pro installation wizard. You're mid-task — the 3-layer UI is built but you need to add lingua specialists and pair specialists before testing.

---

## WHAT WAS DONE THIS SESSION

### 1. Fixed models.js CPU engine sizes
All 7 CPU engines had stale ONNX float32 sizes. Updated to CTranslate2 INT8 actuals (~50% of GPU size). GPU speeds also aligned with turnover letter. **Commit: 3d44399**

### 2. Built 3-Layer Progressive Disclosure UI (Screen 6)
Replaced the old 3-package selector with:
- **Layer 1 🍃 Simple (Grandma Mode):** Auto-recommend card + big green "Install Recommended" button + WindyTune mode picker (Auto/Hybrid/Manual)
- **Layer 2 🚗 Browse (Car Enthusiast):** All engines in GPU ⚡ / CPU 🛡️ / Translation 🌍 sections with badges, quality bars, tier labels
- **Layer 3 ⚙️ Specs (Gearhead):** Full tech table + speed/quality benchmark bars

Layer toggle at top right of Screen 6. **Commit: 3d44399**

### 3. Updated all demo mode data
Replaced old engine IDs (core-spark, edge-standard, lingua-es) with new IDs (windy-stt-nano, windy-stt-core-cpu, etc.). All 16 engines match ENGINE_CATALOG in models.js. **Commit: 3d44399**

### 4. Created WIZARD-ENGINE-PATIENT-FILES.md
Full "patient file" DNA profiles for all 16 wizard engines — source model, fork date, LoRA delta, eval loss, strengths, weaknesses, clinical notes. **Commit: fefb407**

### 5. Updated MODEL_GLOSSARY.json
Added root cause analysis for Edge (English LoRA on multilingual model = 4.814 eval loss) and Lite (Concorde spelling divergence = 4.180 eval loss). **Commit: ebd5d2c**

---

## WHAT NEEDS TO BE DONE NOW

### Priority 1: Add 5 Lingua Specialists to the Wizard
These are CONFIRMED uploaded to HuggingFace with real model content (verified via model_registry.json):

| Windy Name | GPU ID | CPU ID | GPU Size | CPU Size | Base Model |
|-----------|--------|--------|----------|----------|-----------|
| Hindi | windy-lingua-hindi | windy-lingua-hindi-ct2 | 144 MB | 72 MB | Oriserve/Whisper-Hindi2Hinglish-Swift |
| Spanish | windy-lingua-spanish | windy-lingua-spanish-ct2 | 466 MB | 235 MB | clu-ling/whisper-small-spanish |
| Chinese | windy-lingua-chinese | windy-lingua-chinese-ct2 | 466 MB | 235 MB | Jingmiao/whisper-small-chinese_base |
| French | windy-lingua-french | windy-lingua-french-ct2 | 1,462 MB | 735 MB | bofenghuang/whisper-medium-french |
| Arabic | windy-lingua-arabic | windy-lingua-arabic-ct2 | 2,950 MB | 1,481 MB | Byne/whisper-large-v3-arabic |

**Files to update:**
1. `installer-v2/core/models.js` — Add 10 entries to ENGINE_CATALOG (5 GPU + 5 CPU), add to TIER_ACCESS
2. `installer-v2/wizard.html` — Add 10 entries to demo mode scanHardware models array
3. Layer 2 UI needs a new "🌍 Language Specialists" section (alongside GPU/CPU/Translation)
4. Layer 3 gearhead table will auto-populate from allModels
5. Screen 3 (Languages) → Screen 6 connection: if user selected Hindi, auto-recommend windy-lingua-hindi

**Tier:** These should be `pro` tier (require Windy Pro subscription).

### Priority 2: Add ALL 16 Pair Specialists to the Wizard
Grant specifically asked for all 8 bidirectional pairs. CONFIRMED uploaded:

| Pair | ID | Size | Base Model |
|------|----|------|-----------|
| EN→ES | windy-pair-en-es | 299 MB | Helsinki-NLP/opus-mt-en-es |
| ES→EN | windy-pair-es-en | 299 MB | Helsinki-NLP/opus-mt-es-en |
| EN→ZH | windy-pair-en-zh | 299 MB | Helsinki-NLP/opus-mt-en-zh |
| ZH→EN | windy-pair-zh-en | 299 MB | Helsinki-NLP/opus-mt-zh-en |
| EN→FR | windy-pair-en-fr | 288 MB | Helsinki-NLP/opus-mt-en-fr |
| FR→EN | windy-pair-fr-en | 288 MB | Helsinki-NLP/opus-mt-fr-en |
| EN→DE | windy-pair-en-de | 285 MB | Helsinki-NLP/opus-mt-en-de |
| DE→EN | windy-pair-de-en | 285 MB | Helsinki-NLP/opus-mt-de-en |
| EN→AR | windy-pair-en-ar | 296 MB | Helsinki-NLP/opus-mt-en-ar |
| AR→EN | windy-pair-ar-en | 296 MB | Helsinki-NLP/opus-mt-ar-en |
| EN→HI | windy-pair-en-hi | 294 MB | Helsinki-NLP/opus-mt-en-hi |
| HI→EN | windy-pair-hi-en | 292 MB | Helsinki-NLP/opus-mt-hi-en |
| EN→PT | windy-pair-en-pt | 890 MB | Helsinki-NLP/opus-mt-tc-big-en-pt |
| PT→EN | windy-pair-pt-en | 299 MB | Helsinki-NLP/opus-mt-ROMANCE-en |
| EN→RU | windy-pair-en-ru | 296 MB | Helsinki-NLP/opus-mt-en-ru |
| RU→EN | windy-pair-ru-en | 296 MB | Helsinki-NLP/opus-mt-ru-en |

**Files to update:**
1. `installer-v2/core/models.js` — Add 16 entries to ENGINE_CATALOG with family='pair'
2. `installer-v2/wizard.html` — Add 16 entries to demo mode, add "🔗 Pair Specialists" section in Layer 2
3. Pair specialists should auto-recommend based on Screen 3 language selection (if user selected Spanish + English → recommend EN↔ES pairs)

**Tier:** These should be `translate` or `translate_pro` tier.

### Priority 3: Test the Wizard
After adding all models:
```bash
cd ~/windy-pro/installer-v2
xdg-open wizard.html     # Browser demo mode test
# OR
cd ~/windy-pro && npm start   # Full Electron test
```

Click through all 9 screens. Test all 3 layers. Try to break it.

### Priority 4: Update Patient Files
Add the new 26 engines to `docs/WIZARD-ENGINE-PATIENT-FILES.md`.

---

## FINAL WIZARD LINEUP (Target: 46 engines)

| Category | Count | Status |
|----------|-------|--------|
| GPU Engines (Nano→Pro) | 7 | ✅ In wizard |
| CPU Engines (Nano→Pro) | 7 | ✅ In wizard |
| Translation General (Spark + Standard) | 2 | ✅ In wizard |
| Lingua Specialists (5 languages × GPU+CPU) | 10 | ❌ ADD NOW |
| Pair Specialists (8 pairs × bidirectional) | 16 | ❌ ADD NOW |
| **Total** | **42** | |

---

## KEY FILES

```
installer-v2/wizard.html              ← Main wizard UI (3-layer system built)
installer-v2/core/models.js           ← ENGINE_CATALOG (currently 16, needs 42)
installer-v2/wizard-main.js           ← Orchestration (untouched)
installer-v2/wizard-preload.js        ← Electron IPC (untouched)
installer-v2/core/download-manager.js ← HuggingFace downloads (untouched)
docs/WIZARD-ENGINE-PATIENT-FILES.md   ← DNA profiles (needs update after additions)
docs/MODEL_GLOSSARY.json              ← Alpha's build log (135 models, translate sizes wrong)
src/models/model_registry.json        ← Authoritative: what's actually on HuggingFace (45 models)
```

---

## BRANDING RULES (NON-NEGOTIABLE)
1. NEVER mention OpenAI, Whisper, SYSTRAN, Helsinki-NLP, Meta, Facebook in user-facing content
2. Everything is "Developed by Windy Pro Labs" or "Windy Pro proprietary engine"
3. Call them "engines" — NOT "models"
4. Internal IDs can reference source (windy-stt-nano) but display names are clean (Windy Nano)

---

## GRANT'S PREFERENCES
- Header on every message. He hates reminding you.
- Use EST. Never UTC.
- Don't ask permission — do it and report results.
- He's excited about calling his engineer friends overseas to test Arabic, Hindi, Russian translation.
- He wants the pipeline built so future models just slot in.

---

## GIT STATE
```
Repo: ~/windy-pro (sneakyfree/windy-pro on GitHub)
Branch: main
Latest commit: ebd5d2c
Working tree: CLEAN
```

Read SOUL.md first, then this letter. You'll be up to speed in 2 minutes.

— Charlie 🎯, signing off
