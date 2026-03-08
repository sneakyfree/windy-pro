# 🌐 Windy Pro — Translation Architecture

> **Two specialized tools, one translation ecosystem.**
> Last updated: 2026-03-08

---

## Overview

Windy Pro ships with **two translation interfaces**, each optimized for a different use case. They share the same backend engines but serve fundamentally different workflows.

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   🌐 QUICK TRANSLATE (Popup)     🎤 TRANSLATE STUDIO (Panel)   │
│   ┌───────────────────────┐      ┌───────────────────────┐     │
│   │  Floating overlay     │      │  Embedded in main app │     │
│   │  Ctrl+Shift+T         │      │  Click translate icon │     │
│   │                       │      │                       │     │
│   │  ⌨️ Text input        │      │  💬 Text input        │     │
│   │  🎤 Live Listen       │      │  🎙️ Push-to-talk     │     │
│   │  📜 Unified thread    │      │  📋 History + Favs   │     │
│   │  🔧 Cockpit controls  │      │  🎵 TTS playback     │     │
│   │  📏 Ui + Aa sliders   │      │  🌊 Waveform viz     │     │
│   └───────────────────────┘      └───────────────────────┘     │
│               │                            │                    │
│               └────────── Shared ──────────┘                    │
│                    │                                            │
│        ┌───────────┴────────────┐                               │
│        │  Translation Engines   │                               │
│        │  ☁️ Groq Cloud API     │                               │
│        │  ☁️ OpenAI Whisper API │                               │
│        │  🏠 Local Whisper      │                               │
│        └────────────────────────┘                               │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🌐 Quick Translate (Popup Window)

**Purpose:** Always-available translation overlay for meetings, calls, and quick lookups.

**Files:**
- `src/client/desktop/renderer/mini-translate.html` — UI + CSS
- `src/client/desktop/renderer/mini-translate.js` — Logic (~380 lines)
- `src/client/desktop/mini-translate-preload.js` — Electron preload

**Hotkey:** `Ctrl+Shift+T`

### Features
| Feature | Description |
|---|---|
| **⌨️ Text Mode** | Type text → Enter → see translation |
| **🎤 Live Listen** | Continuous mic → real-time transcription + translation |
| **📜 Unified Thread** | Both text & voice entries in one chronological feed |
| **🌪️ WindyTune Toggle** | Auto-selects best engine based on hardware/language |
| **🔧 Manual Mode** | User picks specific model from 15 Windy Pro models |
| **🛫 Cockpit Panel** | Shows Listening engine, Translating engine, mode status |
| **📏 Ui Scale Slider** | Scales all controls (0.8x–1.6x zoom) |
| **📏 Aa Size Slider** | Adjusts transcript text size (10–24px) |
| **⏱️ Chunk Slider** | Configurable audio chunk duration (5–60s) |
| **🟢 Audio Strobe** | Pulsing green dot when mic is active |
| **💡 Tooltips** | Educational hover text on every control |
| **🔍 Auto-detect** | 99 Whisper-supported languages |

### Voice Interaction: Passive Listening
The mic runs continuously in configurable chunks. Ideal for **listening to someone else speak** — e.g., a meeting partner, a recording, a video call.

### Cockpit Model Names (15 Windy Pro Models)
| Category | Models |
|---|---|
| 🛡️ **Edge (CPU)** | Edge Spark (42MB), Edge Pulse (78MB), Edge Standard (168MB), Edge Global (515MB), Edge Pro (515MB) |
| ⚡ **Core (GPU)** | Core Spark (75MB), Core Pulse (142MB), Core Standard (466MB), Core Global (1.5GB), Core Pro (1.5GB), Core Turbo (1.6GB), Core Ultra (2.9GB) |
| 🌍 **Lingua** | Lingua Español (500MB), Lingua Français (500MB), Lingua हिन्दी (500MB) |

---

## 🎤 Translate Studio (Main App Panel)

**Purpose:** Full translation workspace with history, playback, and favorites.

**Files:**
- `src/client/desktop/renderer/translate.js` — TranslatePanel class (~770 lines)
- Panel rendered inside `index.html` (main Electron window)

**Access:** Click translate icon in main Windy Pro window

### Features
| Feature | Description |
|---|---|
| **💬 Text Input** | Type text → translate |
| **🎙️ Push-to-Talk** | Hold mic button to record, release to translate |
| **🌊 Waveform** | Animated canvas visualization during recording |
| **🔊 TTS Playback** | Speak translated text aloud via system TTS |
| **📋 Translation History** | Saved, searchable, persistent across sessions |
| **⭐ Favorites** | Star translations to save permanently |
| **📡 Health Check** | Backend ping every 30s with offline badge |
| **📤 Offline Queue** | Queues translations when backend is unreachable |
| **🏳️ Flag Emojis** | Visual language identification |
| **🔄 Language Swap** | One-click swap source ↔ target |

### Voice Interaction: Push-to-Talk
User holds a button, speaks, releases. Ideal for **recording your own speech** to translate and optionally hear it spoken back.

---

## Why Two Tools?

| Scenario | Use This |
|---|---|
| In a Zoom meeting, someone is speaking Spanish | 🌐 Quick Translate (passive listening) |
| At an airport, need to type a quick message | 🌐 Quick Translate (text mode) |
| Sitting down to translate a document passage | 🎤 Translate Studio |
| Want to hear the translation spoken aloud | 🎤 Translate Studio (TTS) |
| Need to save a translation for later | 🎤 Translate Studio (favorites) |
| Quick lookup during a conversation | 🌐 Quick Translate |

### The Calculator Analogy
- **Quick Translate** = Phone's swipe-down calculator. Instant access, quick task, dismiss.
- **Translate Studio** = Full scientific calculator app. Open it for serious work.

---

## Shared Backend

Both tools share the same translation pipeline via IPC:

```
Renderer → ipcRenderer.invoke('mini-translate-speech', ...) → Main Process
                                                                    │
                                                    ┌───────────────┴──────────┐
                                                    │  Engine Selection Logic   │
                                                    │                          │
                                                    │  if (groqApiKey)         │
                                                    │    → Groq Whisper API    │
                                                    │  elif (openaiApiKey)     │
                                                    │    → OpenAI Whisper API  │
                                                    │  else                    │
                                                    │    → Local Whisper model │
                                                    └──────────────────────────┘
```

### API Keys (BYOK — Bring Your Own Key)
Users provide their own API keys via Settings:
- **Groq API Key** → Fast cloud transcription via Groq's Whisper
- **OpenAI API Key** → OpenAI Whisper API
- **No keys** → Falls back to local Whisper model

---

## Future Roadmap (DNA Strand E)

The current implementation is a **precursor** to the full Strand E vision:

| Feature | Current | Strand E Target |
|---|---|---|
| Translation engine | Cloud APIs (Groq/OpenAI) | CTranslate2 (100% offline) |
| Language pairs | 99 via Whisper | 200 via NLLB models |
| Conversation mode | Manual toggle | Auto speaker detection |
| TTS output | System TTS only | Bundled Piper/Coqui TTS |
| Model management | Manual selection | Hardware-aware auto-cocktail |
| Offline capability | Partial (local Whisper) | Full offline speech-to-speech |

See `DNA_STRAND_MASTER_PLAN.md` → Strand E for the complete vision.

---

## File Map

```
src/client/desktop/
├── main.js                          # IPC handler: mini-translate-speech
├── mini-translate-preload.js        # Preload script for popup window
└── renderer/
    ├── mini-translate.html          # Quick Translate popup UI
    ├── mini-translate.js            # Quick Translate logic
    └── translate.js                 # Translate Studio (TranslatePanel class)
```
