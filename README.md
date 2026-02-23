# Windy Pro

**Voice-to-text with a trustable state machine.**

> "The Green Strobe Never Lies."

## What is Windy Pro?

A local-first voice-to-text platform that eliminates the anxiety of "Is it recording?" with clear visual feedback — plus a powerful cloud option with GPU acceleration for the highest quality output.

### Key Features

| Feature | Details |
|---------|---------|
| **Batch Mode** ✨ | Record first, get polished text on stop. LLM-cleaned punctuation, paragraphs, and formatting. Best quality. |
| **Live Mode** | Words stream in real-time as you speak. Faster feedback, lower quality. |
| **5 Engines** | Local (offline), WindyPro Cloud (GPU), Deepgram, Groq, OpenAI |
| **Configurable Duration** | 5/10/15/30 minute recordings |
| **Green Strobe** | Trustable visual feedback — if it's green, your words are being captured |
| **Privacy-first** | Local mode: nothing leaves your device. Cloud: E2E encrypted, zero retention. |
| **Auto-archive** | Local, Dropbox, and Google Drive sync |

### vs Wispr Flow

| Feature | Wispr Flow | Windy Pro |
|---------|------------|-----------:|
| Session Limit | ~5 minutes | **Up to 30 min** |
| Feedback | Opaque | **Green Strobe** |
| Privacy | Cloud only | **Local-first** |
| Batch Mode | ✅ | **✅ + LLM cleanup** |
| Engines | 1 | **5** |
| Cost | ~$17/mo | **Free (local) / $5 (cloud)** |

## Quick Start

### Prerequisites

- Node.js 18+ (Electron client)
- Python 3.10+ (local transcription engine)
- CUDA 11.7+ (optional, for GPU acceleration)

### Installation

```bash
cd windy-pro

# Python backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Electron client
npm install
```

### Run the App

```bash
# Start local transcription server
python -m src.engine.server --model base --port 9876

# Start Electron app (in another terminal)
npm start
```

### Run the Cloud API (Veron server)

```bash
# Set required env vars
export WINDY_JWT_SECRET="your-secret"
export WINDY_API_KEY="your-api-key"

# Start cloud API
uvicorn src.cloud.api:app --host 0.0.0.0 --port 8000
```

## Transcription Engines

| Engine | Type | Quality | Speed | Setup |
|--------|------|---------|-------|-------|
| 🏠 **Local** | Offline | ★★★☆☆ | Real-time | Works out of the box |
| ☁️ **WindyPro Cloud** | GPU (RTX 5090) | ★★★★★ | Batch | Sign up in Settings |
| 🎙️ **Deepgram** | Streaming | ★★★★★ | Real-time | API key |
| ⚡ **Groq** | LPU | ★★★★☆ | Fastest | API key |
| 🌐 **OpenAI** | Cloud | ★★★★☆ | Batch | API key |

## Recording Modes

### ✨ Batch Mode (Default)
Record audio, then process everything at once for the best quality:
1. Press **Ctrl+Shift+Space** — green strobe activates
2. Speak naturally — no text appears yet
3. Press **Ctrl+Shift+Space** again — "✨ Processing..." state
4. Polished text appears with proper punctuation and paragraphs

The cloud batch endpoint uses GPU transcription (Whisper large-v3) + LLM cleanup (Ollama) for formatting.

### 📝 Live Mode
Words stream in real-time as you speak. Lower quality but immediate feedback.

## Architecture

```
┌─────────────────────────────────────────────────┐
│              Electron Client                     │
│  ┌──────────┐  ┌───────────┐  ┌──────────────┐  │
│  │Green     │  │Transcript │  │Settings      │  │
│  │Strobe    │  │Display    │  │Panel         │  │
│  └──────────┘  └───────────┘  └──────────────┘  │
│                 │                                 │
│        WebSocket / REST (batch)                   │
└─────────────────┬───────────────────────────────┘
                  │
  ┌───────────────┼──────────────────────┐
  │               │                      │
  ▼               ▼                      ▼
Local Server   Cloud API            Third-party APIs
(Python WS)    (FastAPI/GPU)        (Deepgram/Groq/OpenAI)
```

## Hotkeys

| Hotkey | Action |
|--------|--------|
| **Ctrl+Shift+Space** | Toggle Recording |
| **Ctrl+Shift+V** | Paste Transcript |
| **Ctrl+Shift+W** | Show/Hide Window |

## Testing

```bash
source venv/bin/activate
python -m pytest tests/ -v
```

## Project Structure

```
windy-pro/
├── src/
│   ├── engine/              # Local Python transcription
│   │   ├── transcriber.py
│   │   └── server.py
│   ├── client/
│   │   ├── desktop/         # Electron app
│   │   │   ├── main.js
│   │   │   └── renderer/
│   │   │       ├── app.js
│   │   │       ├── settings.js
│   │   │       └── index.html
│   │   └── web/             # React web client
│   └── cloud/
│       └── api.py           # FastAPI cloud server
└── tests/
```

## License

MIT

---

*Built with the collective wisdom of Gemini, ChatGPT, Perplexity, and Grok.*
*Executed by Kit 0.*
