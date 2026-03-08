# 🧬 WINDY PRO — DNA STRAND MASTER PLAN

**Version:** 1.5.0
**Created:** 2026-02-04
**Last Updated:** 2026-03-01
**Authors:** Kit 0 + Kit-0C1Veron + Antigravity + Kit 0C3 Charlie + Grant Whitmer
**Philosophy:** Begin with the end in mind. — Stephen R. Covey

---

## 🗣️ TERMINOLOGY STANDARD (27 Feb 2026)

| Internal / Technical | User-Facing / Marketing |
|---------------------|------------------------|
| Model, LLM, weights | **Voice Engine** or **Engine** |
| Model selection | **Engine selection** |
| Model catalog | **Engine library** |
| Download models | **Download engines** |
| Model Manager | **Engine Manager** |
| Model cocktail | **Engine cocktail** |

**Rule:** Users never see the word "model" in the UI. It's always "engine" or "voice engine."
Normal people understand engines — bigger = more power, smaller = more efficient. The car metaphor
maps perfectly without requiring any AI/ML knowledge. Decision by Grant, 27 Feb 2026.

### Additional Terminology Decisions (27 Feb 2026)

| Decision | Details | By |
|----------|---------|----|
| "Engines" not "models" | All user-facing text uses "engine" exclusively | Grant |
| $7.99/mo monthly option | Windy Translate: $79 one-time **OR** $7.99/mo monthly alongside one-time | Grant + Kit 0C3 |
| Two-tier translation | Hand-translate Top 10 languages, dynamic-translate remaining 89 via Veron | Grant + Kit 0C3 |
| Top 10 = 82% market | Top 10 languages capture ~82% of global addressable market | Kit 0C3 |

---

## 🚨 CRITICAL PATH TO MVP

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    WHAT BLOCKS WHAT (Dependency Graph)                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ✅ A1 (Transcriber) ──┬──> ✅ A3 (Server) ──> ✅ B2.6 (Audio Stream)    │
│  ✅ A2 (Audio Capture) ─┘                            │                   │
│                                                      ▼                   │
│                                            ✅ B3 (Cursor Injection)      │
│                                                      │                   │
│                                                      ▼                   │
│                                            ✅ B4 (TurboTax Installer)    │
│                                                      │                   │
│                                                      ▼                   │
│                                               🟡 MVP HARDENING           │
│                                                                          │
│  ✅ A4 (Cloud API) ──> ✅ C1 (Web Client) ──> 🟡 D1 (Deploy)             │
│                                                                          │
│  Legend: ✅ Done | 🟡 Needs Hardening | 🔲 Not Started | 🎯 Goal        │
└─────────────────────────────────────────────────────────────────────────┘
```

### 🟡 CURRENT STATUS: MVP HARDENING PHASE

**All critical blockers resolved.** B2.6 audio streaming, B3 cursor injection, B4 installer, A4 cloud API, and C1 web client are all implemented. Focus now shifts to hardening, polishing UX to 9+ quality, and production deployment.

---

## 🎯 THE END STATE (What We're Building Toward)

### The Vision in One Sentence
**Windy Pro is a push-button, TurboTax-simple voice platform that provides unlimited real-time transcription AND real-time offline translation — local-first for power users, cloud-backed for everyone else. Your voice, your languages, your device, your privacy.**

### The User Experience (End State)

```
USER JOURNEY — 60 SECONDS TO FLOW STATE

1. User visits windypro.com
2. Clicks "Download" or "Try Cloud"
3. DOWNLOAD PATH:
   └─ Installer detects hardware (GPU? RAM? CPU?)
   └─ Auto-selects optimal Whisper model
   └─ Installs in < 2 minutes, no terminal ever
   └─ Floating window appears in system tray
   
4. CLOUD PATH:
   └─ Sign up with email
   └─ Instant access via web app
   └─ Works on any device

5. USER SPEAKS:
   └─ Green Strobe pulses — "I am recording"
   └─ Words appear in real-time
   └─ No 5-minute limit. Ever.
   └─ Paste anywhere with one click/hotkey

6. USER TRUSTS:
   └─ Green = Safe. Always.
   └─ Yellow = Processing. Wait.
   └─ Red = Error. Auto-reconnecting.
   └─ Blue = Injecting text to cursor.
```

### Success Metrics (The Numbers That Matter)

| Metric | Target | Current | Status |
|--------|--------|---------|--------|
| Time to First Transcription | < 3 min | N/A | 🔲 |
| Latency (local) | < 500ms | ~800ms | 🟡 |
| Latency (cloud) | < 1.5s | N/A | 🔲 |
| Session Length | Unlimited | ✅ | ✅ |
| Crash Recovery | 100% | ✅ | ✅ |
| Mobile-Desktop Parity | 95% | 0% | 🔲 |

---

## 🏗️ ARCHITECTURE OVERVIEW

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           WINDY PRO ECOSYSTEM                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                      WINDY LOCAL (Desktop)                        │   │
│  │                                                                    │   │
│  │  ┌─────────────────┐         WebSocket          ┌──────────────┐ │   │
│  │  │  Electron App   │ ◄──────(ws://127.0.0.1)───►│ Python Server│ │   │
│  │  │                 │          :9876              │              │ │   │
│  │  │ ┌─────────────┐ │                            │ ┌──────────┐ │ │   │
│  │  │ │ Renderer    │ │  Audio bytes (binary) ──►  │ │Transcribe│ │ │   │
│  │  │ │ - Mic capture│ │                            │ │ r.py     │ │ │   │
│  │  │ │ - UI/Strobe │ │  ◄── Transcript JSON       │ └──────────┘ │ │   │
│  │  │ │ - WebSocket │ │                            │              │ │   │
│  │  │ └─────────────┘ │                            │ ┌──────────┐ │ │   │
│  │  │                 │                            │ │faster-   │ │ │   │
│  │  │ ┌─────────────┐ │                            │ │whisper   │ │ │   │
│  │  │ │ Main Process│ │                            │ └──────────┘ │ │   │
│  │  │ │ - Tray      │ │                            │              │ │   │
│  │  │ │ - Hotkeys   │ │                            └──────────────┘ │   │
│  │  │ │ - Injection │ │                                              │   │
│  │  │ └─────────────┘ │                                              │   │
│  │  └─────────────────┘                                              │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                      WINDY CLOUD (Future)                         │   │
│  │                                                                    │   │
│  │  ┌─────────────────┐         WebSocket          ┌──────────────┐ │   │
│  │  │  Web/Mobile PWA │ ◄────(wss://api.windy)────►│ Cloud Server │ │   │
│  │  │  (Opus Audio)   │                            │ (Hostinger)  │ │   │
│  │  └─────────────────┘                            └──────────────┘ │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🧬 DNA CODONS — ATOMIC COMPONENTS

Each codon is the smallest unit of work. Build these correctly, the organism lives.

**Status Legend:**
- ✅ Complete and tested
- 🟡 Partially complete / needs fixes
- 🔴 Critical blocker
- 🔲 Not started
- ⏸️ Blocked by dependency

---

### STRAND A: CORE ENGINE (Python Backend)

#### A1: Transcription Engine ✅
```
FILE: src/engine/transcriber.py
STATUS: ✅ COMPLETE
LINES: 280
TESTED: Yes (via demo.py)

CODONS:
├── A1.1 TranscriptionState enum ✅
│   ├── IDLE (gray)
│   ├── LISTENING (green strobe)
│   ├── BUFFERING (yellow)
│   ├── ERROR (red)
│   └── INJECTING (blue flash)
│
├── A1.2 TranscriptionSegment dataclass ✅
│   ├── text: str
│   ├── start_time: float
│   ├── end_time: float
│   ├── confidence: float
│   ├── is_partial: bool
│   └── words: List[dict]
│
├── A1.3 TranscriberConfig dataclass ✅
│   ├── model_size: tiny|base|small|medium|large-v3|large-v3-turbo
│   ├── device: auto|cpu|cuda
│   ├── compute_type: auto|int8|float16|float32
│   ├── language: str (default "en")
│   ├── vad_enabled: bool (default True)
│   ├── vad_threshold: float (default 0.5)
│   ├── temp_file_path: str (crash recovery)
│   ├── chunk_length_s: float (default 5.0)
│   └── beam_size: int (default 5)
│
├── A1.4 StreamingTranscriber class ✅
│   ├── __init__(config)
│   ├── load_model() -> bool
│   ├── start_session()
│   ├── stop_session() -> str
│   ├── feed_audio(bytes)
│   ├── on_state_change(callback)
│   ├── on_transcript(callback)
│   ├── get_session_file() -> Path
│   └── get_full_transcript() -> str
│
└── A1.5 Crash Recovery ✅
    ├── Write to temp file on EVERY segment
    ├── fsync() to force disk write
    └── Recovery file: ~/windy_session.txt
```

#### A2: Audio Capture ✅
```
FILE: src/engine/audio_capture.py
STATUS: ✅ COMPLETE
LINES: 120
TESTED: Yes (standalone test mode)

CODONS:
├── A2.1 AudioCapture class ✅
│   ├── SAMPLE_RATE = 16000 (Whisper expects 16kHz)
│   ├── CHANNELS = 1 (mono)
│   ├── DTYPE = int16 (16-bit PCM)
│   └── BLOCK_SIZE = 1600 (100ms chunks)
│
├── A2.2 Device Management ✅
│   ├── list_devices() -> List[dict]
│   └── select_device(index: int)
│
├── A2.3 Callbacks ✅
│   ├── on_audio(callback) — raw bytes
│   └── on_level(callback) — 0.0-1.0 for UI meter
│
└── A2.4 Lifecycle ✅
    ├── start() -> bool
    ├── stop()
    └── is_running() -> bool

NOTE: This module is used by demo.py for Python-side capture.
      For Electron, audio capture happens in the renderer (B2.6).
```

#### A3: WebSocket Server ✅
```
FILE: src/engine/server.py
STATUS: ✅ COMPLETE
LINES: 180
TESTED: Yes (with Python client)

CODONS:
├── A3.1 WindyServer class ✅
│   ├── host: str (default "127.0.0.1")
│   ├── port: int (default 9876)
│   └── clients: Set[WebSocket]
│
├── A3.2 Message Protocol ✅
│   ├── INBOUND (from client):
│   │   ├── Binary → audio data (16-bit PCM, 16kHz mono)
│   │   └── JSON → commands
│   │       ├── {"action": "start"}
│   │       ├── {"action": "stop"}
│   │       ├── {"action": "config", "config": {...}}
│   │       └── {"action": "ping", "timestamp": ...}
│   │
│   └── OUTBOUND (to client):
│       ├── {"type": "state", "state": "listening", "previous": "idle"}
│       ├── {"type": "transcript", "text": "...", "partial": false, ...}
│       ├── {"type": "ack", "action": "...", "success": true}
│       ├── {"type": "pong", "timestamp": ...}
│       └── {"type": "error", "message": "..."}
│
└── A3.3 Lifecycle ✅
    ├── start(config) -> bool
    └── stop()
```

#### A4: Cloud API Server ✅
```
FILE: src/cloud/api.py
STATUS: ✅ COMPLETE (694 lines)
TESTED: Yes (tests/test_cloud_api.py — 13 tests)

CODONS:
├── A4.1 FastAPI Application ✅
│   ├── /health — health check ✅
│   ├── /ws/transcribe — WebSocket streaming endpoint ✅
│   ├── /api/v1/auth/register — user registration ✅
│   ├── /api/v1/auth/login — JWT tokens ✅
│   ├── /api/v1/auth/me — user profile ✅
│   └── /api/v1/vault/* — prompt history CRUD ✅
│
├── A4.2 Authentication ✅
│   ├── JWT tokens (HS256, zero-dependency) ✅
│   ├── API key for CLI/automated use ✅
│   ├── Rate limiting per user (slowapi) ✅
│   └── PBKDF2 password hashing ✅
│
├── A4.3 Audio Handling ✅
│   ├── Raw PCM Int16 streaming (Opus decoding TODO) 🟡
│   ├── Per-user concurrency limiting (1 session max) ✅
│   ├── Audio buffer accumulation + batch transcribe ✅
│   └── Frame rate limiting (80 fps max) ✅
│
└── A4.4 Prompt Vault ✅
    ├── SQLite storage (PostgreSQL via DATABASE_URL planned) 🟡
    ├── User-scoped transcripts ✅
    ├── Search by keyword (LIKE query) ✅
    └── Export to TXT/MD (desktop vault.py — cloud REST TODO) 🟡
```

---

### STRAND B: DESKTOP CLIENT (Electron)

#### B1: Electron Shell ✅
```
FILE: src/client/desktop/main.js
STATUS: ✅ COMPLETE
LINES: 280
TESTED: Manually (window launches, tray works)

CODONS:
├── B1.1 Main Process ✅
│   ├── Create BrowserWindow (floating, frameless) ✅
│   ├── System tray integration ✅
│   ├── Global hotkey registration ✅
│   ├── Auto-updater 🔲 (nice-to-have)
│   └── IPC handlers ✅
│
├── B1.2 Window Properties ✅
│   ├── alwaysOnTop: true ✅
│   ├── frame: false (custom title bar) ✅
│   ├── transparent: true (for strobe effect) ✅
│   ├── resizable: true (min 250x150) ✅
│   └── skipTaskbar: false ✅
│
├── B1.3 Tray Menu ✅
│   ├── Show/Hide window ✅
│   ├── Start/Stop recording ✅
│   ├── Settings ✅
│   ├── Open Vault ✅
│   └── Quit ✅
│
├── B1.4 Global Hotkeys ✅
│   ├── Toggle recording: Ctrl+Shift+Space ✅
│   ├── Paste transcript: Ctrl+Shift+V ✅
│   └── Show/Hide: Ctrl+Shift+W ✅
│
└── B1.5 Preload Bridge ✅
    └── FILE: src/client/desktop/preload.js (45 lines)
```

#### B2: Renderer UI ✅
```
FILES: src/client/desktop/renderer/
STATUS: ✅ COMPLETE (app.js 769 lines, styles.css 16K, settings.js 450 lines, vault.js 292 lines)
TESTED: Manually (UI works, audio streams, transcripts display)

CODONS:
├── B2.1 index.html ✅
│   ├── Window structure ✅
│   ├── State indicator container ✅
│   ├── Transcript area ✅
│   └── Control bar ✅
│
├── B2.2 styles.css (The Green Strobe) ✅
│   ├── State colors defined ✅
│   │   ├── --color-idle: #6B7280 (gray)
│   │   ├── --color-listening: #22C55E (green)
│   │   ├── --color-buffering: #EAB308 (yellow)
│   │   ├── --color-error: #EF4444 (red)
│   │   └── --color-injecting: #3B82F6 (blue)
│   │
│   ├── Strobe animation ✅
│   │   └── @keyframes strobe { 0%,100%: 0.15; 50%: 0.4 }
│   │
│   └── Full UI styling ✅ (16K)
│
├── B2.3 app.js - WindyApp class ✅
│   ├── WebSocket connection ✅
│   ├── State management ✅
│   ├── Transcript display ✅
│   ├── Button handlers ✅
│   ├── IPC event handlers ✅
│   └── Archive route management ✅
│
├── B2.4 Component: TranscriptView ✅
│   ├── Auto-scroll to bottom ✅
│   ├── Partial text styling (italics) ✅
│   ├── Timestamp per segment ✅
│   └── Strobe-only mode (hide live text) ✅
│
├── B2.5 Component: ControlBar ✅
│   ├── Start/Stop button ✅
│   ├── Clear button ✅
│   ├── Copy button ✅
│   └── Paste button (with clear-on-paste option) ✅
│
└── B2.6 Audio Capture & Streaming ✅
    │
    │  ✅ IMPLEMENTED — AudioWorklet + ScriptProcessorNode fallback
    │  FILE: app.js startAudioCapture() + audio-processor.js
    │
    ├── B2.6.1 navigator.mediaDevices.getUserMedia() ✅
    │   └── With saved mic device support (T20)
    ├── B2.6.2 AudioWorklet (primary) + ScriptProcessorNode (fallback) ✅
    ├── B2.6.3 AudioContext at 16kHz mono ✅
    ├── B2.6.4 Float32 → Int16 PCM conversion (float32ToInt16) ✅
    ├── B2.6.5 Stream via WebSocket as binary ✅
    └── B2.6.6 Audio level meter (AnalyserNode + updateAudioMeter) ✅

    INVARIANT ENFORCED (FEAT-053):
    Green strobe ONLY shows AFTER mic access is confirmed.
    startAudioCapture() runs BEFORE setState('listening').
```

#### B3: Cursor Injection ✅
```
FILE: src/client/desktop/injection/injector.js
STATUS: ✅ COMPLETE (190 lines)
TESTED: Manually (Windows, macOS, Linux X11/Wayland)
APPROACH: Zero-dependency — native OS commands (no robotjs/@nut-tree)

CODONS:
├── B3.1 Windows Implementation ✅
│   ├── PowerShell SendKeys for Ctrl+V ✅
│   ├── Electron clipboard API for copy ✅
│   └── 3-second timeout on exec ✅
│
├── B3.2 macOS Implementation ✅
│   ├── AppleScript osascript Cmd+V ✅
│   ├── Accessibility permission detection ✅
│   └── User-friendly permission denied message ✅
│
├── B3.3 Linux Implementation ✅
│   ├── XDG_SESSION_TYPE detection (X11 vs Wayland) ✅
│   ├── X11: xdotool key --clearmodifiers ctrl+v ✅
│   ├── Wayland: ydotool key 29:1 47:1 47:0 29:0 ✅
│   └── Missing tool detection with install instructions ✅
│
└── B3.4 Injection Flow ✅
    ├── Save previous clipboard → copy text → paste → restore clipboard ✅
    ├── main.js IPC handler (transcript-for-paste) ✅
    ├── Blue INJECTING state flash ✅
    ├── Platform detection (process.platform) ✅
    ├── Error handling + injection-error IPC ✅
    └── checkPermissions() for proactive UX ✅
```

#### B4: TurboTax Installer
```
FILE: installer-v2/screens/wizard.html + wizard-main.js + wizard-preload.js
STATUS: 🟡 MOSTLY COMPLETE (wizard UI done, packaging not started)
PRIORITY: HIGH (required for MVP)
NOTE: Wizard v2 implemented 27 Feb 2026 — 9 screens, i18n, brand experience

CODONS:
├── B4.1 Hardware Detection ✅
│   │
│   │  MODULE: installer-v2/screens/wizard.html (runHardwareScan())
│   │
│   ├── B4.1.1 NVIDIA GPU detection 🔲
│   │   ├── Run: nvidia-smi --query-gpu=name,memory.total --format=csv
│   │   └── Parse output for GPU name and VRAM
│   │
│   ├── B4.1.2 AMD GPU detection 🔲
│   │   └── Check for ROCm: rocm-smi
│   │
│   ├── B4.1.3 Apple Silicon detection 🔲
│   │   └── Check: process.arch === 'arm64' && process.platform === 'darwin'
│   │
│   ├── B4.1.4 RAM detection 🔲
│   │   └── Use os.totalmem() / (1024 ** 3) for GB
│   │
│   ├── B4.1.5 Disk space detection 🔲
│   │   └── Use check-disk-space package
│   │
│   └── B4.1.6 Generate hardware profile JSON 🔲
│       {
│         "gpu": "NVIDIA RTX 5090",
│         "vram_gb": 32,
│         "ram_gb": 64,
│         "disk_free_gb": 500,
│         "platform": "win32",
│         "arch": "x64"
│       }
│
├── B4.2 Engine Selection Logic ✅
│   │
│   │  DECISION TREE:
│   │
│   │  IF NVIDIA GPU with VRAM ≥ 6GB:
│   │      → large-v3-turbo + float16 + CUDA
│   │      "Best quality, fastest speed"
│   │
│   │  ELSE IF Apple Silicon (M1/M2/M3):
│   │      → large-v3-turbo + MLX
│   │      "Optimized for your Mac"
│   │
│   │  ELSE IF RAM ≥ 16GB:
│   │      → medium + int8 + CPU
│   │      "High accuracy, good speed"
│   │
│   │  ELSE IF RAM ≥ 8GB:
│   │      → small + int8 + CPU
│   │      "Balanced for your hardware"
│   │
│   │  ELSE IF RAM ≥ 4GB:
│   │      → base + int8 + CPU
│   │      "Lightweight, still accurate"
│   │
│   │  ELSE:
│   │      → Recommend Cloud mode
│   │      "Your device works best with Windy Cloud"
│   │
│   └── Display recommendation with "Why this choice?" tooltip
│
├── B4.3 Dependency Installation 🟡
│   │
│   │  STRATEGY: Bundle Python via PyInstaller
│   │
│   ├── B4.3.1 Create standalone Python package 🔲
│   │   ├── pyinstaller src/engine/server.py --onefile
│   │   └── Creates windy-engine.exe / windy-engine (no Python needed)
│   │
│   ├── B4.3.2 Bundle with Electron app 🔲
│   │   └── extraResources in electron-builder config
│   │
│   ├── B4.3.3 Model download manager 🔲
│   │   ├── Download from Hugging Face
│   │   ├── Progress bar with ETA
│   │   ├── Resume interrupted downloads
│   │   └── Verify checksum
│   │
│   └── B4.3.4 First-run setup wizard 🔲
│       ├── "Downloading speech recognition model..."
│       ├── "This may take a few minutes..."
│       └── "Setup complete! Click to start."
│
├── B4.4 Permission Requests 🔲
│   │
│   ├── B4.4.1 Windows UAC 🔲
│   │   └── Request admin only if needed (PATH modification)
│   │
│   ├── B4.4.2 macOS Microphone Permission 🔲
│   │   ├── Trigger permission prompt on first use
│   │   └── Show instructions if denied
│   │
│   ├── B4.4.3 macOS Accessibility Permission 🔲
│   │   ├── Required for cursor injection
│   │   ├── Show System Preferences deep link
│   │   └── Guide: "Click the lock, then check Windy Pro"
│   │
│   └── B4.4.4 Linux Permissions 🔲
│       └── Flatpak portal permissions
│
├── B4.5 Installer UI ✅
│   │
│   │  SCREENS:
│   │
│   ├── Screen 1: Welcome 🔲
│   │   "Welcome to Windy Pro"
│   │   "Voice-to-text that never stops."
│   │   [Get Started]
│   │
│   ├── Screen 2: Hardware Scan 🔲
│   │   "Scanning your system..."
│   │   [Animated progress]
│   │   ✓ GPU: NVIDIA RTX 5090 (32GB)
│   │   ✓ RAM: 64 GB
│   │   ✓ Disk: 500 GB free
│   │
│   ├── Screen 3: Engine Recommendation 🔲
│   │   "We recommend: Large v3 Turbo"
│   │   "Best quality for your hardware"
│   │   [Why this choice?]
│   │   [Continue] [Choose Different]
│   │
│   ├── Screen 4: Download Progress 🔲
│   │   "Downloading model..."
│   │   [████████░░░░░░░░] 52% - 2.1 GB / 4.0 GB
│   │   "About 3 minutes remaining"
│   │
│   ├── Screen 5: Permissions 🔲
│   │   "Windy Pro needs permission to:"
│   │   ☑ Access your microphone
│   │   ☑ Paste text into other apps
│   │   [Grant Permissions]
│   │
│   └── Screen 6: Complete 🔲
│       "You're ready!"
│       "Press Ctrl+Shift+Space to start recording"
│       [Launch Windy Pro]
│
└── B4.6 Packaging 🔲
    │
    ├── B4.6.1 Windows (NSIS) 🔲
    │   ├── electron-builder --win nsis
    │   ├── Signed with code signing cert (optional)
    │   └── Output: Windy-Pro-Setup-1.0.0.exe
    │
    ├── B4.6.2 macOS (DMG) 🔲
    │   ├── electron-builder --mac dmg
    │   ├── Notarized with Apple (required for Gatekeeper)
    │   └── Output: Windy-Pro-1.0.0.dmg
    │
    └── B4.6.3 Linux 🔲
        ├── electron-builder --linux AppImage deb rpm
        ├── AppImage: Windy-Pro-1.0.0.AppImage (universal)
        ├── Deb: windy-pro_1.0.0_amd64.deb (Debian/Ubuntu)
        └── RPM: windy-pro-1.0.0.x86_64.rpm (Fedora/RHEL)
```

---

### STRAND C: WEB/MOBILE CLIENT (React PWA)

#### C1: Progressive Web App ✅
```
FILE: src/client/web/ (React + Vite)
STATUS: ✅ COMPLETE (8 components/pages)
TESTED: Manually (auth flow, cloud transcription)

CODONS:
├── C1.1 Landing Page ✅
│   └── FILE: src/client/web/src/pages/Landing.jsx (12K)
│
├── C1.2 Auth (Login/Register) ✅
│   └── FILE: src/client/web/src/pages/Auth.jsx
│
├── C1.3 Cloud Transcription Page ✅
│   ├── FILE: src/client/web/src/pages/Transcribe.jsx
│   ├── Mic capture via getUserMedia ✅
│   ├── WebSocket streaming to /ws/transcribe ✅
│   └── JWT auth-first-message protocol ✅
│
├── C1.4 Protected Routes ✅
│   └── FILE: src/client/web/src/components/ProtectedRoute.jsx
│
├── C1.5 Privacy Policy ✅
│   └── FILE: src/client/web/src/pages/Privacy.jsx
│
├── C1.6 Terms of Service ✅
│   └── FILE: src/client/web/src/pages/Terms.jsx
│
├── C1.7 PWA Support 🟡
│   ├── manifest.json ✅
│   ├── Service worker (sw.js) ✅
│   └── Offline transcription 🔲 (requires local model)
│
└── C1.8 404 Page ✅
    └── NotFound component in App.jsx
```

---

### STRAND D: INFRASTRUCTURE

#### D1: Cloud Deployment
```
FILE: deploy/
STATUS: 🔲 NOT STARTED (Phase 2)
PRIORITY: MEDIUM (post-MVP)

[Unchanged from v1.0 - deferred to Phase 2]
```

#### D2: Domain & Branding
```
STATUS: 🔲 NOT STARTED
PRIORITY: MEDIUM (before launch)

[Unchanged from v1.0]
```

---

## 📅 REVISED PHASE TIMELINE

### Phase 1: Desktop MVP (Weeks 1-4)

```
WEEK 1 (DONE):
├── [x] A1: Transcription Engine ✅
├── [x] A2: Audio Capture ✅
├── [x] A3: WebSocket Server ✅
├── [x] B1: Electron Shell ✅
└── [x] B2.1-B2.5: UI Components ✅

WEEK 2 (DONE):
├── [x] B2.6: Electron Audio Streaming ✅
│       ├── AudioWorklet + ScriptProcessorNode fallback
│       ├── Float32 → Int16 conversion
│       └── WebSocket binary streaming + audio level meter
├── [x] End-to-end test: Electron → Python → Transcript ✅
└── [x] Settings panel, vault panel, vibe toggle ✅

WEEK 3 (DONE):
├── [x] B3.1: Windows Cursor Injection ✅ (PowerShell SendKeys)
├── [x] B3.2: macOS Cursor Injection ✅ (AppleScript)
├── [x] B3.3: Linux Cursor Injection ✅ (xdotool/ydotool)
├── [x] B3.4: Injection flow integration ✅
├── [x] A4: Cloud API (FastAPI) ✅
└── [x] C1: Web client (React/Vite PWA) ✅

WEEK 4 (DONE):
├── [x] B4.1-B4.2: Hardware Detection + Model Selection ✅
├── [x] B4.3: Dependency Installer (venv + pip + model download) ✅
├── [x] B4.4-B4.5: Permissions + Installer UI ✅
├── [x] B4.6: Packaging config (NSIS, DMG, AppImage) ✅
└── [x] MVP FEATURE COMPLETE 🎯

CURRENT: MVP HARDENING
├── [ ] Harden all features to quality 9+
├── [ ] Infrastructure deployment (Docker, nginx, SSL)
├── [ ] Comprehensive testing (expand test suite)
└── [ ] Domain & branding
```

### Phase 2: Cloud Backend (Weeks 5-6)
```
[Unchanged from v1.0]
```

### Phase 3: Web/Mobile + Launch (Weeks 7-8)
```
[Unchanged from v1.0]
```

---

## 🔬 GAP ANALYSIS — 2026-02-20

Performed by Antigravity after full repo audit. Previous audit by Kit-0C1Veron (2026-02-05).

### Strand A (Engine)
| Codon | Status | Gap | Action Required |
|-------|--------|-----|-----------------|
| A1.1-A1.5 | ✅ | Minor: error recovery, thread safety | Harden (RP-02) |
| A2.1-A2.4 | ✅ | Minor: runtime device selection | Polish (RP-02) |
| A3.1-A3.3 | ✅ | Minor: heartbeat, safe_send | Polish (RP-02) |
| A4.1-A4.4 | ✅ | Opus decoding, PostgreSQL, batch transcribe | Harden (RP-03) |

### Strand B (Desktop)
| Codon | Status | Gap | Action Required |
|-------|--------|-----|-----------------|
| B1.1-B1.5 | ✅ | Graceful shutdown, auto-restart | Polish (RP-04) |
| B2.1-B2.6 | ✅ | Session timer, word count, error UX | Polish (RP-04, RP-05) |
| B3.1-B3.4 | ✅ | Retry logic, special chars, paste delay | Harden (RP-06) |
| B4.1-B4.6 | ✅ | Progress bars, E2E testing, packaging | Complete (RP-07) |

### Strand C (Web)
| Codon | Status | Gap | Action Required |
|-------|--------|-----|-----------------|
| C1.1-C1.8 | ✅ | Audio meter, vault page, mobile UX | Upgrade (RP-08) |

### Strand D (Infrastructure)
| Codon | Status | Gap | Action Required |
|-------|--------|-----|-----------------|
| D1.* | 🟡 | Config exists, not deployed/tested | Deploy (RP-09) |
| D2.* | 🔲 | No domain, no SSL | Register + configure (RP-09) |

### Priority Actions (Hardening Phase)
1. **Engine hardening** — error recovery, thread safety, heartbeat
2. **Cloud API hardening** — PostgreSQL, batch transcribe, auth refresh
3. **Desktop UX polish** — session timer, word count, reconnect toast
4. **Web client upgrade** — audio meter, vault page, mobile responsive
5. **Infrastructure deployment** — Docker, nginx, SSL, domain

---

## 🚨 KNOWN ISSUES & TECHNICAL DEBT

### ~~Issue #1: Audio Not Streaming from Electron~~ ✅ RESOLVED
- **Fixed:** B2.6 fully implemented with AudioWorklet + fallback

### Issue #2: Missing electron-store Dependency ✅ RESOLVED
- **Fixed:** electron-store is in package.json dependencies

### Issue #3: Tray Icon ✅ RESOLVED
- **Fixed:** createTrayIcon() generates colored circles via raw RGBA pixels
- **Enhancement planned:** Use PNG assets from assets/ folder (RP-04)

### ~~Issue #4: canvas Dependency~~ ✅ RESOLVED
- **Fixed:** Removed canvas dependency, using raw RGBA pixel approach

### Issue #5: Cloud API uses SQLite in production 🟡 NEW
- **Severity:** MEDIUM
- **Location:** src/cloud/api.py
- **Problem:** Cloud API uses SQLite, but docker-compose expects PostgreSQL
- **Fix:** Add DATABASE_URL support for PostgreSQL (RP-09)

### Issue #6: No OAuth for cloud storage integrations 🟡 NEW
- **Severity:** MEDIUM
- **Location:** src/client/desktop/main.js
- **Problem:** Dropbox/Google Drive require manual token entry
- **Fix:** Implement OAuth2 PKCE flows (RP-10)

---

## 🧪 TESTING REQUIREMENTS

### Unit Tests (Per Codon)
```
Each codon MUST have:
├── At least 2 test cases
├── Happy path test
├── Error handling test
└── Edge case test (if applicable)
```

### Integration Tests
```
├── Engine → Server: Audio flows, transcripts return ✅ (via demo.py)
├── Server → Client: WebSocket messages correct 🔴 (blocked by B2.6)
├── Client → Injection: Text pastes to target app 🔲
└── Installer → Engine: Model loads and runs 🔲
```

### End-to-End Tests
```
├── Fresh install on clean Windows VM 🔲
├── Fresh install on clean macOS VM 🔲
├── Fresh install on clean Ubuntu VM 🔲
├── Cloud signup → transcription → vault save 🔲 (Phase 2)
└── Mobile PWA: record → transcribe → copy 🔲 (Phase 3)
```

---

## 📊 METRICS & MONITORING

### User-Facing Metrics
```
├── Time to first transcription
├── Transcription latency (p50, p95, p99)
├── Session length distribution
├── Crash rate
└── NPS (Net Promoter Score)
```

### System Metrics
```
├── CPU utilization per stream
├── Memory usage per model
├── WebSocket connection stability
├── API response times
└── Error rates by type
```

---

## 🚨 CRITICAL INVARIANTS

**These must NEVER be violated:**

1. **If green strobe is on, audio is being captured.** No exceptions.
2. **Every segment is written to temp file before callback.** Crash recovery is non-negotiable.
3. **No terminal commands for end users.** Ever. TurboTax or nothing.
4. **One codebase for mobile and desktop web.** Tailwind responsive, not separate apps.
5. **Local mode works 100% offline.** No network required after install.

---

## 🎯 DEFINITION OF DONE

A codon is DONE when:
- [ ] Code is written and linted
- [ ] Unit tests pass
- [ ] Integration with adjacent codons verified
- [ ] Documented in code comments
- [ ] Added to this DNA plan with ✅

A strand is DONE when:
- [ ] All codons are ✅
- [ ] End-to-end test passes
- [ ] No critical bugs
- [ ] User documentation complete

The organism is DONE when:
- [ ] All strands are ✅
- [ ] Beta users confirm UX goals met
- [ ] Performance metrics hit targets
- [ ] Ready for public launch

---

---

## 🧬 STRAND E: WINDY TRANSLATE (Real-Time Offline Translation)

**Added:** 2026-02-27 by Kit 0C3 Charlie
**Priority:** HIGH — This is a standalone product-within-a-product that doubles the addressable market.

### E0: Market Context & Competitive Intelligence

```
MARKET SIZE:
├── Global machine translation market: $978M (2022) → $2.72B (2030), 13.5% CAGR
├── Language services industry overall: ~$65B
├── Military/defense = 30.6% of MT market (largest segment)
├── Healthcare = fastest growing (15.3% CAGR)
├── Google Translate: 500M+ daily users, 100B+ words/day

DIRECT COMPETITORS (Conversation Mode — speak/translate/hand-over):
├── Google Translate — FREE, cloud-only, 249 languages, "Conversation Mode"
├── Apple Translate — FREE (iOS only), cloud-only, 20+ languages, "Face to Face"
├── Microsoft Translator — FREE, cloud-only, 170+ languages, multi-device group mode
├── iTranslate — $6/mo or $50/yr, cloud
├── Speak & Translate — $5/mo or $30/yr, cloud
├── SayHi (Amazon) — FREE, cloud

HARDWARE TRANSLATORS:
├── Pocketalk — Enterprise pricing (was $299), 92+ languages, HIPAA compliant
├── Timekettle earbuds — $100-$300, each person wears one
├── Travis Touch Go — $199, handheld, 155 languages
├── WT2 Edge earbuds — $300, simultaneous translation
├── Vasco — $300-$500, lifetime data, no subscription

ENTERPRISE ON-PREMISE:
├── SYSTRAN — $200 desktop / $15,000+ enterprise
├── Google Cloud Translation API — $20/million chars
├── Amazon Translate — $15/million chars

OUR KILLER DIFFERENTIATOR:
├── 100% OFFLINE speech-to-speech translation on user's own device
├── ZERO data collection (Google mines everything)
├── No subscription ever (destroys $6-30/mo competitors)
├── HIPAA/privacy compliant BY DESIGN (no cloud = no breach)
├── Works without cell signal (field operators, rural areas, travel)
├── Customizable engine cocktails per user's language profile
└── Runs on hardware they already own (vs $300-500 dedicated devices)

NOBODY ELSE DOES FULLY OFFLINE SPEECH-TO-SPEECH TRANSLATION ON A PHONE/LAPTOP.
This is a genuine market gap as of Feb 2026.
```

### E0.5: Current Implementation Status (as of 2026-03-08) ✅
```
REFERENCE: docs/TRANSLATE_ARCHITECTURE.md (full architecture documentation)

TWO-TOOL ARCHITECTURE (both shipping in Electron desktop app):

┌─────────────────────────────────────────────────────────────────━━━━┐
│  🌐 QUICK TRANSLATE (Popup)         🎤 TRANSLATE STUDIO (Panel)    │
│  ├── Ctrl+Shift+T instant access    ├── Embedded in main window    │
│  ├── ⌨️ Text + 🎤 Live Listen       ├── 💬 Text + 🎙️ Push-to-talk │
│  ├── Passive continuous mic          ├── Active push-to-talk mic    │
│  ├── 📜 Unified chronological feed  ├── 📋 History + ⭐ Favorites  │
│  ├── 🔧 Cockpit (15 model selector) ├── 🔊 TTS playback           │
│  ├── 🌪️ WindyTune/Manual toggle    ├── 🌊 Waveform animation      │
│  ├── 📏 Ui + Aa scale sliders       ├── 📡 Health check + offline  │
│  ├── ⏱️ Chunk slider (5-60s)        │   queue                      │
│  ├── 💡 Tooltips on every control   └── ~770 lines (TranslatePanel)│
│  └── ~380 lines                                                     │
└━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┘

FILES (all ✅ COMPLETE):
├── src/client/desktop/renderer/mini-translate.html  (Quick Translate UI)
├── src/client/desktop/renderer/mini-translate.js    (Quick Translate logic)
├── src/client/desktop/mini-translate-preload.js     (Electron preload)
├── src/client/desktop/renderer/translate.js         (Translate Studio class)
└── src/client/desktop/main.js                       (IPC: mini-translate-speech)

CURRENT ENGINES (BYOK — Bring Your Own Key):
├── ☁️ Groq Whisper API (primary cloud)
├── ☁️ OpenAI Whisper API (fallback cloud)
└── 🏠 Local Whisper models (15 proprietary names):
    ├── 🛡️ Edge (CPU): Spark 42MB, Pulse 78MB, Standard 168MB, Global 515MB, Pro 515MB
    ├── ⚡ Core (GPU): Spark 75MB, Pulse 142MB, Standard 466MB, Global 1.5GB,
    │                  Pro 1.5GB, Turbo 1.6GB, Ultra 2.9GB
    └── 🌍 Lingua: Español 500MB, Français 500MB, हिन्दी 500MB

QUICK TRANSLATE COCKPIT FEATURES (✅ all implemented):
├── WindyTune/Manual toggle with CSS animation
├── Manual mode locks cockpit — IPC never overwrites user selection
├── 🎤 Listening / 📝 Translating role labels with cloud/local distinction
├── 🟢 Audio strobe (pulsing green dot when mic active)
├── Unified transcript thread (⌨️ text + 🎤 voice in one feed)
├── Font size slider (10-24px) for transcript
├── UI scale slider (0.8x-1.6x zoom) for all controls
├── Chunk duration slider (5-60s with 1s steps)
├── 99 Whisper-supported languages in both dropdowns
└── Educational tooltips on every interactive element

STATUS: This is a PRECURSOR to the full Strand E vision below.
The current tools use cloud APIs + local Whisper for translation.
Strand E targets full offline speech-to-speech via CTranslate2/NLLB.
```

### E1: Translation Engine Core
```
FILE: src/engine/translator.py
STATUS: 🔲 NOT STARTED
PRIORITY: HIGH

CODONS:
├── E1.1 TranslationPair dataclass 🔲
│   ├── source_lang: str (ISO 639-1, e.g., "en")
│   ├── target_lang: str
│   ├── source_text: str
│   ├── translated_text: str
│   ├── confidence: float (0.0-1.0)
│   ├── timestamp: float
│   └── is_partial: bool
│
├── E1.2 TranslationEngine class 🔲
│   ├── __init__(model_path, source_lang, target_lang)
│   ├── load_model() -> bool
│   ├── translate(text: str) -> TranslationPair
│   ├── translate_stream(segments: Iterator) -> Iterator[TranslationPair]
│   ├── get_supported_pairs() -> List[Tuple[str, str]]
│   ├── swap_languages()
│   └── unload_model()
│
├── E1.3 Engine Backend Options 🔲
│   │
│   │  PRIMARY: CTranslate2 (same library family as faster-whisper)
│   │  - Optimized for CPU + GPU inference
│   │  - Supports OPUS-MT models (Helsinki-NLP)
│   │  - Supports NLLB (Meta's No Language Left Behind — 200 languages)
│   │  - Supports M2M-100 (Meta's many-to-many — 100 languages)
│   │  - int8 quantization for low-RAM devices
│   │
│   │  MODELS (by quality tier):
│   │  ├── Tier 1 (Best): NLLB-200-3.3B (3.3B params, ~6GB, GPU recommended)
│   │  ├── Tier 2 (Good): NLLB-200-1.3B (1.3B params, ~2.5GB, CPU ok)
│   │  ├── Tier 3 (Fast): NLLB-200-600M (600M params, ~1.2GB, any device)
│   │  ├── Tier 4 (Tiny): OPUS-MT bilingual pairs (~300MB per pair, fastest)
│   │  └── Tier 5 (Cloud fallback): API call to Veron for heavy languages
│   │
│   │  MODEL SELECTION LOGIC (mirrors Whisper engine selection):
│   │  ├── GPU ≥ 6GB VRAM → NLLB-3.3B + float16
│   │  ├── GPU < 6GB or CPU + RAM ≥ 16GB → NLLB-1.3B + int8
│   │  ├── RAM ≥ 8GB → NLLB-600M + int8
│   │  ├── RAM < 8GB → OPUS-MT bilingual (only their language pair)
│   │  └── Potato hardware → Cloud fallback
│   │
│   └── E1.3.1 Engine Encryption (.wpr format) 🔲
│       └── Same encryption as Whisper models — account-fingerprinted
│
├── E1.4 Language Detection (Auto-Detect Mode) 🔲
│   ├── Use Whisper's built-in language detection (first 30s of audio)
│   ├── Fallback: fasttext language ID model (~1MB, instant)
│   ├── Cache detected language per speaker turn
│   └── Override: user can pin source language manually
│
└── E1.5 Translation Pipeline Integration 🔲
    │
    │  FLOW: Audio → Whisper STT → Translation Engine → Display
    │
    ├── Whisper outputs source-language text
    ├── Translation engine converts to target language
    ├── Both source and translated text displayed simultaneously
    ├── Latency budget: STT (500ms) + Translation (200ms) = 700ms total
    └── Pipeline runs in separate thread/process to avoid blocking STT
```

### E2: Conversation Mode (The "Hand-Over" Feature)
```
FILE: src/engine/conversation.py
STATUS: 🔲 NOT STARTED
PRIORITY: HIGH — This is the feature that sells Windy Translate

CODONS:
├── E2.1 ConversationSession class 🔲
│   ├── speaker_a_lang: str (e.g., "en")
│   ├── speaker_b_lang: str (e.g., "es")
│   ├── current_speaker: "A" | "B"
│   ├── turns: List[ConversationTurn]
│   ├── auto_detect: bool (detect who's speaking by language)
│   └── mode: "manual" | "auto" | "split-screen"
│
├── E2.2 ConversationTurn dataclass 🔲
│   ├── speaker: "A" | "B"
│   ├── original_text: str
│   ├── translated_text: str
│   ├── source_lang: str
│   ├── target_lang: str
│   ├── timestamp: float
│   └── audio_segment: Optional[bytes]
│
├── E2.3 Conversation Modes 🔲
│   │
│   ├── MANUAL MODE (Simplest):
│   │   ├── Big button: "I'm speaking" / "They're speaking"
│   │   ├── Tap to switch who's talking
│   │   ├── Screen shows translation for the LISTENER
│   │   └── Ideal for: handing phone back and forth
│   │
│   ├── AUTO MODE (Smart):
│   │   ├── Whisper detects language of incoming audio
│   │   ├── If language = Speaker A's lang → translate to B's lang
│   │   ├── If language = Speaker B's lang → translate to A's lang
│   │   ├── No button needed — just talk
│   │   └── Ideal for: phone on table between two people
│   │
│   └── SPLIT-SCREEN MODE (Visual):
│       ├── Screen divided: top half = Person A's view, bottom = Person B's
│       ├── Each half shows the OTHER person's words translated
│       ├── Color-coded by speaker
│       └── Ideal for: face-to-face across a table, phone laying flat
│
├── E2.4 Text-to-Speech Output (Optional) 🔲
│   ├── After translation, optionally speak the translated text aloud
│   ├── Use system TTS or bundled TTS model (Piper/Coqui)
│   ├── Voice selection per language
│   └── Adjustable speed (0.75x - 1.5x)
│
└── E2.5 Conversation Export 🔲
    ├── Export full conversation as bilingual transcript
    ├── Formats: .txt, .md, .pdf, .srt (for video subtitling)
    ├── Side-by-side or interleaved format
    └── Timestamp per turn
```

### E3: Language Profile & Model Management
```
FILE: src/engine/language_profile.py
STATUS: 🔲 NOT STARTED

CODONS:
├── E3.1 UserLanguageProfile dataclass 🔲
│   ├── languages: List[LanguageEntry]
│   │   ├── code: str (ISO 639-1)
│   │   ├── name: str (display name)
│   │   ├── percentage: int (0-100, must sum to 100)
│   │   └── is_primary: bool
│   ├── created_at: datetime
│   └── updated_at: datetime
│
├── E3.2 Engine Cocktail Generator 🔲
│   │
│   │  Based on language profile, determine optimal model set:
│   │
│   ├── IF user speaks 1 language:
│   │   └── Whisper model optimized for that language only (smaller, faster)
│   │
│   ├── IF user speaks 2 languages (e.g., EN 70% / ES 30%):
│   │   ├── Whisper multilingual model
│   │   ├── OPUS-MT bilingual pair (en↔es) — smallest, fastest for 2 langs
│   │   └── Total download: ~800MB
│   │
│   ├── IF user speaks 3-4 languages:
│   │   ├── Whisper multilingual model
│   │   ├── NLLB-600M (covers all pairs) — ~1.2GB
│   │   └── Total download: ~2GB
│   │
│   └── IF user speaks 5+ languages:
│       ├── Whisper large multilingual
│       ├── NLLB-1.3B or NLLB-3.3B (depending on hardware)
│       └── Total download: 3-7GB
│
├── E3.3 Supported Languages (99 Target) 🔲
│   │
│   │  Priority tiers for development:
│   │
│   ├── Tier 1 (Launch — 15 languages):
│   │   English, Spanish, French, German, Portuguese, Italian,
│   │   Chinese (Simplified), Chinese (Traditional), Japanese,
│   │   Korean, Arabic, Hindi, Russian, Turkish, Vietnamese
│   │
│   ├── Tier 2 (Month 2 — 30 more):
│   │   Dutch, Polish, Swedish, Norwegian, Danish, Finnish,
│   │   Thai, Indonesian, Malay, Tagalog, Ukrainian, Czech,
│   │   Romanian, Hungarian, Greek, Hebrew, Persian, Urdu,
│   │   Bengali, Tamil, Telugu, Swahili, Amharic, Hausa,
│   │   Yoruba, Igbo, Zulu, Afrikaans, Catalan, Basque
│   │
│   └── Tier 3 (Month 3-4 — remaining to 99):
│       └── Fill from NLLB-200's supported list based on user demand
│
└── E3.4 Language Search & Selection UI Component 🔲
    │
    │  Reusable across installer wizard AND settings panel
    │
    ├── Searchable dropdown (type to filter)
    ├── Flag icons for visual identification
    ├── Recently used languages pinned at top
    ├── Percentage sliders (auto-balance to 100%)
    ├── Drag to reorder by frequency
    └── "I don't know the percentages" → equal split option
```

### E4: Pricing & Monetization Architecture
```
STATUS: 🔲 DESIGN PHASE

CODONS:
├── E4.1 Tier Structure 🔲
│   │
│   │  ┌────────────────────────────────────────────────────────┐
│   │  │          WINDY PRO PRICING TIERS                       │
│   │  ├────────────────────────────────────────────────────────┤
│   │  │                                                        │
│   │  │  FREE TIER (Windy Pro Base)                            │
│   │  │  ├── Voice-to-text in 1 language                       │
│   │  │  ├── Local Whisper engine only                         │
│   │  │  ├── Basic model (base/small)                          │
│   │  │  └── No translation                                    │
│   │  │                                                        │
│   │  │  WINDY PRO — $49 one-time                              │
│   │  │  ├── Voice-to-text in any language                     │
│   │  │  ├── All 5 engines                                     │
│   │  │  ├── 30-min recordings, batch mode                     │
│   │  │  ├── LLM polish, speaker ID                            │
│   │  │  ├── All Whisper model sizes                           │
│   │  │  └── No translation                                    │
│   │  │                                                        │
│   │  │  WINDY TRANSLATE — $79 one-time OR $7.99/mo            │
│   │  │  ├── 2-way conversation translation                    │
│   │  │  ├── Up to 5 language pairs                            │
│   │  │  ├── Manual + Auto conversation modes                  │
│   │  │  ├── 100% offline                                      │
│   │  │  └── Bilingual transcript export                       │
│   │  │                                                        │
│   │  │  WINDY TRANSLATE PRO — $149 one-time                   │
│   │  │  ├── All 99 languages                                  │
│   │  │  ├── All conversation modes (manual/auto/split-screen) │
│   │  │  ├── TTS output (hear translations spoken)             │
│   │  │  ├── Medical/legal glossary packs                      │
│   │  │  ├── Priority model updates                            │
│   │  │  └── Custom terminology support                        │
│   │  │                                                        │
│   │  │  WINDY ENTERPRISE — $499+ per seat                     │
│   │  │  ├── Everything in Translate Pro                       │
│   │  │  ├── HIPAA compliance documentation                    │
│   │  │  ├── Custom terminology databases                      │
│   │  │  ├── Bulk deployment tools                             │
│   │  │  ├── Admin dashboard                                   │
│   │  │  └── Priority support                                  │
│   │  │                                                        │
│   │  └────────────────────────────────────────────────────────┘
│   │
│   │  KEY PRICING PSYCHOLOGY:
│   │  ├── One-time payments ONLY — this is our brand promise
│   │  ├── $79 undercuts $300 Pocketalk by 73%
│   │  ├── $149 undercuts $500 Vasco by 70%
│   │  ├── "No subscription ever" destroys iTranslate's $6/mo model
│   │  └── Enterprise at $499 undercuts SYSTRAN by 30x
│   │
│   └── Upgrade path: Free → Pro ($49) → Translate ($79) → Translate Pro ($149)
│       Each tier is cumulative — Translate Pro includes everything below it
│
├── E4.2 License Enforcement 🔲
│   ├── Account-based activation (same system as Windy Pro)
│   ├── 5-device limit per account
│   ├── Translation engines only download if tier allows
│   ├── Model files encrypted + account-fingerprinted (.wpr)
│   └── Offline verification (grace period: 30 days without phone-home)
│
└── E4.3 In-App Upgrade Flow 🔲
    ├── Settings → "Upgrade to Translate" (if not purchased)
    ├── Context-aware prompts (detect multilingual audio → suggest upgrade)
    ├── Installer wizard upsell (see Strand F — Installer)
    └── One-click purchase via account server
```

### E5: Target Verticals (Revenue Strategy)
```
STATUS: 🔲 PLANNING

CODONS:
├── E5.1 Healthcare 🔲
│   ├── HIPAA compliance: data never leaves device = compliant by design
│   ├── Medical glossary pack (terminology, drug names, procedures)
│   ├── Patient-provider conversation mode
│   ├── Export to EHR-compatible formats
│   ├── Target: hospitals, clinics, urgent care (vs $150-300/hr interpreters)
│   └── Price: $499/seat (saves $thousands/year vs human interpreters)
│
├── E5.2 Education 🔲
│   ├── Pocketalk already in 500+ school districts (proof of demand)
│   ├── Teacher-student conversation mode
│   ├── Parent-teacher conference mode
│   ├── Classroom-wide mode (teacher speaks, all students see translation)
│   ├── Target: school districts, ESL programs, universities
│   └── Price: $149/seat (district bulk: $99/seat for 50+)
│
├── E5.3 Military/Defense 🔲
│   ├── 30.6% of MT market = largest segment
│   ├── Offline-first = works in field with no cell signal
│   ├── Air-gapped operation possible
│   ├── Target: field interpreters, base operations, allied forces comms
│   └── Price: Government contract pricing (GSA schedule potential)
│
├── E5.4 Travel/Hospitality 🔲
│   ├── Hotels, airports, tourist services
│   ├── No wifi needed (offline)
│   ├── Simple UI for non-technical staff
│   └── Price: $79-149 per device
│
└── E5.5 Legal 🔲
    ├── Attorney-client privilege: nothing leaves device
    ├── Legal glossary pack
    ├── Deposition/interview translation
    └── Price: $499/seat
```

---

## 🧬 STRAND F: INSTALLER WIZARD v2 (Translation-Aware)

**Added:** 2026-02-27 by Kit 0C3 Charlie
**Depends on:** Strand E (Translation Engine), existing B4 (Installer)
**Reference:** INSTALLER-WIZARD-MASTER-PLAN.md (workspace)

### F1: Language Profiling Screen (All Users See This)
```
STATUS: 🔲 NOT STARTED

CODONS:
├── F1.1 Language Search & Selection 🔲
│   ├── Searchable input field (type "span" → "Spanish" appears)
│   ├── Full list of 99 supported languages
│   ├── Flag icons + native script name (e.g., "Español 🇪🇸")
│   ├── "Popular" section at top (top 15 languages)
│   └── Max 10 languages per profile
│
├── F1.2 Percentage Sliders 🔲
│   ├── Each selected language gets a slider (0-100%)
│   ├── Sliders auto-balance to sum to 100%
│   ├── Drag handle + numeric input
│   ├── "I'm not sure" button → equal split
│   └── Minimum 5% per language (if selected, it matters)
│
├── F1.3 Drag-to-Reorder 🔲
│   ├── Primary language = top of list
│   ├── Drag handle on left side
│   └── Reorder updates visual priority
│
├── F1.4 Data Usage 🔲
│   ├── Language profile stored locally (no cloud)
│   ├── Informs Whisper engine selection (multilingual vs English-only)
│   ├── Informs translation engine selection (which pairs to download)
│   ├── Informs TTS voice pre-download
│   └── Shown to user: "This helps us optimize your experience"
│
└── F1.5 UI Mockup 🔲

    ┌─────────────────────────────────────────────────┐
    │  🌐  YOUR LANGUAGES                             │
    │                                                  │
    │  What languages do you speak day-to-day?         │
    │  This helps us pick the best models for you.     │
    │                                                  │
    │  Search: [________________] 🔍                   │
    │                                                  │
    │  ≡ 🇺🇸 English      ████████████████░░  75%     │
    │  ≡ 🇪🇸 Spanish      ██████░░░░░░░░░░░░  20%     │
    │  ≡ 🇫🇷 French       ██░░░░░░░░░░░░░░░░   5%     │
    │                                                  │
    │  [+ Add another language]                        │
    │                                                  │
    │  ⓘ Drag to reorder · Slide to adjust %          │
    │  [ I'm not sure about percentages ]              │
    │                                                  │
    │                              [Continue →]        │
    └─────────────────────────────────────────────────┘
```

### F2: Translation Upsell Screen (Only if 2+ Languages Detected)
```
STATUS: 🔲 NOT STARTED

CODONS:
├── F2.1 Conditional Display Logic 🔲
│   ├── ONLY show if user selected 2+ languages in F1
│   ├── If 1 language → skip this screen entirely
│   └── If already purchased Translate tier → skip, show "✅ Included"
│
├── F2.2 Personalized Demo 🔲
│   ├── Show example using THEIR ACTUAL language pair
│   ├── e.g., if English + Spanish selected:
│   │   "¿Dónde está la farmacia?" → "Where is the pharmacy?"
│   ├── If English + Mandarin:
│   │   "你好，请问洗手间在哪里？" → "Hello, where is the restroom?"
│   └── Pre-built example sentences for top 15 language pairs
│
├── F2.3 Feature Highlights 🔲
│   ├── ✨ Works 100% offline
│   ├── 🔒 Conversations never leave your device
│   ├── ⚡ Sub-second translation speed
│   ├── 🗣️ Conversation mode — speak, translate, hand over
│   └── 📝 Bilingual transcript export
│
├── F2.4 Pricing Display 🔲
│   ├── Show tier that matches their language count:
│   │   ├── 2-5 languages → Windy Translate ($79 one-time)
│   │   └── 6+ languages → Windy Translate Pro ($149 one-time)
│   ├── "One-time payment. No subscription. Ever."
│   ├── Compare: "vs $300 for Pocketalk, $6/mo for iTranslate"
│   └── "Maybe later" button (prominent, guilt-free)
│
├── F2.5 "Maybe Later" Behavior 🔲
│   ├── Records preference (don't nag during install)
│   ├── Shows in Settings → Translation after install
│   ├── Gentle reminder after first multilingual audio detected
│   └── Never more than 1 reminder per 30 days
│
└── F2.6 UI Mockup 🔲

    ┌─────────────────────────────────────────────────┐
    │  🎯  YOU SPEAK MULTIPLE LANGUAGES               │
    │                                                  │
    │  Windy Pro noticed you speak English and         │
    │  Spanish. Unlock real-time conversation           │
    │  translation?                                     │
    │                                                  │
    │  ┌───────────────────────────────────────┐       │
    │  │  🗣️ "¿Dónde está la farmacia?"       │       │
    │  │  📝 "Where is the pharmacy?"          │       │
    │  │                                        │       │
    │  │  🗣️ "Two blocks north on Main St."   │       │
    │  │  📝 "Dos cuadras al norte en la       │       │
    │  │      calle principal."                 │       │
    │  └───────────────────────────────────────┘       │
    │                                                  │
    │  ✨ Works 100% offline                           │
    │  🔒 Your conversations never leave your device   │
    │  ⚡ Sub-second translation speed                 │
    │                                                  │
    │  ┌─────────────────────────────────────┐         │
    │  │  Add Windy Translate — $79 one-time  │         │
    │  │  No subscription. Ever.              │         │
    │  └─────────────────────────────────────┘         │
    │                                                  │
    │  [ Maybe later ]                                 │
    │  You can always add this from Settings           │
    │                                                  │
    └─────────────────────────────────────────────────┘
```

### F3: Updated Wizard Flow (Complete)
```
STATUS: 🔲 NOT STARTED

SCREENS (in order):
├── Screen 1: Welcome
│   "Welcome to Windy Pro"
│   Brand tornado animation
│   [Get Started]
│
├── Screen 2: Account Login/Register
│   Email + password (or license key)
│   Device registration (1 of 5)
│
├── Screen 3: Hardware Scan
│   "Scanning your system..."
│   GPU, RAM, Disk, CPU detected
│   Results displayed with checkmarks
│
├── Screen 4: Your Languages ← NEW (F1)
│   Search, select, percentage sliders
│   Informs engine cocktail selection
│
├── Screen 5: Translation Upgrade ← NEW (F2)
│   Only if 2+ languages selected
│   Personalized demo + pricing
│   "Maybe later" prominent
│
├── Screen 6: Engine Recommendation
│   Based on hardware (Screen 3) + languages (Screen 4) + tier
│   "We recommend: [engine cocktail]"
│   Shows total download size
│   [Why this choice?] tooltip
│
├── Screen 7: Download & Install
│   Whisper model download
│   Translation engine download (if purchased)
│   TTS voice download (if Translate Pro)
│   Progress bars with ETA
│   Brand experience during wait (feature education, tips)
│
├── Screen 8: Permissions
│   Microphone access
│   Accessibility (for cursor injection)
│   Platform-specific guidance
│
├── Screen 9: Voice Sample ← NEW
│   "Say something for 10 seconds"
│   Calibrates their voice profile
│   Shows live transcription as demo
│   "Wow, it works!" moment
│
└── Screen 10: Complete
    "You're ready!"
    Quick-start guide
    Hotkey reference card
    [Launch Windy Pro]
```

### F4: Wizard i18n Integration ✅
```
FILE: installer-v2/screens/wizard-i18n.json + wizard.html
STATUS: ✅ COMPLETE (27 Feb 2026)
ADDED BY: Kit 0C3 Charlie + Antigravity

CODONS:
├── F4.1 Language Detection ✅
│   ├── Wizard receives ?lang= URL parameter from website
│   ├── Fallback: English if no param provided
│   └── Language persists through all wizard screens
│
├── F4.2 Two-Tier Translation Data ✅
│   ├── Tier 1 (Top 10): Hand-translated, bundled in wizard-i18n.json
│   │   └── en, es, fr, zh, ar, pt, de (+ ja, ko, hi planned)
│   ├── Tier 2 (11-99): Dynamic translation via Veron API 🔲
│   │   └── Translated at install time (user has internet)
│   │   └── Cached after first translation
│   └── English is single source of truth — 138 keys across all 9 screens
│
├── F4.3 data-i18n HTML Attributes ✅
│   ├── 76 data-i18n attributes on text elements
│   ├── 7 data-i18n-placeholder attributes on input fields
│   └── Matches website i18n pattern exactly
│
├── F4.4 RTL Support ✅
│   ├── Arabic (ar) sets dir="rtl" on document root
│   └── Layout adapts automatically via existing CSS
│
└── F4.5 t() Helper Function ✅
    ├── t(key) → returns translated string for current language
    ├── Falls back to English if key missing in target language
    └── Available for JS-generated dynamic content
```

---

## 🧬 STRAND G: INTERNATIONALIZATION (i18n)

**Added:** 2026-02-27 by Kit 0C3 Charlie + Grant Whitmer
**Priority:** HIGH — Global market requires localized experience from first touch
**Key Decision:** Two-tier translation system (hand-translate 10, dynamic-translate 89)

### G0: Architecture Decision — Two-Tier Translation System

```
KEY ARCHITECTURE DECISION (27 Feb 2026, Grant + Kit 0C3 Charlie)

TWO-TIER TRANSLATION SYSTEM:

  TIER 1 — TOP 10 LANGUAGES (Hand-Translated, Bundled)
  ├── English, Chinese, Spanish, Hindi, Arabic
  ├── Portuguese, French, Japanese, German, Korean
  ├── Stored in i18n.json (website) and wizard-i18n.json (wizard)
  ├── Bundled with app — no network call needed
  ├── Human-reviewed for quality and cultural adaptation
  └── Captures ~82% of global addressable market

  TIER 2 — LANGUAGES 11-99 (Dynamically Translated via Veron)
  ├── Translated at runtime by our own Windy Translate engine
  ├── API call to Veron server: POST /translate {text, target_lang}
  ├── Results cached in localStorage (website) or install cache (wizard)
  ├── Auto-regenerates when English source content changes
  └── DOG-FOODING: This IS our product being used to sell our product

WHEN CONTENT CHANGES:
  ├── English: edit directly (single source of truth)
  ├── Top 10: run diff on changed strings → batch translate → human review → merge
  └── 11-99: auto-translate from English on next user visit, cached locally

MARKET COVERAGE:
  ├── Top 10 languages  = ~82% of global internet users
  ├── Top 30 languages  = ~95% of global internet users
  ├── All 99 languages   = ~99.5% of global internet users
  └── ROI: Hand-translating 10 languages covers the vast majority
```

### G1: Website i18n ✅
```
FILE: src/client/web/public/landing/i18n.json + index.html
STATUS: ✅ COMPLETE (27 Feb 2026)

CODONS:
├── G1.1 Language Selector ✅
│   ├── Dropdown in nav bar with flag + language name
│   ├── 12 languages in selector (en, es, fr, de, pt, zh, ja, ko, ar, hi, ru, tr)
│   └── Persists choice in localStorage
│
├── G1.2 Auto-Detection ✅
│   ├── Priority: URL param (?lang=) → localStorage → navigator.language → 'en'
│   └── Transparent to user — just works
│
├── G1.3 i18n.json (Tier 1 Data) ✅
│   ├── 16 languages fully translated
│   ├── ~55 keys per language covering all website sections
│   └── Hand-translated, culturally adapted marketing copy
│
├── G1.4 Dynamic API Translation (Tier 2) 🔲
│   ├── For languages not in i18n.json, call Veron API
│   ├── Cache result in localStorage per language + content hash
│   └── Show Tier 1 translation or loading shimmer while fetching
│
├── G1.5 RTL Support ✅
│   ├── Arabic sets dir="rtl" on html element
│   └── CSS adapts layout automatically
│
└── G1.6 Download Links Pass Language ✅
    ├── All download/wizard links append ?lang= param
    └── User's language selection flows to installer wizard
```

### G2: Wizard i18n ✅
```
FILE: installer-v2/screens/wizard-i18n.json + wizard.html
STATUS: ✅ COMPLETE (27 Feb 2026) — See F4 for implementation details

CODONS:
├── G2.1 URL Param Detection ✅
│   ├── Reads ?lang= from URL (passed by website G1.6)
│   └── Falls back to English if not provided
│
├── G2.2 Tier 1 Bundled Translations ✅
│   ├── 7 languages × 138 keys = 966 translations bundled
│   ├── Languages: en, es, fr, zh, ar, pt, de
│   └── 3 more planned: ja, ko, hi (to complete Top 10)
│
├── G2.3 Tier 2 Install-Time Translation 🔲
│   ├── User has internet at download time → translate wizard text
│   ├── Cache translated strings after first translation
│   └── Fall back to English if Veron unreachable
│
└── G2.4 83 Localized Elements ✅
    ├── 76 data-i18n text elements across all 9 wizard screens
    └── 7 data-i18n-placeholder input fields
```

### G3: In-App i18n 🔲
```
FILE: TBD
STATUS: 🔲 NOT STARTED (Future)
PRIORITY: MEDIUM

CODONS:
├── G3.1 App UI Strings 🔲
│   ├── All desktop app strings externalized to JSON
│   ├── Renderer UI, settings panel, vault, tray menu
│   └── Same two-tier pattern as website
│
├── G3.2 Language Auto-Selection 🔲
│   ├── Default to language selected during install (via G6 chain)
│   ├── User can override in Settings → Language
│   └── Applies immediately, no restart required
│
└── G3.3 Contextual Language 🔲
    ├── Engine names stay in English (product names)
    ├── Error messages localized
    └── Keyboard shortcuts shown with local key names
```

### G4: Dynamic Translation API (Veron) 🔲
```
FILE: TBD (Veron server endpoint)
STATUS: 🔲 NOT STARTED
PRIORITY: HIGH — Required for Tier 2 translation

CODONS:
├── G4.1 Translation Endpoint 🔲
│   ├── POST /api/v1/translate
│   ├── Request: { "text": "...", "source": "en", "target": "ja", "context": "marketing" }
│   ├── Response: { "translated": "...", "confidence": 0.95, "cached": false }
│   └── Rate limit: 100 requests/min per IP (generous for i18n use)
│
├── G4.2 Batch Translation 🔲
│   ├── POST /api/v1/translate/batch
│   ├── Request: { "texts": [...], "source": "en", "target": "ja" }
│   ├── Response: { "translations": [...] }
│   └── Used by website/wizard to translate all keys at once
│
├── G4.3 Server-Side Caching 🔲
│   ├── Cache translations by (source_text_hash + target_lang)
│   ├── TTL: infinite (until source content changes)
│   ├── Invalidate when English source hash changes
│   └── Redis or SQLite cache backend
│
└── G4.4 Dog-Fooding 🔲
    ├── This IS Windy Translate being used to sell Windy Translate
    ├── Quality of dynamic translations = live product demo
    ├── If translations are bad, users won't buy → self-correcting incentive
    └── Every website visitor in a Tier 2 language sees our product in action
```

### G5: Translation Maintenance Pipeline 🔲
```
FILE: TBD (CI/CD script or admin tool)
STATUS: 🔲 NOT STARTED
PRIORITY: MEDIUM — Required when English content changes

CODONS:
├── G5.1 Content Hash Tracking 🔲
│   ├── Each English key has a content hash (SHA-256 of value)
│   ├── When English value changes, hash changes
│   ├── Changed hashes = strings needing re-translation
│   └── Stored in i18n-meta.json alongside i18n.json
│
├── G5.2 Tier 1 Re-Translation Workflow 🔲
│   ├── Detect changed English strings via hash diff
│   ├── Batch-translate changed strings to all 10 Tier 1 languages
│   ├── Human review queue (approve/edit before merge)
│   ├── PR-based workflow: bot creates PR with updated translations
│   └── Cadence: on each release or sprint boundary
│
├── G5.3 Tier 2 Cache Invalidation 🔲
│   ├── When English content hash changes → invalidate cached translations
│   ├── Next user visit in Tier 2 language triggers fresh API translation
│   ├── localStorage cache keys include content hash → auto-invalidate
│   └── Graceful: show stale translation while fetching new one
│
└── G5.4 Quality Monitoring 🔲
    ├── Flag button on website: "Translation incorrect?" → report
    ├── Reports feed into Tier 1 promotion candidates
    ├── High-traffic Tier 2 languages may graduate to Tier 1
    └── Metrics: error reports per language, translation latency
```

### G6: Language Chain (Continuous Experience) 🟡
```
STATUS: 🟡 PARTIALLY COMPLETE
PRIORITY: HIGH — Seamless language continuity is the goal

THE CHAIN:

  Website Language (G1)
       ↓ ?lang= URL param
  Wizard Language (G2)
       ↓ pre-selected primary language
  Language Profile (F1)
       ↓ stored in user preferences
  App UI Language (G3)
       ↓ same language everywhere
  Continuous Experience ✅

CODONS:
├── G6.1 Website → Wizard Handoff ✅
│   ├── Website appends ?lang= to all download/wizard links
│   ├── Wizard reads param and displays in that language
│   └── COMPLETE: Implemented in G1.6 and G2.1
│
├── G6.2 Wizard → Language Profile 🟡
│   ├── User's selected language in wizard = pre-selected in Language screen
│   ├── If user visited site in French → wizard in French → French pre-selected
│   └── Needs: auto-add wizard language to language profile list
│
├── G6.3 Language Profile → App UI 🔲
│   ├── Primary language from profile = app UI language
│   ├── Applied on first launch after install
│   └── User can override in Settings
│
└── G6.4 Cross-Device Sync 🔲
    ├── Language preference synced via account server
    ├── Login on new device → same language experience
    └── Account stores { preferred_lang: "fr", profile: [...] }
```

---

### STRAND H: WEB PORTAL & USER DASHBOARD

**Added:** 2026-03-01 by Antigravity + Grant Whitmer
**Priority:** HIGH — Users need to access their recordings from any browser. This is the bridge between desktop power and cloud convenience.
**Vision:** A user records themselves all day on their desktop. That evening, they open windypro.thewindstorm.uk on their phone, log in, and review every recording, transcript, and Soul File entry — searchable, playable, exportable.

#### H1: Account Server
```
FILE: services/account-server/server.js
STATUS: ✅ IMPLEMENTED (2026-03-01, Antigravity)
PRIORITY: HIGH (everything in this strand depends on accounts)

CODONS:
├── H1.1 User Registration ✅
│   ├── POST /api/v1/auth/register
│   ├── Fields: name, email, password
│   ├── Password hashing: bcrypt (12 rounds)
│   ├── Email uniqueness enforcement
│   └── Returns: JWT + user object
│
├── H1.2 User Login ✅
│   ├── POST /api/v1/auth/login
│   ├── Fields: email, password
│   ├── JWT token (HS256, 7-day expiry)
│   ├── Refresh token support (30-day expiry)
│   └── Rate limiting: 5 attempts per 15 min
│
├── H1.3 Device Management ✅
│   ├── POST /api/v1/auth/devices — register device
│   ├── GET /api/v1/auth/devices — list user's devices
│   ├── DELETE /api/v1/auth/devices/:id — revoke device
│   ├── 5-device limit per account (configurable)
│   └── Device fingerprinting (hardware hash)
│
├── H1.4 User Profile ✅
│   ├── GET /api/v1/auth/me — get profile
│   ├── PATCH /api/v1/auth/me — update profile
│   ├── PUT /api/v1/auth/password — change password
│   └── DELETE /api/v1/auth/me — account deletion (GDPR)
│
├── H1.5 Token Management ✅
│   ├── POST /api/v1/auth/refresh — refresh expired JWT
│   ├── POST /api/v1/auth/logout — invalidate token
│   └── Token blacklist (Redis or in-memory Set)
│
└── H1.6 Storage Backend ✅ (SQLite w/ WAL mode)
    ├── SQLite for local dev/testing
    ├── PostgreSQL for production (DATABASE_URL env)
    └── Migration script: SQLite → PostgreSQL

DEPENDENCIES: None (this is the foundation)
```

#### H2: Recording & Transcript API
```
FILE: services/account-server/server.js (integrated into H1 server)
STATUS: ✅ IMPLEMENTED (2026-03-01, Antigravity)
PRIORITY: HIGH (the recordings dashboard needs data)

CODONS:
├── H2.1 Recording CRUD ✅
│   ├── GET /api/v1/recordings — list all (paginated, 50/page)
│   │   ├── Query params: ?page=1&search=keyword&from=2026-01-01&to=2026-03-01
│   │   └── Returns: id, date, duration, wordCount, engine, hasAudio, hasVideo
│   │
│   ├── GET /api/v1/recordings/:id — single recording detail
│   │   └── Returns: full transcript text + metadata + media URLs
│   │
│   ├── DELETE /api/v1/recordings/:id — delete recording + associated files
│   └── PATCH /api/v1/recordings/:id — update transcript text (user edits)
│
├── H2.2 Media Streaming ✅
│   ├── GET /api/v1/recordings/:id/audio — stream audio (Range headers)
│   ├── GET /api/v1/recordings/:id/video — stream video (Range headers)
│   └── Content-Type negotiation (webm, mp4, ogg, wav)
│
├── H2.3 Bulk Operations ✅
│   ├── POST /api/v1/recordings/export — export all as ZIP (text + media)
│   ├── DELETE /api/v1/recordings/bulk — delete multiple by IDs
│   └── GET /api/v1/recordings/stats — total words, total hours, total count
│
└── H2.4 Authentication Middleware ✅
    ├── Bearer token validation on all /api/v1/recordings/* routes
    ├── User-scoped queries (user can ONLY see their own data)
    └── Admin bypass for support scenarios

DEPENDENCIES: H1 (account server for JWT validation)
```

#### H3: Recordings Dashboard (Web Frontend)
```
FILE: src/client/web/src/pages/Dashboard.jsx [NEW]
STATUS: ✅ IMPLEMENTED (2026-03-01, Antigravity)
PRIORITY: HIGH (the whole point of this strand)

CODONS:
├── H3.1 Dashboard Layout ✅
│   ├── Full-height responsive layout
│   ├── Header: user avatar, name, logout
│   ├── Stats bar: total recordings, total words, total hours
│   ├── Search bar with date range picker
│   └── Mobile-first responsive (works on phone browser)
│
├── H3.2 Recording List ✅
│   ├── Grouped by date (TODAY, YESTERDAY, This Week, Older)
│   ├── Each entry: timestamp, preview snippet, word count, duration
│   ├── Media badges: 🎤 audio, 🎬 video, 🧬 clone capture
│   ├── Click to expand → full transcript + media player
│   ├── Infinite scroll / lazy loading (50 per page)
│   └── Search highlighting
│
├── H3.3 Inline Media Player ✅
│   ├── Audio player: waveform visualization, play/pause, skip
│   ├── Video player: responsive aspect ratio, fullscreen
│   ├── Synced A/V playback (audio comes from audio player, video muted)
│   └── Playback speed: 0.5x, 1x, 1.25x, 1.5x, 2x
│
├── H3.4 Transcript Viewer ✅
│   ├── Full transcript display with timestamps
│   ├── Copy to clipboard button
│   ├── Edit-in-place (contentEditable, auto-saves)
│   ├── Export: TXT, MD, PDF
│   └── Word count + estimated reading time
│
├── H3.5 Management Actions ✅
│   ├── Delete single recording (with confirmation modal)
│   ├── Bulk select + delete
│   ├── Export All as ZIP
│   └── Download individual audio/video files
│
└── H3.6 Dashboard Routing ✅
    ├── Route: /dashboard (protected)
    ├── Add to App.jsx Routes
    ├── Add "Dashboard" link to landing page nav (for logged-in users)
    └── Redirect /transcribe → /dashboard after recording completes

DEPENDENCIES: H2 (recording APIs), H1 (auth)
```

#### H4: Desktop → Cloud Sync
```
FILE: src/client/desktop/renderer/sync.js [NEW]
STATUS: ✅ IMPLEMENTED (2026-03-01, Antigravity)
PRIORITY: MEDIUM (can use local-only initially)

CODONS:
├── H4.1 Upload Pipeline ✅
│   ├── After archiveRecording() → queue upload to cloud
│   ├── Upload: transcript JSON + audio blob + video blob
│   ├── Retry logic: 3 attempts with exponential backoff
│   ├── Resume interrupted uploads (chunked upload)
│   └── Bandwidth-aware: pause if user is on metered connection
│
├── H4.2 Sync Status UI ✅
│   ├── Status badge in desktop app: ☁️ Synced / ⏳ Syncing / ❌ Offline
│   ├── Per-recording sync indicator in History panel
│   └── Settings toggle: "Auto-sync to cloud" (default: ON if logged in)
│
├── H4.3 Conflict Resolution 🟡 (basic last-write-wins)
│   ├── Desktop edit wins (desktop is primary)
│   ├── Deleted on web → mark as deleted on desktop (soft delete)
│   └── Timestamp-based last-write-wins for transcript edits
│
├── H4.4 Offline Queue ✅
│   ├── SQLite queue table: pending uploads
│   ├── Process queue when internet reconnects
│   └── Max queue size: 500 recordings (warn user)
│
└── H4.5 Login from Desktop ✅
    ├── Settings → "Connect to Windy Cloud" button
    ├── Opens in-app OAuth/login flow
    ├── Stores JWT in electron-store (not localStorage)
    └── Syncs user profile + device registration (H1.3)

DEPENDENCIES: H1 (accounts), H2 (recording APIs)
NOTE: This is the most complex codon — can be deferred to Phase 2.
      Dashboard works without sync if user uses Windy Cloud for transcription.
```

#### H5: Soul File Browser
```
FILE: src/client/web/src/pages/SoulFile.jsx [NEW]
STATUS: ✅ IMPLEMENTED (2026-03-01, Antigravity)
PRIORITY: MEDIUM (differentiator for Clone Capture users)

CODONS:
├── H5.1 Soul File Overview Page ✅
│   ├── Route: /soul-file (protected)
│   ├── Total data stats: hours recorded, words transcribed, files archived
│   ├── Timeline visualization: recording sessions per day (heatmap calendar)
│   ├── Voice quality metrics: avg recording quality, silence ratio
│   └── "Data completeness" progress indicator
│
├── H5.2 Clone Capture Archive Viewer ✅
│   ├── Filter by: Clone Capture sessions only
│   ├── Batch processing status: ⏳ Pending / ✅ Transcribed / ❌ Failed
│   ├── Queue for overnight batch processing (future)
│   └── Re-process button (re-run transcription with different engine)
│
└── H5.3 Export for Digital Twin 🟡 (future)
    ├── Export all transcripts as single combined file
    ├── Export voice samples (audio clips for voice cloning)
    ├── Export metadata JSON (timestamps, durations, word counts)
    └── Format: ZIP with README explaining structure

DEPENDENCIES: H3 (dashboard), H2 (recording APIs)
```

#### H6: Landing Page Auth Integration
```
FILE: src/client/web/src/pages/Landing.jsx (modify existing)
STATUS: ✅ IMPLEMENTED (2026-03-01, Antigravity)
PRIORITY: HIGH (users need to find the login)

CODONS:
├── H6.1 Add Auth Buttons to Nav ✅
│   ├── "Sign In" button in header (top-right)
│   ├── "Get Started" CTA → /auth (register tab)
│   ├── If logged in: show "Dashboard" button instead of "Sign In"
│   └── User avatar + dropdown menu when logged in
│
├── H6.2 Deploy Auth + Dashboard to Production 🟡
│   ├── Vite build → static files
│   ├── Nginx serves React app with client-side routing
│   ├── API proxy: /api/* → account-server + cloud-storage
│   └── SSL: Let's Encrypt via certbot
│
└── H6.3 Responsive Nav ✅
    ├── Mobile hamburger menu
    ├── "Sign In" accessible on all screen sizes
    └── Touch-friendly dropdown menus

DEPENDENCIES: H1 (account server running in prod)
```

#### H7: Web Portal Deployment
```
FILES: deploy/docker-compose.yml, deploy/nginx.conf (modify existing)
STATUS: ✅ IMPLEMENTED (2026-03-01, Antigravity — nginx config + Vite proxy)
PRIORITY: HIGH (nothing works without deployment)

CODONS:
├── H7.1 Docker Services ✅
│   ├── account-server container (Node.js + SQLite/PostgreSQL)
│   ├── cloud-storage container (Node.js — recording APIs)
│   ├── web-client container (Nginx → Vite static build)
│   └── PostgreSQL container (shared DB for both services)
│
├── H7.2 Nginx Configuration ✅
│   ├── / → React app (SPA fallback to index.html)
│   ├── /api/v1/auth/* → account-server:8098
│   ├── /api/v1/recordings/* → cloud-storage:8099
│   ├── /ws/* → cloud-api:8000 (WebSocket proxy)
│   └── Security headers: CORS, CSP, HSTS
│
├── H7.3 CI/CD Pipeline 🔲
│   ├── GitHub Actions: build + test + deploy on push to main
│   ├── Docker image build + push to registry
│   └── SSH deploy to Hostinger VPS
│
└── H7.4 Monitoring 🔲
    ├── Health check endpoints on all services
    ├── Uptime monitoring (UptimeRobot or similar)
    └── Error alerting (email or Slack webhook)

DEPENDENCIES: H1, H2, H3, H6
```

#### H8: Web Portal Analytics
```
FILE: services/analytics/tracker.js [NEW]
STATUS: 🟡 PARTIAL (basic analytics hooks via existing _sendAnalytics())
PRIORITY: LOW (nice-to-have for v1)

CODONS:
├── H8.1 Usage Metrics 🟡 (basic hooks only)
│   ├── Daily/weekly/monthly active users
│   ├── Recordings per user per day
│   ├── Average session duration
│   ├── Most-used engines
│   └── Clone Capture adoption rate
│
├── H8.2 Dashboard Analytics 🔲
│   ├── Page views, bounce rate
│   ├── Feature usage heatmap
│   ├── Conversion: visitor → signup → first recording
│   └── Retention: D1, D7, D30
│
└── H8.3 Privacy-First 🔲
    ├── NO transcript content ever logged
    ├── NO audio/video content ever analyzed
    ├── Aggregated counts only
    └── User opt-out toggle in settings

DEPENDENCIES: H7 (deployed portal)
NOTE: Zero-knowledge analytics. We track behavior, never content.
      "We know HOW MUCH you talk, never WHAT you say."
```

---

## 📝 CHANGELOG

| Date | Author | Change |
|------|--------|--------|
| 2026-02-04 | Kit 0 | Initial DNA plan created |
| 2026-02-04 | Kit 0 | Strand A (A1-A3) marked complete |
| 2026-02-04 | Kit 0 | Strand B (B1-B2) implemented |
| 2026-02-05 | Kit-0C1Veron | **v1.1.0**: Full audit, identified B2.6 critical gap |
| 2026-02-05 | Kit-0C1Veron | Added Critical Path diagram |
| 2026-02-05 | Kit-0C1Veron | Added detailed B2.6 implementation plan |
| 2026-02-05 | Kit-0C1Veron | Added B3 library recommendations (@nut-tree/nut-js) |
| 2026-02-05 | Kit-0C1Veron | Added Known Issues section |
| 2026-02-05 | Kit-0C1Veron | Updated status markers (B1, B2.1-B2.5 now ✅) |
| 2026-02-05 | Kit-0C1Veron | Added Gap Analysis section |
| 2026-02-05 | Kit-0C1Veron | Revised Phase Timeline |
| 2026-02-20 | Antigravity | **v1.2.0**: Full repo audit — plan was severely outdated |
| 2026-02-20 | Antigravity | B2.6 ✅, B3 ✅, B4 ✅, A4 ✅, C1 ✅ — all implemented |
| 2026-02-20 | Antigravity | Updated Critical Path: all blockers resolved |
| 2026-02-20 | Antigravity | Added orphan features: Vibe, Updater, Settings, Vault panels |
| 2026-02-20 | Antigravity | New gap analysis focused on hardening (scores 7→9+) |
| 2026-02-20 | Antigravity | Updated Known Issues: 4 resolved, 2 new identified |
| 2026-02-27 | Kit 0C3 Charlie | **v1.3.0**: Added Strand E — Windy Translate (full translation engine) |
| 2026-02-27 | Kit 0C3 Charlie | Added E1-E5: Translation engine, conversation mode, language profiles, pricing, verticals |
| 2026-02-27 | Kit 0C3 Charlie | Added Strand F: Translation-aware installer wizard v2 (F1-F3) |
| 2026-02-27 | Kit 0C3 Charlie | Updated vision statement to include translation |
| 2026-02-27 | Kit 0C3 Charlie | Market research: $978M→$2.72B market, competitor analysis, pricing strategy |
| 2026-02-27 | Kit 0C3 Charlie + Grant | **v1.4.0**: Added Strand G — Internationalization (G1-G6) |
| 2026-02-27 | Kit 0C3 Charlie + Antigravity | Added F4: Wizard i18n integration (✅ complete — 7 langs × 138 keys) |
| 2026-02-27 | Grant | Architecture decision: Two-tier translation (hand-translate 10, dynamic 89) |
| 2026-02-27 | Grant | Terminology standard: "engines" not "models" in all user-facing text |
| 2026-02-27 | Grant + Kit 0C3 | Pricing update: $7.99/mo monthly option for Windy Translate |
| 2026-02-27 | Kit 0C3 | Top 10 languages = ~82% of global addressable market |
| 2026-02-27 | Kit 0C3 Charlie | **v1.4.1**: Full alignment audit — Website ↔ DNA ↔ Wizard |
| 2026-02-27 | Kit 0C3 | Fixed website: "5 engines" → "15 Voice Engines", "13 Languages" → "99 Languages" |
| 2026-02-27 | Kit 0C3 | Fixed website: version v0.4.2 → v0.5.0 everywhere (hero, download links) |
| 2026-02-27 | Kit 0C3 | Fixed website: removed old engine names (Deepgram, Groq, OpenAI) — now proprietary messaging |
| 2026-02-27 | Kit 0C3 | Fixed website: comparison table updated (15 engines, "Free / from $49") |
| 2026-02-27 | Kit 0C3 | Added website: full 4-tier pricing section (Free/$49/$79/$149) + Enterprise CTA |
| 2026-02-27 | Kit 0C3 | Added website: Pricing nav link |
| 2026-02-27 | Kit 0C3 | Fixed DNA Plan: B4 status updated (B4.1 ✅, B4.2 ✅, B4.3 🟡, B4.5 ✅) |
| 2026-02-27 | Kit 0C3 | Added wizard i18n: ja, ko, hi — completing Top 10 languages (10 × 138 keys) |
| 2026-03-01 | Antigravity + Grant | **v1.5.0**: Added Strand H — Web Portal & User Dashboard (H1-H8) |
| 2026-03-01 | Antigravity | H1: Account Server — registration, login, device mgmt, JWT, GDPR deletion |
| 2026-03-01 | Antigravity | H2: Recording & Transcript API — CRUD, media streaming, bulk ops |
| 2026-03-01 | Antigravity | H3: Recordings Dashboard — date-grouped list, inline player, transcript viewer |
| 2026-03-01 | Antigravity | H4: Desktop→Cloud Sync — upload pipeline, offline queue, conflict resolution |
| 2026-03-01 | Antigravity | H5: Soul File Browser — Clone Capture archive, export for digital twin |
| 2026-03-01 | Antigravity | H6: Landing Page Auth — Sign In button, auth deployment |
| 2026-03-01 | Antigravity | H7: Web Portal Deployment — Docker, nginx, CI/CD, monitoring |
| 2026-03-01 | Antigravity | H8: Analytics — privacy-first usage metrics, zero-knowledge tracking |
| 2026-03-01 | Grant | Vision: "Record all day, review from any browser that evening" |
| 2026-03-01 | Antigravity | **v1.5.1**: H1-H7 fully implemented — 6 new files, 8 modified, ~1500 LOC |
| 2026-03-01 | Antigravity | All codon statuses updated: H1-H5 ✅, H6 ✅/🟡, H7 ✅/🟡, H8 🟡 |

---

*This document is the single source of truth for Windy Pro development.*
*Any Kit can read this, understand the vision, and execute.*
*Update this document as codons are completed.*

**The Green Strobe Never Lies. Neither does this plan.**
