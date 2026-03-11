# WINDY PRO — COMPLETE MODEL FLEET REPORT
**Generated:** 2026-03-10 15:02 EST
**Machine:** Veron-1 (RTX 5090, Mount Pleasant SC)
**HuggingFace Org:** WindyProLabs (Pro, $9/mo)

## FLEET SUMMARY
| Metric | Count |
|---|---|
| Models on disk | 139 |
| Models on HuggingFace | 121 |
| Models certified | 48 |
| Models failed certification | 34 |
| Gate-slippers (uncertified on HF) | 9 |
| Missing languages to build | 17 × 2 = 34 |
| OPUS-MT pairs to build | 1098 × 2 = 2196 |
| **GRAND TOTAL (target)** | **~2,500** |

## STATUS KEY
| Symbol | Meaning |
|---|---|
| 🟢 | Complete — LoRA trained, certified, on HuggingFace |
| 🟡 | Partial — built but missing certification or upload |
| 🔴 | Failed — certification failed, needs rebuild |
| ⚪ | Planned — not yet started |
| ⚠️ | Gate-slipper — on HF without full certification |

---
## SECTION 1: CORE STT MODELS (7 groups)

| # | Source Model | Windy Pro GPU | Size | Windy Pro CPU | Size | LoRA | Cert | On HF | Notes |
|---|---|---|---|---|---|---|---|---|---|
| 1 | openai/whisper-tiny.en | windy-stt-nano | 77MB | windy-stt-nano-ct2 | 38MB | 🟢 | 🟢/🟢 | 🟢/🟢 | English, ultra-light, mobile-friendly |
| 2 | openai/whisper-base.en | windy-stt-lite | 144MB | windy-stt-lite-ct2 | 72MB | 🟢 | 🟢/🟢 | 🟢/🟢 | English, lightweight |
| 3 | openai/whisper-small.en | windy-stt-core | 466MB | windy-stt-core-ct2 | 234MB | 🟢 | 🟢/🟢 | 🟢/🟢 | English, balanced quality/speed |
| 4 | openai/whisper-medium.en | windy-stt-plus | 1462MB | windy-stt-plus-ct2 | 734MB | 🟢 | 🟢/🟢 | 🟢/🟢 | English, high quality |
| 5 | openai/whisper-large-v3-turbo | windy-stt-turbo | 1548MB | windy-stt-turbo-ct2 | 777MB | 🟢 | 🟢/🟢 | 🟢/🟢 | English, fast large model ⭐ |
| 6 | openai/whisper-large-v3 | windy-stt-pro | 2949MB | windy-stt-pro-ct2 | 1480MB | 🟢 | 🟢/🟢 | 🟢/🟢 | English, maximum accuracy |
| 7 | distil-whisper/distil-large-v3 | windy-stt-edge | 1448MB | windy-stt-edge-ct2 | 727MB | 🟢 | 🟢/🟢 | 🟢/🟢 | English, edge-optimized |

## SECTION 2: DISTIL-WHISPER CPU MODELS (3 models, no CT2 variant)

| # | Source Model | Windy Pro Model | Size | LoRA | Cert | On HF | Notes |
|---|---|---|---|---|---|---|---|
| 1 | distil-whisper/distil-small.en | windy-stt-distil-small | 319MB | 🟢 | 🟢 | 🟢 | English, purpose-built CPU arch |
| 2 | distil-whisper/distil-medium.en | windy-stt-distil-medium | 754MB | 🟢 | 🟢 | 🟢 | English, medium CPU quality |
| 3 | distil-whisper/distil-large-v3 | windy-stt-distil-large | 1445MB | 🟢 | 🟢 | 🟢 | English, best CPU quality |

## SECTION 3: TRANSLATION GENERALIST MODELS (2 models)

| # | Source Model | Windy Pro Model | Size | LoRA | Cert | On HF | Notes |
|---|---|---|---|---|---|---|---|
| 1 | facebook/m2m100_418M | windy_translate_spark | 929MB | 🟢 | 🟢 | 🟢 | 100+ languages, fast, lightweight |
| 2 | facebook/m2m100_1.2B | windy_translate_standard | 2370MB | 🟢 | 🟢 | 🟢 | 100+ languages, high quality |

## SECTION 4: LINGUA STT LANGUAGE SPECIALISTS (67 languages)

| # | Lang | Source Model | GPU Model | GPU Size | CPU Model | CPU Size | LoRA | GPU Cert | CPU Cert | GPU HF | CPU HF | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Amharic | openai/whisper-small | windy-lingua-am | 467MB | windy-lingua-am-ct2 | 234MB | 🟢 | 🟡 | 🟡 | 🟢 | 🟢 | Amharic STT specialist |
| 2 | Arabic | Byne/whisper-large-v3-arabic | windy-lingua-arabic | 2949MB | windy-lingua-arabic-ct2 | 1480MB | 🟢 | 🟡 | 🟡 | 🟢 | 🟢 | Arabic STT specialist |
| 3 | Azerbaijani | openai/whisper-small | windy-lingua-az | 1462MB | windy-lingua-az-ct2 | 740MB | 🟢 | 🟡 | 🟡 | 🟢 | 🟢 | Azerbaijani STT specialist |
| 4 | Bulgarian | openai/whisper-small | windy-lingua-bg | ⚪ | windy-lingua-bg-ct2 | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | NOT BUILT — bad source model ID |
| 5 | Bengali | openai/whisper-small | windy-lingua-bn | 1460MB | windy-lingua-bn-ct2 | 735MB | 🟢 | 🟡 | 🟡 | 🟢 | 🟢 | Bengali STT specialist |
| 6 | Catalan | openai/whisper-small | windy-lingua-ca | 1462MB | windy-lingua-ca-ct2 | 735MB | 🟢 | 🟡 | 🟡 | 🟢 | 🟢 | Catalan STT specialist |
| 7 | Chinese | Jingmiao/whisper-small-chinese_base | windy-lingua-chinese | 466MB | windy-lingua-chinese-ct2 | 234MB | 🟢 | 🟡 | 🟡 | 🟢 | 🟢 | Chinese STT specialist |
| 8 | Czech | openai/whisper-small | windy-lingua-cs | 2949MB | windy-lingua-cs-ct2 | 1480MB | 🟢 | 🟡 | 🟡 | 🟢 | 🟢 | Czech STT specialist |
| 9 | Danish | openai/whisper-small | windy-lingua-da | ⚪ | windy-lingua-da-ct2 | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | NOT BUILT — bad source model ID |
| 10 | German | openai/whisper-large-v3 | windy-lingua-de | 1548MB | windy-lingua-de-ct2 | 777MB | 🟢 | 🟡 | 🟡 | 🟢 | 🟢 | German STT specialist |
| 11 | Greek | openai/whisper-small | windy-lingua-el | ⚪ | windy-lingua-el-ct2 | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | NOT BUILT — bad source model ID |
| 12 | Persian | openai/whisper-small | windy-lingua-fa | 467MB | windy-lingua-fa-ct2 | 234MB | 🟢 | 🟡 | 🟡 | 🟢 | 🟢 | Persian STT specialist |
| 13 | Finnish | openai/whisper-small | windy-lingua-fi | 2949MB | windy-lingua-fi-ct2 | 1480MB | 🟢 | 🟡 | 🟡 | 🟢 | 🟢 | Finnish STT specialist |
| 14 | French | bofenghuang/whisper-medium-french | windy-lingua-french | 1462MB | windy-lingua-french-ct2 | 735MB | 🟢 | 🟡 | 🟡 | 🟢 | 🟢 | French STT specialist |
| 15 | Irish | openai/whisper-small | windy-lingua-ga | ⚪ | windy-lingua-ga-ct2 | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | NOT BUILT — bad source model ID |
| 16 | Gujarati | openai/whisper-small | windy-lingua-gu | 1462MB | windy-lingua-gu-ct2 | 735MB | 🟢 | 🟡 | 🟡 | 🟢 | 🟢 | Gujarati STT specialist |
| 17 | Hausa | openai/whisper-small | windy-lingua-ha | ⚪ | windy-lingua-ha-ct2 | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | NOT BUILT — bad source model ID |
| 18 | Hebrew | openai/whisper-small | windy-lingua-he | 2949MB | windy-lingua-he-ct2 | 1480MB | 🟢 | 🟡 | 🟡 | 🟢 | 🟢 | Hebrew STT specialist |
| 19 | Hindi | Oriserve/Whisper-Hindi2Hinglish-Swift | windy-lingua-hindi | 144MB | windy-lingua-hindi-ct2 | 72MB | 🟢 | 🟡 | 🟡 | 🟢 | 🟢 | Hindi STT specialist |
| 20 | Hungarian | openai/whisper-small | windy-lingua-hu | 2949MB | windy-lingua-hu-ct2 | 1480MB | 🟢 | 🟡 | 🟡 | 🟢 | 🟢 | Hungarian STT specialist |
| 21 | Armenian | openai/whisper-small | windy-lingua-hy | 1548MB | windy-lingua-hy-ct2 | 777MB | 🟢 | 🟡 | 🟡 | 🟢 | 🟢 | Armenian STT specialist |
| 22 | Indonesian | openai/whisper-small | windy-lingua-id | ⚪ | windy-lingua-id-ct2 | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | NOT BUILT — bad source model ID |
| 23 | Igbo | openai/whisper-small | windy-lingua-ig | 77MB | windy-lingua-ig-ct2 | 38MB | 🟢 | 🟡 | 🟡 | 🟢 | 🟢 | Igbo STT specialist |
| 24 | Icelandic | openai/whisper-small | windy-lingua-is | ⚪ | windy-lingua-is-ct2 | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | NOT BUILT — bad source model ID |
| 25 | Italian | openai/whisper-large-v3 | windy-lingua-it | 2949MB | windy-lingua-it-ct2 | 1480MB | 🟢 | 🟡 | 🟡 | 🟢 | 🟢 | Italian STT specialist |
| 26 | Japanese | openai/whisper-large-v3 | windy-lingua-ja | 143MB | windy-lingua-ja-ct2 | 72MB | 🟢 | 🟡 | 🟡 | 🟢 | 🟢 | Japanese STT specialist |
| 27 | Javanese | openai/whisper-small | windy-lingua-jv | ⚪ | windy-lingua-jv-ct2 | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | NOT BUILT — bad source model ID |
| 28 | Kazakh | openai/whisper-small | windy-lingua-kk | 2949MB | windy-lingua-kk-ct2 | 1480MB | 🟢 | 🟡 | 🟡 | 🟢 | 🟢 | Kazakh STT specialist |
| 29 | Khmer | openai/whisper-small | windy-lingua-km | 466MB | windy-lingua-km-ct2 | 234MB | 🟢 | 🟡 | 🟡 | 🟢 | 🟢 | Khmer STT specialist |
| 30 | Kannada | openai/whisper-small | windy-lingua-kn | 466MB | windy-lingua-kn-ct2 | 234MB | 🟢 | 🟡 | 🟡 | 🟢 | 🟢 | Kannada STT specialist ⚠️CPU-slipper |
| 31 | Korean | openai/whisper-small | windy-lingua-ko | ⚪ | windy-lingua-ko-ct2 | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | NOT BUILT — bad source model ID |
| 32 | Lao | openai/whisper-small | windy-lingua-lo | ⚪ | windy-lingua-lo-ct2 | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | NOT BUILT — bad source model ID |
| 33 | Lithuanian | openai/whisper-small | windy-lingua-lt | 144MB | windy-lingua-lt-ct2 | 72MB | 🟢 | 🟡 | 🟡 | 🟢 | 🟢 | Lithuanian STT specialist ⚠️GPU-slipper ⚠️CPU-slipper |
| 34 | Latvian | openai/whisper-small | windy-lingua-lv | ⚪ | windy-lingua-lv-ct2 | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | NOT BUILT — bad source model ID |
| 35 | Malayalam | openai/whisper-small | windy-lingua-ml | 467MB | windy-lingua-ml-ct2 | 234MB | 🟢 | 🟡 | 🟡 | 🟢 | 🟢 | Malayalam STT specialist ⚠️GPU-slipper ⚠️CPU-slipper |
| 36 | Mongolian | openai/whisper-small | windy-lingua-mn | 466MB | windy-lingua-mn-ct2 | 234MB | 🟢 | 🟡 | 🟡 | 🟢 | 🟢 | Mongolian STT specialist ⚠️GPU-slipper ⚠️CPU-slipper |
| 37 | Marathi | openai/whisper-small | windy-lingua-mr | 2949MB | windy-lingua-mr-ct2 | 1480MB | 🟢 | 🟡 | 🟡 | 🟢 | 🟢 | Marathi STT specialist |
| 38 | Malay | openai/whisper-small | windy-lingua-ms | 467MB | windy-lingua-ms-ct2 | 234MB | 🟢 | 🟡 | 🟡 | 🟢 | 🟢 | Malay STT specialist ⚠️GPU-slipper ⚠️CPU-slipper |
| 39 | Myanmar | openai/whisper-small | windy-lingua-my | ⚪ | windy-lingua-my-ct2 | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | NOT BUILT — bad source model ID |
| 40 | Nepali | openai/whisper-small | windy-lingua-ne | 466MB | windy-lingua-ne-ct2 | 234MB | 🟢 | 🟡 | 🔴 | 🟢 | ⚪ | Nepali STT specialist | CT2 FAILED — needs re-quantize |
| 41 | Dutch | openai/whisper-large-v3 | windy-lingua-nl | 2949MB | windy-lingua-nl-ct2 | 1480MB | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | Dutch STT specialist |
| 42 | Norwegian | openai/whisper-small | windy-lingua-no | 466MB | windy-lingua-no-ct2 | 234MB | 🟢 | 🟢 | 🔴 | 🟢 | ⚪ | Norwegian STT specialist | CT2 FAILED — needs re-quantize |
| 43 | Punjabi | openai/whisper-small | windy-lingua-pa | 2949MB | windy-lingua-pa-ct2 | 1480MB | 🟢 | 🟢 | 🔴 | 🟢 | ⚪ | Punjabi STT specialist | CT2 FAILED — needs re-quantize |
| 44 | Polish | openai/whisper-small | windy-lingua-pl | ⚪ | windy-lingua-pl-ct2 | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | NOT BUILT — bad source model ID |
| 45 | Pashto | openai/whisper-small | windy-lingua-ps | 143MB | windy-lingua-ps-ct2 | 72MB | 🟢 | 🟢 | 🔴 | 🟢 | ⚪ | Pashto STT specialist | CT2 FAILED — needs re-quantize |
| 46 | Portuguese | openai/whisper-large-v3 | windy-lingua-pt | 1462MB | windy-lingua-pt-ct2 | 735MB | 🟢 | 🟢 | 🔴 | 🟢 | ⚪ | Portuguese STT specialist | CT2 FAILED — needs re-quantize |
| 47 | Romanian | openai/whisper-small | windy-lingua-ro | 1462MB | windy-lingua-ro-ct2 | 735MB | 🟢 | 🟢 | 🔴 | 🟢 | ⚪ | Romanian STT specialist | CT2 FAILED — needs re-quantize |
| 48 | Russian | openai/whisper-small | windy-lingua-ru | ⚪ | windy-lingua-ru-ct2 | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | NOT BUILT — bad source model ID |
| 49 | Sindhi | openai/whisper-small | windy-lingua-sd | 2949MB | windy-lingua-sd-ct2 | 1480MB | 🟢 | 🟢 | 🔴 | 🟢 | ⚪ | Sindhi STT specialist | CT2 FAILED — needs re-quantize |
| 50 | Sinhala | openai/whisper-small | windy-lingua-si | 467MB | windy-lingua-si-ct2 | 234MB | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | Sinhala STT specialist | CT2 FAILED — needs re-quantize |
| 51 | Slovenian | openai/whisper-small | windy-lingua-sl | ⚪ | windy-lingua-sl-ct2 | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | NOT BUILT — bad source model ID |
| 52 | Somali | openai/whisper-small | windy-lingua-so | 466MB | windy-lingua-so-ct2 | 234MB | 🟢 | 🟢 | 🔴 | 🟢 | ⚪ | Somali STT specialist | CT2 FAILED — needs re-quantize |
| 53 | Spanish | clu-ling/whisper-small-spanish | windy-lingua-spanish | 466MB | windy-lingua-spanish-ct2 | 234MB | 🟢 | 🟡 | 🟡 | 🟢 | 🟢 | Spanish STT specialist |
| 54 | Serbian | openai/whisper-small | windy-lingua-sr | 2949MB | windy-lingua-sr-ct2 | 1480MB | 🟢 | 🟢 | 🔴 | 🟢 | ⚪ | Serbian STT specialist | CT2 FAILED — needs re-quantize |
| 55 | Swedish | openai/whisper-small | windy-lingua-sv | 1462MB | windy-lingua-sv-ct2 | 735MB | 🟢 | 🟢 | 🔴 | 🟢 | ⚪ | Swedish STT specialist | CT2 FAILED — needs re-quantize |
| 56 | Swahili | openai/whisper-small | windy-lingua-sw | ⚪ | windy-lingua-sw-ct2 | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | NOT BUILT — bad source model ID |
| 57 | Tamil | openai/whisper-small | windy-lingua-ta | 466MB | windy-lingua-ta-ct2 | 234MB | 🟢 | 🟢 | 🔴 | 🟢 | ⚪ | Tamil STT specialist | CT2 FAILED — needs re-quantize |
| 58 | Telugu | openai/whisper-small | windy-lingua-te | 143MB | windy-lingua-te-ct2 | 72MB | 🟢 | 🟢 | 🔴 | 🟢 | ⚪ | Telugu STT specialist | CT2 FAILED — needs re-quantize |
| 59 | Thai | openai/whisper-small | windy-lingua-th | 143MB | windy-lingua-th-ct2 | 72MB | 🟢 | 🟢 | 🔴 | 🟢 | ⚪ | Thai STT specialist | CT2 FAILED — needs re-quantize |
| 60 | Filipino | openai/whisper-small | windy-lingua-tl | 467MB | windy-lingua-tl-ct2 | 234MB | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | Filipino STT specialist | CT2 FAILED — needs re-quantize |
| 61 | Turkish | openai/whisper-small | windy-lingua-tr | 1548MB | windy-lingua-tr-ct2 | 777MB | 🟢 | 🟢 | 🔴 | 🟢 | ⚪ | Turkish STT specialist | CT2 FAILED — needs re-quantize |
| 62 | Urdu | openai/whisper-small | windy-lingua-ur | 467MB | windy-lingua-ur-ct2 | 234MB | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | Urdu STT specialist | CT2 FAILED — needs re-quantize |
| 63 | Uzbek | openai/whisper-small | windy-lingua-uz | 1462MB | windy-lingua-uz-ct2 | 735MB | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | Uzbek STT specialist | CT2 FAILED — needs re-quantize |
| 64 | Vietnamese | openai/whisper-small | windy-lingua-vi | ⚪ | windy-lingua-vi-ct2 | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | NOT BUILT — bad source model ID |
| 65 | Xhosa | openai/whisper-small | windy-lingua-xh | 467MB | windy-lingua-xh-ct2 | 234MB | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | Xhosa STT specialist | CT2 FAILED — needs re-quantize |
| 66 | Yoruba | openai/whisper-small | windy-lingua-yo | 467MB | windy-lingua-yo-ct2 | 234MB | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | Yoruba STT specialist | CT2 FAILED — needs re-quantize |
| 67 | Zulu | openai/whisper-small | windy-lingua-zu | 1462MB | windy-lingua-zu-ct2 | 735MB | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | Zulu STT specialist | CT2 FAILED — needs re-quantize |

## SECTION 5: TRANSLATION PAIR SPECIALISTS (OPUS-MT)

### 5A. BUILT (16 pairs = 16 GPU models, CT2 planned)

| # | Direction | Source Model | GPU Model | GPU Size | CPU Model | CPU Size | LoRA | Cert | GPU HF | CPU HF | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | AR→EN | Helsinki-NLP/opus-mt-ar-en | windy-pair-ar-en | 295MB | windy-pair-ar-en-ct2 | ⚪ | 🟢 | 🟡 | 🟢 | ⚪ | Arabic→English translation |
| 2 | DE→EN | Helsinki-NLP/opus-mt-de-en | windy-pair-de-en | 285MB | windy-pair-de-en-ct2 | ⚪ | 🟢 | 🟡 | 🟢 | ⚪ | German→English translation |
| 3 | EN→AR | Helsinki-NLP/opus-mt-en-ar | windy-pair-en-ar | 295MB | windy-pair-en-ar-ct2 | ⚪ | 🟢 | 🟡 | 🟢 | ⚪ | English→Arabic translation |
| 4 | EN→DE | Helsinki-NLP/opus-mt-en-de | windy-pair-en-de | 285MB | windy-pair-en-de-ct2 | ⚪ | 🟢 | 🟡 | 🟢 | ⚪ | English→German translation |
| 5 | EN→ES | Helsinki-NLP/opus-mt-en-es | windy-pair-en-es | 299MB | windy-pair-en-es-ct2 | ⚪ | 🟢 | 🟡 | 🟢 | ⚪ | English→Spanish translation |
| 6 | EN→FR | Helsinki-NLP/opus-mt-en-fr | windy-pair-en-fr | 288MB | windy-pair-en-fr-ct2 | ⚪ | 🟢 | 🟡 | 🟢 | ⚪ | English→French translation |
| 7 | EN→HI | Helsinki-NLP/opus-mt-en-hi | windy-pair-en-hi | 294MB | windy-pair-en-hi-ct2 | ⚪ | 🟢 | 🟡 | 🟢 | ⚪ | English→Hindi translation |
| 8 | EN→PT | Helsinki-NLP/opus-mt-en-pt | windy-pair-en-pt | 890MB | windy-pair-en-pt-ct2 | ⚪ | 🟢 | 🟡 | 🟢 | ⚪ | English→Portuguese translation |
| 9 | EN→RU | Helsinki-NLP/opus-mt-en-ru | windy-pair-en-ru | 295MB | windy-pair-en-ru-ct2 | ⚪ | 🟢 | 🟡 | 🟢 | ⚪ | English→Russian translation |
| 10 | EN→ZH | Helsinki-NLP/opus-mt-en-zh | windy-pair-en-zh | 299MB | windy-pair-en-zh-ct2 | ⚪ | 🟢 | 🟡 | 🟢 | ⚪ | English→Chinese translation |
| 11 | ES→EN | Helsinki-NLP/opus-mt-es-en | windy-pair-es-en | 299MB | windy-pair-es-en-ct2 | ⚪ | 🟢 | 🟡 | 🟢 | ⚪ | Spanish→English translation |
| 12 | FR→EN | Helsinki-NLP/opus-mt-fr-en | windy-pair-fr-en | 288MB | windy-pair-fr-en-ct2 | ⚪ | 🟢 | 🟡 | 🟢 | ⚪ | French→English translation |
| 13 | HI→EN | Helsinki-NLP/opus-mt-hi-en | windy-pair-hi-en | 292MB | windy-pair-hi-en-ct2 | ⚪ | 🟢 | 🟡 | 🟢 | ⚪ | Hindi→English translation |
| 14 | PT→EN | Helsinki-NLP/opus-mt-pt-en | windy-pair-pt-en | 299MB | windy-pair-pt-en-ct2 | ⚪ | 🟢 | 🟡 | 🟢 | ⚪ | Portuguese→English translation |
| 15 | RU→EN | Helsinki-NLP/opus-mt-ru-en | windy-pair-ru-en | 295MB | windy-pair-ru-en-ct2 | ⚪ | 🟢 | 🟡 | 🟢 | ⚪ | Russian→English translation |
| 16 | ZH→EN | Helsinki-NLP/opus-mt-zh-en | windy-pair-zh-en | 299MB | windy-pair-zh-en-ct2 | ⚪ | 🟢 | 🟡 | 🟢 | ⚪ | Chinese→English translation |

### 5B. PLANNED (1098 remaining OPUS-MT pairs)

| # | Pair Code | Source Model | GPU Model | CPU Model | LoRA | Cert | HF | Specialty |
|---|---|---|---|---|---|---|---|---|
| 1 | NORTH_EU-NORTH_EU | Helsinki-NLP/opus-mt-NORTH_EU-NORTH_EU | windy-pair-NORTH_EU-NORTH_EU | windy-pair-NORTH_EU-NORTH_EU-ct2 | ⚪ | ⚪ | ⚪ | NORTH_EU→NORTH_EU |
| 2 | ROMANCE-en | Helsinki-NLP/opus-mt-ROMANCE-en | windy-pair-ROMANCE-en | windy-pair-ROMANCE-en-ct2 | ⚪ | ⚪ | ⚪ | ROMANCE→English |
| 3 | SCANDINAVIA-SCANDINAVIA | Helsinki-NLP/opus-mt-SCANDINAVIA-SCANDINAVIA | windy-pair-SCANDINAVIA-SCANDINAVIA | windy-pair-SCANDINAVIA-SCANDINAVIA-ct2 | ⚪ | ⚪ | ⚪ | SCANDINAVIA→SCANDINAVIA |
| 4 | aav-en | Helsinki-NLP/opus-mt-aav-en | windy-pair-aav-en | windy-pair-aav-en-ct2 | ⚪ | ⚪ | ⚪ | AAV→English |
| 5 | aed-es | Helsinki-NLP/opus-mt-aed-es | windy-pair-aed-es | windy-pair-aed-es-ct2 | ⚪ | ⚪ | ⚪ | AED→Spanish |
| 6 | af-de | Helsinki-NLP/opus-mt-af-de | windy-pair-af-de | windy-pair-af-de-ct2 | ⚪ | ⚪ | ⚪ | Afrikaans→German |
| 7 | af-en | Helsinki-NLP/opus-mt-af-en | windy-pair-af-en | windy-pair-af-en-ct2 | ⚪ | ⚪ | ⚪ | Afrikaans→English |
| 8 | af-eo | Helsinki-NLP/opus-mt-af-eo | windy-pair-af-eo | windy-pair-af-eo-ct2 | ⚪ | ⚪ | ⚪ | Afrikaans→Esperanto |
| 9 | af-es | Helsinki-NLP/opus-mt-af-es | windy-pair-af-es | windy-pair-af-es-ct2 | ⚪ | ⚪ | ⚪ | Afrikaans→Spanish |
| 10 | af-fi | Helsinki-NLP/opus-mt-af-fi | windy-pair-af-fi | windy-pair-af-fi-ct2 | ⚪ | ⚪ | ⚪ | Afrikaans→Finnish |
| 11 | af-fr | Helsinki-NLP/opus-mt-af-fr | windy-pair-af-fr | windy-pair-af-fr-ct2 | ⚪ | ⚪ | ⚪ | Afrikaans→French |
| 12 | af-nl | Helsinki-NLP/opus-mt-af-nl | windy-pair-af-nl | windy-pair-af-nl-ct2 | ⚪ | ⚪ | ⚪ | Afrikaans→Dutch |
| 13 | af-ru | Helsinki-NLP/opus-mt-af-ru | windy-pair-af-ru | windy-pair-af-ru-ct2 | ⚪ | ⚪ | ⚪ | Afrikaans→Russian |
| 14 | af-sv | Helsinki-NLP/opus-mt-af-sv | windy-pair-af-sv | windy-pair-af-sv-ct2 | ⚪ | ⚪ | ⚪ | Afrikaans→Swedish |
| 15 | afa-afa | Helsinki-NLP/opus-mt-afa-afa | windy-pair-afa-afa | windy-pair-afa-afa-ct2 | ⚪ | ⚪ | ⚪ | AFA→AFA |
| 16 | afa-en | Helsinki-NLP/opus-mt-afa-en | windy-pair-afa-en | windy-pair-afa-en-ct2 | ⚪ | ⚪ | ⚪ | AFA→English |
| 17 | alv-en | Helsinki-NLP/opus-mt-alv-en | windy-pair-alv-en | windy-pair-alv-en-ct2 | ⚪ | ⚪ | ⚪ | ALV→English |
| 18 | am-sv | Helsinki-NLP/opus-mt-am-sv | windy-pair-am-sv | windy-pair-am-sv-ct2 | ⚪ | ⚪ | ⚪ | Amharic→Swedish |
| 19 | ar-de | Helsinki-NLP/opus-mt-ar-de | windy-pair-ar-de | windy-pair-ar-de-ct2 | ⚪ | ⚪ | ⚪ | Arabic→German |
| 20 | ar-el | Helsinki-NLP/opus-mt-ar-el | windy-pair-ar-el | windy-pair-ar-el-ct2 | ⚪ | ⚪ | ⚪ | Arabic→Greek |
| 21 | ar-eo | Helsinki-NLP/opus-mt-ar-eo | windy-pair-ar-eo | windy-pair-ar-eo-ct2 | ⚪ | ⚪ | ⚪ | Arabic→Esperanto |
| 22 | ar-es | Helsinki-NLP/opus-mt-ar-es | windy-pair-ar-es | windy-pair-ar-es-ct2 | ⚪ | ⚪ | ⚪ | Arabic→Spanish |
| 23 | ar-fr | Helsinki-NLP/opus-mt-ar-fr | windy-pair-ar-fr | windy-pair-ar-fr-ct2 | ⚪ | ⚪ | ⚪ | Arabic→French |
| 24 | ar-he | Helsinki-NLP/opus-mt-ar-he | windy-pair-ar-he | windy-pair-ar-he-ct2 | ⚪ | ⚪ | ⚪ | Arabic→Hebrew |
| 25 | ar-it | Helsinki-NLP/opus-mt-ar-it | windy-pair-ar-it | windy-pair-ar-it-ct2 | ⚪ | ⚪ | ⚪ | Arabic→Italian |
| 26 | ar-pl | Helsinki-NLP/opus-mt-ar-pl | windy-pair-ar-pl | windy-pair-ar-pl-ct2 | ⚪ | ⚪ | ⚪ | Arabic→Polish |
| 27 | ar-ru | Helsinki-NLP/opus-mt-ar-ru | windy-pair-ar-ru | windy-pair-ar-ru-ct2 | ⚪ | ⚪ | ⚪ | Arabic→Russian |
| 28 | ar-tr | Helsinki-NLP/opus-mt-ar-tr | windy-pair-ar-tr | windy-pair-ar-tr-ct2 | ⚪ | ⚪ | ⚪ | Arabic→Turkish |
| 29 | art-en | Helsinki-NLP/opus-mt-art-en | windy-pair-art-en | windy-pair-art-en-ct2 | ⚪ | ⚪ | ⚪ | ART→English |
| 30 | ase-de | Helsinki-NLP/opus-mt-ase-de | windy-pair-ase-de | windy-pair-ase-de-ct2 | ⚪ | ⚪ | ⚪ | ASE→German |
| 31 | ase-en | Helsinki-NLP/opus-mt-ase-en | windy-pair-ase-en | windy-pair-ase-en-ct2 | ⚪ | ⚪ | ⚪ | ASE→English |
| 32 | ase-es | Helsinki-NLP/opus-mt-ase-es | windy-pair-ase-es | windy-pair-ase-es-ct2 | ⚪ | ⚪ | ⚪ | ASE→Spanish |
| 33 | ase-fr | Helsinki-NLP/opus-mt-ase-fr | windy-pair-ase-fr | windy-pair-ase-fr-ct2 | ⚪ | ⚪ | ⚪ | ASE→French |
| 34 | ase-sv | Helsinki-NLP/opus-mt-ase-sv | windy-pair-ase-sv | windy-pair-ase-sv-ct2 | ⚪ | ⚪ | ⚪ | ASE→Swedish |
| 35 | az-en | Helsinki-NLP/opus-mt-az-en | windy-pair-az-en | windy-pair-az-en-ct2 | ⚪ | ⚪ | ⚪ | Azerbaijani→English |
| 36 | az-es | Helsinki-NLP/opus-mt-az-es | windy-pair-az-es | windy-pair-az-es-ct2 | ⚪ | ⚪ | ⚪ | Azerbaijani→Spanish |
| 37 | az-tr | Helsinki-NLP/opus-mt-az-tr | windy-pair-az-tr | windy-pair-az-tr-ct2 | ⚪ | ⚪ | ⚪ | Azerbaijani→Turkish |
| 38 | bat-en | Helsinki-NLP/opus-mt-bat-en | windy-pair-bat-en | windy-pair-bat-en-ct2 | ⚪ | ⚪ | ⚪ | BAT→English |
| 39 | bcl-de | Helsinki-NLP/opus-mt-bcl-de | windy-pair-bcl-de | windy-pair-bcl-de-ct2 | ⚪ | ⚪ | ⚪ | BCL→German |
| 40 | bcl-en | Helsinki-NLP/opus-mt-bcl-en | windy-pair-bcl-en | windy-pair-bcl-en-ct2 | ⚪ | ⚪ | ⚪ | BCL→English |
| 41 | bcl-es | Helsinki-NLP/opus-mt-bcl-es | windy-pair-bcl-es | windy-pair-bcl-es-ct2 | ⚪ | ⚪ | ⚪ | BCL→Spanish |
| 42 | bcl-fi | Helsinki-NLP/opus-mt-bcl-fi | windy-pair-bcl-fi | windy-pair-bcl-fi-ct2 | ⚪ | ⚪ | ⚪ | BCL→Finnish |
| 43 | bcl-fr | Helsinki-NLP/opus-mt-bcl-fr | windy-pair-bcl-fr | windy-pair-bcl-fr-ct2 | ⚪ | ⚪ | ⚪ | BCL→French |
| 44 | bcl-sv | Helsinki-NLP/opus-mt-bcl-sv | windy-pair-bcl-sv | windy-pair-bcl-sv-ct2 | ⚪ | ⚪ | ⚪ | BCL→Swedish |
| 45 | be-es | Helsinki-NLP/opus-mt-be-es | windy-pair-be-es | windy-pair-be-es-ct2 | ⚪ | ⚪ | ⚪ | Belarusian→Spanish |
| 46 | bem-en | Helsinki-NLP/opus-mt-bem-en | windy-pair-bem-en | windy-pair-bem-en-ct2 | ⚪ | ⚪ | ⚪ | BEM→English |
| 47 | bem-es | Helsinki-NLP/opus-mt-bem-es | windy-pair-bem-es | windy-pair-bem-es-ct2 | ⚪ | ⚪ | ⚪ | BEM→Spanish |
| 48 | bem-fi | Helsinki-NLP/opus-mt-bem-fi | windy-pair-bem-fi | windy-pair-bem-fi-ct2 | ⚪ | ⚪ | ⚪ | BEM→Finnish |
| 49 | bem-fr | Helsinki-NLP/opus-mt-bem-fr | windy-pair-bem-fr | windy-pair-bem-fr-ct2 | ⚪ | ⚪ | ⚪ | BEM→French |
| 50 | bem-sv | Helsinki-NLP/opus-mt-bem-sv | windy-pair-bem-sv | windy-pair-bem-sv-ct2 | ⚪ | ⚪ | ⚪ | BEM→Swedish |
| 51 | ber-en | Helsinki-NLP/opus-mt-ber-en | windy-pair-ber-en | windy-pair-ber-en-ct2 | ⚪ | ⚪ | ⚪ | BER→English |
| 52 | ber-es | Helsinki-NLP/opus-mt-ber-es | windy-pair-ber-es | windy-pair-ber-es-ct2 | ⚪ | ⚪ | ⚪ | BER→Spanish |
| 53 | ber-fr | Helsinki-NLP/opus-mt-ber-fr | windy-pair-ber-fr | windy-pair-ber-fr-ct2 | ⚪ | ⚪ | ⚪ | BER→French |
| 54 | bg-de | Helsinki-NLP/opus-mt-bg-de | windy-pair-bg-de | windy-pair-bg-de-ct2 | ⚪ | ⚪ | ⚪ | Bulgarian→German |
| 55 | bg-en | Helsinki-NLP/opus-mt-bg-en | windy-pair-bg-en | windy-pair-bg-en-ct2 | ⚪ | ⚪ | ⚪ | Bulgarian→English |
| 56 | bg-eo | Helsinki-NLP/opus-mt-bg-eo | windy-pair-bg-eo | windy-pair-bg-eo-ct2 | ⚪ | ⚪ | ⚪ | Bulgarian→Esperanto |
| 57 | bg-es | Helsinki-NLP/opus-mt-bg-es | windy-pair-bg-es | windy-pair-bg-es-ct2 | ⚪ | ⚪ | ⚪ | Bulgarian→Spanish |
| 58 | bg-fi | Helsinki-NLP/opus-mt-bg-fi | windy-pair-bg-fi | windy-pair-bg-fi-ct2 | ⚪ | ⚪ | ⚪ | Bulgarian→Finnish |
| 59 | bg-fr | Helsinki-NLP/opus-mt-bg-fr | windy-pair-bg-fr | windy-pair-bg-fr-ct2 | ⚪ | ⚪ | ⚪ | Bulgarian→French |
| 60 | bg-it | Helsinki-NLP/opus-mt-bg-it | windy-pair-bg-it | windy-pair-bg-it-ct2 | ⚪ | ⚪ | ⚪ | Bulgarian→Italian |
| 61 | bg-ru | Helsinki-NLP/opus-mt-bg-ru | windy-pair-bg-ru | windy-pair-bg-ru-ct2 | ⚪ | ⚪ | ⚪ | Bulgarian→Russian |
| 62 | bg-sv | Helsinki-NLP/opus-mt-bg-sv | windy-pair-bg-sv | windy-pair-bg-sv-ct2 | ⚪ | ⚪ | ⚪ | Bulgarian→Swedish |
| 63 | bg-tr | Helsinki-NLP/opus-mt-bg-tr | windy-pair-bg-tr | windy-pair-bg-tr-ct2 | ⚪ | ⚪ | ⚪ | Bulgarian→Turkish |
| 64 | bg-uk | Helsinki-NLP/opus-mt-bg-uk | windy-pair-bg-uk | windy-pair-bg-uk-ct2 | ⚪ | ⚪ | ⚪ | Bulgarian→Ukrainian |
| 65 | bi-en | Helsinki-NLP/opus-mt-bi-en | windy-pair-bi-en | windy-pair-bi-en-ct2 | ⚪ | ⚪ | ⚪ | BI→English |
| 66 | bi-es | Helsinki-NLP/opus-mt-bi-es | windy-pair-bi-es | windy-pair-bi-es-ct2 | ⚪ | ⚪ | ⚪ | BI→Spanish |
| 67 | bi-fr | Helsinki-NLP/opus-mt-bi-fr | windy-pair-bi-fr | windy-pair-bi-fr-ct2 | ⚪ | ⚪ | ⚪ | BI→French |
| 68 | bi-sv | Helsinki-NLP/opus-mt-bi-sv | windy-pair-bi-sv | windy-pair-bi-sv-ct2 | ⚪ | ⚪ | ⚪ | BI→Swedish |
| 69 | bn-en | Helsinki-NLP/opus-mt-bn-en | windy-pair-bn-en | windy-pair-bn-en-ct2 | ⚪ | ⚪ | ⚪ | Bengali→English |
| 70 | bnt-en | Helsinki-NLP/opus-mt-bnt-en | windy-pair-bnt-en | windy-pair-bnt-en-ct2 | ⚪ | ⚪ | ⚪ | BNT→English |
| 71 | bzs-en | Helsinki-NLP/opus-mt-bzs-en | windy-pair-bzs-en | windy-pair-bzs-en-ct2 | ⚪ | ⚪ | ⚪ | BZS→English |
| 72 | bzs-es | Helsinki-NLP/opus-mt-bzs-es | windy-pair-bzs-es | windy-pair-bzs-es-ct2 | ⚪ | ⚪ | ⚪ | BZS→Spanish |
| 73 | bzs-fi | Helsinki-NLP/opus-mt-bzs-fi | windy-pair-bzs-fi | windy-pair-bzs-fi-ct2 | ⚪ | ⚪ | ⚪ | BZS→Finnish |
| 74 | bzs-fr | Helsinki-NLP/opus-mt-bzs-fr | windy-pair-bzs-fr | windy-pair-bzs-fr-ct2 | ⚪ | ⚪ | ⚪ | BZS→French |
| 75 | bzs-sv | Helsinki-NLP/opus-mt-bzs-sv | windy-pair-bzs-sv | windy-pair-bzs-sv-ct2 | ⚪ | ⚪ | ⚪ | BZS→Swedish |
| 76 | ca-de | Helsinki-NLP/opus-mt-ca-de | windy-pair-ca-de | windy-pair-ca-de-ct2 | ⚪ | ⚪ | ⚪ | Catalan→German |
| 77 | ca-en | Helsinki-NLP/opus-mt-ca-en | windy-pair-ca-en | windy-pair-ca-en-ct2 | ⚪ | ⚪ | ⚪ | Catalan→English |
| 78 | ca-es | Helsinki-NLP/opus-mt-ca-es | windy-pair-ca-es | windy-pair-ca-es-ct2 | ⚪ | ⚪ | ⚪ | Catalan→Spanish |
| 79 | ca-fr | Helsinki-NLP/opus-mt-ca-fr | windy-pair-ca-fr | windy-pair-ca-fr-ct2 | ⚪ | ⚪ | ⚪ | Catalan→French |
| 80 | ca-it | Helsinki-NLP/opus-mt-ca-it | windy-pair-ca-it | windy-pair-ca-it-ct2 | ⚪ | ⚪ | ⚪ | Catalan→Italian |
| 81 | ca-nl | Helsinki-NLP/opus-mt-ca-nl | windy-pair-ca-nl | windy-pair-ca-nl-ct2 | ⚪ | ⚪ | ⚪ | Catalan→Dutch |
| 82 | ca-pt | Helsinki-NLP/opus-mt-ca-pt | windy-pair-ca-pt | windy-pair-ca-pt-ct2 | ⚪ | ⚪ | ⚪ | Catalan→Portuguese |
| 83 | ca-uk | Helsinki-NLP/opus-mt-ca-uk | windy-pair-ca-uk | windy-pair-ca-uk-ct2 | ⚪ | ⚪ | ⚪ | Catalan→Ukrainian |
| 84 | caenes-eo | Helsinki-NLP/opus-mt-caenes-eo | windy-pair-caenes-eo | windy-pair-caenes-eo-ct2 | ⚪ | ⚪ | ⚪ | CAENES→Esperanto |
| 85 | cau-en | Helsinki-NLP/opus-mt-cau-en | windy-pair-cau-en | windy-pair-cau-en-ct2 | ⚪ | ⚪ | ⚪ | CAU→English |
| 86 | ccs-en | Helsinki-NLP/opus-mt-ccs-en | windy-pair-ccs-en | windy-pair-ccs-en-ct2 | ⚪ | ⚪ | ⚪ | CCS→English |
| 87 | ceb-en | Helsinki-NLP/opus-mt-ceb-en | windy-pair-ceb-en | windy-pair-ceb-en-ct2 | ⚪ | ⚪ | ⚪ | CEB→English |
| 88 | ceb-es | Helsinki-NLP/opus-mt-ceb-es | windy-pair-ceb-es | windy-pair-ceb-es-ct2 | ⚪ | ⚪ | ⚪ | CEB→Spanish |
| 89 | ceb-fi | Helsinki-NLP/opus-mt-ceb-fi | windy-pair-ceb-fi | windy-pair-ceb-fi-ct2 | ⚪ | ⚪ | ⚪ | CEB→Finnish |
| 90 | ceb-fr | Helsinki-NLP/opus-mt-ceb-fr | windy-pair-ceb-fr | windy-pair-ceb-fr-ct2 | ⚪ | ⚪ | ⚪ | CEB→French |
| 91 | ceb-sv | Helsinki-NLP/opus-mt-ceb-sv | windy-pair-ceb-sv | windy-pair-ceb-sv-ct2 | ⚪ | ⚪ | ⚪ | CEB→Swedish |
| 92 | cel-en | Helsinki-NLP/opus-mt-cel-en | windy-pair-cel-en | windy-pair-cel-en-ct2 | ⚪ | ⚪ | ⚪ | CEL→English |
| 93 | chk-en | Helsinki-NLP/opus-mt-chk-en | windy-pair-chk-en | windy-pair-chk-en-ct2 | ⚪ | ⚪ | ⚪ | CHK→English |
| 94 | chk-es | Helsinki-NLP/opus-mt-chk-es | windy-pair-chk-es | windy-pair-chk-es-ct2 | ⚪ | ⚪ | ⚪ | CHK→Spanish |
| 95 | chk-fr | Helsinki-NLP/opus-mt-chk-fr | windy-pair-chk-fr | windy-pair-chk-fr-ct2 | ⚪ | ⚪ | ⚪ | CHK→French |
| 96 | chk-sv | Helsinki-NLP/opus-mt-chk-sv | windy-pair-chk-sv | windy-pair-chk-sv-ct2 | ⚪ | ⚪ | ⚪ | CHK→Swedish |
| 97 | cpf-en | Helsinki-NLP/opus-mt-cpf-en | windy-pair-cpf-en | windy-pair-cpf-en-ct2 | ⚪ | ⚪ | ⚪ | CPF→English |
| 98 | cpp-en | Helsinki-NLP/opus-mt-cpp-en | windy-pair-cpp-en | windy-pair-cpp-en-ct2 | ⚪ | ⚪ | ⚪ | CPP→English |
| 99 | crs-de | Helsinki-NLP/opus-mt-crs-de | windy-pair-crs-de | windy-pair-crs-de-ct2 | ⚪ | ⚪ | ⚪ | CRS→German |
| 100 | crs-en | Helsinki-NLP/opus-mt-crs-en | windy-pair-crs-en | windy-pair-crs-en-ct2 | ⚪ | ⚪ | ⚪ | CRS→English |
| 101 | crs-es | Helsinki-NLP/opus-mt-crs-es | windy-pair-crs-es | windy-pair-crs-es-ct2 | ⚪ | ⚪ | ⚪ | CRS→Spanish |
| 102 | crs-fi | Helsinki-NLP/opus-mt-crs-fi | windy-pair-crs-fi | windy-pair-crs-fi-ct2 | ⚪ | ⚪ | ⚪ | CRS→Finnish |
| 103 | crs-fr | Helsinki-NLP/opus-mt-crs-fr | windy-pair-crs-fr | windy-pair-crs-fr-ct2 | ⚪ | ⚪ | ⚪ | CRS→French |
| 104 | crs-sv | Helsinki-NLP/opus-mt-crs-sv | windy-pair-crs-sv | windy-pair-crs-sv-ct2 | ⚪ | ⚪ | ⚪ | CRS→Swedish |
| 105 | cs-de | Helsinki-NLP/opus-mt-cs-de | windy-pair-cs-de | windy-pair-cs-de-ct2 | ⚪ | ⚪ | ⚪ | Czech→German |
| 106 | cs-en | Helsinki-NLP/opus-mt-cs-en | windy-pair-cs-en | windy-pair-cs-en-ct2 | ⚪ | ⚪ | ⚪ | Czech→English |
| 107 | cs-eo | Helsinki-NLP/opus-mt-cs-eo | windy-pair-cs-eo | windy-pair-cs-eo-ct2 | ⚪ | ⚪ | ⚪ | Czech→Esperanto |
| 108 | cs-fi | Helsinki-NLP/opus-mt-cs-fi | windy-pair-cs-fi | windy-pair-cs-fi-ct2 | ⚪ | ⚪ | ⚪ | Czech→Finnish |
| 109 | cs-fr | Helsinki-NLP/opus-mt-cs-fr | windy-pair-cs-fr | windy-pair-cs-fr-ct2 | ⚪ | ⚪ | ⚪ | Czech→French |
| 110 | cs-sv | Helsinki-NLP/opus-mt-cs-sv | windy-pair-cs-sv | windy-pair-cs-sv-ct2 | ⚪ | ⚪ | ⚪ | Czech→Swedish |
| 111 | cs-uk | Helsinki-NLP/opus-mt-cs-uk | windy-pair-cs-uk | windy-pair-cs-uk-ct2 | ⚪ | ⚪ | ⚪ | Czech→Ukrainian |
| 112 | csg-es | Helsinki-NLP/opus-mt-csg-es | windy-pair-csg-es | windy-pair-csg-es-ct2 | ⚪ | ⚪ | ⚪ | CSG→Spanish |
| 113 | csn-es | Helsinki-NLP/opus-mt-csn-es | windy-pair-csn-es | windy-pair-csn-es-ct2 | ⚪ | ⚪ | ⚪ | CSN→Spanish |
| 114 | cus-en | Helsinki-NLP/opus-mt-cus-en | windy-pair-cus-en | windy-pair-cus-en-ct2 | ⚪ | ⚪ | ⚪ | CUS→English |
| 115 | cy-en | Helsinki-NLP/opus-mt-cy-en | windy-pair-cy-en | windy-pair-cy-en-ct2 | ⚪ | ⚪ | ⚪ | Welsh→English |
| 116 | da-de | Helsinki-NLP/opus-mt-da-de | windy-pair-da-de | windy-pair-da-de-ct2 | ⚪ | ⚪ | ⚪ | Danish→German |
| 117 | da-en | Helsinki-NLP/opus-mt-da-en | windy-pair-da-en | windy-pair-da-en-ct2 | ⚪ | ⚪ | ⚪ | Danish→English |
| 118 | da-eo | Helsinki-NLP/opus-mt-da-eo | windy-pair-da-eo | windy-pair-da-eo-ct2 | ⚪ | ⚪ | ⚪ | Danish→Esperanto |
| 119 | da-es | Helsinki-NLP/opus-mt-da-es | windy-pair-da-es | windy-pair-da-es-ct2 | ⚪ | ⚪ | ⚪ | Danish→Spanish |
| 120 | da-fi | Helsinki-NLP/opus-mt-da-fi | windy-pair-da-fi | windy-pair-da-fi-ct2 | ⚪ | ⚪ | ⚪ | Danish→Finnish |
| 121 | da-fr | Helsinki-NLP/opus-mt-da-fr | windy-pair-da-fr | windy-pair-da-fr-ct2 | ⚪ | ⚪ | ⚪ | Danish→French |
| 122 | da-no | Helsinki-NLP/opus-mt-da-no | windy-pair-da-no | windy-pair-da-no-ct2 | ⚪ | ⚪ | ⚪ | Danish→Norwegian |
| 123 | da-ru | Helsinki-NLP/opus-mt-da-ru | windy-pair-da-ru | windy-pair-da-ru-ct2 | ⚪ | ⚪ | ⚪ | Danish→Russian |
| 124 | de-ZH | Helsinki-NLP/opus-mt-de-ZH | windy-pair-de-ZH | windy-pair-de-ZH-ct2 | ⚪ | ⚪ | ⚪ | German→ZH |
| 125 | de-af | Helsinki-NLP/opus-mt-de-af | windy-pair-de-af | windy-pair-de-af-ct2 | ⚪ | ⚪ | ⚪ | German→Afrikaans |
| 126 | de-ar | Helsinki-NLP/opus-mt-de-ar | windy-pair-de-ar | windy-pair-de-ar-ct2 | ⚪ | ⚪ | ⚪ | German→Arabic |
| 127 | de-ase | Helsinki-NLP/opus-mt-de-ase | windy-pair-de-ase | windy-pair-de-ase-ct2 | ⚪ | ⚪ | ⚪ | German→ASE |
| 128 | de-bcl | Helsinki-NLP/opus-mt-de-bcl | windy-pair-de-bcl | windy-pair-de-bcl-ct2 | ⚪ | ⚪ | ⚪ | German→BCL |
| 129 | de-bg | Helsinki-NLP/opus-mt-de-bg | windy-pair-de-bg | windy-pair-de-bg-ct2 | ⚪ | ⚪ | ⚪ | German→Bulgarian |
| 130 | de-bi | Helsinki-NLP/opus-mt-de-bi | windy-pair-de-bi | windy-pair-de-bi-ct2 | ⚪ | ⚪ | ⚪ | German→BI |
| 131 | de-bzs | Helsinki-NLP/opus-mt-de-bzs | windy-pair-de-bzs | windy-pair-de-bzs-ct2 | ⚪ | ⚪ | ⚪ | German→BZS |
| 132 | de-ca | Helsinki-NLP/opus-mt-de-ca | windy-pair-de-ca | windy-pair-de-ca-ct2 | ⚪ | ⚪ | ⚪ | German→Catalan |
| 133 | de-crs | Helsinki-NLP/opus-mt-de-crs | windy-pair-de-crs | windy-pair-de-crs-ct2 | ⚪ | ⚪ | ⚪ | German→CRS |
| 134 | de-cs | Helsinki-NLP/opus-mt-de-cs | windy-pair-de-cs | windy-pair-de-cs-ct2 | ⚪ | ⚪ | ⚪ | German→Czech |
| 135 | de-da | Helsinki-NLP/opus-mt-de-da | windy-pair-de-da | windy-pair-de-da-ct2 | ⚪ | ⚪ | ⚪ | German→Danish |
| 136 | de-de | Helsinki-NLP/opus-mt-de-de | windy-pair-de-de | windy-pair-de-de-ct2 | ⚪ | ⚪ | ⚪ | German→German |
| 137 | de-ee | Helsinki-NLP/opus-mt-de-ee | windy-pair-de-ee | windy-pair-de-ee-ct2 | ⚪ | ⚪ | ⚪ | German→EE |
| 138 | de-efi | Helsinki-NLP/opus-mt-de-efi | windy-pair-de-efi | windy-pair-de-efi-ct2 | ⚪ | ⚪ | ⚪ | German→EFI |
| 139 | de-el | Helsinki-NLP/opus-mt-de-el | windy-pair-de-el | windy-pair-de-el-ct2 | ⚪ | ⚪ | ⚪ | German→Greek |
| 140 | de-eo | Helsinki-NLP/opus-mt-de-eo | windy-pair-de-eo | windy-pair-de-eo-ct2 | ⚪ | ⚪ | ⚪ | German→Esperanto |
| 141 | de-es | Helsinki-NLP/opus-mt-de-es | windy-pair-de-es | windy-pair-de-es-ct2 | ⚪ | ⚪ | ⚪ | German→Spanish |
| 142 | de-et | Helsinki-NLP/opus-mt-de-et | windy-pair-de-et | windy-pair-de-et-ct2 | ⚪ | ⚪ | ⚪ | German→Estonian |
| 143 | de-eu | Helsinki-NLP/opus-mt-de-eu | windy-pair-de-eu | windy-pair-de-eu-ct2 | ⚪ | ⚪ | ⚪ | German→Basque |
| 144 | de-fi | Helsinki-NLP/opus-mt-de-fi | windy-pair-de-fi | windy-pair-de-fi-ct2 | ⚪ | ⚪ | ⚪ | German→Finnish |
| 145 | de-fj | Helsinki-NLP/opus-mt-de-fj | windy-pair-de-fj | windy-pair-de-fj-ct2 | ⚪ | ⚪ | ⚪ | German→FJ |
| 146 | de-fr | Helsinki-NLP/opus-mt-de-fr | windy-pair-de-fr | windy-pair-de-fr-ct2 | ⚪ | ⚪ | ⚪ | German→French |
| 147 | de-gaa | Helsinki-NLP/opus-mt-de-gaa | windy-pair-de-gaa | windy-pair-de-gaa-ct2 | ⚪ | ⚪ | ⚪ | German→GAA |
| 148 | de-gil | Helsinki-NLP/opus-mt-de-gil | windy-pair-de-gil | windy-pair-de-gil-ct2 | ⚪ | ⚪ | ⚪ | German→GIL |
| 149 | de-guw | Helsinki-NLP/opus-mt-de-guw | windy-pair-de-guw | windy-pair-de-guw-ct2 | ⚪ | ⚪ | ⚪ | German→GUW |
| 150 | de-ha | Helsinki-NLP/opus-mt-de-ha | windy-pair-de-ha | windy-pair-de-ha-ct2 | ⚪ | ⚪ | ⚪ | German→Hausa |
| 151 | de-he | Helsinki-NLP/opus-mt-de-he | windy-pair-de-he | windy-pair-de-he-ct2 | ⚪ | ⚪ | ⚪ | German→Hebrew |
| 152 | de-hil | Helsinki-NLP/opus-mt-de-hil | windy-pair-de-hil | windy-pair-de-hil-ct2 | ⚪ | ⚪ | ⚪ | German→HIL |
| 153 | de-ho | Helsinki-NLP/opus-mt-de-ho | windy-pair-de-ho | windy-pair-de-ho-ct2 | ⚪ | ⚪ | ⚪ | German→HO |
| 154 | de-hr | Helsinki-NLP/opus-mt-de-hr | windy-pair-de-hr | windy-pair-de-hr-ct2 | ⚪ | ⚪ | ⚪ | German→Croatian |
| 155 | de-ht | Helsinki-NLP/opus-mt-de-ht | windy-pair-de-ht | windy-pair-de-ht-ct2 | ⚪ | ⚪ | ⚪ | German→HT |
| 156 | de-hu | Helsinki-NLP/opus-mt-de-hu | windy-pair-de-hu | windy-pair-de-hu-ct2 | ⚪ | ⚪ | ⚪ | German→Hungarian |
| 157 | de-ig | Helsinki-NLP/opus-mt-de-ig | windy-pair-de-ig | windy-pair-de-ig-ct2 | ⚪ | ⚪ | ⚪ | German→Igbo |
| 158 | de-ilo | Helsinki-NLP/opus-mt-de-ilo | windy-pair-de-ilo | windy-pair-de-ilo-ct2 | ⚪ | ⚪ | ⚪ | German→ILO |
| 159 | de-is | Helsinki-NLP/opus-mt-de-is | windy-pair-de-is | windy-pair-de-is-ct2 | ⚪ | ⚪ | ⚪ | German→Icelandic |
| 160 | de-iso | Helsinki-NLP/opus-mt-de-iso | windy-pair-de-iso | windy-pair-de-iso-ct2 | ⚪ | ⚪ | ⚪ | German→ISO |
| 161 | de-it | Helsinki-NLP/opus-mt-de-it | windy-pair-de-it | windy-pair-de-it-ct2 | ⚪ | ⚪ | ⚪ | German→Italian |
| 162 | de-kg | Helsinki-NLP/opus-mt-de-kg | windy-pair-de-kg | windy-pair-de-kg-ct2 | ⚪ | ⚪ | ⚪ | German→KG |
| 163 | de-ln | Helsinki-NLP/opus-mt-de-ln | windy-pair-de-ln | windy-pair-de-ln-ct2 | ⚪ | ⚪ | ⚪ | German→LN |
| 164 | de-loz | Helsinki-NLP/opus-mt-de-loz | windy-pair-de-loz | windy-pair-de-loz-ct2 | ⚪ | ⚪ | ⚪ | German→LOZ |
| 165 | de-lt | Helsinki-NLP/opus-mt-de-lt | windy-pair-de-lt | windy-pair-de-lt-ct2 | ⚪ | ⚪ | ⚪ | German→Lithuanian |
| 166 | de-lua | Helsinki-NLP/opus-mt-de-lua | windy-pair-de-lua | windy-pair-de-lua-ct2 | ⚪ | ⚪ | ⚪ | German→LUA |
| 167 | de-ms | Helsinki-NLP/opus-mt-de-ms | windy-pair-de-ms | windy-pair-de-ms-ct2 | ⚪ | ⚪ | ⚪ | German→Malay |
| 168 | de-mt | Helsinki-NLP/opus-mt-de-mt | windy-pair-de-mt | windy-pair-de-mt-ct2 | ⚪ | ⚪ | ⚪ | German→Maltese |
| 169 | de-niu | Helsinki-NLP/opus-mt-de-niu | windy-pair-de-niu | windy-pair-de-niu-ct2 | ⚪ | ⚪ | ⚪ | German→NIU |
| 170 | de-nl | Helsinki-NLP/opus-mt-de-nl | windy-pair-de-nl | windy-pair-de-nl-ct2 | ⚪ | ⚪ | ⚪ | German→Dutch |
| 171 | de-no | Helsinki-NLP/opus-mt-de-no | windy-pair-de-no | windy-pair-de-no-ct2 | ⚪ | ⚪ | ⚪ | German→Norwegian |
| 172 | de-nso | Helsinki-NLP/opus-mt-de-nso | windy-pair-de-nso | windy-pair-de-nso-ct2 | ⚪ | ⚪ | ⚪ | German→NSO |
| 173 | de-ny | Helsinki-NLP/opus-mt-de-ny | windy-pair-de-ny | windy-pair-de-ny-ct2 | ⚪ | ⚪ | ⚪ | German→Chichewa |
| 174 | de-pag | Helsinki-NLP/opus-mt-de-pag | windy-pair-de-pag | windy-pair-de-pag-ct2 | ⚪ | ⚪ | ⚪ | German→PAG |
| 175 | de-pap | Helsinki-NLP/opus-mt-de-pap | windy-pair-de-pap | windy-pair-de-pap-ct2 | ⚪ | ⚪ | ⚪ | German→PAP |
| 176 | de-pis | Helsinki-NLP/opus-mt-de-pis | windy-pair-de-pis | windy-pair-de-pis-ct2 | ⚪ | ⚪ | ⚪ | German→PIS |
| 177 | de-pl | Helsinki-NLP/opus-mt-de-pl | windy-pair-de-pl | windy-pair-de-pl-ct2 | ⚪ | ⚪ | ⚪ | German→Polish |
| 178 | de-pon | Helsinki-NLP/opus-mt-de-pon | windy-pair-de-pon | windy-pair-de-pon-ct2 | ⚪ | ⚪ | ⚪ | German→PON |
| 179 | de-tl | Helsinki-NLP/opus-mt-de-tl | windy-pair-de-tl | windy-pair-de-tl-ct2 | ⚪ | ⚪ | ⚪ | German→Filipino |
| 180 | de-uk | Helsinki-NLP/opus-mt-de-uk | windy-pair-de-uk | windy-pair-de-uk-ct2 | ⚪ | ⚪ | ⚪ | German→Ukrainian |
| 181 | de-vi | Helsinki-NLP/opus-mt-de-vi | windy-pair-de-vi | windy-pair-de-vi-ct2 | ⚪ | ⚪ | ⚪ | German→Vietnamese |
| 182 | dra-en | Helsinki-NLP/opus-mt-dra-en | windy-pair-dra-en | windy-pair-dra-en-ct2 | ⚪ | ⚪ | ⚪ | DRA→English |
| 183 | ee-de | Helsinki-NLP/opus-mt-ee-de | windy-pair-ee-de | windy-pair-ee-de-ct2 | ⚪ | ⚪ | ⚪ | EE→German |
| 184 | ee-en | Helsinki-NLP/opus-mt-ee-en | windy-pair-ee-en | windy-pair-ee-en-ct2 | ⚪ | ⚪ | ⚪ | EE→English |
| 185 | ee-es | Helsinki-NLP/opus-mt-ee-es | windy-pair-ee-es | windy-pair-ee-es-ct2 | ⚪ | ⚪ | ⚪ | EE→Spanish |
| 186 | ee-fi | Helsinki-NLP/opus-mt-ee-fi | windy-pair-ee-fi | windy-pair-ee-fi-ct2 | ⚪ | ⚪ | ⚪ | EE→Finnish |
| 187 | ee-fr | Helsinki-NLP/opus-mt-ee-fr | windy-pair-ee-fr | windy-pair-ee-fr-ct2 | ⚪ | ⚪ | ⚪ | EE→French |
| 188 | ee-sv | Helsinki-NLP/opus-mt-ee-sv | windy-pair-ee-sv | windy-pair-ee-sv-ct2 | ⚪ | ⚪ | ⚪ | EE→Swedish |
| 189 | efi-de | Helsinki-NLP/opus-mt-efi-de | windy-pair-efi-de | windy-pair-efi-de-ct2 | ⚪ | ⚪ | ⚪ | EFI→German |
| 190 | efi-en | Helsinki-NLP/opus-mt-efi-en | windy-pair-efi-en | windy-pair-efi-en-ct2 | ⚪ | ⚪ | ⚪ | EFI→English |
| 191 | efi-fi | Helsinki-NLP/opus-mt-efi-fi | windy-pair-efi-fi | windy-pair-efi-fi-ct2 | ⚪ | ⚪ | ⚪ | EFI→Finnish |
| 192 | efi-fr | Helsinki-NLP/opus-mt-efi-fr | windy-pair-efi-fr | windy-pair-efi-fr-ct2 | ⚪ | ⚪ | ⚪ | EFI→French |
| 193 | efi-sv | Helsinki-NLP/opus-mt-efi-sv | windy-pair-efi-sv | windy-pair-efi-sv-ct2 | ⚪ | ⚪ | ⚪ | EFI→Swedish |
| 194 | el-ar | Helsinki-NLP/opus-mt-el-ar | windy-pair-el-ar | windy-pair-el-ar-ct2 | ⚪ | ⚪ | ⚪ | Greek→Arabic |
| 195 | el-eo | Helsinki-NLP/opus-mt-el-eo | windy-pair-el-eo | windy-pair-el-eo-ct2 | ⚪ | ⚪ | ⚪ | Greek→Esperanto |
| 196 | el-fi | Helsinki-NLP/opus-mt-el-fi | windy-pair-el-fi | windy-pair-el-fi-ct2 | ⚪ | ⚪ | ⚪ | Greek→Finnish |
| 197 | el-fr | Helsinki-NLP/opus-mt-el-fr | windy-pair-el-fr | windy-pair-el-fr-ct2 | ⚪ | ⚪ | ⚪ | Greek→French |
| 198 | el-sv | Helsinki-NLP/opus-mt-el-sv | windy-pair-el-sv | windy-pair-el-sv-ct2 | ⚪ | ⚪ | ⚪ | Greek→Swedish |
| 199 | en-CELTIC | Helsinki-NLP/opus-mt-en-CELTIC | windy-pair-en-CELTIC | windy-pair-en-CELTIC-ct2 | ⚪ | ⚪ | ⚪ | English→CELTIC |
| 200 | en-ROMANCE | Helsinki-NLP/opus-mt-en-ROMANCE | windy-pair-en-ROMANCE | windy-pair-en-ROMANCE-ct2 | ⚪ | ⚪ | ⚪ | English→ROMANCE |
| 201 | en-aav | Helsinki-NLP/opus-mt-en-aav | windy-pair-en-aav | windy-pair-en-aav-ct2 | ⚪ | ⚪ | ⚪ | English→AAV |
| 202 | en-af | Helsinki-NLP/opus-mt-en-af | windy-pair-en-af | windy-pair-en-af-ct2 | ⚪ | ⚪ | ⚪ | English→Afrikaans |
| 203 | en-afa | Helsinki-NLP/opus-mt-en-afa | windy-pair-en-afa | windy-pair-en-afa-ct2 | ⚪ | ⚪ | ⚪ | English→AFA |
| 204 | en-alv | Helsinki-NLP/opus-mt-en-alv | windy-pair-en-alv | windy-pair-en-alv-ct2 | ⚪ | ⚪ | ⚪ | English→ALV |
| 205 | en-az | Helsinki-NLP/opus-mt-en-az | windy-pair-en-az | windy-pair-en-az-ct2 | ⚪ | ⚪ | ⚪ | English→Azerbaijani |
| 206 | en-bat | Helsinki-NLP/opus-mt-en-bat | windy-pair-en-bat | windy-pair-en-bat-ct2 | ⚪ | ⚪ | ⚪ | English→BAT |
| 207 | en-bcl | Helsinki-NLP/opus-mt-en-bcl | windy-pair-en-bcl | windy-pair-en-bcl-ct2 | ⚪ | ⚪ | ⚪ | English→BCL |
| 208 | en-bem | Helsinki-NLP/opus-mt-en-bem | windy-pair-en-bem | windy-pair-en-bem-ct2 | ⚪ | ⚪ | ⚪ | English→BEM |
| 209 | en-ber | Helsinki-NLP/opus-mt-en-ber | windy-pair-en-ber | windy-pair-en-ber-ct2 | ⚪ | ⚪ | ⚪ | English→BER |
| 210 | en-bg | Helsinki-NLP/opus-mt-en-bg | windy-pair-en-bg | windy-pair-en-bg-ct2 | ⚪ | ⚪ | ⚪ | English→Bulgarian |
| 211 | en-bi | Helsinki-NLP/opus-mt-en-bi | windy-pair-en-bi | windy-pair-en-bi-ct2 | ⚪ | ⚪ | ⚪ | English→BI |
| 212 | en-bnt | Helsinki-NLP/opus-mt-en-bnt | windy-pair-en-bnt | windy-pair-en-bnt-ct2 | ⚪ | ⚪ | ⚪ | English→BNT |
| 213 | en-bzs | Helsinki-NLP/opus-mt-en-bzs | windy-pair-en-bzs | windy-pair-en-bzs-ct2 | ⚪ | ⚪ | ⚪ | English→BZS |
| 214 | en-ca | Helsinki-NLP/opus-mt-en-ca | windy-pair-en-ca | windy-pair-en-ca-ct2 | ⚪ | ⚪ | ⚪ | English→Catalan |
| 215 | en-ceb | Helsinki-NLP/opus-mt-en-ceb | windy-pair-en-ceb | windy-pair-en-ceb-ct2 | ⚪ | ⚪ | ⚪ | English→CEB |
| 216 | en-cel | Helsinki-NLP/opus-mt-en-cel | windy-pair-en-cel | windy-pair-en-cel-ct2 | ⚪ | ⚪ | ⚪ | English→CEL |
| 217 | en-chk | Helsinki-NLP/opus-mt-en-chk | windy-pair-en-chk | windy-pair-en-chk-ct2 | ⚪ | ⚪ | ⚪ | English→CHK |
| 218 | en-cpf | Helsinki-NLP/opus-mt-en-cpf | windy-pair-en-cpf | windy-pair-en-cpf-ct2 | ⚪ | ⚪ | ⚪ | English→CPF |
| 219 | en-cpp | Helsinki-NLP/opus-mt-en-cpp | windy-pair-en-cpp | windy-pair-en-cpp-ct2 | ⚪ | ⚪ | ⚪ | English→CPP |
| 220 | en-crs | Helsinki-NLP/opus-mt-en-crs | windy-pair-en-crs | windy-pair-en-crs-ct2 | ⚪ | ⚪ | ⚪ | English→CRS |
| 221 | en-cs | Helsinki-NLP/opus-mt-en-cs | windy-pair-en-cs | windy-pair-en-cs-ct2 | ⚪ | ⚪ | ⚪ | English→Czech |
| 222 | en-cus | Helsinki-NLP/opus-mt-en-cus | windy-pair-en-cus | windy-pair-en-cus-ct2 | ⚪ | ⚪ | ⚪ | English→CUS |
| 223 | en-cy | Helsinki-NLP/opus-mt-en-cy | windy-pair-en-cy | windy-pair-en-cy-ct2 | ⚪ | ⚪ | ⚪ | English→Welsh |
| 224 | en-da | Helsinki-NLP/opus-mt-en-da | windy-pair-en-da | windy-pair-en-da-ct2 | ⚪ | ⚪ | ⚪ | English→Danish |
| 225 | en-dra | Helsinki-NLP/opus-mt-en-dra | windy-pair-en-dra | windy-pair-en-dra-ct2 | ⚪ | ⚪ | ⚪ | English→DRA |
| 226 | en-ee | Helsinki-NLP/opus-mt-en-ee | windy-pair-en-ee | windy-pair-en-ee-ct2 | ⚪ | ⚪ | ⚪ | English→EE |
| 227 | en-efi | Helsinki-NLP/opus-mt-en-efi | windy-pair-en-efi | windy-pair-en-efi-ct2 | ⚪ | ⚪ | ⚪ | English→EFI |
| 228 | en-el | Helsinki-NLP/opus-mt-en-el | windy-pair-en-el | windy-pair-en-el-ct2 | ⚪ | ⚪ | ⚪ | English→Greek |
| 229 | en-eo | Helsinki-NLP/opus-mt-en-eo | windy-pair-en-eo | windy-pair-en-eo-ct2 | ⚪ | ⚪ | ⚪ | English→Esperanto |
| 230 | en-et | Helsinki-NLP/opus-mt-en-et | windy-pair-en-et | windy-pair-en-et-ct2 | ⚪ | ⚪ | ⚪ | English→Estonian |
| 231 | en-eu | Helsinki-NLP/opus-mt-en-eu | windy-pair-en-eu | windy-pair-en-eu-ct2 | ⚪ | ⚪ | ⚪ | English→Basque |
| 232 | en-euq | Helsinki-NLP/opus-mt-en-euq | windy-pair-en-euq | windy-pair-en-euq-ct2 | ⚪ | ⚪ | ⚪ | English→EUQ |
| 233 | en-fi | Helsinki-NLP/opus-mt-en-fi | windy-pair-en-fi | windy-pair-en-fi-ct2 | ⚪ | ⚪ | ⚪ | English→Finnish |
| 234 | en-fiu | Helsinki-NLP/opus-mt-en-fiu | windy-pair-en-fiu | windy-pair-en-fiu-ct2 | ⚪ | ⚪ | ⚪ | English→FIU |
| 235 | en-fj | Helsinki-NLP/opus-mt-en-fj | windy-pair-en-fj | windy-pair-en-fj-ct2 | ⚪ | ⚪ | ⚪ | English→FJ |
| 236 | en-ga | Helsinki-NLP/opus-mt-en-ga | windy-pair-en-ga | windy-pair-en-ga-ct2 | ⚪ | ⚪ | ⚪ | English→Irish |
| 237 | en-gaa | Helsinki-NLP/opus-mt-en-gaa | windy-pair-en-gaa | windy-pair-en-gaa-ct2 | ⚪ | ⚪ | ⚪ | English→GAA |
| 238 | en-gem | Helsinki-NLP/opus-mt-en-gem | windy-pair-en-gem | windy-pair-en-gem-ct2 | ⚪ | ⚪ | ⚪ | English→GEM |
| 239 | en-gil | Helsinki-NLP/opus-mt-en-gil | windy-pair-en-gil | windy-pair-en-gil-ct2 | ⚪ | ⚪ | ⚪ | English→GIL |
| 240 | en-gl | Helsinki-NLP/opus-mt-en-gl | windy-pair-en-gl | windy-pair-en-gl-ct2 | ⚪ | ⚪ | ⚪ | English→Galician |
| 241 | en-gmq | Helsinki-NLP/opus-mt-en-gmq | windy-pair-en-gmq | windy-pair-en-gmq-ct2 | ⚪ | ⚪ | ⚪ | English→GMQ |
| 242 | en-gmw | Helsinki-NLP/opus-mt-en-gmw | windy-pair-en-gmw | windy-pair-en-gmw-ct2 | ⚪ | ⚪ | ⚪ | English→GMW |
| 243 | en-grk | Helsinki-NLP/opus-mt-en-grk | windy-pair-en-grk | windy-pair-en-grk-ct2 | ⚪ | ⚪ | ⚪ | English→GRK |
| 244 | en-guw | Helsinki-NLP/opus-mt-en-guw | windy-pair-en-guw | windy-pair-en-guw-ct2 | ⚪ | ⚪ | ⚪ | English→GUW |
| 245 | en-gv | Helsinki-NLP/opus-mt-en-gv | windy-pair-en-gv | windy-pair-en-gv-ct2 | ⚪ | ⚪ | ⚪ | English→GV |
| 246 | en-ha | Helsinki-NLP/opus-mt-en-ha | windy-pair-en-ha | windy-pair-en-ha-ct2 | ⚪ | ⚪ | ⚪ | English→Hausa |
| 247 | en-he | Helsinki-NLP/opus-mt-en-he | windy-pair-en-he | windy-pair-en-he-ct2 | ⚪ | ⚪ | ⚪ | English→Hebrew |
| 248 | en-hil | Helsinki-NLP/opus-mt-en-hil | windy-pair-en-hil | windy-pair-en-hil-ct2 | ⚪ | ⚪ | ⚪ | English→HIL |
| 249 | en-ho | Helsinki-NLP/opus-mt-en-ho | windy-pair-en-ho | windy-pair-en-ho-ct2 | ⚪ | ⚪ | ⚪ | English→HO |
| 250 | en-ht | Helsinki-NLP/opus-mt-en-ht | windy-pair-en-ht | windy-pair-en-ht-ct2 | ⚪ | ⚪ | ⚪ | English→HT |
| 251 | en-hu | Helsinki-NLP/opus-mt-en-hu | windy-pair-en-hu | windy-pair-en-hu-ct2 | ⚪ | ⚪ | ⚪ | English→Hungarian |
| 252 | en-hy | Helsinki-NLP/opus-mt-en-hy | windy-pair-en-hy | windy-pair-en-hy-ct2 | ⚪ | ⚪ | ⚪ | English→Armenian |
| 253 | en-id | Helsinki-NLP/opus-mt-en-id | windy-pair-en-id | windy-pair-en-id-ct2 | ⚪ | ⚪ | ⚪ | English→Indonesian |
| 254 | en-ig | Helsinki-NLP/opus-mt-en-ig | windy-pair-en-ig | windy-pair-en-ig-ct2 | ⚪ | ⚪ | ⚪ | English→Igbo |
| 255 | en-inc | Helsinki-NLP/opus-mt-en-inc | windy-pair-en-inc | windy-pair-en-inc-ct2 | ⚪ | ⚪ | ⚪ | English→INC |
| 256 | en-ine | Helsinki-NLP/opus-mt-en-ine | windy-pair-en-ine | windy-pair-en-ine-ct2 | ⚪ | ⚪ | ⚪ | English→INE |
| 257 | en-is | Helsinki-NLP/opus-mt-en-is | windy-pair-en-is | windy-pair-en-is-ct2 | ⚪ | ⚪ | ⚪ | English→Icelandic |
| 258 | en-iso | Helsinki-NLP/opus-mt-en-iso | windy-pair-en-iso | windy-pair-en-iso-ct2 | ⚪ | ⚪ | ⚪ | English→ISO |
| 259 | en-it | Helsinki-NLP/opus-mt-en-it | windy-pair-en-it | windy-pair-en-it-ct2 | ⚪ | ⚪ | ⚪ | English→Italian |
| 260 | en-itc | Helsinki-NLP/opus-mt-en-itc | windy-pair-en-itc | windy-pair-en-itc-ct2 | ⚪ | ⚪ | ⚪ | English→ITC |
| 261 | en-jap | Helsinki-NLP/opus-mt-en-jap | windy-pair-en-jap | windy-pair-en-jap-ct2 | ⚪ | ⚪ | ⚪ | English→JAP |
| 262 | en-mk | Helsinki-NLP/opus-mt-en-mk | windy-pair-en-mk | windy-pair-en-mk-ct2 | ⚪ | ⚪ | ⚪ | English→Macedonian |
| 263 | en-mkh | Helsinki-NLP/opus-mt-en-mkh | windy-pair-en-mkh | windy-pair-en-mkh-ct2 | ⚪ | ⚪ | ⚪ | English→MKH |
| 264 | en-mul | Helsinki-NLP/opus-mt-en-mul | windy-pair-en-mul | windy-pair-en-mul-ct2 | ⚪ | ⚪ | ⚪ | English→MUL |
| 265 | en-pag | Helsinki-NLP/opus-mt-en-pag | windy-pair-en-pag | windy-pair-en-pag-ct2 | ⚪ | ⚪ | ⚪ | English→PAG |
| 266 | en-pap | Helsinki-NLP/opus-mt-en-pap | windy-pair-en-pap | windy-pair-en-pap-ct2 | ⚪ | ⚪ | ⚪ | English→PAP |
| 267 | en-ro | Helsinki-NLP/opus-mt-en-ro | windy-pair-en-ro | windy-pair-en-ro-ct2 | ⚪ | ⚪ | ⚪ | English→Romanian |
| 268 | en-roa | Helsinki-NLP/opus-mt-en-roa | windy-pair-en-roa | windy-pair-en-roa-ct2 | ⚪ | ⚪ | ⚪ | English→ROA |
| 269 | en-run | Helsinki-NLP/opus-mt-en-run | windy-pair-en-run | windy-pair-en-run-ct2 | ⚪ | ⚪ | ⚪ | English→RUN |
| 270 | en-sem | Helsinki-NLP/opus-mt-en-sem | windy-pair-en-sem | windy-pair-en-sem-ct2 | ⚪ | ⚪ | ⚪ | English→SEM |
| 271 | en-sit | Helsinki-NLP/opus-mt-en-sit | windy-pair-en-sit | windy-pair-en-sit-ct2 | ⚪ | ⚪ | ⚪ | English→SIT |
| 272 | en-sk | Helsinki-NLP/opus-mt-en-sk | windy-pair-en-sk | windy-pair-en-sk-ct2 | ⚪ | ⚪ | ⚪ | English→Slovak |
| 273 | en-sla | Helsinki-NLP/opus-mt-en-sla | windy-pair-en-sla | windy-pair-en-sla-ct2 | ⚪ | ⚪ | ⚪ | English→SLA |
| 274 | en-sq | Helsinki-NLP/opus-mt-en-sq | windy-pair-en-sq | windy-pair-en-sq-ct2 | ⚪ | ⚪ | ⚪ | English→Albanian |
| 275 | en-sv | Helsinki-NLP/opus-mt-en-sv | windy-pair-en-sv | windy-pair-en-sv-ct2 | ⚪ | ⚪ | ⚪ | English→Swedish |
| 276 | en-sw | Helsinki-NLP/opus-mt-en-sw | windy-pair-en-sw | windy-pair-en-sw-ct2 | ⚪ | ⚪ | ⚪ | English→Swahili |
| 277 | en-swc | Helsinki-NLP/opus-mt-en-swc | windy-pair-en-swc | windy-pair-en-swc-ct2 | ⚪ | ⚪ | ⚪ | English→SWC |
| 278 | en-tl | Helsinki-NLP/opus-mt-en-tl | windy-pair-en-tl | windy-pair-en-tl-ct2 | ⚪ | ⚪ | ⚪ | English→Filipino |
| 279 | en-tll | Helsinki-NLP/opus-mt-en-tll | windy-pair-en-tll | windy-pair-en-tll-ct2 | ⚪ | ⚪ | ⚪ | English→TLL |
| 280 | en-trk | Helsinki-NLP/opus-mt-en-trk | windy-pair-en-trk | windy-pair-en-trk-ct2 | ⚪ | ⚪ | ⚪ | English→TRK |
| 281 | en-uk | Helsinki-NLP/opus-mt-en-uk | windy-pair-en-uk | windy-pair-en-uk-ct2 | ⚪ | ⚪ | ⚪ | English→Ukrainian |
| 282 | en-ur | Helsinki-NLP/opus-mt-en-ur | windy-pair-en-ur | windy-pair-en-ur-ct2 | ⚪ | ⚪ | ⚪ | English→Urdu |
| 283 | en-urj | Helsinki-NLP/opus-mt-en-urj | windy-pair-en-urj | windy-pair-en-urj-ct2 | ⚪ | ⚪ | ⚪ | English→URJ |
| 284 | en-vi | Helsinki-NLP/opus-mt-en-vi | windy-pair-en-vi | windy-pair-en-vi-ct2 | ⚪ | ⚪ | ⚪ | English→Vietnamese |
| 285 | en-xh | Helsinki-NLP/opus-mt-en-xh | windy-pair-en-xh | windy-pair-en-xh-ct2 | ⚪ | ⚪ | ⚪ | English→Xhosa |
| 286 | en-zlw | Helsinki-NLP/opus-mt-en-zlw | windy-pair-en-zlw | windy-pair-en-zlw-ct2 | ⚪ | ⚪ | ⚪ | English→ZLW |
| 287 | en_el_es_fi-en_el_es_fi | Helsinki-NLP/opus-mt-en_el_es_fi-en_el_es_fi | windy-pair-en_el_es_fi-en_el_es_fi | windy-pair-en_el_es_fi-en_el_es_fi-ct2 | ⚪ | ⚪ | ⚪ | EN_EL_ES_FI→EN_EL_ES_FI |
| 288 | eo-af | Helsinki-NLP/opus-mt-eo-af | windy-pair-eo-af | windy-pair-eo-af-ct2 | ⚪ | ⚪ | ⚪ | Esperanto→Afrikaans |
| 289 | eo-bg | Helsinki-NLP/opus-mt-eo-bg | windy-pair-eo-bg | windy-pair-eo-bg-ct2 | ⚪ | ⚪ | ⚪ | Esperanto→Bulgarian |
| 290 | eo-caenes | Helsinki-NLP/opus-mt-eo-caenes | windy-pair-eo-caenes | windy-pair-eo-caenes-ct2 | ⚪ | ⚪ | ⚪ | Esperanto→CAENES |
| 291 | eo-cs | Helsinki-NLP/opus-mt-eo-cs | windy-pair-eo-cs | windy-pair-eo-cs-ct2 | ⚪ | ⚪ | ⚪ | Esperanto→Czech |
| 292 | eo-da | Helsinki-NLP/opus-mt-eo-da | windy-pair-eo-da | windy-pair-eo-da-ct2 | ⚪ | ⚪ | ⚪ | Esperanto→Danish |
| 293 | eo-de | Helsinki-NLP/opus-mt-eo-de | windy-pair-eo-de | windy-pair-eo-de-ct2 | ⚪ | ⚪ | ⚪ | Esperanto→German |
| 294 | eo-el | Helsinki-NLP/opus-mt-eo-el | windy-pair-eo-el | windy-pair-eo-el-ct2 | ⚪ | ⚪ | ⚪ | Esperanto→Greek |
| 295 | eo-es | Helsinki-NLP/opus-mt-eo-es | windy-pair-eo-es | windy-pair-eo-es-ct2 | ⚪ | ⚪ | ⚪ | Esperanto→Spanish |
| 296 | eo-fi | Helsinki-NLP/opus-mt-eo-fi | windy-pair-eo-fi | windy-pair-eo-fi-ct2 | ⚪ | ⚪ | ⚪ | Esperanto→Finnish |
| 297 | eo-fr | Helsinki-NLP/opus-mt-eo-fr | windy-pair-eo-fr | windy-pair-eo-fr-ct2 | ⚪ | ⚪ | ⚪ | Esperanto→French |
| 298 | eo-hu | Helsinki-NLP/opus-mt-eo-hu | windy-pair-eo-hu | windy-pair-eo-hu-ct2 | ⚪ | ⚪ | ⚪ | Esperanto→Hungarian |
| 299 | eo-it | Helsinki-NLP/opus-mt-eo-it | windy-pair-eo-it | windy-pair-eo-it-ct2 | ⚪ | ⚪ | ⚪ | Esperanto→Italian |
| 300 | eo-pl | Helsinki-NLP/opus-mt-eo-pl | windy-pair-eo-pl | windy-pair-eo-pl-ct2 | ⚪ | ⚪ | ⚪ | Esperanto→Polish |
| 301 | eo-pt | Helsinki-NLP/opus-mt-eo-pt | windy-pair-eo-pt | windy-pair-eo-pt-ct2 | ⚪ | ⚪ | ⚪ | Esperanto→Portuguese |
| 302 | eo-ro | Helsinki-NLP/opus-mt-eo-ro | windy-pair-eo-ro | windy-pair-eo-ro-ct2 | ⚪ | ⚪ | ⚪ | Esperanto→Romanian |
| 303 | eo-ru | Helsinki-NLP/opus-mt-eo-ru | windy-pair-eo-ru | windy-pair-eo-ru-ct2 | ⚪ | ⚪ | ⚪ | Esperanto→Russian |
| 304 | eo-sv | Helsinki-NLP/opus-mt-eo-sv | windy-pair-eo-sv | windy-pair-eo-sv-ct2 | ⚪ | ⚪ | ⚪ | Esperanto→Swedish |
| 305 | es-NORWAY | Helsinki-NLP/opus-mt-es-NORWAY | windy-pair-es-NORWAY | windy-pair-es-NORWAY-ct2 | ⚪ | ⚪ | ⚪ | Spanish→NORWAY |
| 306 | es-aed | Helsinki-NLP/opus-mt-es-aed | windy-pair-es-aed | windy-pair-es-aed-ct2 | ⚪ | ⚪ | ⚪ | Spanish→AED |
| 307 | es-af | Helsinki-NLP/opus-mt-es-af | windy-pair-es-af | windy-pair-es-af-ct2 | ⚪ | ⚪ | ⚪ | Spanish→Afrikaans |
| 308 | es-ar | Helsinki-NLP/opus-mt-es-ar | windy-pair-es-ar | windy-pair-es-ar-ct2 | ⚪ | ⚪ | ⚪ | Spanish→Arabic |
| 309 | es-ase | Helsinki-NLP/opus-mt-es-ase | windy-pair-es-ase | windy-pair-es-ase-ct2 | ⚪ | ⚪ | ⚪ | Spanish→ASE |
| 310 | es-bcl | Helsinki-NLP/opus-mt-es-bcl | windy-pair-es-bcl | windy-pair-es-bcl-ct2 | ⚪ | ⚪ | ⚪ | Spanish→BCL |
| 311 | es-ber | Helsinki-NLP/opus-mt-es-ber | windy-pair-es-ber | windy-pair-es-ber-ct2 | ⚪ | ⚪ | ⚪ | Spanish→BER |
| 312 | es-bg | Helsinki-NLP/opus-mt-es-bg | windy-pair-es-bg | windy-pair-es-bg-ct2 | ⚪ | ⚪ | ⚪ | Spanish→Bulgarian |
| 313 | es-bi | Helsinki-NLP/opus-mt-es-bi | windy-pair-es-bi | windy-pair-es-bi-ct2 | ⚪ | ⚪ | ⚪ | Spanish→BI |
| 314 | es-bzs | Helsinki-NLP/opus-mt-es-bzs | windy-pair-es-bzs | windy-pair-es-bzs-ct2 | ⚪ | ⚪ | ⚪ | Spanish→BZS |
| 315 | es-ca | Helsinki-NLP/opus-mt-es-ca | windy-pair-es-ca | windy-pair-es-ca-ct2 | ⚪ | ⚪ | ⚪ | Spanish→Catalan |
| 316 | es-ceb | Helsinki-NLP/opus-mt-es-ceb | windy-pair-es-ceb | windy-pair-es-ceb-ct2 | ⚪ | ⚪ | ⚪ | Spanish→CEB |
| 317 | es-crs | Helsinki-NLP/opus-mt-es-crs | windy-pair-es-crs | windy-pair-es-crs-ct2 | ⚪ | ⚪ | ⚪ | Spanish→CRS |
| 318 | es-cs | Helsinki-NLP/opus-mt-es-cs | windy-pair-es-cs | windy-pair-es-cs-ct2 | ⚪ | ⚪ | ⚪ | Spanish→Czech |
| 319 | es-csg | Helsinki-NLP/opus-mt-es-csg | windy-pair-es-csg | windy-pair-es-csg-ct2 | ⚪ | ⚪ | ⚪ | Spanish→CSG |
| 320 | es-csn | Helsinki-NLP/opus-mt-es-csn | windy-pair-es-csn | windy-pair-es-csn-ct2 | ⚪ | ⚪ | ⚪ | Spanish→CSN |
| 321 | es-da | Helsinki-NLP/opus-mt-es-da | windy-pair-es-da | windy-pair-es-da-ct2 | ⚪ | ⚪ | ⚪ | Spanish→Danish |
| 322 | es-de | Helsinki-NLP/opus-mt-es-de | windy-pair-es-de | windy-pair-es-de-ct2 | ⚪ | ⚪ | ⚪ | Spanish→German |
| 323 | es-ee | Helsinki-NLP/opus-mt-es-ee | windy-pair-es-ee | windy-pair-es-ee-ct2 | ⚪ | ⚪ | ⚪ | Spanish→EE |
| 324 | es-efi | Helsinki-NLP/opus-mt-es-efi | windy-pair-es-efi | windy-pair-es-efi-ct2 | ⚪ | ⚪ | ⚪ | Spanish→EFI |
| 325 | es-el | Helsinki-NLP/opus-mt-es-el | windy-pair-es-el | windy-pair-es-el-ct2 | ⚪ | ⚪ | ⚪ | Spanish→Greek |
| 326 | es-eo | Helsinki-NLP/opus-mt-es-eo | windy-pair-es-eo | windy-pair-es-eo-ct2 | ⚪ | ⚪ | ⚪ | Spanish→Esperanto |
| 327 | es-es | Helsinki-NLP/opus-mt-es-es | windy-pair-es-es | windy-pair-es-es-ct2 | ⚪ | ⚪ | ⚪ | Spanish→Spanish |
| 328 | es-et | Helsinki-NLP/opus-mt-es-et | windy-pair-es-et | windy-pair-es-et-ct2 | ⚪ | ⚪ | ⚪ | Spanish→Estonian |
| 329 | es-eu | Helsinki-NLP/opus-mt-es-eu | windy-pair-es-eu | windy-pair-es-eu-ct2 | ⚪ | ⚪ | ⚪ | Spanish→Basque |
| 330 | es-fi | Helsinki-NLP/opus-mt-es-fi | windy-pair-es-fi | windy-pair-es-fi-ct2 | ⚪ | ⚪ | ⚪ | Spanish→Finnish |
| 331 | es-fj | Helsinki-NLP/opus-mt-es-fj | windy-pair-es-fj | windy-pair-es-fj-ct2 | ⚪ | ⚪ | ⚪ | Spanish→FJ |
| 332 | es-fr | Helsinki-NLP/opus-mt-es-fr | windy-pair-es-fr | windy-pair-es-fr-ct2 | ⚪ | ⚪ | ⚪ | Spanish→French |
| 333 | es-gaa | Helsinki-NLP/opus-mt-es-gaa | windy-pair-es-gaa | windy-pair-es-gaa-ct2 | ⚪ | ⚪ | ⚪ | Spanish→GAA |
| 334 | es-gil | Helsinki-NLP/opus-mt-es-gil | windy-pair-es-gil | windy-pair-es-gil-ct2 | ⚪ | ⚪ | ⚪ | Spanish→GIL |
| 335 | es-gl | Helsinki-NLP/opus-mt-es-gl | windy-pair-es-gl | windy-pair-es-gl-ct2 | ⚪ | ⚪ | ⚪ | Spanish→Galician |
| 336 | es-guw | Helsinki-NLP/opus-mt-es-guw | windy-pair-es-guw | windy-pair-es-guw-ct2 | ⚪ | ⚪ | ⚪ | Spanish→GUW |
| 337 | es-ha | Helsinki-NLP/opus-mt-es-ha | windy-pair-es-ha | windy-pair-es-ha-ct2 | ⚪ | ⚪ | ⚪ | Spanish→Hausa |
| 338 | es-he | Helsinki-NLP/opus-mt-es-he | windy-pair-es-he | windy-pair-es-he-ct2 | ⚪ | ⚪ | ⚪ | Spanish→Hebrew |
| 339 | es-hil | Helsinki-NLP/opus-mt-es-hil | windy-pair-es-hil | windy-pair-es-hil-ct2 | ⚪ | ⚪ | ⚪ | Spanish→HIL |
| 340 | es-ho | Helsinki-NLP/opus-mt-es-ho | windy-pair-es-ho | windy-pair-es-ho-ct2 | ⚪ | ⚪ | ⚪ | Spanish→HO |
| 341 | es-hr | Helsinki-NLP/opus-mt-es-hr | windy-pair-es-hr | windy-pair-es-hr-ct2 | ⚪ | ⚪ | ⚪ | Spanish→Croatian |
| 342 | es-ht | Helsinki-NLP/opus-mt-es-ht | windy-pair-es-ht | windy-pair-es-ht-ct2 | ⚪ | ⚪ | ⚪ | Spanish→HT |
| 343 | es-id | Helsinki-NLP/opus-mt-es-id | windy-pair-es-id | windy-pair-es-id-ct2 | ⚪ | ⚪ | ⚪ | Spanish→Indonesian |
| 344 | es-ig | Helsinki-NLP/opus-mt-es-ig | windy-pair-es-ig | windy-pair-es-ig-ct2 | ⚪ | ⚪ | ⚪ | Spanish→Igbo |
| 345 | es-ilo | Helsinki-NLP/opus-mt-es-ilo | windy-pair-es-ilo | windy-pair-es-ilo-ct2 | ⚪ | ⚪ | ⚪ | Spanish→ILO |
| 346 | es-is | Helsinki-NLP/opus-mt-es-is | windy-pair-es-is | windy-pair-es-is-ct2 | ⚪ | ⚪ | ⚪ | Spanish→Icelandic |
| 347 | es-iso | Helsinki-NLP/opus-mt-es-iso | windy-pair-es-iso | windy-pair-es-iso-ct2 | ⚪ | ⚪ | ⚪ | Spanish→ISO |
| 348 | es-it | Helsinki-NLP/opus-mt-es-it | windy-pair-es-it | windy-pair-es-it-ct2 | ⚪ | ⚪ | ⚪ | Spanish→Italian |
| 349 | es-kg | Helsinki-NLP/opus-mt-es-kg | windy-pair-es-kg | windy-pair-es-kg-ct2 | ⚪ | ⚪ | ⚪ | Spanish→KG |
| 350 | es-ln | Helsinki-NLP/opus-mt-es-ln | windy-pair-es-ln | windy-pair-es-ln-ct2 | ⚪ | ⚪ | ⚪ | Spanish→LN |
| 351 | es-loz | Helsinki-NLP/opus-mt-es-loz | windy-pair-es-loz | windy-pair-es-loz-ct2 | ⚪ | ⚪ | ⚪ | Spanish→LOZ |
| 352 | es-lt | Helsinki-NLP/opus-mt-es-lt | windy-pair-es-lt | windy-pair-es-lt-ct2 | ⚪ | ⚪ | ⚪ | Spanish→Lithuanian |
| 353 | es-lua | Helsinki-NLP/opus-mt-es-lua | windy-pair-es-lua | windy-pair-es-lua-ct2 | ⚪ | ⚪ | ⚪ | Spanish→LUA |
| 354 | es-lus | Helsinki-NLP/opus-mt-es-lus | windy-pair-es-lus | windy-pair-es-lus-ct2 | ⚪ | ⚪ | ⚪ | Spanish→LUS |
| 355 | es-mfs | Helsinki-NLP/opus-mt-es-mfs | windy-pair-es-mfs | windy-pair-es-mfs-ct2 | ⚪ | ⚪ | ⚪ | Spanish→MFS |
| 356 | es-mk | Helsinki-NLP/opus-mt-es-mk | windy-pair-es-mk | windy-pair-es-mk-ct2 | ⚪ | ⚪ | ⚪ | Spanish→Macedonian |
| 357 | es-mt | Helsinki-NLP/opus-mt-es-mt | windy-pair-es-mt | windy-pair-es-mt-ct2 | ⚪ | ⚪ | ⚪ | Spanish→Maltese |
| 358 | es-niu | Helsinki-NLP/opus-mt-es-niu | windy-pair-es-niu | windy-pair-es-niu-ct2 | ⚪ | ⚪ | ⚪ | Spanish→NIU |
| 359 | es-nl | Helsinki-NLP/opus-mt-es-nl | windy-pair-es-nl | windy-pair-es-nl-ct2 | ⚪ | ⚪ | ⚪ | Spanish→Dutch |
| 360 | es-no | Helsinki-NLP/opus-mt-es-no | windy-pair-es-no | windy-pair-es-no-ct2 | ⚪ | ⚪ | ⚪ | Spanish→Norwegian |
| 361 | es-nso | Helsinki-NLP/opus-mt-es-nso | windy-pair-es-nso | windy-pair-es-nso-ct2 | ⚪ | ⚪ | ⚪ | Spanish→NSO |
| 362 | es-ny | Helsinki-NLP/opus-mt-es-ny | windy-pair-es-ny | windy-pair-es-ny-ct2 | ⚪ | ⚪ | ⚪ | Spanish→Chichewa |
| 363 | es-pag | Helsinki-NLP/opus-mt-es-pag | windy-pair-es-pag | windy-pair-es-pag-ct2 | ⚪ | ⚪ | ⚪ | Spanish→PAG |
| 364 | es-pap | Helsinki-NLP/opus-mt-es-pap | windy-pair-es-pap | windy-pair-es-pap-ct2 | ⚪ | ⚪ | ⚪ | Spanish→PAP |
| 365 | es-pis | Helsinki-NLP/opus-mt-es-pis | windy-pair-es-pis | windy-pair-es-pis-ct2 | ⚪ | ⚪ | ⚪ | Spanish→PIS |
| 366 | es-pl | Helsinki-NLP/opus-mt-es-pl | windy-pair-es-pl | windy-pair-es-pl-ct2 | ⚪ | ⚪ | ⚪ | Spanish→Polish |
| 367 | es-pon | Helsinki-NLP/opus-mt-es-pon | windy-pair-es-pon | windy-pair-es-pon-ct2 | ⚪ | ⚪ | ⚪ | Spanish→PON |
| 368 | es-prl | Helsinki-NLP/opus-mt-es-prl | windy-pair-es-prl | windy-pair-es-prl-ct2 | ⚪ | ⚪ | ⚪ | Spanish→PRL |
| 369 | es-rn | Helsinki-NLP/opus-mt-es-rn | windy-pair-es-rn | windy-pair-es-rn-ct2 | ⚪ | ⚪ | ⚪ | Spanish→RN |
| 370 | es-ro | Helsinki-NLP/opus-mt-es-ro | windy-pair-es-ro | windy-pair-es-ro-ct2 | ⚪ | ⚪ | ⚪ | Spanish→Romanian |
| 371 | es-ru | Helsinki-NLP/opus-mt-es-ru | windy-pair-es-ru | windy-pair-es-ru-ct2 | ⚪ | ⚪ | ⚪ | Spanish→Russian |
| 372 | es-rw | Helsinki-NLP/opus-mt-es-rw | windy-pair-es-rw | windy-pair-es-rw-ct2 | ⚪ | ⚪ | ⚪ | Spanish→Kinyarwanda |
| 373 | es-sg | Helsinki-NLP/opus-mt-es-sg | windy-pair-es-sg | windy-pair-es-sg-ct2 | ⚪ | ⚪ | ⚪ | Spanish→SG |
| 374 | es-sl | Helsinki-NLP/opus-mt-es-sl | windy-pair-es-sl | windy-pair-es-sl-ct2 | ⚪ | ⚪ | ⚪ | Spanish→Slovenian |
| 375 | es-sm | Helsinki-NLP/opus-mt-es-sm | windy-pair-es-sm | windy-pair-es-sm-ct2 | ⚪ | ⚪ | ⚪ | Spanish→Samoan |
| 376 | es-sn | Helsinki-NLP/opus-mt-es-sn | windy-pair-es-sn | windy-pair-es-sn-ct2 | ⚪ | ⚪ | ⚪ | Spanish→Shona |
| 377 | es-srn | Helsinki-NLP/opus-mt-es-srn | windy-pair-es-srn | windy-pair-es-srn-ct2 | ⚪ | ⚪ | ⚪ | Spanish→SRN |
| 378 | es-st | Helsinki-NLP/opus-mt-es-st | windy-pair-es-st | windy-pair-es-st-ct2 | ⚪ | ⚪ | ⚪ | Spanish→Sesotho |
| 379 | es-swc | Helsinki-NLP/opus-mt-es-swc | windy-pair-es-swc | windy-pair-es-swc-ct2 | ⚪ | ⚪ | ⚪ | Spanish→SWC |
| 380 | es-tl | Helsinki-NLP/opus-mt-es-tl | windy-pair-es-tl | windy-pair-es-tl-ct2 | ⚪ | ⚪ | ⚪ | Spanish→Filipino |
| 381 | es-tll | Helsinki-NLP/opus-mt-es-tll | windy-pair-es-tll | windy-pair-es-tll-ct2 | ⚪ | ⚪ | ⚪ | Spanish→TLL |
| 382 | es-uk | Helsinki-NLP/opus-mt-es-uk | windy-pair-es-uk | windy-pair-es-uk-ct2 | ⚪ | ⚪ | ⚪ | Spanish→Ukrainian |
| 383 | es-vi | Helsinki-NLP/opus-mt-es-vi | windy-pair-es-vi | windy-pair-es-vi-ct2 | ⚪ | ⚪ | ⚪ | Spanish→Vietnamese |
| 384 | es-xh | Helsinki-NLP/opus-mt-es-xh | windy-pair-es-xh | windy-pair-es-xh-ct2 | ⚪ | ⚪ | ⚪ | Spanish→Xhosa |
| 385 | es-yo | Helsinki-NLP/opus-mt-es-yo | windy-pair-es-yo | windy-pair-es-yo-ct2 | ⚪ | ⚪ | ⚪ | Spanish→Yoruba |
| 386 | et-de | Helsinki-NLP/opus-mt-et-de | windy-pair-et-de | windy-pair-et-de-ct2 | ⚪ | ⚪ | ⚪ | Estonian→German |
| 387 | et-en | Helsinki-NLP/opus-mt-et-en | windy-pair-et-en | windy-pair-et-en-ct2 | ⚪ | ⚪ | ⚪ | Estonian→English |
| 388 | et-es | Helsinki-NLP/opus-mt-et-es | windy-pair-et-es | windy-pair-et-es-ct2 | ⚪ | ⚪ | ⚪ | Estonian→Spanish |
| 389 | et-fi | Helsinki-NLP/opus-mt-et-fi | windy-pair-et-fi | windy-pair-et-fi-ct2 | ⚪ | ⚪ | ⚪ | Estonian→Finnish |
| 390 | et-fr | Helsinki-NLP/opus-mt-et-fr | windy-pair-et-fr | windy-pair-et-fr-ct2 | ⚪ | ⚪ | ⚪ | Estonian→French |
| 391 | et-ru | Helsinki-NLP/opus-mt-et-ru | windy-pair-et-ru | windy-pair-et-ru-ct2 | ⚪ | ⚪ | ⚪ | Estonian→Russian |
| 392 | et-sv | Helsinki-NLP/opus-mt-et-sv | windy-pair-et-sv | windy-pair-et-sv-ct2 | ⚪ | ⚪ | ⚪ | Estonian→Swedish |
| 393 | eu-de | Helsinki-NLP/opus-mt-eu-de | windy-pair-eu-de | windy-pair-eu-de-ct2 | ⚪ | ⚪ | ⚪ | Basque→German |
| 394 | eu-en | Helsinki-NLP/opus-mt-eu-en | windy-pair-eu-en | windy-pair-eu-en-ct2 | ⚪ | ⚪ | ⚪ | Basque→English |
| 395 | eu-es | Helsinki-NLP/opus-mt-eu-es | windy-pair-eu-es | windy-pair-eu-es-ct2 | ⚪ | ⚪ | ⚪ | Basque→Spanish |
| 396 | eu-ru | Helsinki-NLP/opus-mt-eu-ru | windy-pair-eu-ru | windy-pair-eu-ru-ct2 | ⚪ | ⚪ | ⚪ | Basque→Russian |
| 397 | euq-en | Helsinki-NLP/opus-mt-euq-en | windy-pair-euq-en | windy-pair-euq-en-ct2 | ⚪ | ⚪ | ⚪ | EUQ→English |
| 398 | fi-NORWAY | Helsinki-NLP/opus-mt-fi-NORWAY | windy-pair-fi-NORWAY | windy-pair-fi-NORWAY-ct2 | ⚪ | ⚪ | ⚪ | Finnish→NORWAY |
| 399 | fi-ZH | Helsinki-NLP/opus-mt-fi-ZH | windy-pair-fi-ZH | windy-pair-fi-ZH-ct2 | ⚪ | ⚪ | ⚪ | Finnish→ZH |
| 400 | fi-af | Helsinki-NLP/opus-mt-fi-af | windy-pair-fi-af | windy-pair-fi-af-ct2 | ⚪ | ⚪ | ⚪ | Finnish→Afrikaans |
| 401 | fi-bcl | Helsinki-NLP/opus-mt-fi-bcl | windy-pair-fi-bcl | windy-pair-fi-bcl-ct2 | ⚪ | ⚪ | ⚪ | Finnish→BCL |
| 402 | fi-bem | Helsinki-NLP/opus-mt-fi-bem | windy-pair-fi-bem | windy-pair-fi-bem-ct2 | ⚪ | ⚪ | ⚪ | Finnish→BEM |
| 403 | fi-bg | Helsinki-NLP/opus-mt-fi-bg | windy-pair-fi-bg | windy-pair-fi-bg-ct2 | ⚪ | ⚪ | ⚪ | Finnish→Bulgarian |
| 404 | fi-bzs | Helsinki-NLP/opus-mt-fi-bzs | windy-pair-fi-bzs | windy-pair-fi-bzs-ct2 | ⚪ | ⚪ | ⚪ | Finnish→BZS |
| 405 | fi-ceb | Helsinki-NLP/opus-mt-fi-ceb | windy-pair-fi-ceb | windy-pair-fi-ceb-ct2 | ⚪ | ⚪ | ⚪ | Finnish→CEB |
| 406 | fi-crs | Helsinki-NLP/opus-mt-fi-crs | windy-pair-fi-crs | windy-pair-fi-crs-ct2 | ⚪ | ⚪ | ⚪ | Finnish→CRS |
| 407 | fi-cs | Helsinki-NLP/opus-mt-fi-cs | windy-pair-fi-cs | windy-pair-fi-cs-ct2 | ⚪ | ⚪ | ⚪ | Finnish→Czech |
| 408 | fi-de | Helsinki-NLP/opus-mt-fi-de | windy-pair-fi-de | windy-pair-fi-de-ct2 | ⚪ | ⚪ | ⚪ | Finnish→German |
| 409 | fi-ee | Helsinki-NLP/opus-mt-fi-ee | windy-pair-fi-ee | windy-pair-fi-ee-ct2 | ⚪ | ⚪ | ⚪ | Finnish→EE |
| 410 | fi-efi | Helsinki-NLP/opus-mt-fi-efi | windy-pair-fi-efi | windy-pair-fi-efi-ct2 | ⚪ | ⚪ | ⚪ | Finnish→EFI |
| 411 | fi-el | Helsinki-NLP/opus-mt-fi-el | windy-pair-fi-el | windy-pair-fi-el-ct2 | ⚪ | ⚪ | ⚪ | Finnish→Greek |
| 412 | fi-en | Helsinki-NLP/opus-mt-fi-en | windy-pair-fi-en | windy-pair-fi-en-ct2 | ⚪ | ⚪ | ⚪ | Finnish→English |
| 413 | fi-eo | Helsinki-NLP/opus-mt-fi-eo | windy-pair-fi-eo | windy-pair-fi-eo-ct2 | ⚪ | ⚪ | ⚪ | Finnish→Esperanto |
| 414 | fi-es | Helsinki-NLP/opus-mt-fi-es | windy-pair-fi-es | windy-pair-fi-es-ct2 | ⚪ | ⚪ | ⚪ | Finnish→Spanish |
| 415 | fi-et | Helsinki-NLP/opus-mt-fi-et | windy-pair-fi-et | windy-pair-fi-et-ct2 | ⚪ | ⚪ | ⚪ | Finnish→Estonian |
| 416 | fi-fi | Helsinki-NLP/opus-mt-fi-fi | windy-pair-fi-fi | windy-pair-fi-fi-ct2 | ⚪ | ⚪ | ⚪ | Finnish→Finnish |
| 417 | fi-fj | Helsinki-NLP/opus-mt-fi-fj | windy-pair-fi-fj | windy-pair-fi-fj-ct2 | ⚪ | ⚪ | ⚪ | Finnish→FJ |
| 418 | fi-fr | Helsinki-NLP/opus-mt-fi-fr | windy-pair-fi-fr | windy-pair-fi-fr-ct2 | ⚪ | ⚪ | ⚪ | Finnish→French |
| 419 | fi-fse | Helsinki-NLP/opus-mt-fi-fse | windy-pair-fi-fse | windy-pair-fi-fse-ct2 | ⚪ | ⚪ | ⚪ | Finnish→FSE |
| 420 | fi-gaa | Helsinki-NLP/opus-mt-fi-gaa | windy-pair-fi-gaa | windy-pair-fi-gaa-ct2 | ⚪ | ⚪ | ⚪ | Finnish→GAA |
| 421 | fi-gil | Helsinki-NLP/opus-mt-fi-gil | windy-pair-fi-gil | windy-pair-fi-gil-ct2 | ⚪ | ⚪ | ⚪ | Finnish→GIL |
| 422 | fi-guw | Helsinki-NLP/opus-mt-fi-guw | windy-pair-fi-guw | windy-pair-fi-guw-ct2 | ⚪ | ⚪ | ⚪ | Finnish→GUW |
| 423 | fi-ha | Helsinki-NLP/opus-mt-fi-ha | windy-pair-fi-ha | windy-pair-fi-ha-ct2 | ⚪ | ⚪ | ⚪ | Finnish→Hausa |
| 424 | fi-he | Helsinki-NLP/opus-mt-fi-he | windy-pair-fi-he | windy-pair-fi-he-ct2 | ⚪ | ⚪ | ⚪ | Finnish→Hebrew |
| 425 | fi-hil | Helsinki-NLP/opus-mt-fi-hil | windy-pair-fi-hil | windy-pair-fi-hil-ct2 | ⚪ | ⚪ | ⚪ | Finnish→HIL |
| 426 | fi-ho | Helsinki-NLP/opus-mt-fi-ho | windy-pair-fi-ho | windy-pair-fi-ho-ct2 | ⚪ | ⚪ | ⚪ | Finnish→HO |
| 427 | fi-hr | Helsinki-NLP/opus-mt-fi-hr | windy-pair-fi-hr | windy-pair-fi-hr-ct2 | ⚪ | ⚪ | ⚪ | Finnish→Croatian |
| 428 | fi-ht | Helsinki-NLP/opus-mt-fi-ht | windy-pair-fi-ht | windy-pair-fi-ht-ct2 | ⚪ | ⚪ | ⚪ | Finnish→HT |
| 429 | fi-hu | Helsinki-NLP/opus-mt-fi-hu | windy-pair-fi-hu | windy-pair-fi-hu-ct2 | ⚪ | ⚪ | ⚪ | Finnish→Hungarian |
| 430 | fi-id | Helsinki-NLP/opus-mt-fi-id | windy-pair-fi-id | windy-pair-fi-id-ct2 | ⚪ | ⚪ | ⚪ | Finnish→Indonesian |
| 431 | fi-ig | Helsinki-NLP/opus-mt-fi-ig | windy-pair-fi-ig | windy-pair-fi-ig-ct2 | ⚪ | ⚪ | ⚪ | Finnish→Igbo |
| 432 | fi-ilo | Helsinki-NLP/opus-mt-fi-ilo | windy-pair-fi-ilo | windy-pair-fi-ilo-ct2 | ⚪ | ⚪ | ⚪ | Finnish→ILO |
| 433 | fi-is | Helsinki-NLP/opus-mt-fi-is | windy-pair-fi-is | windy-pair-fi-is-ct2 | ⚪ | ⚪ | ⚪ | Finnish→Icelandic |
| 434 | fi-iso | Helsinki-NLP/opus-mt-fi-iso | windy-pair-fi-iso | windy-pair-fi-iso-ct2 | ⚪ | ⚪ | ⚪ | Finnish→ISO |
| 435 | fi-it | Helsinki-NLP/opus-mt-fi-it | windy-pair-fi-it | windy-pair-fi-it-ct2 | ⚪ | ⚪ | ⚪ | Finnish→Italian |
| 436 | fi-kg | Helsinki-NLP/opus-mt-fi-kg | windy-pair-fi-kg | windy-pair-fi-kg-ct2 | ⚪ | ⚪ | ⚪ | Finnish→KG |
| 437 | fi-kqn | Helsinki-NLP/opus-mt-fi-kqn | windy-pair-fi-kqn | windy-pair-fi-kqn-ct2 | ⚪ | ⚪ | ⚪ | Finnish→KQN |
| 438 | fi-lg | Helsinki-NLP/opus-mt-fi-lg | windy-pair-fi-lg | windy-pair-fi-lg-ct2 | ⚪ | ⚪ | ⚪ | Finnish→LG |
| 439 | fi-ln | Helsinki-NLP/opus-mt-fi-ln | windy-pair-fi-ln | windy-pair-fi-ln-ct2 | ⚪ | ⚪ | ⚪ | Finnish→LN |
| 440 | fi-lu | Helsinki-NLP/opus-mt-fi-lu | windy-pair-fi-lu | windy-pair-fi-lu-ct2 | ⚪ | ⚪ | ⚪ | Finnish→LU |
| 441 | fi-lua | Helsinki-NLP/opus-mt-fi-lua | windy-pair-fi-lua | windy-pair-fi-lua-ct2 | ⚪ | ⚪ | ⚪ | Finnish→LUA |
| 442 | fi-lue | Helsinki-NLP/opus-mt-fi-lue | windy-pair-fi-lue | windy-pair-fi-lue-ct2 | ⚪ | ⚪ | ⚪ | Finnish→LUE |
| 443 | fi-lus | Helsinki-NLP/opus-mt-fi-lus | windy-pair-fi-lus | windy-pair-fi-lus-ct2 | ⚪ | ⚪ | ⚪ | Finnish→LUS |
| 444 | fi-lv | Helsinki-NLP/opus-mt-fi-lv | windy-pair-fi-lv | windy-pair-fi-lv-ct2 | ⚪ | ⚪ | ⚪ | Finnish→Latvian |
| 445 | fi-mfe | Helsinki-NLP/opus-mt-fi-mfe | windy-pair-fi-mfe | windy-pair-fi-mfe-ct2 | ⚪ | ⚪ | ⚪ | Finnish→MFE |
| 446 | fi-mg | Helsinki-NLP/opus-mt-fi-mg | windy-pair-fi-mg | windy-pair-fi-mg-ct2 | ⚪ | ⚪ | ⚪ | Finnish→Malagasy |
| 447 | fi-mh | Helsinki-NLP/opus-mt-fi-mh | windy-pair-fi-mh | windy-pair-fi-mh-ct2 | ⚪ | ⚪ | ⚪ | Finnish→MH |
| 448 | fi-mk | Helsinki-NLP/opus-mt-fi-mk | windy-pair-fi-mk | windy-pair-fi-mk-ct2 | ⚪ | ⚪ | ⚪ | Finnish→Macedonian |
| 449 | fi-mos | Helsinki-NLP/opus-mt-fi-mos | windy-pair-fi-mos | windy-pair-fi-mos-ct2 | ⚪ | ⚪ | ⚪ | Finnish→MOS |
| 450 | fi-mt | Helsinki-NLP/opus-mt-fi-mt | windy-pair-fi-mt | windy-pair-fi-mt-ct2 | ⚪ | ⚪ | ⚪ | Finnish→Maltese |
| 451 | fi-niu | Helsinki-NLP/opus-mt-fi-niu | windy-pair-fi-niu | windy-pair-fi-niu-ct2 | ⚪ | ⚪ | ⚪ | Finnish→NIU |
| 452 | fi-nl | Helsinki-NLP/opus-mt-fi-nl | windy-pair-fi-nl | windy-pair-fi-nl-ct2 | ⚪ | ⚪ | ⚪ | Finnish→Dutch |
| 453 | fi-no | Helsinki-NLP/opus-mt-fi-no | windy-pair-fi-no | windy-pair-fi-no-ct2 | ⚪ | ⚪ | ⚪ | Finnish→Norwegian |
| 454 | fi-nso | Helsinki-NLP/opus-mt-fi-nso | windy-pair-fi-nso | windy-pair-fi-nso-ct2 | ⚪ | ⚪ | ⚪ | Finnish→NSO |
| 455 | fi-ny | Helsinki-NLP/opus-mt-fi-ny | windy-pair-fi-ny | windy-pair-fi-ny-ct2 | ⚪ | ⚪ | ⚪ | Finnish→Chichewa |
| 456 | fi-pag | Helsinki-NLP/opus-mt-fi-pag | windy-pair-fi-pag | windy-pair-fi-pag-ct2 | ⚪ | ⚪ | ⚪ | Finnish→PAG |
| 457 | fi-pap | Helsinki-NLP/opus-mt-fi-pap | windy-pair-fi-pap | windy-pair-fi-pap-ct2 | ⚪ | ⚪ | ⚪ | Finnish→PAP |
| 458 | fi-pis | Helsinki-NLP/opus-mt-fi-pis | windy-pair-fi-pis | windy-pair-fi-pis-ct2 | ⚪ | ⚪ | ⚪ | Finnish→PIS |
| 459 | fi-pon | Helsinki-NLP/opus-mt-fi-pon | windy-pair-fi-pon | windy-pair-fi-pon-ct2 | ⚪ | ⚪ | ⚪ | Finnish→PON |
| 460 | fi-ro | Helsinki-NLP/opus-mt-fi-ro | windy-pair-fi-ro | windy-pair-fi-ro-ct2 | ⚪ | ⚪ | ⚪ | Finnish→Romanian |
| 461 | fi-ru | Helsinki-NLP/opus-mt-fi-ru | windy-pair-fi-ru | windy-pair-fi-ru-ct2 | ⚪ | ⚪ | ⚪ | Finnish→Russian |
| 462 | fi-run | Helsinki-NLP/opus-mt-fi-run | windy-pair-fi-run | windy-pair-fi-run-ct2 | ⚪ | ⚪ | ⚪ | Finnish→RUN |
| 463 | fi-rw | Helsinki-NLP/opus-mt-fi-rw | windy-pair-fi-rw | windy-pair-fi-rw-ct2 | ⚪ | ⚪ | ⚪ | Finnish→Kinyarwanda |
| 464 | fi-sg | Helsinki-NLP/opus-mt-fi-sg | windy-pair-fi-sg | windy-pair-fi-sg-ct2 | ⚪ | ⚪ | ⚪ | Finnish→SG |
| 465 | fi-sk | Helsinki-NLP/opus-mt-fi-sk | windy-pair-fi-sk | windy-pair-fi-sk-ct2 | ⚪ | ⚪ | ⚪ | Finnish→Slovak |
| 466 | fi-sl | Helsinki-NLP/opus-mt-fi-sl | windy-pair-fi-sl | windy-pair-fi-sl-ct2 | ⚪ | ⚪ | ⚪ | Finnish→Slovenian |
| 467 | fi-sm | Helsinki-NLP/opus-mt-fi-sm | windy-pair-fi-sm | windy-pair-fi-sm-ct2 | ⚪ | ⚪ | ⚪ | Finnish→Samoan |
| 468 | fi-sn | Helsinki-NLP/opus-mt-fi-sn | windy-pair-fi-sn | windy-pair-fi-sn-ct2 | ⚪ | ⚪ | ⚪ | Finnish→Shona |
| 469 | fi-sq | Helsinki-NLP/opus-mt-fi-sq | windy-pair-fi-sq | windy-pair-fi-sq-ct2 | ⚪ | ⚪ | ⚪ | Finnish→Albanian |
| 470 | fi-srn | Helsinki-NLP/opus-mt-fi-srn | windy-pair-fi-srn | windy-pair-fi-srn-ct2 | ⚪ | ⚪ | ⚪ | Finnish→SRN |
| 471 | fi-st | Helsinki-NLP/opus-mt-fi-st | windy-pair-fi-st | windy-pair-fi-st-ct2 | ⚪ | ⚪ | ⚪ | Finnish→Sesotho |
| 472 | fi-sv | Helsinki-NLP/opus-mt-fi-sv | windy-pair-fi-sv | windy-pair-fi-sv-ct2 | ⚪ | ⚪ | ⚪ | Finnish→Swedish |
| 473 | fi-sw | Helsinki-NLP/opus-mt-fi-sw | windy-pair-fi-sw | windy-pair-fi-sw-ct2 | ⚪ | ⚪ | ⚪ | Finnish→Swahili |
| 474 | fi-swc | Helsinki-NLP/opus-mt-fi-swc | windy-pair-fi-swc | windy-pair-fi-swc-ct2 | ⚪ | ⚪ | ⚪ | Finnish→SWC |
| 475 | fi-tiv | Helsinki-NLP/opus-mt-fi-tiv | windy-pair-fi-tiv | windy-pair-fi-tiv-ct2 | ⚪ | ⚪ | ⚪ | Finnish→TIV |
| 476 | fi-tll | Helsinki-NLP/opus-mt-fi-tll | windy-pair-fi-tll | windy-pair-fi-tll-ct2 | ⚪ | ⚪ | ⚪ | Finnish→TLL |
| 477 | fi-tn | Helsinki-NLP/opus-mt-fi-tn | windy-pair-fi-tn | windy-pair-fi-tn-ct2 | ⚪ | ⚪ | ⚪ | Finnish→TN |
| 478 | fi-to | Helsinki-NLP/opus-mt-fi-to | windy-pair-fi-to | windy-pair-fi-to-ct2 | ⚪ | ⚪ | ⚪ | Finnish→TO |
| 479 | fi-tr | Helsinki-NLP/opus-mt-fi-tr | windy-pair-fi-tr | windy-pair-fi-tr-ct2 | ⚪ | ⚪ | ⚪ | Finnish→Turkish |
| 480 | fi-uk | Helsinki-NLP/opus-mt-fi-uk | windy-pair-fi-uk | windy-pair-fi-uk-ct2 | ⚪ | ⚪ | ⚪ | Finnish→Ukrainian |
| 481 | fi-xh | Helsinki-NLP/opus-mt-fi-xh | windy-pair-fi-xh | windy-pair-fi-xh-ct2 | ⚪ | ⚪ | ⚪ | Finnish→Xhosa |
| 482 | fi-yo | Helsinki-NLP/opus-mt-fi-yo | windy-pair-fi-yo | windy-pair-fi-yo-ct2 | ⚪ | ⚪ | ⚪ | Finnish→Yoruba |
| 483 | fi_nb_no_nn_ru_sv_en-SAMI | Helsinki-NLP/opus-mt-fi_nb_no_nn_ru_sv_en-SAMI | windy-pair-fi_nb_no_nn_ru_sv_en-SAMI | windy-pair-fi_nb_no_nn_ru_sv_en-SAMI-ct2 | ⚪ | ⚪ | ⚪ | FI_NB_NO_NN_RU_SV_EN→SAMI |
| 484 | fiu-en | Helsinki-NLP/opus-mt-fiu-en | windy-pair-fiu-en | windy-pair-fiu-en-ct2 | ⚪ | ⚪ | ⚪ | FIU→English |
| 485 | fiu-fiu | Helsinki-NLP/opus-mt-fiu-fiu | windy-pair-fiu-fiu | windy-pair-fiu-fiu-ct2 | ⚪ | ⚪ | ⚪ | FIU→FIU |
| 486 | fj-fr | Helsinki-NLP/opus-mt-fj-fr | windy-pair-fj-fr | windy-pair-fj-fr-ct2 | ⚪ | ⚪ | ⚪ | FJ→French |
| 487 | fr-af | Helsinki-NLP/opus-mt-fr-af | windy-pair-fr-af | windy-pair-fr-af-ct2 | ⚪ | ⚪ | ⚪ | French→Afrikaans |
| 488 | fr-ar | Helsinki-NLP/opus-mt-fr-ar | windy-pair-fr-ar | windy-pair-fr-ar-ct2 | ⚪ | ⚪ | ⚪ | French→Arabic |
| 489 | fr-ase | Helsinki-NLP/opus-mt-fr-ase | windy-pair-fr-ase | windy-pair-fr-ase-ct2 | ⚪ | ⚪ | ⚪ | French→ASE |
| 490 | fr-bcl | Helsinki-NLP/opus-mt-fr-bcl | windy-pair-fr-bcl | windy-pair-fr-bcl-ct2 | ⚪ | ⚪ | ⚪ | French→BCL |
| 491 | fr-bem | Helsinki-NLP/opus-mt-fr-bem | windy-pair-fr-bem | windy-pair-fr-bem-ct2 | ⚪ | ⚪ | ⚪ | French→BEM |
| 492 | fr-ber | Helsinki-NLP/opus-mt-fr-ber | windy-pair-fr-ber | windy-pair-fr-ber-ct2 | ⚪ | ⚪ | ⚪ | French→BER |
| 493 | fr-bg | Helsinki-NLP/opus-mt-fr-bg | windy-pair-fr-bg | windy-pair-fr-bg-ct2 | ⚪ | ⚪ | ⚪ | French→Bulgarian |
| 494 | fr-bi | Helsinki-NLP/opus-mt-fr-bi | windy-pair-fr-bi | windy-pair-fr-bi-ct2 | ⚪ | ⚪ | ⚪ | French→BI |
| 495 | fr-bzs | Helsinki-NLP/opus-mt-fr-bzs | windy-pair-fr-bzs | windy-pair-fr-bzs-ct2 | ⚪ | ⚪ | ⚪ | French→BZS |
| 496 | fr-ca | Helsinki-NLP/opus-mt-fr-ca | windy-pair-fr-ca | windy-pair-fr-ca-ct2 | ⚪ | ⚪ | ⚪ | French→Catalan |
| 497 | fr-ceb | Helsinki-NLP/opus-mt-fr-ceb | windy-pair-fr-ceb | windy-pair-fr-ceb-ct2 | ⚪ | ⚪ | ⚪ | French→CEB |
| 498 | fr-crs | Helsinki-NLP/opus-mt-fr-crs | windy-pair-fr-crs | windy-pair-fr-crs-ct2 | ⚪ | ⚪ | ⚪ | French→CRS |
| 499 | fr-de | Helsinki-NLP/opus-mt-fr-de | windy-pair-fr-de | windy-pair-fr-de-ct2 | ⚪ | ⚪ | ⚪ | French→German |
| 500 | fr-ee | Helsinki-NLP/opus-mt-fr-ee | windy-pair-fr-ee | windy-pair-fr-ee-ct2 | ⚪ | ⚪ | ⚪ | French→EE |
| 501 | fr-efi | Helsinki-NLP/opus-mt-fr-efi | windy-pair-fr-efi | windy-pair-fr-efi-ct2 | ⚪ | ⚪ | ⚪ | French→EFI |
| 502 | fr-el | Helsinki-NLP/opus-mt-fr-el | windy-pair-fr-el | windy-pair-fr-el-ct2 | ⚪ | ⚪ | ⚪ | French→Greek |
| 503 | fr-eo | Helsinki-NLP/opus-mt-fr-eo | windy-pair-fr-eo | windy-pair-fr-eo-ct2 | ⚪ | ⚪ | ⚪ | French→Esperanto |
| 504 | fr-es | Helsinki-NLP/opus-mt-fr-es | windy-pair-fr-es | windy-pair-fr-es-ct2 | ⚪ | ⚪ | ⚪ | French→Spanish |
| 505 | fr-fj | Helsinki-NLP/opus-mt-fr-fj | windy-pair-fr-fj | windy-pair-fr-fj-ct2 | ⚪ | ⚪ | ⚪ | French→FJ |
| 506 | fr-gaa | Helsinki-NLP/opus-mt-fr-gaa | windy-pair-fr-gaa | windy-pair-fr-gaa-ct2 | ⚪ | ⚪ | ⚪ | French→GAA |
| 507 | fr-gil | Helsinki-NLP/opus-mt-fr-gil | windy-pair-fr-gil | windy-pair-fr-gil-ct2 | ⚪ | ⚪ | ⚪ | French→GIL |
| 508 | fr-guw | Helsinki-NLP/opus-mt-fr-guw | windy-pair-fr-guw | windy-pair-fr-guw-ct2 | ⚪ | ⚪ | ⚪ | French→GUW |
| 509 | fr-ha | Helsinki-NLP/opus-mt-fr-ha | windy-pair-fr-ha | windy-pair-fr-ha-ct2 | ⚪ | ⚪ | ⚪ | French→Hausa |
| 510 | fr-he | Helsinki-NLP/opus-mt-fr-he | windy-pair-fr-he | windy-pair-fr-he-ct2 | ⚪ | ⚪ | ⚪ | French→Hebrew |
| 511 | fr-hil | Helsinki-NLP/opus-mt-fr-hil | windy-pair-fr-hil | windy-pair-fr-hil-ct2 | ⚪ | ⚪ | ⚪ | French→HIL |
| 512 | fr-ho | Helsinki-NLP/opus-mt-fr-ho | windy-pair-fr-ho | windy-pair-fr-ho-ct2 | ⚪ | ⚪ | ⚪ | French→HO |
| 513 | fr-hr | Helsinki-NLP/opus-mt-fr-hr | windy-pair-fr-hr | windy-pair-fr-hr-ct2 | ⚪ | ⚪ | ⚪ | French→Croatian |
| 514 | fr-ht | Helsinki-NLP/opus-mt-fr-ht | windy-pair-fr-ht | windy-pair-fr-ht-ct2 | ⚪ | ⚪ | ⚪ | French→HT |
| 515 | fr-hu | Helsinki-NLP/opus-mt-fr-hu | windy-pair-fr-hu | windy-pair-fr-hu-ct2 | ⚪ | ⚪ | ⚪ | French→Hungarian |
| 516 | fr-id | Helsinki-NLP/opus-mt-fr-id | windy-pair-fr-id | windy-pair-fr-id-ct2 | ⚪ | ⚪ | ⚪ | French→Indonesian |
| 517 | fr-ig | Helsinki-NLP/opus-mt-fr-ig | windy-pair-fr-ig | windy-pair-fr-ig-ct2 | ⚪ | ⚪ | ⚪ | French→Igbo |
| 518 | fr-ilo | Helsinki-NLP/opus-mt-fr-ilo | windy-pair-fr-ilo | windy-pair-fr-ilo-ct2 | ⚪ | ⚪ | ⚪ | French→ILO |
| 519 | fr-iso | Helsinki-NLP/opus-mt-fr-iso | windy-pair-fr-iso | windy-pair-fr-iso-ct2 | ⚪ | ⚪ | ⚪ | French→ISO |
| 520 | fr-kg | Helsinki-NLP/opus-mt-fr-kg | windy-pair-fr-kg | windy-pair-fr-kg-ct2 | ⚪ | ⚪ | ⚪ | French→KG |
| 521 | fr-kqn | Helsinki-NLP/opus-mt-fr-kqn | windy-pair-fr-kqn | windy-pair-fr-kqn-ct2 | ⚪ | ⚪ | ⚪ | French→KQN |
| 522 | fr-kwy | Helsinki-NLP/opus-mt-fr-kwy | windy-pair-fr-kwy | windy-pair-fr-kwy-ct2 | ⚪ | ⚪ | ⚪ | French→KWY |
| 523 | fr-lg | Helsinki-NLP/opus-mt-fr-lg | windy-pair-fr-lg | windy-pair-fr-lg-ct2 | ⚪ | ⚪ | ⚪ | French→LG |
| 524 | fr-ln | Helsinki-NLP/opus-mt-fr-ln | windy-pair-fr-ln | windy-pair-fr-ln-ct2 | ⚪ | ⚪ | ⚪ | French→LN |
| 525 | fr-loz | Helsinki-NLP/opus-mt-fr-loz | windy-pair-fr-loz | windy-pair-fr-loz-ct2 | ⚪ | ⚪ | ⚪ | French→LOZ |
| 526 | fr-lu | Helsinki-NLP/opus-mt-fr-lu | windy-pair-fr-lu | windy-pair-fr-lu-ct2 | ⚪ | ⚪ | ⚪ | French→LU |
| 527 | fr-lua | Helsinki-NLP/opus-mt-fr-lua | windy-pair-fr-lua | windy-pair-fr-lua-ct2 | ⚪ | ⚪ | ⚪ | French→LUA |
| 528 | fr-lue | Helsinki-NLP/opus-mt-fr-lue | windy-pair-fr-lue | windy-pair-fr-lue-ct2 | ⚪ | ⚪ | ⚪ | French→LUE |
| 529 | fr-lus | Helsinki-NLP/opus-mt-fr-lus | windy-pair-fr-lus | windy-pair-fr-lus-ct2 | ⚪ | ⚪ | ⚪ | French→LUS |
| 530 | fr-mfe | Helsinki-NLP/opus-mt-fr-mfe | windy-pair-fr-mfe | windy-pair-fr-mfe-ct2 | ⚪ | ⚪ | ⚪ | French→MFE |
| 531 | fr-mh | Helsinki-NLP/opus-mt-fr-mh | windy-pair-fr-mh | windy-pair-fr-mh-ct2 | ⚪ | ⚪ | ⚪ | French→MH |
| 532 | fr-mos | Helsinki-NLP/opus-mt-fr-mos | windy-pair-fr-mos | windy-pair-fr-mos-ct2 | ⚪ | ⚪ | ⚪ | French→MOS |
| 533 | fr-ms | Helsinki-NLP/opus-mt-fr-ms | windy-pair-fr-ms | windy-pair-fr-ms-ct2 | ⚪ | ⚪ | ⚪ | French→Malay |
| 534 | fr-mt | Helsinki-NLP/opus-mt-fr-mt | windy-pair-fr-mt | windy-pair-fr-mt-ct2 | ⚪ | ⚪ | ⚪ | French→Maltese |
| 535 | fr-niu | Helsinki-NLP/opus-mt-fr-niu | windy-pair-fr-niu | windy-pair-fr-niu-ct2 | ⚪ | ⚪ | ⚪ | French→NIU |
| 536 | fr-no | Helsinki-NLP/opus-mt-fr-no | windy-pair-fr-no | windy-pair-fr-no-ct2 | ⚪ | ⚪ | ⚪ | French→Norwegian |
| 537 | fr-nso | Helsinki-NLP/opus-mt-fr-nso | windy-pair-fr-nso | windy-pair-fr-nso-ct2 | ⚪ | ⚪ | ⚪ | French→NSO |
| 538 | fr-ny | Helsinki-NLP/opus-mt-fr-ny | windy-pair-fr-ny | windy-pair-fr-ny-ct2 | ⚪ | ⚪ | ⚪ | French→Chichewa |
| 539 | fr-pag | Helsinki-NLP/opus-mt-fr-pag | windy-pair-fr-pag | windy-pair-fr-pag-ct2 | ⚪ | ⚪ | ⚪ | French→PAG |
| 540 | fr-pap | Helsinki-NLP/opus-mt-fr-pap | windy-pair-fr-pap | windy-pair-fr-pap-ct2 | ⚪ | ⚪ | ⚪ | French→PAP |
| 541 | fr-pis | Helsinki-NLP/opus-mt-fr-pis | windy-pair-fr-pis | windy-pair-fr-pis-ct2 | ⚪ | ⚪ | ⚪ | French→PIS |
| 542 | fr-pl | Helsinki-NLP/opus-mt-fr-pl | windy-pair-fr-pl | windy-pair-fr-pl-ct2 | ⚪ | ⚪ | ⚪ | French→Polish |
| 543 | fr-pon | Helsinki-NLP/opus-mt-fr-pon | windy-pair-fr-pon | windy-pair-fr-pon-ct2 | ⚪ | ⚪ | ⚪ | French→PON |
| 544 | fr-rnd | Helsinki-NLP/opus-mt-fr-rnd | windy-pair-fr-rnd | windy-pair-fr-rnd-ct2 | ⚪ | ⚪ | ⚪ | French→RND |
| 545 | fr-ro | Helsinki-NLP/opus-mt-fr-ro | windy-pair-fr-ro | windy-pair-fr-ro-ct2 | ⚪ | ⚪ | ⚪ | French→Romanian |
| 546 | fr-ru | Helsinki-NLP/opus-mt-fr-ru | windy-pair-fr-ru | windy-pair-fr-ru-ct2 | ⚪ | ⚪ | ⚪ | French→Russian |
| 547 | fr-run | Helsinki-NLP/opus-mt-fr-run | windy-pair-fr-run | windy-pair-fr-run-ct2 | ⚪ | ⚪ | ⚪ | French→RUN |
| 548 | fr-rw | Helsinki-NLP/opus-mt-fr-rw | windy-pair-fr-rw | windy-pair-fr-rw-ct2 | ⚪ | ⚪ | ⚪ | French→Kinyarwanda |
| 549 | fr-sg | Helsinki-NLP/opus-mt-fr-sg | windy-pair-fr-sg | windy-pair-fr-sg-ct2 | ⚪ | ⚪ | ⚪ | French→SG |
| 550 | fr-sk | Helsinki-NLP/opus-mt-fr-sk | windy-pair-fr-sk | windy-pair-fr-sk-ct2 | ⚪ | ⚪ | ⚪ | French→Slovak |
| 551 | fr-sl | Helsinki-NLP/opus-mt-fr-sl | windy-pair-fr-sl | windy-pair-fr-sl-ct2 | ⚪ | ⚪ | ⚪ | French→Slovenian |
| 552 | fr-sm | Helsinki-NLP/opus-mt-fr-sm | windy-pair-fr-sm | windy-pair-fr-sm-ct2 | ⚪ | ⚪ | ⚪ | French→Samoan |
| 553 | fr-sn | Helsinki-NLP/opus-mt-fr-sn | windy-pair-fr-sn | windy-pair-fr-sn-ct2 | ⚪ | ⚪ | ⚪ | French→Shona |
| 554 | fr-srn | Helsinki-NLP/opus-mt-fr-srn | windy-pair-fr-srn | windy-pair-fr-srn-ct2 | ⚪ | ⚪ | ⚪ | French→SRN |
| 555 | fr-st | Helsinki-NLP/opus-mt-fr-st | windy-pair-fr-st | windy-pair-fr-st-ct2 | ⚪ | ⚪ | ⚪ | French→Sesotho |
| 556 | fr-sv | Helsinki-NLP/opus-mt-fr-sv | windy-pair-fr-sv | windy-pair-fr-sv-ct2 | ⚪ | ⚪ | ⚪ | French→Swedish |
| 557 | fr-swc | Helsinki-NLP/opus-mt-fr-swc | windy-pair-fr-swc | windy-pair-fr-swc-ct2 | ⚪ | ⚪ | ⚪ | French→SWC |
| 558 | fr-tiv | Helsinki-NLP/opus-mt-fr-tiv | windy-pair-fr-tiv | windy-pair-fr-tiv-ct2 | ⚪ | ⚪ | ⚪ | French→TIV |
| 559 | fr-tl | Helsinki-NLP/opus-mt-fr-tl | windy-pair-fr-tl | windy-pair-fr-tl-ct2 | ⚪ | ⚪ | ⚪ | French→Filipino |
| 560 | fr-tll | Helsinki-NLP/opus-mt-fr-tll | windy-pair-fr-tll | windy-pair-fr-tll-ct2 | ⚪ | ⚪ | ⚪ | French→TLL |
| 561 | fr-uk | Helsinki-NLP/opus-mt-fr-uk | windy-pair-fr-uk | windy-pair-fr-uk-ct2 | ⚪ | ⚪ | ⚪ | French→Ukrainian |
| 562 | fr-vi | Helsinki-NLP/opus-mt-fr-vi | windy-pair-fr-vi | windy-pair-fr-vi-ct2 | ⚪ | ⚪ | ⚪ | French→Vietnamese |
| 563 | fr-xh | Helsinki-NLP/opus-mt-fr-xh | windy-pair-fr-xh | windy-pair-fr-xh-ct2 | ⚪ | ⚪ | ⚪ | French→Xhosa |
| 564 | fr-yo | Helsinki-NLP/opus-mt-fr-yo | windy-pair-fr-yo | windy-pair-fr-yo-ct2 | ⚪ | ⚪ | ⚪ | French→Yoruba |
| 565 | gaa-de | Helsinki-NLP/opus-mt-gaa-de | windy-pair-gaa-de | windy-pair-gaa-de-ct2 | ⚪ | ⚪ | ⚪ | GAA→German |
| 566 | gaa-sv | Helsinki-NLP/opus-mt-gaa-sv | windy-pair-gaa-sv | windy-pair-gaa-sv-ct2 | ⚪ | ⚪ | ⚪ | GAA→Swedish |
| 567 | gem-en | Helsinki-NLP/opus-mt-gem-en | windy-pair-gem-en | windy-pair-gem-en-ct2 | ⚪ | ⚪ | ⚪ | GEM→English |
| 568 | gem-gem | Helsinki-NLP/opus-mt-gem-gem | windy-pair-gem-gem | windy-pair-gem-gem-ct2 | ⚪ | ⚪ | ⚪ | GEM→GEM |
| 569 | gil-sv | Helsinki-NLP/opus-mt-gil-sv | windy-pair-gil-sv | windy-pair-gil-sv-ct2 | ⚪ | ⚪ | ⚪ | GIL→Swedish |
| 570 | gl-en | Helsinki-NLP/opus-mt-gl-en | windy-pair-gl-en | windy-pair-gl-en-ct2 | ⚪ | ⚪ | ⚪ | Galician→English |
| 571 | gl-es | Helsinki-NLP/opus-mt-gl-es | windy-pair-gl-es | windy-pair-gl-es-ct2 | ⚪ | ⚪ | ⚪ | Galician→Spanish |
| 572 | gl-pt | Helsinki-NLP/opus-mt-gl-pt | windy-pair-gl-pt | windy-pair-gl-pt-ct2 | ⚪ | ⚪ | ⚪ | Galician→Portuguese |
| 573 | gmq-en | Helsinki-NLP/opus-mt-gmq-en | windy-pair-gmq-en | windy-pair-gmq-en-ct2 | ⚪ | ⚪ | ⚪ | GMQ→English |
| 574 | gmq-gmq | Helsinki-NLP/opus-mt-gmq-gmq | windy-pair-gmq-gmq | windy-pair-gmq-gmq-ct2 | ⚪ | ⚪ | ⚪ | GMQ→GMQ |
| 575 | grk-en | Helsinki-NLP/opus-mt-grk-en | windy-pair-grk-en | windy-pair-grk-en-ct2 | ⚪ | ⚪ | ⚪ | GRK→English |
| 576 | guw-de | Helsinki-NLP/opus-mt-guw-de | windy-pair-guw-de | windy-pair-guw-de-ct2 | ⚪ | ⚪ | ⚪ | GUW→German |
| 577 | guw-sv | Helsinki-NLP/opus-mt-guw-sv | windy-pair-guw-sv | windy-pair-guw-sv-ct2 | ⚪ | ⚪ | ⚪ | GUW→Swedish |
| 578 | ha-en | Helsinki-NLP/opus-mt-ha-en | windy-pair-ha-en | windy-pair-ha-en-ct2 | ⚪ | ⚪ | ⚪ | Hausa→English |
| 579 | ha-es | Helsinki-NLP/opus-mt-ha-es | windy-pair-ha-es | windy-pair-ha-es-ct2 | ⚪ | ⚪ | ⚪ | Hausa→Spanish |
| 580 | ha-fi | Helsinki-NLP/opus-mt-ha-fi | windy-pair-ha-fi | windy-pair-ha-fi-ct2 | ⚪ | ⚪ | ⚪ | Hausa→Finnish |
| 581 | ha-fr | Helsinki-NLP/opus-mt-ha-fr | windy-pair-ha-fr | windy-pair-ha-fr-ct2 | ⚪ | ⚪ | ⚪ | Hausa→French |
| 582 | ha-sv | Helsinki-NLP/opus-mt-ha-sv | windy-pair-ha-sv | windy-pair-ha-sv-ct2 | ⚪ | ⚪ | ⚪ | Hausa→Swedish |
| 583 | he-ar | Helsinki-NLP/opus-mt-he-ar | windy-pair-he-ar | windy-pair-he-ar-ct2 | ⚪ | ⚪ | ⚪ | Hebrew→Arabic |
| 584 | he-de | Helsinki-NLP/opus-mt-he-de | windy-pair-he-de | windy-pair-he-de-ct2 | ⚪ | ⚪ | ⚪ | Hebrew→German |
| 585 | he-it | Helsinki-NLP/opus-mt-he-it | windy-pair-he-it | windy-pair-he-it-ct2 | ⚪ | ⚪ | ⚪ | Hebrew→Italian |
| 586 | he-ru | Helsinki-NLP/opus-mt-he-ru | windy-pair-he-ru | windy-pair-he-ru-ct2 | ⚪ | ⚪ | ⚪ | Hebrew→Russian |
| 587 | he-sv | Helsinki-NLP/opus-mt-he-sv | windy-pair-he-sv | windy-pair-he-sv-ct2 | ⚪ | ⚪ | ⚪ | Hebrew→Swedish |
| 588 | he-uk | Helsinki-NLP/opus-mt-he-uk | windy-pair-he-uk | windy-pair-he-uk-ct2 | ⚪ | ⚪ | ⚪ | Hebrew→Ukrainian |
| 589 | hi-ur | Helsinki-NLP/opus-mt-hi-ur | windy-pair-hi-ur | windy-pair-hi-ur-ct2 | ⚪ | ⚪ | ⚪ | Hindi→Urdu |
| 590 | hil-de | Helsinki-NLP/opus-mt-hil-de | windy-pair-hil-de | windy-pair-hil-de-ct2 | ⚪ | ⚪ | ⚪ | HIL→German |
| 591 | hil-en | Helsinki-NLP/opus-mt-hil-en | windy-pair-hil-en | windy-pair-hil-en-ct2 | ⚪ | ⚪ | ⚪ | HIL→English |
| 592 | hil-fi | Helsinki-NLP/opus-mt-hil-fi | windy-pair-hil-fi | windy-pair-hil-fi-ct2 | ⚪ | ⚪ | ⚪ | HIL→Finnish |
| 593 | hr-es | Helsinki-NLP/opus-mt-hr-es | windy-pair-hr-es | windy-pair-hr-es-ct2 | ⚪ | ⚪ | ⚪ | Croatian→Spanish |
| 594 | hr-fi | Helsinki-NLP/opus-mt-hr-fi | windy-pair-hr-fi | windy-pair-hr-fi-ct2 | ⚪ | ⚪ | ⚪ | Croatian→Finnish |
| 595 | hr-fr | Helsinki-NLP/opus-mt-hr-fr | windy-pair-hr-fr | windy-pair-hr-fr-ct2 | ⚪ | ⚪ | ⚪ | Croatian→French |
| 596 | hr-sv | Helsinki-NLP/opus-mt-hr-sv | windy-pair-hr-sv | windy-pair-hr-sv-ct2 | ⚪ | ⚪ | ⚪ | Croatian→Swedish |
| 597 | ht-sv | Helsinki-NLP/opus-mt-ht-sv | windy-pair-ht-sv | windy-pair-ht-sv-ct2 | ⚪ | ⚪ | ⚪ | HT→Swedish |
| 598 | hu-de | Helsinki-NLP/opus-mt-hu-de | windy-pair-hu-de | windy-pair-hu-de-ct2 | ⚪ | ⚪ | ⚪ | Hungarian→German |
| 599 | hu-en | Helsinki-NLP/opus-mt-hu-en | windy-pair-hu-en | windy-pair-hu-en-ct2 | ⚪ | ⚪ | ⚪ | Hungarian→English |
| 600 | hu-eo | Helsinki-NLP/opus-mt-hu-eo | windy-pair-hu-eo | windy-pair-hu-eo-ct2 | ⚪ | ⚪ | ⚪ | Hungarian→Esperanto |
| 601 | hu-fi | Helsinki-NLP/opus-mt-hu-fi | windy-pair-hu-fi | windy-pair-hu-fi-ct2 | ⚪ | ⚪ | ⚪ | Hungarian→Finnish |
| 602 | hu-fr | Helsinki-NLP/opus-mt-hu-fr | windy-pair-hu-fr | windy-pair-hu-fr-ct2 | ⚪ | ⚪ | ⚪ | Hungarian→French |
| 603 | hu-sv | Helsinki-NLP/opus-mt-hu-sv | windy-pair-hu-sv | windy-pair-hu-sv-ct2 | ⚪ | ⚪ | ⚪ | Hungarian→Swedish |
| 604 | hu-uk | Helsinki-NLP/opus-mt-hu-uk | windy-pair-hu-uk | windy-pair-hu-uk-ct2 | ⚪ | ⚪ | ⚪ | Hungarian→Ukrainian |
| 605 | hy-en | Helsinki-NLP/opus-mt-hy-en | windy-pair-hy-en | windy-pair-hy-en-ct2 | ⚪ | ⚪ | ⚪ | Armenian→English |
| 606 | hy-ru | Helsinki-NLP/opus-mt-hy-ru | windy-pair-hy-ru | windy-pair-hy-ru-ct2 | ⚪ | ⚪ | ⚪ | Armenian→Russian |
| 607 | id-en | Helsinki-NLP/opus-mt-id-en | windy-pair-id-en | windy-pair-id-en-ct2 | ⚪ | ⚪ | ⚪ | Indonesian→English |
| 608 | id-es | Helsinki-NLP/opus-mt-id-es | windy-pair-id-es | windy-pair-id-es-ct2 | ⚪ | ⚪ | ⚪ | Indonesian→Spanish |
| 609 | id-fi | Helsinki-NLP/opus-mt-id-fi | windy-pair-id-fi | windy-pair-id-fi-ct2 | ⚪ | ⚪ | ⚪ | Indonesian→Finnish |
| 610 | id-fr | Helsinki-NLP/opus-mt-id-fr | windy-pair-id-fr | windy-pair-id-fr-ct2 | ⚪ | ⚪ | ⚪ | Indonesian→French |
| 611 | id-sv | Helsinki-NLP/opus-mt-id-sv | windy-pair-id-sv | windy-pair-id-sv-ct2 | ⚪ | ⚪ | ⚪ | Indonesian→Swedish |
| 612 | ig-de | Helsinki-NLP/opus-mt-ig-de | windy-pair-ig-de | windy-pair-ig-de-ct2 | ⚪ | ⚪ | ⚪ | Igbo→German |
| 613 | ig-en | Helsinki-NLP/opus-mt-ig-en | windy-pair-ig-en | windy-pair-ig-en-ct2 | ⚪ | ⚪ | ⚪ | Igbo→English |
| 614 | ig-es | Helsinki-NLP/opus-mt-ig-es | windy-pair-ig-es | windy-pair-ig-es-ct2 | ⚪ | ⚪ | ⚪ | Igbo→Spanish |
| 615 | ig-fi | Helsinki-NLP/opus-mt-ig-fi | windy-pair-ig-fi | windy-pair-ig-fi-ct2 | ⚪ | ⚪ | ⚪ | Igbo→Finnish |
| 616 | ig-fr | Helsinki-NLP/opus-mt-ig-fr | windy-pair-ig-fr | windy-pair-ig-fr-ct2 | ⚪ | ⚪ | ⚪ | Igbo→French |
| 617 | ig-sv | Helsinki-NLP/opus-mt-ig-sv | windy-pair-ig-sv | windy-pair-ig-sv-ct2 | ⚪ | ⚪ | ⚪ | Igbo→Swedish |
| 618 | ilo-de | Helsinki-NLP/opus-mt-ilo-de | windy-pair-ilo-de | windy-pair-ilo-de-ct2 | ⚪ | ⚪ | ⚪ | ILO→German |
| 619 | ilo-sv | Helsinki-NLP/opus-mt-ilo-sv | windy-pair-ilo-sv | windy-pair-ilo-sv-ct2 | ⚪ | ⚪ | ⚪ | ILO→Swedish |
| 620 | inc-en | Helsinki-NLP/opus-mt-inc-en | windy-pair-inc-en | windy-pair-inc-en-ct2 | ⚪ | ⚪ | ⚪ | INC→English |
| 621 | inc-inc | Helsinki-NLP/opus-mt-inc-inc | windy-pair-inc-inc | windy-pair-inc-inc-ct2 | ⚪ | ⚪ | ⚪ | INC→INC |
| 622 | ine-en | Helsinki-NLP/opus-mt-ine-en | windy-pair-ine-en | windy-pair-ine-en-ct2 | ⚪ | ⚪ | ⚪ | INE→English |
| 623 | ine-ine | Helsinki-NLP/opus-mt-ine-ine | windy-pair-ine-ine | windy-pair-ine-ine-ct2 | ⚪ | ⚪ | ⚪ | INE→INE |
| 624 | is-de | Helsinki-NLP/opus-mt-is-de | windy-pair-is-de | windy-pair-is-de-ct2 | ⚪ | ⚪ | ⚪ | Icelandic→German |
| 625 | is-en | Helsinki-NLP/opus-mt-is-en | windy-pair-is-en | windy-pair-is-en-ct2 | ⚪ | ⚪ | ⚪ | Icelandic→English |
| 626 | is-eo | Helsinki-NLP/opus-mt-is-eo | windy-pair-is-eo | windy-pair-is-eo-ct2 | ⚪ | ⚪ | ⚪ | Icelandic→Esperanto |
| 627 | is-es | Helsinki-NLP/opus-mt-is-es | windy-pair-is-es | windy-pair-is-es-ct2 | ⚪ | ⚪ | ⚪ | Icelandic→Spanish |
| 628 | is-fi | Helsinki-NLP/opus-mt-is-fi | windy-pair-is-fi | windy-pair-is-fi-ct2 | ⚪ | ⚪ | ⚪ | Icelandic→Finnish |
| 629 | is-fr | Helsinki-NLP/opus-mt-is-fr | windy-pair-is-fr | windy-pair-is-fr-ct2 | ⚪ | ⚪ | ⚪ | Icelandic→French |
| 630 | is-it | Helsinki-NLP/opus-mt-is-it | windy-pair-is-it | windy-pair-is-it-ct2 | ⚪ | ⚪ | ⚪ | Icelandic→Italian |
| 631 | is-sv | Helsinki-NLP/opus-mt-is-sv | windy-pair-is-sv | windy-pair-is-sv-ct2 | ⚪ | ⚪ | ⚪ | Icelandic→Swedish |
| 632 | iso-en | Helsinki-NLP/opus-mt-iso-en | windy-pair-iso-en | windy-pair-iso-en-ct2 | ⚪ | ⚪ | ⚪ | ISO→English |
| 633 | iso-es | Helsinki-NLP/opus-mt-iso-es | windy-pair-iso-es | windy-pair-iso-es-ct2 | ⚪ | ⚪ | ⚪ | ISO→Spanish |
| 634 | iso-fi | Helsinki-NLP/opus-mt-iso-fi | windy-pair-iso-fi | windy-pair-iso-fi-ct2 | ⚪ | ⚪ | ⚪ | ISO→Finnish |
| 635 | iso-fr | Helsinki-NLP/opus-mt-iso-fr | windy-pair-iso-fr | windy-pair-iso-fr-ct2 | ⚪ | ⚪ | ⚪ | ISO→French |
| 636 | iso-sv | Helsinki-NLP/opus-mt-iso-sv | windy-pair-iso-sv | windy-pair-iso-sv-ct2 | ⚪ | ⚪ | ⚪ | ISO→Swedish |
| 637 | it-ar | Helsinki-NLP/opus-mt-it-ar | windy-pair-it-ar | windy-pair-it-ar-ct2 | ⚪ | ⚪ | ⚪ | Italian→Arabic |
| 638 | it-bg | Helsinki-NLP/opus-mt-it-bg | windy-pair-it-bg | windy-pair-it-bg-ct2 | ⚪ | ⚪ | ⚪ | Italian→Bulgarian |
| 639 | it-ca | Helsinki-NLP/opus-mt-it-ca | windy-pair-it-ca | windy-pair-it-ca-ct2 | ⚪ | ⚪ | ⚪ | Italian→Catalan |
| 640 | it-de | Helsinki-NLP/opus-mt-it-de | windy-pair-it-de | windy-pair-it-de-ct2 | ⚪ | ⚪ | ⚪ | Italian→German |
| 641 | it-en | Helsinki-NLP/opus-mt-it-en | windy-pair-it-en | windy-pair-it-en-ct2 | ⚪ | ⚪ | ⚪ | Italian→English |
| 642 | it-eo | Helsinki-NLP/opus-mt-it-eo | windy-pair-it-eo | windy-pair-it-eo-ct2 | ⚪ | ⚪ | ⚪ | Italian→Esperanto |
| 643 | it-es | Helsinki-NLP/opus-mt-it-es | windy-pair-it-es | windy-pair-it-es-ct2 | ⚪ | ⚪ | ⚪ | Italian→Spanish |
| 644 | it-fr | Helsinki-NLP/opus-mt-it-fr | windy-pair-it-fr | windy-pair-it-fr-ct2 | ⚪ | ⚪ | ⚪ | Italian→French |
| 645 | it-is | Helsinki-NLP/opus-mt-it-is | windy-pair-it-is | windy-pair-it-is-ct2 | ⚪ | ⚪ | ⚪ | Italian→Icelandic |
| 646 | it-lt | Helsinki-NLP/opus-mt-it-lt | windy-pair-it-lt | windy-pair-it-lt-ct2 | ⚪ | ⚪ | ⚪ | Italian→Lithuanian |
| 647 | it-ms | Helsinki-NLP/opus-mt-it-ms | windy-pair-it-ms | windy-pair-it-ms-ct2 | ⚪ | ⚪ | ⚪ | Italian→Malay |
| 648 | it-sv | Helsinki-NLP/opus-mt-it-sv | windy-pair-it-sv | windy-pair-it-sv-ct2 | ⚪ | ⚪ | ⚪ | Italian→Swedish |
| 649 | it-uk | Helsinki-NLP/opus-mt-it-uk | windy-pair-it-uk | windy-pair-it-uk-ct2 | ⚪ | ⚪ | ⚪ | Italian→Ukrainian |
| 650 | it-vi | Helsinki-NLP/opus-mt-it-vi | windy-pair-it-vi | windy-pair-it-vi-ct2 | ⚪ | ⚪ | ⚪ | Italian→Vietnamese |
| 651 | itc-en | Helsinki-NLP/opus-mt-itc-en | windy-pair-itc-en | windy-pair-itc-en-ct2 | ⚪ | ⚪ | ⚪ | ITC→English |
| 652 | itc-itc | Helsinki-NLP/opus-mt-itc-itc | windy-pair-itc-itc | windy-pair-itc-itc-ct2 | ⚪ | ⚪ | ⚪ | ITC→ITC |
| 653 | ja-ar | Helsinki-NLP/opus-mt-ja-ar | windy-pair-ja-ar | windy-pair-ja-ar-ct2 | ⚪ | ⚪ | ⚪ | Japanese→Arabic |
| 654 | ja-bg | Helsinki-NLP/opus-mt-ja-bg | windy-pair-ja-bg | windy-pair-ja-bg-ct2 | ⚪ | ⚪ | ⚪ | Japanese→Bulgarian |
| 655 | ja-da | Helsinki-NLP/opus-mt-ja-da | windy-pair-ja-da | windy-pair-ja-da-ct2 | ⚪ | ⚪ | ⚪ | Japanese→Danish |
| 656 | ja-de | Helsinki-NLP/opus-mt-ja-de | windy-pair-ja-de | windy-pair-ja-de-ct2 | ⚪ | ⚪ | ⚪ | Japanese→German |
| 657 | ja-en | Helsinki-NLP/opus-mt-ja-en | windy-pair-ja-en | windy-pair-ja-en-ct2 | ⚪ | ⚪ | ⚪ | Japanese→English |
| 658 | ja-es | Helsinki-NLP/opus-mt-ja-es | windy-pair-ja-es | windy-pair-ja-es-ct2 | ⚪ | ⚪ | ⚪ | Japanese→Spanish |
| 659 | ja-fi | Helsinki-NLP/opus-mt-ja-fi | windy-pair-ja-fi | windy-pair-ja-fi-ct2 | ⚪ | ⚪ | ⚪ | Japanese→Finnish |
| 660 | ja-fr | Helsinki-NLP/opus-mt-ja-fr | windy-pair-ja-fr | windy-pair-ja-fr-ct2 | ⚪ | ⚪ | ⚪ | Japanese→French |
| 661 | ja-he | Helsinki-NLP/opus-mt-ja-he | windy-pair-ja-he | windy-pair-ja-he-ct2 | ⚪ | ⚪ | ⚪ | Japanese→Hebrew |
| 662 | ja-hu | Helsinki-NLP/opus-mt-ja-hu | windy-pair-ja-hu | windy-pair-ja-hu-ct2 | ⚪ | ⚪ | ⚪ | Japanese→Hungarian |
| 663 | ja-it | Helsinki-NLP/opus-mt-ja-it | windy-pair-ja-it | windy-pair-ja-it-ct2 | ⚪ | ⚪ | ⚪ | Japanese→Italian |
| 664 | ja-ms | Helsinki-NLP/opus-mt-ja-ms | windy-pair-ja-ms | windy-pair-ja-ms-ct2 | ⚪ | ⚪ | ⚪ | Japanese→Malay |
| 665 | ja-nl | Helsinki-NLP/opus-mt-ja-nl | windy-pair-ja-nl | windy-pair-ja-nl-ct2 | ⚪ | ⚪ | ⚪ | Japanese→Dutch |
| 666 | ja-pl | Helsinki-NLP/opus-mt-ja-pl | windy-pair-ja-pl | windy-pair-ja-pl-ct2 | ⚪ | ⚪ | ⚪ | Japanese→Polish |
| 667 | ja-pt | Helsinki-NLP/opus-mt-ja-pt | windy-pair-ja-pt | windy-pair-ja-pt-ct2 | ⚪ | ⚪ | ⚪ | Japanese→Portuguese |
| 668 | ja-ru | Helsinki-NLP/opus-mt-ja-ru | windy-pair-ja-ru | windy-pair-ja-ru-ct2 | ⚪ | ⚪ | ⚪ | Japanese→Russian |
| 669 | ja-sh | Helsinki-NLP/opus-mt-ja-sh | windy-pair-ja-sh | windy-pair-ja-sh-ct2 | ⚪ | ⚪ | ⚪ | Japanese→SH |
| 670 | ja-sv | Helsinki-NLP/opus-mt-ja-sv | windy-pair-ja-sv | windy-pair-ja-sv-ct2 | ⚪ | ⚪ | ⚪ | Japanese→Swedish |
| 671 | ja-tr | Helsinki-NLP/opus-mt-ja-tr | windy-pair-ja-tr | windy-pair-ja-tr-ct2 | ⚪ | ⚪ | ⚪ | Japanese→Turkish |
| 672 | ja-vi | Helsinki-NLP/opus-mt-ja-vi | windy-pair-ja-vi | windy-pair-ja-vi-ct2 | ⚪ | ⚪ | ⚪ | Japanese→Vietnamese |
| 673 | jap-en | Helsinki-NLP/opus-mt-jap-en | windy-pair-jap-en | windy-pair-jap-en-ct2 | ⚪ | ⚪ | ⚪ | JAP→English |
| 674 | ka-en | Helsinki-NLP/opus-mt-ka-en | windy-pair-ka-en | windy-pair-ka-en-ct2 | ⚪ | ⚪ | ⚪ | Georgian→English |
| 675 | ka-ru | Helsinki-NLP/opus-mt-ka-ru | windy-pair-ka-ru | windy-pair-ka-ru-ct2 | ⚪ | ⚪ | ⚪ | Georgian→Russian |
| 676 | kab-en | Helsinki-NLP/opus-mt-kab-en | windy-pair-kab-en | windy-pair-kab-en-ct2 | ⚪ | ⚪ | ⚪ | KAB→English |
| 677 | kg-sv | Helsinki-NLP/opus-mt-kg-sv | windy-pair-kg-sv | windy-pair-kg-sv-ct2 | ⚪ | ⚪ | ⚪ | KG→Swedish |
| 678 | ko-de | Helsinki-NLP/opus-mt-ko-de | windy-pair-ko-de | windy-pair-ko-de-ct2 | ⚪ | ⚪ | ⚪ | Korean→German |
| 679 | ko-en | Helsinki-NLP/opus-mt-ko-en | windy-pair-ko-en | windy-pair-ko-en-ct2 | ⚪ | ⚪ | ⚪ | Korean→English |
| 680 | ko-es | Helsinki-NLP/opus-mt-ko-es | windy-pair-ko-es | windy-pair-ko-es-ct2 | ⚪ | ⚪ | ⚪ | Korean→Spanish |
| 681 | ko-fi | Helsinki-NLP/opus-mt-ko-fi | windy-pair-ko-fi | windy-pair-ko-fi-ct2 | ⚪ | ⚪ | ⚪ | Korean→Finnish |
| 682 | ko-fr | Helsinki-NLP/opus-mt-ko-fr | windy-pair-ko-fr | windy-pair-ko-fr-ct2 | ⚪ | ⚪ | ⚪ | Korean→French |
| 683 | ko-hu | Helsinki-NLP/opus-mt-ko-hu | windy-pair-ko-hu | windy-pair-ko-hu-ct2 | ⚪ | ⚪ | ⚪ | Korean→Hungarian |
| 684 | ko-ru | Helsinki-NLP/opus-mt-ko-ru | windy-pair-ko-ru | windy-pair-ko-ru-ct2 | ⚪ | ⚪ | ⚪ | Korean→Russian |
| 685 | ko-sv | Helsinki-NLP/opus-mt-ko-sv | windy-pair-ko-sv | windy-pair-ko-sv-ct2 | ⚪ | ⚪ | ⚪ | Korean→Swedish |
| 686 | kqn-sv | Helsinki-NLP/opus-mt-kqn-sv | windy-pair-kqn-sv | windy-pair-kqn-sv-ct2 | ⚪ | ⚪ | ⚪ | KQN→Swedish |
| 687 | kwy-sv | Helsinki-NLP/opus-mt-kwy-sv | windy-pair-kwy-sv | windy-pair-kwy-sv-ct2 | ⚪ | ⚪ | ⚪ | KWY→Swedish |
| 688 | lg-sv | Helsinki-NLP/opus-mt-lg-sv | windy-pair-lg-sv | windy-pair-lg-sv-ct2 | ⚪ | ⚪ | ⚪ | LG→Swedish |
| 689 | ln-de | Helsinki-NLP/opus-mt-ln-de | windy-pair-ln-de | windy-pair-ln-de-ct2 | ⚪ | ⚪ | ⚪ | LN→German |
| 690 | loz-de | Helsinki-NLP/opus-mt-loz-de | windy-pair-loz-de | windy-pair-loz-de-ct2 | ⚪ | ⚪ | ⚪ | LOZ→German |
| 691 | loz-sv | Helsinki-NLP/opus-mt-loz-sv | windy-pair-loz-sv | windy-pair-loz-sv-ct2 | ⚪ | ⚪ | ⚪ | LOZ→Swedish |
| 692 | lt-de | Helsinki-NLP/opus-mt-lt-de | windy-pair-lt-de | windy-pair-lt-de-ct2 | ⚪ | ⚪ | ⚪ | Lithuanian→German |
| 693 | lt-eo | Helsinki-NLP/opus-mt-lt-eo | windy-pair-lt-eo | windy-pair-lt-eo-ct2 | ⚪ | ⚪ | ⚪ | Lithuanian→Esperanto |
| 694 | lt-es | Helsinki-NLP/opus-mt-lt-es | windy-pair-lt-es | windy-pair-lt-es-ct2 | ⚪ | ⚪ | ⚪ | Lithuanian→Spanish |
| 695 | lt-fr | Helsinki-NLP/opus-mt-lt-fr | windy-pair-lt-fr | windy-pair-lt-fr-ct2 | ⚪ | ⚪ | ⚪ | Lithuanian→French |
| 696 | lt-it | Helsinki-NLP/opus-mt-lt-it | windy-pair-lt-it | windy-pair-lt-it-ct2 | ⚪ | ⚪ | ⚪ | Lithuanian→Italian |
| 697 | lt-pl | Helsinki-NLP/opus-mt-lt-pl | windy-pair-lt-pl | windy-pair-lt-pl-ct2 | ⚪ | ⚪ | ⚪ | Lithuanian→Polish |
| 698 | lt-ru | Helsinki-NLP/opus-mt-lt-ru | windy-pair-lt-ru | windy-pair-lt-ru-ct2 | ⚪ | ⚪ | ⚪ | Lithuanian→Russian |
| 699 | lt-sv | Helsinki-NLP/opus-mt-lt-sv | windy-pair-lt-sv | windy-pair-lt-sv-ct2 | ⚪ | ⚪ | ⚪ | Lithuanian→Swedish |
| 700 | lt-tr | Helsinki-NLP/opus-mt-lt-tr | windy-pair-lt-tr | windy-pair-lt-tr-ct2 | ⚪ | ⚪ | ⚪ | Lithuanian→Turkish |
| 701 | lu-sv | Helsinki-NLP/opus-mt-lu-sv | windy-pair-lu-sv | windy-pair-lu-sv-ct2 | ⚪ | ⚪ | ⚪ | LU→Swedish |
| 702 | lua-sv | Helsinki-NLP/opus-mt-lua-sv | windy-pair-lua-sv | windy-pair-lua-sv-ct2 | ⚪ | ⚪ | ⚪ | LUA→Swedish |
| 703 | lue-sv | Helsinki-NLP/opus-mt-lue-sv | windy-pair-lue-sv | windy-pair-lue-sv-ct2 | ⚪ | ⚪ | ⚪ | LUE→Swedish |
| 704 | lus-sv | Helsinki-NLP/opus-mt-lus-sv | windy-pair-lus-sv | windy-pair-lus-sv-ct2 | ⚪ | ⚪ | ⚪ | LUS→Swedish |
| 705 | lv-en | Helsinki-NLP/opus-mt-lv-en | windy-pair-lv-en | windy-pair-lv-en-ct2 | ⚪ | ⚪ | ⚪ | Latvian→English |
| 706 | lv-es | Helsinki-NLP/opus-mt-lv-es | windy-pair-lv-es | windy-pair-lv-es-ct2 | ⚪ | ⚪ | ⚪ | Latvian→Spanish |
| 707 | lv-fi | Helsinki-NLP/opus-mt-lv-fi | windy-pair-lv-fi | windy-pair-lv-fi-ct2 | ⚪ | ⚪ | ⚪ | Latvian→Finnish |
| 708 | lv-fr | Helsinki-NLP/opus-mt-lv-fr | windy-pair-lv-fr | windy-pair-lv-fr-ct2 | ⚪ | ⚪ | ⚪ | Latvian→French |
| 709 | lv-ru | Helsinki-NLP/opus-mt-lv-ru | windy-pair-lv-ru | windy-pair-lv-ru-ct2 | ⚪ | ⚪ | ⚪ | Latvian→Russian |
| 710 | lv-sv | Helsinki-NLP/opus-mt-lv-sv | windy-pair-lv-sv | windy-pair-lv-sv-ct2 | ⚪ | ⚪ | ⚪ | Latvian→Swedish |
| 711 | mk-en | Helsinki-NLP/opus-mt-mk-en | windy-pair-mk-en | windy-pair-mk-en-ct2 | ⚪ | ⚪ | ⚪ | Macedonian→English |
| 712 | mk-es | Helsinki-NLP/opus-mt-mk-es | windy-pair-mk-es | windy-pair-mk-es-ct2 | ⚪ | ⚪ | ⚪ | Macedonian→Spanish |
| 713 | mk-fi | Helsinki-NLP/opus-mt-mk-fi | windy-pair-mk-fi | windy-pair-mk-fi-ct2 | ⚪ | ⚪ | ⚪ | Macedonian→Finnish |
| 714 | mk-fr | Helsinki-NLP/opus-mt-mk-fr | windy-pair-mk-fr | windy-pair-mk-fr-ct2 | ⚪ | ⚪ | ⚪ | Macedonian→French |
| 715 | mkh-en | Helsinki-NLP/opus-mt-mkh-en | windy-pair-mkh-en | windy-pair-mkh-en-ct2 | ⚪ | ⚪ | ⚪ | MKH→English |
| 716 | ms-de | Helsinki-NLP/opus-mt-ms-de | windy-pair-ms-de | windy-pair-ms-de-ct2 | ⚪ | ⚪ | ⚪ | Malay→German |
| 717 | ms-fr | Helsinki-NLP/opus-mt-ms-fr | windy-pair-ms-fr | windy-pair-ms-fr-ct2 | ⚪ | ⚪ | ⚪ | Malay→French |
| 718 | ms-it | Helsinki-NLP/opus-mt-ms-it | windy-pair-ms-it | windy-pair-ms-it-ct2 | ⚪ | ⚪ | ⚪ | Malay→Italian |
| 719 | ms-ms | Helsinki-NLP/opus-mt-ms-ms | windy-pair-ms-ms | windy-pair-ms-ms-ct2 | ⚪ | ⚪ | ⚪ | Malay→Malay |
| 720 | mt-sv | Helsinki-NLP/opus-mt-mt-sv | windy-pair-mt-sv | windy-pair-mt-sv-ct2 | ⚪ | ⚪ | ⚪ | Maltese→Swedish |
| 721 | mul-en | Helsinki-NLP/opus-mt-mul-en | windy-pair-mul-en | windy-pair-mul-en-ct2 | ⚪ | ⚪ | ⚪ | MUL→English |
| 722 | niu-de | Helsinki-NLP/opus-mt-niu-de | windy-pair-niu-de | windy-pair-niu-de-ct2 | ⚪ | ⚪ | ⚪ | NIU→German |
| 723 | niu-sv | Helsinki-NLP/opus-mt-niu-sv | windy-pair-niu-sv | windy-pair-niu-sv-ct2 | ⚪ | ⚪ | ⚪ | NIU→Swedish |
| 724 | nl-af | Helsinki-NLP/opus-mt-nl-af | windy-pair-nl-af | windy-pair-nl-af-ct2 | ⚪ | ⚪ | ⚪ | Dutch→Afrikaans |
| 725 | nl-ca | Helsinki-NLP/opus-mt-nl-ca | windy-pair-nl-ca | windy-pair-nl-ca-ct2 | ⚪ | ⚪ | ⚪ | Dutch→Catalan |
| 726 | nl-no | Helsinki-NLP/opus-mt-nl-no | windy-pair-nl-no | windy-pair-nl-no-ct2 | ⚪ | ⚪ | ⚪ | Dutch→Norwegian |
| 727 | nl-sv | Helsinki-NLP/opus-mt-nl-sv | windy-pair-nl-sv | windy-pair-nl-sv-ct2 | ⚪ | ⚪ | ⚪ | Dutch→Swedish |
| 728 | nl-uk | Helsinki-NLP/opus-mt-nl-uk | windy-pair-nl-uk | windy-pair-nl-uk-ct2 | ⚪ | ⚪ | ⚪ | Dutch→Ukrainian |
| 729 | no-da | Helsinki-NLP/opus-mt-no-da | windy-pair-no-da | windy-pair-no-da-ct2 | ⚪ | ⚪ | ⚪ | Norwegian→Danish |
| 730 | no-de | Helsinki-NLP/opus-mt-no-de | windy-pair-no-de | windy-pair-no-de-ct2 | ⚪ | ⚪ | ⚪ | Norwegian→German |
| 731 | no-es | Helsinki-NLP/opus-mt-no-es | windy-pair-no-es | windy-pair-no-es-ct2 | ⚪ | ⚪ | ⚪ | Norwegian→Spanish |
| 732 | no-fi | Helsinki-NLP/opus-mt-no-fi | windy-pair-no-fi | windy-pair-no-fi-ct2 | ⚪ | ⚪ | ⚪ | Norwegian→Finnish |
| 733 | no-fr | Helsinki-NLP/opus-mt-no-fr | windy-pair-no-fr | windy-pair-no-fr-ct2 | ⚪ | ⚪ | ⚪ | Norwegian→French |
| 734 | no-nl | Helsinki-NLP/opus-mt-no-nl | windy-pair-no-nl | windy-pair-no-nl-ct2 | ⚪ | ⚪ | ⚪ | Norwegian→Dutch |
| 735 | no-no | Helsinki-NLP/opus-mt-no-no | windy-pair-no-no | windy-pair-no-no-ct2 | ⚪ | ⚪ | ⚪ | Norwegian→Norwegian |
| 736 | no-pl | Helsinki-NLP/opus-mt-no-pl | windy-pair-no-pl | windy-pair-no-pl-ct2 | ⚪ | ⚪ | ⚪ | Norwegian→Polish |
| 737 | no-ru | Helsinki-NLP/opus-mt-no-ru | windy-pair-no-ru | windy-pair-no-ru-ct2 | ⚪ | ⚪ | ⚪ | Norwegian→Russian |
| 738 | no-sv | Helsinki-NLP/opus-mt-no-sv | windy-pair-no-sv | windy-pair-no-sv-ct2 | ⚪ | ⚪ | ⚪ | Norwegian→Swedish |
| 739 | no-uk | Helsinki-NLP/opus-mt-no-uk | windy-pair-no-uk | windy-pair-no-uk-ct2 | ⚪ | ⚪ | ⚪ | Norwegian→Ukrainian |
| 740 | nso-de | Helsinki-NLP/opus-mt-nso-de | windy-pair-nso-de | windy-pair-nso-de-ct2 | ⚪ | ⚪ | ⚪ | NSO→German |
| 741 | nso-sv | Helsinki-NLP/opus-mt-nso-sv | windy-pair-nso-sv | windy-pair-nso-sv-ct2 | ⚪ | ⚪ | ⚪ | NSO→Swedish |
| 742 | ny-de | Helsinki-NLP/opus-mt-ny-de | windy-pair-ny-de | windy-pair-ny-de-ct2 | ⚪ | ⚪ | ⚪ | Chichewa→German |
| 743 | pa-en | Helsinki-NLP/opus-mt-pa-en | windy-pair-pa-en | windy-pair-pa-en-ct2 | ⚪ | ⚪ | ⚪ | Punjabi→English |
| 744 | pag-de | Helsinki-NLP/opus-mt-pag-de | windy-pair-pag-de | windy-pair-pag-de-ct2 | ⚪ | ⚪ | ⚪ | PAG→German |
| 745 | pag-en | Helsinki-NLP/opus-mt-pag-en | windy-pair-pag-en | windy-pair-pag-en-ct2 | ⚪ | ⚪ | ⚪ | PAG→English |
| 746 | pag-es | Helsinki-NLP/opus-mt-pag-es | windy-pair-pag-es | windy-pair-pag-es-ct2 | ⚪ | ⚪ | ⚪ | PAG→Spanish |
| 747 | pag-fi | Helsinki-NLP/opus-mt-pag-fi | windy-pair-pag-fi | windy-pair-pag-fi-ct2 | ⚪ | ⚪ | ⚪ | PAG→Finnish |
| 748 | pag-sv | Helsinki-NLP/opus-mt-pag-sv | windy-pair-pag-sv | windy-pair-pag-sv-ct2 | ⚪ | ⚪ | ⚪ | PAG→Swedish |
| 749 | pap-de | Helsinki-NLP/opus-mt-pap-de | windy-pair-pap-de | windy-pair-pap-de-ct2 | ⚪ | ⚪ | ⚪ | PAP→German |
| 750 | pap-en | Helsinki-NLP/opus-mt-pap-en | windy-pair-pap-en | windy-pair-pap-en-ct2 | ⚪ | ⚪ | ⚪ | PAP→English |
| 751 | pap-es | Helsinki-NLP/opus-mt-pap-es | windy-pair-pap-es | windy-pair-pap-es-ct2 | ⚪ | ⚪ | ⚪ | PAP→Spanish |
| 752 | pap-fi | Helsinki-NLP/opus-mt-pap-fi | windy-pair-pap-fi | windy-pair-pap-fi-ct2 | ⚪ | ⚪ | ⚪ | PAP→Finnish |
| 753 | pap-fr | Helsinki-NLP/opus-mt-pap-fr | windy-pair-pap-fr | windy-pair-pap-fr-ct2 | ⚪ | ⚪ | ⚪ | PAP→French |
| 754 | pis-sv | Helsinki-NLP/opus-mt-pis-sv | windy-pair-pis-sv | windy-pair-pis-sv-ct2 | ⚪ | ⚪ | ⚪ | PIS→Swedish |
| 755 | pl-ar | Helsinki-NLP/opus-mt-pl-ar | windy-pair-pl-ar | windy-pair-pl-ar-ct2 | ⚪ | ⚪ | ⚪ | Polish→Arabic |
| 756 | pl-de | Helsinki-NLP/opus-mt-pl-de | windy-pair-pl-de | windy-pair-pl-de-ct2 | ⚪ | ⚪ | ⚪ | Polish→German |
| 757 | pl-en | Helsinki-NLP/opus-mt-pl-en | windy-pair-pl-en | windy-pair-pl-en-ct2 | ⚪ | ⚪ | ⚪ | Polish→English |
| 758 | pl-eo | Helsinki-NLP/opus-mt-pl-eo | windy-pair-pl-eo | windy-pair-pl-eo-ct2 | ⚪ | ⚪ | ⚪ | Polish→Esperanto |
| 759 | pl-es | Helsinki-NLP/opus-mt-pl-es | windy-pair-pl-es | windy-pair-pl-es-ct2 | ⚪ | ⚪ | ⚪ | Polish→Spanish |
| 760 | pl-fr | Helsinki-NLP/opus-mt-pl-fr | windy-pair-pl-fr | windy-pair-pl-fr-ct2 | ⚪ | ⚪ | ⚪ | Polish→French |
| 761 | pl-lt | Helsinki-NLP/opus-mt-pl-lt | windy-pair-pl-lt | windy-pair-pl-lt-ct2 | ⚪ | ⚪ | ⚪ | Polish→Lithuanian |
| 762 | pl-no | Helsinki-NLP/opus-mt-pl-no | windy-pair-pl-no | windy-pair-pl-no-ct2 | ⚪ | ⚪ | ⚪ | Polish→Norwegian |
| 763 | pl-sv | Helsinki-NLP/opus-mt-pl-sv | windy-pair-pl-sv | windy-pair-pl-sv-ct2 | ⚪ | ⚪ | ⚪ | Polish→Swedish |
| 764 | pl-uk | Helsinki-NLP/opus-mt-pl-uk | windy-pair-pl-uk | windy-pair-pl-uk-ct2 | ⚪ | ⚪ | ⚪ | Polish→Ukrainian |
| 765 | pon-sv | Helsinki-NLP/opus-mt-pon-sv | windy-pair-pon-sv | windy-pair-pon-sv-ct2 | ⚪ | ⚪ | ⚪ | PON→Swedish |
| 766 | pt-ca | Helsinki-NLP/opus-mt-pt-ca | windy-pair-pt-ca | windy-pair-pt-ca-ct2 | ⚪ | ⚪ | ⚪ | Portuguese→Catalan |
| 767 | pt-eo | Helsinki-NLP/opus-mt-pt-eo | windy-pair-pt-eo | windy-pair-pt-eo-ct2 | ⚪ | ⚪ | ⚪ | Portuguese→Esperanto |
| 768 | pt-gl | Helsinki-NLP/opus-mt-pt-gl | windy-pair-pt-gl | windy-pair-pt-gl-ct2 | ⚪ | ⚪ | ⚪ | Portuguese→Galician |
| 769 | pt-tl | Helsinki-NLP/opus-mt-pt-tl | windy-pair-pt-tl | windy-pair-pt-tl-ct2 | ⚪ | ⚪ | ⚪ | Portuguese→Filipino |
| 770 | pt-uk | Helsinki-NLP/opus-mt-pt-uk | windy-pair-pt-uk | windy-pair-pt-uk-ct2 | ⚪ | ⚪ | ⚪ | Portuguese→Ukrainian |
| 771 | rn-de | Helsinki-NLP/opus-mt-rn-de | windy-pair-rn-de | windy-pair-rn-de-ct2 | ⚪ | ⚪ | ⚪ | RN→German |
| 772 | rn-ru | Helsinki-NLP/opus-mt-rn-ru | windy-pair-rn-ru | windy-pair-rn-ru-ct2 | ⚪ | ⚪ | ⚪ | RN→Russian |
| 773 | rnd-sv | Helsinki-NLP/opus-mt-rnd-sv | windy-pair-rnd-sv | windy-pair-rnd-sv-ct2 | ⚪ | ⚪ | ⚪ | RND→Swedish |
| 774 | ro-eo | Helsinki-NLP/opus-mt-ro-eo | windy-pair-ro-eo | windy-pair-ro-eo-ct2 | ⚪ | ⚪ | ⚪ | Romanian→Esperanto |
| 775 | ro-fi | Helsinki-NLP/opus-mt-ro-fi | windy-pair-ro-fi | windy-pair-ro-fi-ct2 | ⚪ | ⚪ | ⚪ | Romanian→Finnish |
| 776 | ro-fr | Helsinki-NLP/opus-mt-ro-fr | windy-pair-ro-fr | windy-pair-ro-fr-ct2 | ⚪ | ⚪ | ⚪ | Romanian→French |
| 777 | ro-sv | Helsinki-NLP/opus-mt-ro-sv | windy-pair-ro-sv | windy-pair-ro-sv-ct2 | ⚪ | ⚪ | ⚪ | Romanian→Swedish |
| 778 | roa-en | Helsinki-NLP/opus-mt-roa-en | windy-pair-roa-en | windy-pair-roa-en-ct2 | ⚪ | ⚪ | ⚪ | ROA→English |
| 779 | ru-af | Helsinki-NLP/opus-mt-ru-af | windy-pair-ru-af | windy-pair-ru-af-ct2 | ⚪ | ⚪ | ⚪ | Russian→Afrikaans |
| 780 | ru-ar | Helsinki-NLP/opus-mt-ru-ar | windy-pair-ru-ar | windy-pair-ru-ar-ct2 | ⚪ | ⚪ | ⚪ | Russian→Arabic |
| 781 | ru-bg | Helsinki-NLP/opus-mt-ru-bg | windy-pair-ru-bg | windy-pair-ru-bg-ct2 | ⚪ | ⚪ | ⚪ | Russian→Bulgarian |
| 782 | ru-da | Helsinki-NLP/opus-mt-ru-da | windy-pair-ru-da | windy-pair-ru-da-ct2 | ⚪ | ⚪ | ⚪ | Russian→Danish |
| 783 | ru-eo | Helsinki-NLP/opus-mt-ru-eo | windy-pair-ru-eo | windy-pair-ru-eo-ct2 | ⚪ | ⚪ | ⚪ | Russian→Esperanto |
| 784 | ru-es | Helsinki-NLP/opus-mt-ru-es | windy-pair-ru-es | windy-pair-ru-es-ct2 | ⚪ | ⚪ | ⚪ | Russian→Spanish |
| 785 | ru-et | Helsinki-NLP/opus-mt-ru-et | windy-pair-ru-et | windy-pair-ru-et-ct2 | ⚪ | ⚪ | ⚪ | Russian→Estonian |
| 786 | ru-eu | Helsinki-NLP/opus-mt-ru-eu | windy-pair-ru-eu | windy-pair-ru-eu-ct2 | ⚪ | ⚪ | ⚪ | Russian→Basque |
| 787 | ru-fi | Helsinki-NLP/opus-mt-ru-fi | windy-pair-ru-fi | windy-pair-ru-fi-ct2 | ⚪ | ⚪ | ⚪ | Russian→Finnish |
| 788 | ru-fr | Helsinki-NLP/opus-mt-ru-fr | windy-pair-ru-fr | windy-pair-ru-fr-ct2 | ⚪ | ⚪ | ⚪ | Russian→French |
| 789 | ru-he | Helsinki-NLP/opus-mt-ru-he | windy-pair-ru-he | windy-pair-ru-he-ct2 | ⚪ | ⚪ | ⚪ | Russian→Hebrew |
| 790 | ru-hy | Helsinki-NLP/opus-mt-ru-hy | windy-pair-ru-hy | windy-pair-ru-hy-ct2 | ⚪ | ⚪ | ⚪ | Russian→Armenian |
| 791 | ru-lt | Helsinki-NLP/opus-mt-ru-lt | windy-pair-ru-lt | windy-pair-ru-lt-ct2 | ⚪ | ⚪ | ⚪ | Russian→Lithuanian |
| 792 | ru-lv | Helsinki-NLP/opus-mt-ru-lv | windy-pair-ru-lv | windy-pair-ru-lv-ct2 | ⚪ | ⚪ | ⚪ | Russian→Latvian |
| 793 | ru-no | Helsinki-NLP/opus-mt-ru-no | windy-pair-ru-no | windy-pair-ru-no-ct2 | ⚪ | ⚪ | ⚪ | Russian→Norwegian |
| 794 | ru-sl | Helsinki-NLP/opus-mt-ru-sl | windy-pair-ru-sl | windy-pair-ru-sl-ct2 | ⚪ | ⚪ | ⚪ | Russian→Slovenian |
| 795 | ru-sv | Helsinki-NLP/opus-mt-ru-sv | windy-pair-ru-sv | windy-pair-ru-sv-ct2 | ⚪ | ⚪ | ⚪ | Russian→Swedish |
| 796 | ru-uk | Helsinki-NLP/opus-mt-ru-uk | windy-pair-ru-uk | windy-pair-ru-uk-ct2 | ⚪ | ⚪ | ⚪ | Russian→Ukrainian |
| 797 | ru-vi | Helsinki-NLP/opus-mt-ru-vi | windy-pair-ru-vi | windy-pair-ru-vi-ct2 | ⚪ | ⚪ | ⚪ | Russian→Vietnamese |
| 798 | run-en | Helsinki-NLP/opus-mt-run-en | windy-pair-run-en | windy-pair-run-en-ct2 | ⚪ | ⚪ | ⚪ | RUN→English |
| 799 | run-es | Helsinki-NLP/opus-mt-run-es | windy-pair-run-es | windy-pair-run-es-ct2 | ⚪ | ⚪ | ⚪ | RUN→Spanish |
| 800 | run-sv | Helsinki-NLP/opus-mt-run-sv | windy-pair-run-sv | windy-pair-run-sv-ct2 | ⚪ | ⚪ | ⚪ | RUN→Swedish |
| 801 | rw-sv | Helsinki-NLP/opus-mt-rw-sv | windy-pair-rw-sv | windy-pair-rw-sv-ct2 | ⚪ | ⚪ | ⚪ | Kinyarwanda→Swedish |
| 802 | sem-en | Helsinki-NLP/opus-mt-sem-en | windy-pair-sem-en | windy-pair-sem-en-ct2 | ⚪ | ⚪ | ⚪ | SEM→English |
| 803 | sem-sem | Helsinki-NLP/opus-mt-sem-sem | windy-pair-sem-sem | windy-pair-sem-sem-ct2 | ⚪ | ⚪ | ⚪ | SEM→SEM |
| 804 | sg-sv | Helsinki-NLP/opus-mt-sg-sv | windy-pair-sg-sv | windy-pair-sg-sv-ct2 | ⚪ | ⚪ | ⚪ | SG→Swedish |
| 805 | sh-uk | Helsinki-NLP/opus-mt-sh-uk | windy-pair-sh-uk | windy-pair-sh-uk-ct2 | ⚪ | ⚪ | ⚪ | SH→Ukrainian |
| 806 | sk-en | Helsinki-NLP/opus-mt-sk-en | windy-pair-sk-en | windy-pair-sk-en-ct2 | ⚪ | ⚪ | ⚪ | Slovak→English |
| 807 | sk-es | Helsinki-NLP/opus-mt-sk-es | windy-pair-sk-es | windy-pair-sk-es-ct2 | ⚪ | ⚪ | ⚪ | Slovak→Spanish |
| 808 | sk-fi | Helsinki-NLP/opus-mt-sk-fi | windy-pair-sk-fi | windy-pair-sk-fi-ct2 | ⚪ | ⚪ | ⚪ | Slovak→Finnish |
| 809 | sk-fr | Helsinki-NLP/opus-mt-sk-fr | windy-pair-sk-fr | windy-pair-sk-fr-ct2 | ⚪ | ⚪ | ⚪ | Slovak→French |
| 810 | sk-sv | Helsinki-NLP/opus-mt-sk-sv | windy-pair-sk-sv | windy-pair-sk-sv-ct2 | ⚪ | ⚪ | ⚪ | Slovak→Swedish |
| 811 | sl-es | Helsinki-NLP/opus-mt-sl-es | windy-pair-sl-es | windy-pair-sl-es-ct2 | ⚪ | ⚪ | ⚪ | Slovenian→Spanish |
| 812 | sl-fi | Helsinki-NLP/opus-mt-sl-fi | windy-pair-sl-fi | windy-pair-sl-fi-ct2 | ⚪ | ⚪ | ⚪ | Slovenian→Finnish |
| 813 | sl-fr | Helsinki-NLP/opus-mt-sl-fr | windy-pair-sl-fr | windy-pair-sl-fr-ct2 | ⚪ | ⚪ | ⚪ | Slovenian→French |
| 814 | sl-ru | Helsinki-NLP/opus-mt-sl-ru | windy-pair-sl-ru | windy-pair-sl-ru-ct2 | ⚪ | ⚪ | ⚪ | Slovenian→Russian |
| 815 | sl-sv | Helsinki-NLP/opus-mt-sl-sv | windy-pair-sl-sv | windy-pair-sl-sv-ct2 | ⚪ | ⚪ | ⚪ | Slovenian→Swedish |
| 816 | sl-uk | Helsinki-NLP/opus-mt-sl-uk | windy-pair-sl-uk | windy-pair-sl-uk-ct2 | ⚪ | ⚪ | ⚪ | Slovenian→Ukrainian |
| 817 | sla-en | Helsinki-NLP/opus-mt-sla-en | windy-pair-sla-en | windy-pair-sla-en-ct2 | ⚪ | ⚪ | ⚪ | SLA→English |
| 818 | sla-sla | Helsinki-NLP/opus-mt-sla-sla | windy-pair-sla-sla | windy-pair-sla-sla-ct2 | ⚪ | ⚪ | ⚪ | SLA→SLA |
| 819 | sn-sv | Helsinki-NLP/opus-mt-sn-sv | windy-pair-sn-sv | windy-pair-sn-sv-ct2 | ⚪ | ⚪ | ⚪ | Shona→Swedish |
| 820 | sq-en | Helsinki-NLP/opus-mt-sq-en | windy-pair-sq-en | windy-pair-sq-en-ct2 | ⚪ | ⚪ | ⚪ | Albanian→English |
| 821 | sq-es | Helsinki-NLP/opus-mt-sq-es | windy-pair-sq-es | windy-pair-sq-es-ct2 | ⚪ | ⚪ | ⚪ | Albanian→Spanish |
| 822 | sq-sv | Helsinki-NLP/opus-mt-sq-sv | windy-pair-sq-sv | windy-pair-sq-sv-ct2 | ⚪ | ⚪ | ⚪ | Albanian→Swedish |
| 823 | srn-sv | Helsinki-NLP/opus-mt-srn-sv | windy-pair-srn-sv | windy-pair-srn-sv-ct2 | ⚪ | ⚪ | ⚪ | SRN→Swedish |
| 824 | st-sv | Helsinki-NLP/opus-mt-st-sv | windy-pair-st-sv | windy-pair-st-sv-ct2 | ⚪ | ⚪ | ⚪ | Sesotho→Swedish |
| 825 | sv-NORWAY | Helsinki-NLP/opus-mt-sv-NORWAY | windy-pair-sv-NORWAY | windy-pair-sv-NORWAY-ct2 | ⚪ | ⚪ | ⚪ | Swedish→NORWAY |
| 826 | sv-ZH | Helsinki-NLP/opus-mt-sv-ZH | windy-pair-sv-ZH | windy-pair-sv-ZH-ct2 | ⚪ | ⚪ | ⚪ | Swedish→ZH |
| 827 | sv-af | Helsinki-NLP/opus-mt-sv-af | windy-pair-sv-af | windy-pair-sv-af-ct2 | ⚪ | ⚪ | ⚪ | Swedish→Afrikaans |
| 828 | sv-ase | Helsinki-NLP/opus-mt-sv-ase | windy-pair-sv-ase | windy-pair-sv-ase-ct2 | ⚪ | ⚪ | ⚪ | Swedish→ASE |
| 829 | sv-bcl | Helsinki-NLP/opus-mt-sv-bcl | windy-pair-sv-bcl | windy-pair-sv-bcl-ct2 | ⚪ | ⚪ | ⚪ | Swedish→BCL |
| 830 | sv-bem | Helsinki-NLP/opus-mt-sv-bem | windy-pair-sv-bem | windy-pair-sv-bem-ct2 | ⚪ | ⚪ | ⚪ | Swedish→BEM |
| 831 | sv-bg | Helsinki-NLP/opus-mt-sv-bg | windy-pair-sv-bg | windy-pair-sv-bg-ct2 | ⚪ | ⚪ | ⚪ | Swedish→Bulgarian |
| 832 | sv-bi | Helsinki-NLP/opus-mt-sv-bi | windy-pair-sv-bi | windy-pair-sv-bi-ct2 | ⚪ | ⚪ | ⚪ | Swedish→BI |
| 833 | sv-bzs | Helsinki-NLP/opus-mt-sv-bzs | windy-pair-sv-bzs | windy-pair-sv-bzs-ct2 | ⚪ | ⚪ | ⚪ | Swedish→BZS |
| 834 | sv-ceb | Helsinki-NLP/opus-mt-sv-ceb | windy-pair-sv-ceb | windy-pair-sv-ceb-ct2 | ⚪ | ⚪ | ⚪ | Swedish→CEB |
| 835 | sv-chk | Helsinki-NLP/opus-mt-sv-chk | windy-pair-sv-chk | windy-pair-sv-chk-ct2 | ⚪ | ⚪ | ⚪ | Swedish→CHK |
| 836 | sv-crs | Helsinki-NLP/opus-mt-sv-crs | windy-pair-sv-crs | windy-pair-sv-crs-ct2 | ⚪ | ⚪ | ⚪ | Swedish→CRS |
| 837 | sv-cs | Helsinki-NLP/opus-mt-sv-cs | windy-pair-sv-cs | windy-pair-sv-cs-ct2 | ⚪ | ⚪ | ⚪ | Swedish→Czech |
| 838 | sv-ee | Helsinki-NLP/opus-mt-sv-ee | windy-pair-sv-ee | windy-pair-sv-ee-ct2 | ⚪ | ⚪ | ⚪ | Swedish→EE |
| 839 | sv-efi | Helsinki-NLP/opus-mt-sv-efi | windy-pair-sv-efi | windy-pair-sv-efi-ct2 | ⚪ | ⚪ | ⚪ | Swedish→EFI |
| 840 | sv-el | Helsinki-NLP/opus-mt-sv-el | windy-pair-sv-el | windy-pair-sv-el-ct2 | ⚪ | ⚪ | ⚪ | Swedish→Greek |
| 841 | sv-en | Helsinki-NLP/opus-mt-sv-en | windy-pair-sv-en | windy-pair-sv-en-ct2 | ⚪ | ⚪ | ⚪ | Swedish→English |
| 842 | sv-eo | Helsinki-NLP/opus-mt-sv-eo | windy-pair-sv-eo | windy-pair-sv-eo-ct2 | ⚪ | ⚪ | ⚪ | Swedish→Esperanto |
| 843 | sv-es | Helsinki-NLP/opus-mt-sv-es | windy-pair-sv-es | windy-pair-sv-es-ct2 | ⚪ | ⚪ | ⚪ | Swedish→Spanish |
| 844 | sv-et | Helsinki-NLP/opus-mt-sv-et | windy-pair-sv-et | windy-pair-sv-et-ct2 | ⚪ | ⚪ | ⚪ | Swedish→Estonian |
| 845 | sv-fi | Helsinki-NLP/opus-mt-sv-fi | windy-pair-sv-fi | windy-pair-sv-fi-ct2 | ⚪ | ⚪ | ⚪ | Swedish→Finnish |
| 846 | sv-fj | Helsinki-NLP/opus-mt-sv-fj | windy-pair-sv-fj | windy-pair-sv-fj-ct2 | ⚪ | ⚪ | ⚪ | Swedish→FJ |
| 847 | sv-fr | Helsinki-NLP/opus-mt-sv-fr | windy-pair-sv-fr | windy-pair-sv-fr-ct2 | ⚪ | ⚪ | ⚪ | Swedish→French |
| 848 | sv-gaa | Helsinki-NLP/opus-mt-sv-gaa | windy-pair-sv-gaa | windy-pair-sv-gaa-ct2 | ⚪ | ⚪ | ⚪ | Swedish→GAA |
| 849 | sv-gil | Helsinki-NLP/opus-mt-sv-gil | windy-pair-sv-gil | windy-pair-sv-gil-ct2 | ⚪ | ⚪ | ⚪ | Swedish→GIL |
| 850 | sv-guw | Helsinki-NLP/opus-mt-sv-guw | windy-pair-sv-guw | windy-pair-sv-guw-ct2 | ⚪ | ⚪ | ⚪ | Swedish→GUW |
| 851 | sv-ha | Helsinki-NLP/opus-mt-sv-ha | windy-pair-sv-ha | windy-pair-sv-ha-ct2 | ⚪ | ⚪ | ⚪ | Swedish→Hausa |
| 852 | sv-he | Helsinki-NLP/opus-mt-sv-he | windy-pair-sv-he | windy-pair-sv-he-ct2 | ⚪ | ⚪ | ⚪ | Swedish→Hebrew |
| 853 | sv-hil | Helsinki-NLP/opus-mt-sv-hil | windy-pair-sv-hil | windy-pair-sv-hil-ct2 | ⚪ | ⚪ | ⚪ | Swedish→HIL |
| 854 | sv-ho | Helsinki-NLP/opus-mt-sv-ho | windy-pair-sv-ho | windy-pair-sv-ho-ct2 | ⚪ | ⚪ | ⚪ | Swedish→HO |
| 855 | sv-hr | Helsinki-NLP/opus-mt-sv-hr | windy-pair-sv-hr | windy-pair-sv-hr-ct2 | ⚪ | ⚪ | ⚪ | Swedish→Croatian |
| 856 | sv-hu | Helsinki-NLP/opus-mt-sv-hu | windy-pair-sv-hu | windy-pair-sv-hu-ct2 | ⚪ | ⚪ | ⚪ | Swedish→Hungarian |
| 857 | sv-id | Helsinki-NLP/opus-mt-sv-id | windy-pair-sv-id | windy-pair-sv-id-ct2 | ⚪ | ⚪ | ⚪ | Swedish→Indonesian |
| 858 | sv-ig | Helsinki-NLP/opus-mt-sv-ig | windy-pair-sv-ig | windy-pair-sv-ig-ct2 | ⚪ | ⚪ | ⚪ | Swedish→Igbo |
| 859 | sv-is | Helsinki-NLP/opus-mt-sv-is | windy-pair-sv-is | windy-pair-sv-is-ct2 | ⚪ | ⚪ | ⚪ | Swedish→Icelandic |
| 860 | sv-iso | Helsinki-NLP/opus-mt-sv-iso | windy-pair-sv-iso | windy-pair-sv-iso-ct2 | ⚪ | ⚪ | ⚪ | Swedish→ISO |
| 861 | sv-lv | Helsinki-NLP/opus-mt-sv-lv | windy-pair-sv-lv | windy-pair-sv-lv-ct2 | ⚪ | ⚪ | ⚪ | Swedish→Latvian |
| 862 | sv-no | Helsinki-NLP/opus-mt-sv-no | windy-pair-sv-no | windy-pair-sv-no-ct2 | ⚪ | ⚪ | ⚪ | Swedish→Norwegian |
| 863 | sv-pag | Helsinki-NLP/opus-mt-sv-pag | windy-pair-sv-pag | windy-pair-sv-pag-ct2 | ⚪ | ⚪ | ⚪ | Swedish→PAG |
| 864 | sv-pap | Helsinki-NLP/opus-mt-sv-pap | windy-pair-sv-pap | windy-pair-sv-pap-ct2 | ⚪ | ⚪ | ⚪ | Swedish→PAP |
| 865 | sv-ro | Helsinki-NLP/opus-mt-sv-ro | windy-pair-sv-ro | windy-pair-sv-ro-ct2 | ⚪ | ⚪ | ⚪ | Swedish→Romanian |
| 866 | sv-ru | Helsinki-NLP/opus-mt-sv-ru | windy-pair-sv-ru | windy-pair-sv-ru-ct2 | ⚪ | ⚪ | ⚪ | Swedish→Russian |
| 867 | sv-run | Helsinki-NLP/opus-mt-sv-run | windy-pair-sv-run | windy-pair-sv-run-ct2 | ⚪ | ⚪ | ⚪ | Swedish→RUN |
| 868 | sv-sk | Helsinki-NLP/opus-mt-sv-sk | windy-pair-sv-sk | windy-pair-sv-sk-ct2 | ⚪ | ⚪ | ⚪ | Swedish→Slovak |
| 869 | sv-sl | Helsinki-NLP/opus-mt-sv-sl | windy-pair-sv-sl | windy-pair-sv-sl-ct2 | ⚪ | ⚪ | ⚪ | Swedish→Slovenian |
| 870 | sv-sq | Helsinki-NLP/opus-mt-sv-sq | windy-pair-sv-sq | windy-pair-sv-sq-ct2 | ⚪ | ⚪ | ⚪ | Swedish→Albanian |
| 871 | sv-swc | Helsinki-NLP/opus-mt-sv-swc | windy-pair-sv-swc | windy-pair-sv-swc-ct2 | ⚪ | ⚪ | ⚪ | Swedish→SWC |
| 872 | sv-th | Helsinki-NLP/opus-mt-sv-th | windy-pair-sv-th | windy-pair-sv-th-ct2 | ⚪ | ⚪ | ⚪ | Swedish→Thai |
| 873 | sv-tll | Helsinki-NLP/opus-mt-sv-tll | windy-pair-sv-tll | windy-pair-sv-tll-ct2 | ⚪ | ⚪ | ⚪ | Swedish→TLL |
| 874 | sv-uk | Helsinki-NLP/opus-mt-sv-uk | windy-pair-sv-uk | windy-pair-sv-uk-ct2 | ⚪ | ⚪ | ⚪ | Swedish→Ukrainian |
| 875 | sv-xh | Helsinki-NLP/opus-mt-sv-xh | windy-pair-sv-xh | windy-pair-sv-xh-ct2 | ⚪ | ⚪ | ⚪ | Swedish→Xhosa |
| 876 | sv-yo | Helsinki-NLP/opus-mt-sv-yo | windy-pair-sv-yo | windy-pair-sv-yo-ct2 | ⚪ | ⚪ | ⚪ | Swedish→Yoruba |
| 877 | swc-en | Helsinki-NLP/opus-mt-swc-en | windy-pair-swc-en | windy-pair-swc-en-ct2 | ⚪ | ⚪ | ⚪ | SWC→English |
| 878 | swc-es | Helsinki-NLP/opus-mt-swc-es | windy-pair-swc-es | windy-pair-swc-es-ct2 | ⚪ | ⚪ | ⚪ | SWC→Spanish |
| 879 | swc-fi | Helsinki-NLP/opus-mt-swc-fi | windy-pair-swc-fi | windy-pair-swc-fi-ct2 | ⚪ | ⚪ | ⚪ | SWC→Finnish |
| 880 | swc-fr | Helsinki-NLP/opus-mt-swc-fr | windy-pair-swc-fr | windy-pair-swc-fr-ct2 | ⚪ | ⚪ | ⚪ | SWC→French |
| 881 | swc-sv | Helsinki-NLP/opus-mt-swc-sv | windy-pair-swc-sv | windy-pair-swc-sv-ct2 | ⚪ | ⚪ | ⚪ | SWC→Swedish |
| 882 | synthetic-en-eu | Helsinki-NLP/opus-mt-synthetic-en-eu | windy-pair-synthetic-en-eu | windy-pair-synthetic-en-eu-ct2 | ⚪ | ⚪ | ⚪ | SYNTHETIC→EN-EU |
| 883 | synthetic-en-is | Helsinki-NLP/opus-mt-synthetic-en-is | windy-pair-synthetic-en-is | windy-pair-synthetic-en-is-ct2 | ⚪ | ⚪ | ⚪ | SYNTHETIC→EN-IS |
| 884 | synthetic-en-ka | Helsinki-NLP/opus-mt-synthetic-en-ka | windy-pair-synthetic-en-ka | windy-pair-synthetic-en-ka-ct2 | ⚪ | ⚪ | ⚪ | SYNTHETIC→EN-KA |
| 885 | synthetic-en-mk | Helsinki-NLP/opus-mt-synthetic-en-mk | windy-pair-synthetic-en-mk | windy-pair-synthetic-en-mk-ct2 | ⚪ | ⚪ | ⚪ | SYNTHETIC→EN-MK |
| 886 | synthetic-en-so | Helsinki-NLP/opus-mt-synthetic-en-so | windy-pair-synthetic-en-so | windy-pair-synthetic-en-so-ct2 | ⚪ | ⚪ | ⚪ | SYNTHETIC→EN-SO |
| 887 | synthetic-en-uk | Helsinki-NLP/opus-mt-synthetic-en-uk | windy-pair-synthetic-en-uk | windy-pair-synthetic-en-uk-ct2 | ⚪ | ⚪ | ⚪ | SYNTHETIC→EN-UK |
| 888 | taw-en | Helsinki-NLP/opus-mt-taw-en | windy-pair-taw-en | windy-pair-taw-en-ct2 | ⚪ | ⚪ | ⚪ | TAW→English |
| 889 | tc-base-bat-zle | Helsinki-NLP/opus-mt-tc-base-bat-zle | windy-pair-tc-base-bat-zle | windy-pair-tc-base-bat-zle-ct2 | ⚪ | ⚪ | ⚪ | TC→BASE-BAT-ZLE |
| 890 | tc-base-ces_slk-uk | Helsinki-NLP/opus-mt-tc-base-ces_slk-uk | windy-pair-tc-base-ces_slk-uk | windy-pair-tc-base-ces_slk-uk-ct2 | ⚪ | ⚪ | ⚪ | TC→BASE-CES_SLK-UK |
| 891 | tc-base-fi-uk | Helsinki-NLP/opus-mt-tc-base-fi-uk | windy-pair-tc-base-fi-uk | windy-pair-tc-base-fi-uk-ct2 | ⚪ | ⚪ | ⚪ | TC→BASE-FI-UK |
| 892 | tc-base-hu-uk | Helsinki-NLP/opus-mt-tc-base-hu-uk | windy-pair-tc-base-hu-uk | windy-pair-tc-base-hu-uk-ct2 | ⚪ | ⚪ | ⚪ | TC→BASE-HU-UK |
| 893 | tc-base-ro-uk | Helsinki-NLP/opus-mt-tc-base-ro-uk | windy-pair-tc-base-ro-uk | windy-pair-tc-base-ro-uk-ct2 | ⚪ | ⚪ | ⚪ | TC→BASE-RO-UK |
| 894 | tc-base-tr-uk | Helsinki-NLP/opus-mt-tc-base-tr-uk | windy-pair-tc-base-tr-uk | windy-pair-tc-base-tr-uk-ct2 | ⚪ | ⚪ | ⚪ | TC→BASE-TR-UK |
| 895 | tc-base-uk-ces_slk | Helsinki-NLP/opus-mt-tc-base-uk-ces_slk | windy-pair-tc-base-uk-ces_slk | windy-pair-tc-base-uk-ces_slk-ct2 | ⚪ | ⚪ | ⚪ | TC→BASE-UK-CES_SLK |
| 896 | tc-base-uk-fi | Helsinki-NLP/opus-mt-tc-base-uk-fi | windy-pair-tc-base-uk-fi | windy-pair-tc-base-uk-fi-ct2 | ⚪ | ⚪ | ⚪ | TC→BASE-UK-FI |
| 897 | tc-base-uk-hu | Helsinki-NLP/opus-mt-tc-base-uk-hu | windy-pair-tc-base-uk-hu | windy-pair-tc-base-uk-hu-ct2 | ⚪ | ⚪ | ⚪ | TC→BASE-UK-HU |
| 898 | tc-base-uk-ro | Helsinki-NLP/opus-mt-tc-base-uk-ro | windy-pair-tc-base-uk-ro | windy-pair-tc-base-uk-ro-ct2 | ⚪ | ⚪ | ⚪ | TC→BASE-UK-RO |
| 899 | tc-base-uk-tr | Helsinki-NLP/opus-mt-tc-base-uk-tr | windy-pair-tc-base-uk-tr | windy-pair-tc-base-uk-tr-ct2 | ⚪ | ⚪ | ⚪ | TC→BASE-UK-TR |
| 900 | tc-base-zle-bat | Helsinki-NLP/opus-mt-tc-base-zle-bat | windy-pair-tc-base-zle-bat | windy-pair-tc-base-zle-bat-ct2 | ⚪ | ⚪ | ⚪ | TC→BASE-ZLE-BAT |
| 901 | tc-bible-big-aav-fra_ita_por_spa | Helsinki-NLP/opus-mt-tc-bible-big-aav-fra_ita_por_spa | windy-pair-tc-bible-big-aav-fra_ita_por_spa | windy-pair-tc-bible-big-aav-fra_ita_por_spa-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-AAV-FRA_ITA_POR_SPA |
| 902 | tc-bible-big-afa-deu_eng_fra_por_spa | Helsinki-NLP/opus-mt-tc-bible-big-afa-deu_eng_fra_por_spa | windy-pair-tc-bible-big-afa-deu_eng_fra_por_spa | windy-pair-tc-bible-big-afa-deu_eng_fra_por_spa-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-AFA-DEU_ENG_FRA_POR_SPA |
| 903 | tc-bible-big-afa-deu_eng_nld | Helsinki-NLP/opus-mt-tc-bible-big-afa-deu_eng_nld | windy-pair-tc-bible-big-afa-deu_eng_nld | windy-pair-tc-bible-big-afa-deu_eng_nld-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-AFA-DEU_ENG_NLD |
| 904 | tc-bible-big-afa-en | Helsinki-NLP/opus-mt-tc-bible-big-afa-en | windy-pair-tc-bible-big-afa-en | windy-pair-tc-bible-big-afa-en-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-AFA-EN |
| 905 | tc-bible-big-afa-fra_ita_por_spa | Helsinki-NLP/opus-mt-tc-bible-big-afa-fra_ita_por_spa | windy-pair-tc-bible-big-afa-fra_ita_por_spa | windy-pair-tc-bible-big-afa-fra_ita_por_spa-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-AFA-FRA_ITA_POR_SPA |
| 906 | tc-bible-big-bat-deu_eng_fra_por_spa | Helsinki-NLP/opus-mt-tc-bible-big-bat-deu_eng_fra_por_spa | windy-pair-tc-bible-big-bat-deu_eng_fra_por_spa | windy-pair-tc-bible-big-bat-deu_eng_fra_por_spa-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-BAT-DEU_ENG_FRA_POR_SPA |
| 907 | tc-bible-big-bat-deu_eng_nld | Helsinki-NLP/opus-mt-tc-bible-big-bat-deu_eng_nld | windy-pair-tc-bible-big-bat-deu_eng_nld | windy-pair-tc-bible-big-bat-deu_eng_nld-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-BAT-DEU_ENG_NLD |
| 908 | tc-bible-big-bat-en | Helsinki-NLP/opus-mt-tc-bible-big-bat-en | windy-pair-tc-bible-big-bat-en | windy-pair-tc-bible-big-bat-en-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-BAT-EN |
| 909 | tc-bible-big-bnt-deu_eng_fra_por_spa | Helsinki-NLP/opus-mt-tc-bible-big-bnt-deu_eng_fra_por_spa | windy-pair-tc-bible-big-bnt-deu_eng_fra_por_spa | windy-pair-tc-bible-big-bnt-deu_eng_fra_por_spa-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-BNT-DEU_ENG_FRA_POR_SPA |
| 910 | tc-bible-big-cel-deu_eng_fra_por_spa | Helsinki-NLP/opus-mt-tc-bible-big-cel-deu_eng_fra_por_spa | windy-pair-tc-bible-big-cel-deu_eng_fra_por_spa | windy-pair-tc-bible-big-cel-deu_eng_fra_por_spa-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-CEL-DEU_ENG_FRA_POR_SPA |
| 911 | tc-bible-big-deu_eng_fra_por_spa-afa | Helsinki-NLP/opus-mt-tc-bible-big-deu_eng_fra_por_spa-afa | windy-pair-tc-bible-big-deu_eng_fra_por_spa-afa | windy-pair-tc-bible-big-deu_eng_fra_por_spa-afa-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-DEU_ENG_FRA_POR_SPA-AFA |
| 912 | tc-bible-big-deu_eng_fra_por_spa-bat | Helsinki-NLP/opus-mt-tc-bible-big-deu_eng_fra_por_spa-bat | windy-pair-tc-bible-big-deu_eng_fra_por_spa-bat | windy-pair-tc-bible-big-deu_eng_fra_por_spa-bat-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-DEU_ENG_FRA_POR_SPA-BAT |
| 913 | tc-bible-big-deu_eng_fra_por_spa-bnt | Helsinki-NLP/opus-mt-tc-bible-big-deu_eng_fra_por_spa-bnt | windy-pair-tc-bible-big-deu_eng_fra_por_spa-bnt | windy-pair-tc-bible-big-deu_eng_fra_por_spa-bnt-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-DEU_ENG_FRA_POR_SPA-BNT |
| 914 | tc-bible-big-deu_eng_fra_por_spa-fiu | Helsinki-NLP/opus-mt-tc-bible-big-deu_eng_fra_por_spa-fiu | windy-pair-tc-bible-big-deu_eng_fra_por_spa-fiu | windy-pair-tc-bible-big-deu_eng_fra_por_spa-fiu-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-DEU_ENG_FRA_POR_SPA-FIU |
| 915 | tc-bible-big-deu_eng_fra_por_spa-gem | Helsinki-NLP/opus-mt-tc-bible-big-deu_eng_fra_por_spa-gem | windy-pair-tc-bible-big-deu_eng_fra_por_spa-gem | windy-pair-tc-bible-big-deu_eng_fra_por_spa-gem-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-DEU_ENG_FRA_POR_SPA-GEM |
| 916 | tc-bible-big-deu_eng_fra_por_spa-gmq | Helsinki-NLP/opus-mt-tc-bible-big-deu_eng_fra_por_spa-gmq | windy-pair-tc-bible-big-deu_eng_fra_por_spa-gmq | windy-pair-tc-bible-big-deu_eng_fra_por_spa-gmq-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-DEU_ENG_FRA_POR_SPA-GMQ |
| 917 | tc-bible-big-deu_eng_fra_por_spa-inc | Helsinki-NLP/opus-mt-tc-bible-big-deu_eng_fra_por_spa-inc | windy-pair-tc-bible-big-deu_eng_fra_por_spa-inc | windy-pair-tc-bible-big-deu_eng_fra_por_spa-inc-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-DEU_ENG_FRA_POR_SPA-INC |
| 918 | tc-bible-big-deu_eng_fra_por_spa-ine | Helsinki-NLP/opus-mt-tc-bible-big-deu_eng_fra_por_spa-ine | windy-pair-tc-bible-big-deu_eng_fra_por_spa-ine | windy-pair-tc-bible-big-deu_eng_fra_por_spa-ine-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-DEU_ENG_FRA_POR_SPA-INE |
| 919 | tc-bible-big-deu_eng_fra_por_spa-itc | Helsinki-NLP/opus-mt-tc-bible-big-deu_eng_fra_por_spa-itc | windy-pair-tc-bible-big-deu_eng_fra_por_spa-itc | windy-pair-tc-bible-big-deu_eng_fra_por_spa-itc-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-DEU_ENG_FRA_POR_SPA-ITC |
| 920 | tc-bible-big-deu_eng_fra_por_spa-mkh | Helsinki-NLP/opus-mt-tc-bible-big-deu_eng_fra_por_spa-mkh | windy-pair-tc-bible-big-deu_eng_fra_por_spa-mkh | windy-pair-tc-bible-big-deu_eng_fra_por_spa-mkh-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-DEU_ENG_FRA_POR_SPA-MKH |
| 921 | tc-bible-big-deu_eng_fra_por_spa-mul | Helsinki-NLP/opus-mt-tc-bible-big-deu_eng_fra_por_spa-mul | windy-pair-tc-bible-big-deu_eng_fra_por_spa-mul | windy-pair-tc-bible-big-deu_eng_fra_por_spa-mul-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-DEU_ENG_FRA_POR_SPA-MUL |
| 922 | tc-bible-big-deu_eng_fra_por_spa-roa | Helsinki-NLP/opus-mt-tc-bible-big-deu_eng_fra_por_spa-roa | windy-pair-tc-bible-big-deu_eng_fra_por_spa-roa | windy-pair-tc-bible-big-deu_eng_fra_por_spa-roa-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-DEU_ENG_FRA_POR_SPA-ROA |
| 923 | tc-bible-big-deu_eng_fra_por_spa-sem | Helsinki-NLP/opus-mt-tc-bible-big-deu_eng_fra_por_spa-sem | windy-pair-tc-bible-big-deu_eng_fra_por_spa-sem | windy-pair-tc-bible-big-deu_eng_fra_por_spa-sem-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-DEU_ENG_FRA_POR_SPA-SEM |
| 924 | tc-bible-big-deu_eng_fra_por_spa-sla | Helsinki-NLP/opus-mt-tc-bible-big-deu_eng_fra_por_spa-sla | windy-pair-tc-bible-big-deu_eng_fra_por_spa-sla | windy-pair-tc-bible-big-deu_eng_fra_por_spa-sla-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-DEU_ENG_FRA_POR_SPA-SLA |
| 925 | tc-bible-big-deu_eng_fra_por_spa-trk | Helsinki-NLP/opus-mt-tc-bible-big-deu_eng_fra_por_spa-trk | windy-pair-tc-bible-big-deu_eng_fra_por_spa-trk | windy-pair-tc-bible-big-deu_eng_fra_por_spa-trk-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-DEU_ENG_FRA_POR_SPA-TRK |
| 926 | tc-bible-big-deu_eng_fra_por_spa-urj | Helsinki-NLP/opus-mt-tc-bible-big-deu_eng_fra_por_spa-urj | windy-pair-tc-bible-big-deu_eng_fra_por_spa-urj | windy-pair-tc-bible-big-deu_eng_fra_por_spa-urj-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-DEU_ENG_FRA_POR_SPA-URJ |
| 927 | tc-bible-big-dra-deu_eng_nld | Helsinki-NLP/opus-mt-tc-bible-big-dra-deu_eng_nld | windy-pair-tc-bible-big-dra-deu_eng_nld | windy-pair-tc-bible-big-dra-deu_eng_nld-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-DRA-DEU_ENG_NLD |
| 928 | tc-bible-big-dra-en | Helsinki-NLP/opus-mt-tc-bible-big-dra-en | windy-pair-tc-bible-big-dra-en | windy-pair-tc-bible-big-dra-en-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-DRA-EN |
| 929 | tc-bible-big-fiu-deu_eng_fra_por_spa | Helsinki-NLP/opus-mt-tc-bible-big-fiu-deu_eng_fra_por_spa | windy-pair-tc-bible-big-fiu-deu_eng_fra_por_spa | windy-pair-tc-bible-big-fiu-deu_eng_fra_por_spa-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-FIU-DEU_ENG_FRA_POR_SPA |
| 930 | tc-bible-big-fiu-en | Helsinki-NLP/opus-mt-tc-bible-big-fiu-en | windy-pair-tc-bible-big-fiu-en | windy-pair-tc-bible-big-fiu-en-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-FIU-EN |
| 931 | tc-bible-big-fiu-fra_ita_por_spa | Helsinki-NLP/opus-mt-tc-bible-big-fiu-fra_ita_por_spa | windy-pair-tc-bible-big-fiu-fra_ita_por_spa | windy-pair-tc-bible-big-fiu-fra_ita_por_spa-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-FIU-FRA_ITA_POR_SPA |
| 932 | tc-bible-big-gem-deu_eng_fra_por_spa | Helsinki-NLP/opus-mt-tc-bible-big-gem-deu_eng_fra_por_spa | windy-pair-tc-bible-big-gem-deu_eng_fra_por_spa | windy-pair-tc-bible-big-gem-deu_eng_fra_por_spa-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-GEM-DEU_ENG_FRA_POR_SPA |
| 933 | tc-bible-big-gem-fra_ita_por_spa | Helsinki-NLP/opus-mt-tc-bible-big-gem-fra_ita_por_spa | windy-pair-tc-bible-big-gem-fra_ita_por_spa | windy-pair-tc-bible-big-gem-fra_ita_por_spa-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-GEM-FRA_ITA_POR_SPA |
| 934 | tc-bible-big-gmq-deu_eng_fra_por_spa | Helsinki-NLP/opus-mt-tc-bible-big-gmq-deu_eng_fra_por_spa | windy-pair-tc-bible-big-gmq-deu_eng_fra_por_spa | windy-pair-tc-bible-big-gmq-deu_eng_fra_por_spa-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-GMQ-DEU_ENG_FRA_POR_SPA |
| 935 | tc-bible-big-gmq-en | Helsinki-NLP/opus-mt-tc-bible-big-gmq-en | windy-pair-tc-bible-big-gmq-en | windy-pair-tc-bible-big-gmq-en-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-GMQ-EN |
| 936 | tc-bible-big-gmw-fra_ita_por_spa | Helsinki-NLP/opus-mt-tc-bible-big-gmw-fra_ita_por_spa | windy-pair-tc-bible-big-gmw-fra_ita_por_spa | windy-pair-tc-bible-big-gmw-fra_ita_por_spa-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-GMW-FRA_ITA_POR_SPA |
| 937 | tc-bible-big-inc-deu_eng_fra_por_spa | Helsinki-NLP/opus-mt-tc-bible-big-inc-deu_eng_fra_por_spa | windy-pair-tc-bible-big-inc-deu_eng_fra_por_spa | windy-pair-tc-bible-big-inc-deu_eng_fra_por_spa-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-INC-DEU_ENG_FRA_POR_SPA |
| 938 | tc-bible-big-inc-deu_eng_nld | Helsinki-NLP/opus-mt-tc-bible-big-inc-deu_eng_nld | windy-pair-tc-bible-big-inc-deu_eng_nld | windy-pair-tc-bible-big-inc-deu_eng_nld-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-INC-DEU_ENG_NLD |
| 939 | tc-bible-big-inc-en | Helsinki-NLP/opus-mt-tc-bible-big-inc-en | windy-pair-tc-bible-big-inc-en | windy-pair-tc-bible-big-inc-en-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-INC-EN |
| 940 | tc-bible-big-ine-deu_eng_fra_por_spa | Helsinki-NLP/opus-mt-tc-bible-big-ine-deu_eng_fra_por_spa | windy-pair-tc-bible-big-ine-deu_eng_fra_por_spa | windy-pair-tc-bible-big-ine-deu_eng_fra_por_spa-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-INE-DEU_ENG_FRA_POR_SPA |
| 941 | tc-bible-big-ine-deu_eng_nld | Helsinki-NLP/opus-mt-tc-bible-big-ine-deu_eng_nld | windy-pair-tc-bible-big-ine-deu_eng_nld | windy-pair-tc-bible-big-ine-deu_eng_nld-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-INE-DEU_ENG_NLD |
| 942 | tc-bible-big-itc-deu_eng_fra_por_spa | Helsinki-NLP/opus-mt-tc-bible-big-itc-deu_eng_fra_por_spa | windy-pair-tc-bible-big-itc-deu_eng_fra_por_spa | windy-pair-tc-bible-big-itc-deu_eng_fra_por_spa-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-ITC-DEU_ENG_FRA_POR_SPA |
| 943 | tc-bible-big-itc-deu_eng_nld | Helsinki-NLP/opus-mt-tc-bible-big-itc-deu_eng_nld | windy-pair-tc-bible-big-itc-deu_eng_nld | windy-pair-tc-bible-big-itc-deu_eng_nld-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-ITC-DEU_ENG_NLD |
| 944 | tc-bible-big-itc-fra_ita_por_spa | Helsinki-NLP/opus-mt-tc-bible-big-itc-fra_ita_por_spa | windy-pair-tc-bible-big-itc-fra_ita_por_spa | windy-pair-tc-bible-big-itc-fra_ita_por_spa-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-ITC-FRA_ITA_POR_SPA |
| 945 | tc-bible-big-map-fra_ita_por_spa | Helsinki-NLP/opus-mt-tc-bible-big-map-fra_ita_por_spa | windy-pair-tc-bible-big-map-fra_ita_por_spa | windy-pair-tc-bible-big-map-fra_ita_por_spa-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-MAP-FRA_ITA_POR_SPA |
| 946 | tc-bible-big-mkh-deu_eng_nld | Helsinki-NLP/opus-mt-tc-bible-big-mkh-deu_eng_nld | windy-pair-tc-bible-big-mkh-deu_eng_nld | windy-pair-tc-bible-big-mkh-deu_eng_nld-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-MKH-DEU_ENG_NLD |
| 947 | tc-bible-big-mkh-fra_ita_por_spa | Helsinki-NLP/opus-mt-tc-bible-big-mkh-fra_ita_por_spa | windy-pair-tc-bible-big-mkh-fra_ita_por_spa | windy-pair-tc-bible-big-mkh-fra_ita_por_spa-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-MKH-FRA_ITA_POR_SPA |
| 948 | tc-bible-big-mul-deu_eng_fra_por_spa | Helsinki-NLP/opus-mt-tc-bible-big-mul-deu_eng_fra_por_spa | windy-pair-tc-bible-big-mul-deu_eng_fra_por_spa | windy-pair-tc-bible-big-mul-deu_eng_fra_por_spa-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-MUL-DEU_ENG_FRA_POR_SPA |
| 949 | tc-bible-big-mul-deu_eng_nld | Helsinki-NLP/opus-mt-tc-bible-big-mul-deu_eng_nld | windy-pair-tc-bible-big-mul-deu_eng_nld | windy-pair-tc-bible-big-mul-deu_eng_nld-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-MUL-DEU_ENG_NLD |
| 950 | tc-bible-big-mul-mul | Helsinki-NLP/opus-mt-tc-bible-big-mul-mul | windy-pair-tc-bible-big-mul-mul | windy-pair-tc-bible-big-mul-mul-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-MUL-MUL |
| 951 | tc-bible-big-poz-fra_ita_por_spa | Helsinki-NLP/opus-mt-tc-bible-big-poz-fra_ita_por_spa | windy-pair-tc-bible-big-poz-fra_ita_por_spa | windy-pair-tc-bible-big-poz-fra_ita_por_spa-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-POZ-FRA_ITA_POR_SPA |
| 952 | tc-bible-big-pqw-fra_ita_por_spa | Helsinki-NLP/opus-mt-tc-bible-big-pqw-fra_ita_por_spa | windy-pair-tc-bible-big-pqw-fra_ita_por_spa | windy-pair-tc-bible-big-pqw-fra_ita_por_spa-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-PQW-FRA_ITA_POR_SPA |
| 953 | tc-bible-big-roa-deu_eng_fra_por_spa | Helsinki-NLP/opus-mt-tc-bible-big-roa-deu_eng_fra_por_spa | windy-pair-tc-bible-big-roa-deu_eng_fra_por_spa | windy-pair-tc-bible-big-roa-deu_eng_fra_por_spa-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-ROA-DEU_ENG_FRA_POR_SPA |
| 954 | tc-bible-big-roa-en | Helsinki-NLP/opus-mt-tc-bible-big-roa-en | windy-pair-tc-bible-big-roa-en | windy-pair-tc-bible-big-roa-en-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-ROA-EN |
| 955 | tc-bible-big-sem-deu_eng_fra_por_spa | Helsinki-NLP/opus-mt-tc-bible-big-sem-deu_eng_fra_por_spa | windy-pair-tc-bible-big-sem-deu_eng_fra_por_spa | windy-pair-tc-bible-big-sem-deu_eng_fra_por_spa-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-SEM-DEU_ENG_FRA_POR_SPA |
| 956 | tc-bible-big-sem-deu_eng_nld | Helsinki-NLP/opus-mt-tc-bible-big-sem-deu_eng_nld | windy-pair-tc-bible-big-sem-deu_eng_nld | windy-pair-tc-bible-big-sem-deu_eng_nld-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-SEM-DEU_ENG_NLD |
| 957 | tc-bible-big-sem-en | Helsinki-NLP/opus-mt-tc-bible-big-sem-en | windy-pair-tc-bible-big-sem-en | windy-pair-tc-bible-big-sem-en-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-SEM-EN |
| 958 | tc-bible-big-sla-deu_eng_nld | Helsinki-NLP/opus-mt-tc-bible-big-sla-deu_eng_nld | windy-pair-tc-bible-big-sla-deu_eng_nld | windy-pair-tc-bible-big-sla-deu_eng_nld-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-SLA-DEU_ENG_NLD |
| 959 | tc-bible-big-sla-en | Helsinki-NLP/opus-mt-tc-bible-big-sla-en | windy-pair-tc-bible-big-sla-en | windy-pair-tc-bible-big-sla-en-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-SLA-EN |
| 960 | tc-bible-big-tai-deu_eng_fra_por_spa | Helsinki-NLP/opus-mt-tc-bible-big-tai-deu_eng_fra_por_spa | windy-pair-tc-bible-big-tai-deu_eng_fra_por_spa | windy-pair-tc-bible-big-tai-deu_eng_fra_por_spa-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-TAI-DEU_ENG_FRA_POR_SPA |
| 961 | tc-bible-big-trk-deu_eng_fra_por_spa | Helsinki-NLP/opus-mt-tc-bible-big-trk-deu_eng_fra_por_spa | windy-pair-tc-bible-big-trk-deu_eng_fra_por_spa | windy-pair-tc-bible-big-trk-deu_eng_fra_por_spa-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-TRK-DEU_ENG_FRA_POR_SPA |
| 962 | tc-bible-big-urj-deu_eng_fra_por_spa | Helsinki-NLP/opus-mt-tc-bible-big-urj-deu_eng_fra_por_spa | windy-pair-tc-bible-big-urj-deu_eng_fra_por_spa | windy-pair-tc-bible-big-urj-deu_eng_fra_por_spa-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-URJ-DEU_ENG_FRA_POR_SPA |
| 963 | tc-bible-big-urj-deu_eng_nld | Helsinki-NLP/opus-mt-tc-bible-big-urj-deu_eng_nld | windy-pair-tc-bible-big-urj-deu_eng_nld | windy-pair-tc-bible-big-urj-deu_eng_nld-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-URJ-DEU_ENG_NLD |
| 964 | tc-bible-big-urj-fra_ita_por_spa | Helsinki-NLP/opus-mt-tc-bible-big-urj-fra_ita_por_spa | windy-pair-tc-bible-big-urj-fra_ita_por_spa | windy-pair-tc-bible-big-urj-fra_ita_por_spa-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-URJ-FRA_ITA_POR_SPA |
| 965 | tc-bible-big-zhx-deu_eng_fra_por_spa | Helsinki-NLP/opus-mt-tc-bible-big-zhx-deu_eng_fra_por_spa | windy-pair-tc-bible-big-zhx-deu_eng_fra_por_spa | windy-pair-tc-bible-big-zhx-deu_eng_fra_por_spa-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-ZHX-DEU_ENG_FRA_POR_SPA |
| 966 | tc-bible-big-zhx-en | Helsinki-NLP/opus-mt-tc-bible-big-zhx-en | windy-pair-tc-bible-big-zhx-en | windy-pair-tc-bible-big-zhx-en-ct2 | ⚪ | ⚪ | ⚪ | TC→BIBLE-BIG-ZHX-EN |
| 967 | tc-big-ar-en | Helsinki-NLP/opus-mt-tc-big-ar-en | windy-pair-tc-big-ar-en | windy-pair-tc-big-ar-en-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-AR-EN |
| 968 | tc-big-ar-gmq | Helsinki-NLP/opus-mt-tc-big-ar-gmq | windy-pair-tc-big-ar-gmq | windy-pair-tc-big-ar-gmq-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-AR-GMQ |
| 969 | tc-big-ar-itc | Helsinki-NLP/opus-mt-tc-big-ar-itc | windy-pair-tc-big-ar-itc | windy-pair-tc-big-ar-itc-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-AR-ITC |
| 970 | tc-big-bg-en | Helsinki-NLP/opus-mt-tc-big-bg-en | windy-pair-tc-big-bg-en | windy-pair-tc-big-bg-en-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-BG-EN |
| 971 | tc-big-cat_oci_spa-en | Helsinki-NLP/opus-mt-tc-big-cat_oci_spa-en | windy-pair-tc-big-cat_oci_spa-en | windy-pair-tc-big-cat_oci_spa-en-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-CAT_OCI_SPA-EN |
| 972 | tc-big-cel-en | Helsinki-NLP/opus-mt-tc-big-cel-en | windy-pair-tc-big-cel-en | windy-pair-tc-big-cel-en-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-CEL-EN |
| 973 | tc-big-ces_slk-en | Helsinki-NLP/opus-mt-tc-big-ces_slk-en | windy-pair-tc-big-ces_slk-en | windy-pair-tc-big-ces_slk-en-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-CES_SLK-EN |
| 974 | tc-big-de-gmq | Helsinki-NLP/opus-mt-tc-big-de-gmq | windy-pair-tc-big-de-gmq | windy-pair-tc-big-de-gmq-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-DE-GMQ |
| 975 | tc-big-el-en | Helsinki-NLP/opus-mt-tc-big-el-en | windy-pair-tc-big-el-en | windy-pair-tc-big-el-en-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-EL-EN |
| 976 | tc-big-en-ar | Helsinki-NLP/opus-mt-tc-big-en-ar | windy-pair-tc-big-en-ar | windy-pair-tc-big-en-ar-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-EN-AR |
| 977 | tc-big-en-bg | Helsinki-NLP/opus-mt-tc-big-en-bg | windy-pair-tc-big-en-bg | windy-pair-tc-big-en-bg-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-EN-BG |
| 978 | tc-big-en-cat_oci_spa | Helsinki-NLP/opus-mt-tc-big-en-cat_oci_spa | windy-pair-tc-big-en-cat_oci_spa | windy-pair-tc-big-en-cat_oci_spa-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-EN-CAT_OCI_SPA |
| 979 | tc-big-en-ces_slk | Helsinki-NLP/opus-mt-tc-big-en-ces_slk | windy-pair-tc-big-en-ces_slk | windy-pair-tc-big-en-ces_slk-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-EN-CES_SLK |
| 980 | tc-big-en-el | Helsinki-NLP/opus-mt-tc-big-en-el | windy-pair-tc-big-en-el | windy-pair-tc-big-en-el-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-EN-EL |
| 981 | tc-big-en-et | Helsinki-NLP/opus-mt-tc-big-en-et | windy-pair-tc-big-en-et | windy-pair-tc-big-en-et-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-EN-ET |
| 982 | tc-big-en-gmq | Helsinki-NLP/opus-mt-tc-big-en-gmq | windy-pair-tc-big-en-gmq | windy-pair-tc-big-en-gmq-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-EN-GMQ |
| 983 | tc-big-en-hu | Helsinki-NLP/opus-mt-tc-big-en-hu | windy-pair-tc-big-en-hu | windy-pair-tc-big-en-hu-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-EN-HU |
| 984 | tc-big-en-it | Helsinki-NLP/opus-mt-tc-big-en-it | windy-pair-tc-big-en-it | windy-pair-tc-big-en-it-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-EN-IT |
| 985 | tc-big-en-ko | Helsinki-NLP/opus-mt-tc-big-en-ko | windy-pair-tc-big-en-ko | windy-pair-tc-big-en-ko-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-EN-KO |
| 986 | tc-big-en-lt | Helsinki-NLP/opus-mt-tc-big-en-lt | windy-pair-tc-big-en-lt | windy-pair-tc-big-en-lt-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-EN-LT |
| 987 | tc-big-en-lv | Helsinki-NLP/opus-mt-tc-big-en-lv | windy-pair-tc-big-en-lv | windy-pair-tc-big-en-lv-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-EN-LV |
| 988 | tc-big-en-pt | Helsinki-NLP/opus-mt-tc-big-en-pt | windy-pair-tc-big-en-pt | windy-pair-tc-big-en-pt-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-EN-PT |
| 989 | tc-big-en-ro | Helsinki-NLP/opus-mt-tc-big-en-ro | windy-pair-tc-big-en-ro | windy-pair-tc-big-en-ro-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-EN-RO |
| 990 | tc-big-en-tr | Helsinki-NLP/opus-mt-tc-big-en-tr | windy-pair-tc-big-en-tr | windy-pair-tc-big-en-tr-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-EN-TR |
| 991 | tc-big-et-en | Helsinki-NLP/opus-mt-tc-big-et-en | windy-pair-tc-big-et-en | windy-pair-tc-big-et-en-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-ET-EN |
| 992 | tc-big-eu-itc | Helsinki-NLP/opus-mt-tc-big-eu-itc | windy-pair-tc-big-eu-itc | windy-pair-tc-big-eu-itc-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-EU-ITC |
| 993 | tc-big-fa-gmq | Helsinki-NLP/opus-mt-tc-big-fa-gmq | windy-pair-tc-big-fa-gmq | windy-pair-tc-big-fa-gmq-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-FA-GMQ |
| 994 | tc-big-fa-itc | Helsinki-NLP/opus-mt-tc-big-fa-itc | windy-pair-tc-big-fa-itc | windy-pair-tc-big-fa-itc-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-FA-ITC |
| 995 | tc-big-gmq-ar | Helsinki-NLP/opus-mt-tc-big-gmq-ar | windy-pair-tc-big-gmq-ar | windy-pair-tc-big-gmq-ar-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-GMQ-AR |
| 996 | tc-big-gmq-en | Helsinki-NLP/opus-mt-tc-big-gmq-en | windy-pair-tc-big-gmq-en | windy-pair-tc-big-gmq-en-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-GMQ-EN |
| 997 | tc-big-gmq-gmq | Helsinki-NLP/opus-mt-tc-big-gmq-gmq | windy-pair-tc-big-gmq-gmq | windy-pair-tc-big-gmq-gmq-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-GMQ-GMQ |
| 998 | tc-big-gmq-he | Helsinki-NLP/opus-mt-tc-big-gmq-he | windy-pair-tc-big-gmq-he | windy-pair-tc-big-gmq-he-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-GMQ-HE |
| 999 | tc-big-gmq-itc | Helsinki-NLP/opus-mt-tc-big-gmq-itc | windy-pair-tc-big-gmq-itc | windy-pair-tc-big-gmq-itc-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-GMQ-ITC |
| 1000 | tc-big-gmq-tr | Helsinki-NLP/opus-mt-tc-big-gmq-tr | windy-pair-tc-big-gmq-tr | windy-pair-tc-big-gmq-tr-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-GMQ-TR |
| 1001 | tc-big-gmq-zle | Helsinki-NLP/opus-mt-tc-big-gmq-zle | windy-pair-tc-big-gmq-zle | windy-pair-tc-big-gmq-zle-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-GMQ-ZLE |
| 1002 | tc-big-gmq-zlw | Helsinki-NLP/opus-mt-tc-big-gmq-zlw | windy-pair-tc-big-gmq-zlw | windy-pair-tc-big-gmq-zlw-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-GMQ-ZLW |
| 1003 | tc-big-he-gmq | Helsinki-NLP/opus-mt-tc-big-he-gmq | windy-pair-tc-big-he-gmq | windy-pair-tc-big-he-gmq-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-HE-GMQ |
| 1004 | tc-big-he-itc | Helsinki-NLP/opus-mt-tc-big-he-itc | windy-pair-tc-big-he-itc | windy-pair-tc-big-he-itc-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-HE-ITC |
| 1005 | tc-big-hu-en | Helsinki-NLP/opus-mt-tc-big-hu-en | windy-pair-tc-big-hu-en | windy-pair-tc-big-hu-en-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-HU-EN |
| 1006 | tc-big-it-en | Helsinki-NLP/opus-mt-tc-big-it-en | windy-pair-tc-big-it-en | windy-pair-tc-big-it-en-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-IT-EN |
| 1007 | tc-big-it-zle | Helsinki-NLP/opus-mt-tc-big-it-zle | windy-pair-tc-big-it-zle | windy-pair-tc-big-it-zle-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-IT-ZLE |
| 1008 | tc-big-itc-ar | Helsinki-NLP/opus-mt-tc-big-itc-ar | windy-pair-tc-big-itc-ar | windy-pair-tc-big-itc-ar-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-ITC-AR |
| 1009 | tc-big-itc-bat | Helsinki-NLP/opus-mt-tc-big-itc-bat | windy-pair-tc-big-itc-bat | windy-pair-tc-big-itc-bat-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-ITC-BAT |
| 1010 | tc-big-itc-eu | Helsinki-NLP/opus-mt-tc-big-itc-eu | windy-pair-tc-big-itc-eu | windy-pair-tc-big-itc-eu-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-ITC-EU |
| 1011 | tc-big-itc-he | Helsinki-NLP/opus-mt-tc-big-itc-he | windy-pair-tc-big-itc-he | windy-pair-tc-big-itc-he-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-ITC-HE |
| 1012 | tc-big-itc-itc | Helsinki-NLP/opus-mt-tc-big-itc-itc | windy-pair-tc-big-itc-itc | windy-pair-tc-big-itc-itc-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-ITC-ITC |
| 1013 | tc-big-itc-tr | Helsinki-NLP/opus-mt-tc-big-itc-tr | windy-pair-tc-big-itc-tr | windy-pair-tc-big-itc-tr-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-ITC-TR |
| 1014 | tc-big-ko-en | Helsinki-NLP/opus-mt-tc-big-ko-en | windy-pair-tc-big-ko-en | windy-pair-tc-big-ko-en-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-KO-EN |
| 1015 | tc-big-lt-en | Helsinki-NLP/opus-mt-tc-big-lt-en | windy-pair-tc-big-lt-en | windy-pair-tc-big-lt-en-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-LT-EN |
| 1016 | tc-big-lv-en | Helsinki-NLP/opus-mt-tc-big-lv-en | windy-pair-tc-big-lv-en | windy-pair-tc-big-lv-en-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-LV-EN |
| 1017 | tc-big-pt-zle | Helsinki-NLP/opus-mt-tc-big-pt-zle | windy-pair-tc-big-pt-zle | windy-pair-tc-big-pt-zle-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-PT-ZLE |
| 1018 | tc-big-tr-en | Helsinki-NLP/opus-mt-tc-big-tr-en | windy-pair-tc-big-tr-en | windy-pair-tc-big-tr-en-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-TR-EN |
| 1019 | tc-big-zh-ja | Helsinki-NLP/opus-mt-tc-big-zh-ja | windy-pair-tc-big-zh-ja | windy-pair-tc-big-zh-ja-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-ZH-JA |
| 1020 | tc-big-zle-gmq | Helsinki-NLP/opus-mt-tc-big-zle-gmq | windy-pair-tc-big-zle-gmq | windy-pair-tc-big-zle-gmq-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-ZLE-GMQ |
| 1021 | tc-big-zle-it | Helsinki-NLP/opus-mt-tc-big-zle-it | windy-pair-tc-big-zle-it | windy-pair-tc-big-zle-it-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-ZLE-IT |
| 1022 | tc-big-zle-itc | Helsinki-NLP/opus-mt-tc-big-zle-itc | windy-pair-tc-big-zle-itc | windy-pair-tc-big-zle-itc-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-ZLE-ITC |
| 1023 | tc-big-zle-pt | Helsinki-NLP/opus-mt-tc-big-zle-pt | windy-pair-tc-big-zle-pt | windy-pair-tc-big-zle-pt-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-ZLE-PT |
| 1024 | tc-big-zle-zlw | Helsinki-NLP/opus-mt-tc-big-zle-zlw | windy-pair-tc-big-zle-zlw | windy-pair-tc-big-zle-zlw-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-ZLE-ZLW |
| 1025 | tc-big-zls-itc | Helsinki-NLP/opus-mt-tc-big-zls-itc | windy-pair-tc-big-zls-itc | windy-pair-tc-big-zls-itc-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-ZLS-ITC |
| 1026 | tc-big-zlw-en | Helsinki-NLP/opus-mt-tc-big-zlw-en | windy-pair-tc-big-zlw-en | windy-pair-tc-big-zlw-en-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-ZLW-EN |
| 1027 | tc-big-zlw-zle | Helsinki-NLP/opus-mt-tc-big-zlw-zle | windy-pair-tc-big-zlw-zle | windy-pair-tc-big-zlw-zle-ct2 | ⚪ | ⚪ | ⚪ | TC→BIG-ZLW-ZLE |
| 1028 | th-en | Helsinki-NLP/opus-mt-th-en | windy-pair-th-en | windy-pair-th-en-ct2 | ⚪ | ⚪ | ⚪ | Thai→English |
| 1029 | th-fr | Helsinki-NLP/opus-mt-th-fr | windy-pair-th-fr | windy-pair-th-fr-ct2 | ⚪ | ⚪ | ⚪ | Thai→French |
| 1030 | tl-de | Helsinki-NLP/opus-mt-tl-de | windy-pair-tl-de | windy-pair-tl-de-ct2 | ⚪ | ⚪ | ⚪ | Filipino→German |
| 1031 | tl-en | Helsinki-NLP/opus-mt-tl-en | windy-pair-tl-en | windy-pair-tl-en-ct2 | ⚪ | ⚪ | ⚪ | Filipino→English |
| 1032 | tl-es | Helsinki-NLP/opus-mt-tl-es | windy-pair-tl-es | windy-pair-tl-es-ct2 | ⚪ | ⚪ | ⚪ | Filipino→Spanish |
| 1033 | tl-pt | Helsinki-NLP/opus-mt-tl-pt | windy-pair-tl-pt | windy-pair-tl-pt-ct2 | ⚪ | ⚪ | ⚪ | Filipino→Portuguese |
| 1034 | tll-en | Helsinki-NLP/opus-mt-tll-en | windy-pair-tll-en | windy-pair-tll-en-ct2 | ⚪ | ⚪ | ⚪ | TLL→English |
| 1035 | tll-es | Helsinki-NLP/opus-mt-tll-es | windy-pair-tll-es | windy-pair-tll-es-ct2 | ⚪ | ⚪ | ⚪ | TLL→Spanish |
| 1036 | tll-fi | Helsinki-NLP/opus-mt-tll-fi | windy-pair-tll-fi | windy-pair-tll-fi-ct2 | ⚪ | ⚪ | ⚪ | TLL→Finnish |
| 1037 | tll-fr | Helsinki-NLP/opus-mt-tll-fr | windy-pair-tll-fr | windy-pair-tll-fr-ct2 | ⚪ | ⚪ | ⚪ | TLL→French |
| 1038 | tll-sv | Helsinki-NLP/opus-mt-tll-sv | windy-pair-tll-sv | windy-pair-tll-sv-ct2 | ⚪ | ⚪ | ⚪ | TLL→Swedish |
| 1039 | tr-ar | Helsinki-NLP/opus-mt-tr-ar | windy-pair-tr-ar | windy-pair-tr-ar-ct2 | ⚪ | ⚪ | ⚪ | Turkish→Arabic |
| 1040 | tr-az | Helsinki-NLP/opus-mt-tr-az | windy-pair-tr-az | windy-pair-tr-az-ct2 | ⚪ | ⚪ | ⚪ | Turkish→Azerbaijani |
| 1041 | tr-en | Helsinki-NLP/opus-mt-tr-en | windy-pair-tr-en | windy-pair-tr-en-ct2 | ⚪ | ⚪ | ⚪ | Turkish→English |
| 1042 | tr-eo | Helsinki-NLP/opus-mt-tr-eo | windy-pair-tr-eo | windy-pair-tr-eo-ct2 | ⚪ | ⚪ | ⚪ | Turkish→Esperanto |
| 1043 | tr-es | Helsinki-NLP/opus-mt-tr-es | windy-pair-tr-es | windy-pair-tr-es-ct2 | ⚪ | ⚪ | ⚪ | Turkish→Spanish |
| 1044 | tr-fr | Helsinki-NLP/opus-mt-tr-fr | windy-pair-tr-fr | windy-pair-tr-fr-ct2 | ⚪ | ⚪ | ⚪ | Turkish→French |
| 1045 | tr-lt | Helsinki-NLP/opus-mt-tr-lt | windy-pair-tr-lt | windy-pair-tr-lt-ct2 | ⚪ | ⚪ | ⚪ | Turkish→Lithuanian |
| 1046 | tr-sv | Helsinki-NLP/opus-mt-tr-sv | windy-pair-tr-sv | windy-pair-tr-sv-ct2 | ⚪ | ⚪ | ⚪ | Turkish→Swedish |
| 1047 | tr-uk | Helsinki-NLP/opus-mt-tr-uk | windy-pair-tr-uk | windy-pair-tr-uk-ct2 | ⚪ | ⚪ | ⚪ | Turkish→Ukrainian |
| 1048 | trk-en | Helsinki-NLP/opus-mt-trk-en | windy-pair-trk-en | windy-pair-trk-en-ct2 | ⚪ | ⚪ | ⚪ | TRK→English |
| 1049 | uk-bg | Helsinki-NLP/opus-mt-uk-bg | windy-pair-uk-bg | windy-pair-uk-bg-ct2 | ⚪ | ⚪ | ⚪ | Ukrainian→Bulgarian |
| 1050 | uk-ca | Helsinki-NLP/opus-mt-uk-ca | windy-pair-uk-ca | windy-pair-uk-ca-ct2 | ⚪ | ⚪ | ⚪ | Ukrainian→Catalan |
| 1051 | uk-cs | Helsinki-NLP/opus-mt-uk-cs | windy-pair-uk-cs | windy-pair-uk-cs-ct2 | ⚪ | ⚪ | ⚪ | Ukrainian→Czech |
| 1052 | uk-de | Helsinki-NLP/opus-mt-uk-de | windy-pair-uk-de | windy-pair-uk-de-ct2 | ⚪ | ⚪ | ⚪ | Ukrainian→German |
| 1053 | uk-en | Helsinki-NLP/opus-mt-uk-en | windy-pair-uk-en | windy-pair-uk-en-ct2 | ⚪ | ⚪ | ⚪ | Ukrainian→English |
| 1054 | uk-es | Helsinki-NLP/opus-mt-uk-es | windy-pair-uk-es | windy-pair-uk-es-ct2 | ⚪ | ⚪ | ⚪ | Ukrainian→Spanish |
| 1055 | uk-fi | Helsinki-NLP/opus-mt-uk-fi | windy-pair-uk-fi | windy-pair-uk-fi-ct2 | ⚪ | ⚪ | ⚪ | Ukrainian→Finnish |
| 1056 | uk-fr | Helsinki-NLP/opus-mt-uk-fr | windy-pair-uk-fr | windy-pair-uk-fr-ct2 | ⚪ | ⚪ | ⚪ | Ukrainian→French |
| 1057 | uk-he | Helsinki-NLP/opus-mt-uk-he | windy-pair-uk-he | windy-pair-uk-he-ct2 | ⚪ | ⚪ | ⚪ | Ukrainian→Hebrew |
| 1058 | uk-hu | Helsinki-NLP/opus-mt-uk-hu | windy-pair-uk-hu | windy-pair-uk-hu-ct2 | ⚪ | ⚪ | ⚪ | Ukrainian→Hungarian |
| 1059 | uk-it | Helsinki-NLP/opus-mt-uk-it | windy-pair-uk-it | windy-pair-uk-it-ct2 | ⚪ | ⚪ | ⚪ | Ukrainian→Italian |
| 1060 | uk-nl | Helsinki-NLP/opus-mt-uk-nl | windy-pair-uk-nl | windy-pair-uk-nl-ct2 | ⚪ | ⚪ | ⚪ | Ukrainian→Dutch |
| 1061 | uk-no | Helsinki-NLP/opus-mt-uk-no | windy-pair-uk-no | windy-pair-uk-no-ct2 | ⚪ | ⚪ | ⚪ | Ukrainian→Norwegian |
| 1062 | uk-pl | Helsinki-NLP/opus-mt-uk-pl | windy-pair-uk-pl | windy-pair-uk-pl-ct2 | ⚪ | ⚪ | ⚪ | Ukrainian→Polish |
| 1063 | uk-pt | Helsinki-NLP/opus-mt-uk-pt | windy-pair-uk-pt | windy-pair-uk-pt-ct2 | ⚪ | ⚪ | ⚪ | Ukrainian→Portuguese |
| 1064 | uk-ru | Helsinki-NLP/opus-mt-uk-ru | windy-pair-uk-ru | windy-pair-uk-ru-ct2 | ⚪ | ⚪ | ⚪ | Ukrainian→Russian |
| 1065 | uk-sh | Helsinki-NLP/opus-mt-uk-sh | windy-pair-uk-sh | windy-pair-uk-sh-ct2 | ⚪ | ⚪ | ⚪ | Ukrainian→SH |
| 1066 | uk-sl | Helsinki-NLP/opus-mt-uk-sl | windy-pair-uk-sl | windy-pair-uk-sl-ct2 | ⚪ | ⚪ | ⚪ | Ukrainian→Slovenian |
| 1067 | uk-sv | Helsinki-NLP/opus-mt-uk-sv | windy-pair-uk-sv | windy-pair-uk-sv-ct2 | ⚪ | ⚪ | ⚪ | Ukrainian→Swedish |
| 1068 | uk-tr | Helsinki-NLP/opus-mt-uk-tr | windy-pair-uk-tr | windy-pair-uk-tr-ct2 | ⚪ | ⚪ | ⚪ | Ukrainian→Turkish |
| 1069 | ur-en | Helsinki-NLP/opus-mt-ur-en | windy-pair-ur-en | windy-pair-ur-en-ct2 | ⚪ | ⚪ | ⚪ | Urdu→English |
| 1070 | urj-en | Helsinki-NLP/opus-mt-urj-en | windy-pair-urj-en | windy-pair-urj-en-ct2 | ⚪ | ⚪ | ⚪ | URJ→English |
| 1071 | urj-urj | Helsinki-NLP/opus-mt-urj-urj | windy-pair-urj-urj | windy-pair-urj-urj-ct2 | ⚪ | ⚪ | ⚪ | URJ→URJ |
| 1072 | vi-de | Helsinki-NLP/opus-mt-vi-de | windy-pair-vi-de | windy-pair-vi-de-ct2 | ⚪ | ⚪ | ⚪ | Vietnamese→German |
| 1073 | vi-en | Helsinki-NLP/opus-mt-vi-en | windy-pair-vi-en | windy-pair-vi-en-ct2 | ⚪ | ⚪ | ⚪ | Vietnamese→English |
| 1074 | vi-eo | Helsinki-NLP/opus-mt-vi-eo | windy-pair-vi-eo | windy-pair-vi-eo-ct2 | ⚪ | ⚪ | ⚪ | Vietnamese→Esperanto |
| 1075 | vi-es | Helsinki-NLP/opus-mt-vi-es | windy-pair-vi-es | windy-pair-vi-es-ct2 | ⚪ | ⚪ | ⚪ | Vietnamese→Spanish |
| 1076 | vi-fr | Helsinki-NLP/opus-mt-vi-fr | windy-pair-vi-fr | windy-pair-vi-fr-ct2 | ⚪ | ⚪ | ⚪ | Vietnamese→French |
| 1077 | vi-it | Helsinki-NLP/opus-mt-vi-it | windy-pair-vi-it | windy-pair-vi-it-ct2 | ⚪ | ⚪ | ⚪ | Vietnamese→Italian |
| 1078 | vi-ru | Helsinki-NLP/opus-mt-vi-ru | windy-pair-vi-ru | windy-pair-vi-ru-ct2 | ⚪ | ⚪ | ⚪ | Vietnamese→Russian |
| 1079 | xh-en | Helsinki-NLP/opus-mt-xh-en | windy-pair-xh-en | windy-pair-xh-en-ct2 | ⚪ | ⚪ | ⚪ | Xhosa→English |
| 1080 | xh-es | Helsinki-NLP/opus-mt-xh-es | windy-pair-xh-es | windy-pair-xh-es-ct2 | ⚪ | ⚪ | ⚪ | Xhosa→Spanish |
| 1081 | xh-fr | Helsinki-NLP/opus-mt-xh-fr | windy-pair-xh-fr | windy-pair-xh-fr-ct2 | ⚪ | ⚪ | ⚪ | Xhosa→French |
| 1082 | xh-sv | Helsinki-NLP/opus-mt-xh-sv | windy-pair-xh-sv | windy-pair-xh-sv-ct2 | ⚪ | ⚪ | ⚪ | Xhosa→Swedish |
| 1083 | yo-en | Helsinki-NLP/opus-mt-yo-en | windy-pair-yo-en | windy-pair-yo-en-ct2 | ⚪ | ⚪ | ⚪ | Yoruba→English |
| 1084 | yo-es | Helsinki-NLP/opus-mt-yo-es | windy-pair-yo-es | windy-pair-yo-es-ct2 | ⚪ | ⚪ | ⚪ | Yoruba→Spanish |
| 1085 | yo-fi | Helsinki-NLP/opus-mt-yo-fi | windy-pair-yo-fi | windy-pair-yo-fi-ct2 | ⚪ | ⚪ | ⚪ | Yoruba→Finnish |
| 1086 | yo-fr | Helsinki-NLP/opus-mt-yo-fr | windy-pair-yo-fr | windy-pair-yo-fr-ct2 | ⚪ | ⚪ | ⚪ | Yoruba→French |
| 1087 | yo-sv | Helsinki-NLP/opus-mt-yo-sv | windy-pair-yo-sv | windy-pair-yo-sv-ct2 | ⚪ | ⚪ | ⚪ | Yoruba→Swedish |
| 1088 | zh-bg | Helsinki-NLP/opus-mt-zh-bg | windy-pair-zh-bg | windy-pair-zh-bg-ct2 | ⚪ | ⚪ | ⚪ | Chinese→Bulgarian |
| 1089 | zh-de | Helsinki-NLP/opus-mt-zh-de | windy-pair-zh-de | windy-pair-zh-de-ct2 | ⚪ | ⚪ | ⚪ | Chinese→German |
| 1090 | zh-fi | Helsinki-NLP/opus-mt-zh-fi | windy-pair-zh-fi | windy-pair-zh-fi-ct2 | ⚪ | ⚪ | ⚪ | Chinese→Finnish |
| 1091 | zh-he | Helsinki-NLP/opus-mt-zh-he | windy-pair-zh-he | windy-pair-zh-he-ct2 | ⚪ | ⚪ | ⚪ | Chinese→Hebrew |
| 1092 | zh-it | Helsinki-NLP/opus-mt-zh-it | windy-pair-zh-it | windy-pair-zh-it-ct2 | ⚪ | ⚪ | ⚪ | Chinese→Italian |
| 1093 | zh-ms | Helsinki-NLP/opus-mt-zh-ms | windy-pair-zh-ms | windy-pair-zh-ms-ct2 | ⚪ | ⚪ | ⚪ | Chinese→Malay |
| 1094 | zh-nl | Helsinki-NLP/opus-mt-zh-nl | windy-pair-zh-nl | windy-pair-zh-nl-ct2 | ⚪ | ⚪ | ⚪ | Chinese→Dutch |
| 1095 | zh-sv | Helsinki-NLP/opus-mt-zh-sv | windy-pair-zh-sv | windy-pair-zh-sv-ct2 | ⚪ | ⚪ | ⚪ | Chinese→Swedish |
| 1096 | zh-uk | Helsinki-NLP/opus-mt-zh-uk | windy-pair-zh-uk | windy-pair-zh-uk-ct2 | ⚪ | ⚪ | ⚪ | Chinese→Ukrainian |
| 1097 | zh-vi | Helsinki-NLP/opus-mt-zh-vi | windy-pair-zh-vi | windy-pair-zh-vi-ct2 | ⚪ | ⚪ | ⚪ | Chinese→Vietnamese |
| 1098 | zlw-en | Helsinki-NLP/opus-mt-zlw-en | windy-pair-zlw-en | windy-pair-zlw-en-ct2 | ⚪ | ⚪ | ⚪ | ZLW→English |
| 1099 | zlw-fiu | Helsinki-NLP/opus-mt-zlw-fiu | windy-pair-zlw-fiu | windy-pair-zlw-fiu-ct2 | ⚪ | ⚪ | ⚪ | ZLW→FIU |
| 1100 | zlw-zlw | Helsinki-NLP/opus-mt-zlw-zlw | windy-pair-zlw-zlw | windy-pair-zlw-zlw-ct2 | ⚪ | ⚪ | ⚪ | ZLW→ZLW |

---
## FLEET STATISTICS

| Category | Built | Certified | On HF | Planned | Total Target |
|---|---|---|---|---|---|
| Core STT (GPU+CT2) | 14 | 14 | 14 | 0 | 14 |
| Distil-Whisper | 3 | 3 | 3 | 0 | 3 |
| Translate Generalist | 2 | 2 | 2 | 0 | 2 |
| Lingua GPU | 50 | ~29 | 50 | 17 | 67 |
| Lingua CT2 | 50 | ~15 | 36 | 17+14 fix | 67 |
| Pair GPU (built) | 16 | 0 | 16 | 0 | 16 |
| Pair CT2 (planned) | 0 | 0 | 0 | 16 | 16 |
| OPUS-MT GPU (planned) | 0 | 0 | 0 | 1100 | 1100 |
| OPUS-MT CT2 (planned) | 0 | 0 | 0 | 1100 | 1100 |
| **TOTALS** | **139** | **48** | **121** | **2250** | **~2389** |