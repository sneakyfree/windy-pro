# 🧬 WINDY PRO — DNA STRAND MASTER PLAN

**Version:** 2.0.0
**Created:** 2026-02-04
**Last Updated:** 2026-03-12
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
| $8.99/mo monthly option | Windy Translate: $79 one-time **OR** $8.99/mo monthly alongside one-time | Grant + Kit 0C3 |
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
│                                      🟡 MVP HARDENING + PACKAGING        │
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

#### B4: TurboTax Installer ✅
```
FILES: installer-v2/ (6,692 lines across 20 files)
  ├── wizard.html (161K, 9-screen wizard UI)
  ├── wizard-main.js (403 lines, Electron main process for wizard)
  ├── wizard-preload.js (IPC bridge)
  ├── core/ (14 modules, 4,605 lines)
  │   ├── clean-slate.js (504) — prior version detection + full uninstall
  │   ├── bundled-assets.js (362) — bundled Python/ffmpeg/model resolver
  │   ├── dependency-installer.js (593) — full cocktail: Python→venv→pip→ffmpeg→audio→CUDA
  │   ├── download-manager.js (452) — HuggingFace pipeline with resume/retry
  │   ├── hardware-detect.js (378) — GPU/RAM/disk/CPU detection
  │   ├── models.js (521) — engine catalog (CTranslate2 INT8 sizes, 45+ models)
  │   ├── windytune.js (479) — AI-powered engine recommendation
  │   ├── storage-aware-models.js (271) — disk-aware model filtering
  │   ├── account-manager.js (340) — license/device management
  │   ├── brand-content.js (239) — educational content during install wait
  │   ├── permissions.js (232) — platform-specific permission requests
  │   ├── language-profile.js (135) — language selection for cocktail
  │   ├── translation-upsell.js (99) — translate tier upgrade screen
  │   └── packaging.js (from parent dir, 109) — electron-builder config
  └── adapters/ (7 files, 1,684 lines)
      ├── index.js (63) — platform dispatcher
      ├── windows.js (327) — VC++ Redist auto-install, registry cleanup
      ├── macos.js (262) — 5-tier Python fallback chain
      ├── linux-debian.js (378) — 30+ apt packages in one cocktail shot
      ├── linux-fedora.js (220) — DNF cocktail + RPM Fusion auto-enable
      ├── linux-arch.js (197) — pacman cocktail + Wayland support
      └── linux-universal.js (237) — Miniforge standalone Python for unknown distros
STATUS: ✅ COMPLETE + QA AUDITED (core architecture), 🟡 Packaging not E2E tested
PRIORITY: HIGH (required for MVP)
LAST UPDATED: 11 Mar 2026 by Kit 0C3 Charlie (commit 45bfd48)
QA AUDIT: 11 Mar 2026 by Antigravity Opus (commits 97f2f3d + 88bd988)
  — Pass 1: 29 issues found, 16 fixes (7 CRITICAL, 7 HIGH)
  — Pass 2: Remaining 13 MEDIUM/LOW fixed, callback signatures verified,
    all 12 IPC handlers traced E2E, friendlyError() UX for all error paths
  — 29/29 issues resolved. Zero known bugs remaining in installer.
  — All 11 files pass node -c syntax check

CODONS:
├── B4.0 Clean Slate (Prior Version Removal) ✅ [NEW — 11 Mar 2026]
│   │
│   │  FILE: installer-v2/core/clean-slate.js (504 lines)
│   │  Grant's Rule: "If you don't completely kill and uninstall the prior
│   │  version, you have all kinds of issues."
│   │  MUST run BEFORE any installation begins.
│   │
│   ├── B4.0.1 Process Termination ✅
│   │   ├── Kill running Electron app (windy-pro, windy pro)
│   │   ├── Kill Python server (transcriber, server.py on port 9876)
│   │   └── Platform-aware: taskkill (Win), pkill (Linux/Mac)
│   │
│   ├── B4.0.2 Directory Removal ✅
│   │   ├── Remove ~/.windy-pro/ (main install dir)
│   │   ├── Remove ~/.config/windy-pro/ (config dir)
│   │   ├── Option to preserve models/ (they're huge and reusable)
│   │   └── Verify clean state before returning
│   │
│   ├── B4.0.3 Platform Artifact Cleanup ✅
│   │   ├── Windows: registry keys (HKCU\Software\WindyPro), Start Menu shortcuts
│   │   ├── macOS: ~/Library/Application Support/WindyPro, Login Items
│   │   ├── Linux: ~/.local/share/applications/*.desktop, user systemd services
│   │   └── ⚠️ KNOWN GAP: system-level autostart not cleaned
│   │       (needs /etc/systemd/system/ and HKLM\...\Run checks)
│   │
│   └── B4.0.4 Verification ✅
│       ├── Confirms no Windy Pro processes running
│       ├── Confirms install directory removed
│       └── Returns status report to wizard UI
│
├── B4.1 Hardware Detection ✅
│   │
│   │  FILE: installer-v2/core/hardware-detect.js (378 lines)
│   │
│   ├── B4.1.1 NVIDIA GPU Detection ✅
│   │   ├── Run: nvidia-smi --query-gpu=name,memory.total --format=csv
│   │   └── Parse VRAM in MB, detect CUDA compute capability
│   │
│   ├── B4.1.2 AMD GPU Detection ✅
│   │   └── Check for ROCm: rocm-smi
│   │
│   ├── B4.1.3 Apple Silicon Detection ✅
│   │   └── Check: process.arch === 'arm64' && process.platform === 'darwin'
│   │
│   ├── B4.1.4 RAM Detection ✅
│   │   └── os.totalmem() / (1024 ** 3) for GB
│   │
│   ├── B4.1.5 Disk Space Detection ✅
│   │   └── fs.statfs or df command for free space
│   │
│   └── B4.1.6 Hardware Profile JSON ✅
│       └── Returns: { gpu, vram_gb, ram_gb, disk_free_gb, platform, arch, cpu_cores }
│
├── B4.2 Engine Selection Logic ✅
│   │
│   │  FILES: installer-v2/core/windytune.js (479 lines)
│   │         installer-v2/core/models.js (521 lines)
│   │         installer-v2/core/storage-aware-models.js (271 lines)
│   │
│   │  THREE-LAYER WIZARD UI (Grandma/Enthusiast/Gearhead):
│   │  ├── WindyTune (default): AI auto-selects based on hardware profile
│   │  ├── Enthusiast: user picks from filtered recommendations
│   │  └── Gearhead: full manual model selection (15 proprietary engines)
│   │
│   │  DECISION TREE (WindyTune):
│   │  ├── GPU ≥ 6GB VRAM → GPU-tier engines (float16, CUDA)
│   │  ├── Apple Silicon → Core-tier engines (MLX)
│   │  ├── RAM ≥ 16GB → CPU medium/large engines (int8)
│   │  ├── RAM ≥ 8GB → CPU small engines (int8)
│   │  ├── RAM ≥ 4GB → CPU base engines (int8)
│   │  └── Below minimum → Recommend Cloud mode
│   │
│   │  ENGINE CATALOG (models.js — corrected CTranslate2 INT8 sizes):
│   │  ├── 🛡️ Edge (CPU): Spark 42MB, Pulse 78MB, Standard 168MB, Global 515MB, Pro 515MB
│   │  ├── ⚡ Core (GPU): Spark 75MB, Pulse 142MB, Standard 466MB, Global 1.5GB,
│   │  │                  Pro 1.5GB, Turbo 1.6GB, Ultra 2.9GB
│   │  └── 🌍 Lingua: Language-specific specialists (~500MB each)
│   │
│   └── Storage-aware filtering: removes engines that won't fit on disk
│
├── B4.3 Dependency Installation ✅ [COMPLETELY REWRITTEN — 11 Mar 2026]
│   │
│   │  STRATEGY: Bundled Python venv + pip (NOT PyInstaller)
│   │  Grant's Rule: "Grandma doesn't know what Python is, and she shouldn't have to."
│   │
│   ├── B4.3.0 Bundled Assets Resolver ✅
│   │   │  FILE: installer-v2/core/bundled-assets.js (362 lines)
│   │   │  Bundled assets are PRIMARY. Internet downloads are FALLBACK only.
│   │   ├── Resolve bundled Python (3.11.9 per platform)
│   │   ├── Resolve bundled ffmpeg (per platform)
│   │   ├── Resolve bundled default model (faster-whisper-base)
│   │   └── Directory: bundled/{python,ffmpeg,model}/
│   │
│   ├── B4.3.1 Python Installation ✅
│   │   ├── Use bundled Python 3.11.9 (extracted per platform)
│   │   ├── Create venv in ~/.windy-pro/venv/
│   │   └── NEVER require user to install Python manually
│   │
│   ├── B4.3.2 Pip Package Installation ✅
│   │   ├── 12 pip packages: faster-whisper, torch, numpy, websockets,
│   │   │   sounddevice, pydub, fastapi, uvicorn, python-jose, passlib,
│   │   │   slowapi, aiofiles
│   │   └── All installed into venv automatically
│   │
│   ├── B4.3.3 ffmpeg Installation ✅
│   │   ├── Use bundled ffmpeg binary (per platform)
│   │   ├── Fallback: apt/brew/choco install
│   │   └── Required for audio format conversion
│   │
│   ├── B4.3.4 Audio Subsystem ✅
│   │   ├── Linux: portaudio19-dev, libasound2-dev, pulseaudio
│   │   ├── macOS: portaudio via Homebrew (if not bundled)
│   │   └── Windows: included in Python sounddevice wheel
│   │
│   ├── B4.3.5 CUDA (Optional) ✅
│   │   ├── Detect NVIDIA GPU → install CUDA toolkit
│   │   ├── Install torch with CUDA support
│   │   └── Skip gracefully if no GPU
│   │
│   ├── B4.3.6 Model Download Manager ✅
│   │   │  FILE: installer-v2/core/download-manager.js (452 lines)
│   │   ├── Real HuggingFace pipeline (all 45+ models mapped)
│   │   ├── Correct repo names from Alpha/OC1 registry:
│   │   │   ├── STT: WindyProLabs/windy-stt-{name}[-ct2]
│   │   │   ├── Lingua: WindyProLabs/windy-lingua-{language} (full names)
│   │   │   ├── Pairs: WindyProLabs/windy-pair-{src}-{tgt} (ISO codes)
│   │   │   └── Translate: WindyProLabs/windy_translate_{name} (underscores!)
│   │   ├── Resume support (HTTP range headers)
│   │   ├── Retry with exponential backoff (3 attempts)
│   │   ├── Progress callbacks for UI
│   │   └── Integrity verification (checksum)
│   │
│   └── B4.3.7 Platform Adapters ✅
│       │  FILES: installer-v2/adapters/ (7 files, 1,684 lines)
│       │  Every adapter is bundled-first, NEVER "please install manually"
│       │
│       ├── Windows ✅ — Auto-installs VC++ Redistributable silently
│       ├── macOS ✅ — 5-tier Python fallback:
│       │   bundled → Xcode CLI → Homebrew → python.org → error
│       ├── Debian/Ubuntu ✅ — 30+ apt packages in one cocktail shot
│       ├── Fedora/RHEL ✅ — DNF cocktail + RPM Fusion auto-enable
│       ├── Arch ✅ — pacman cocktail + Wayland support
│       └── Universal ✅ — Miniforge standalone Python for unknown distros
│
├── B4.4 Permission Requests ✅
│   │
│   │  FILE: installer-v2/core/permissions.js (232 lines)
│   │
│   ├── B4.4.1 Windows UAC ✅
│   │   └── Elevate only if needed (PATH, registry, VC++ install)
│   │
│   ├── B4.4.2 macOS Microphone Permission ✅
│   │   ├── Trigger system permission prompt
│   │   └── Show instructions if denied
│   │
│   ├── B4.4.3 macOS Accessibility Permission ✅
│   │   ├── Required for cursor injection (AppleScript)
│   │   ├── System Preferences deep link
│   │   └── User-friendly guide
│   │
│   └── B4.4.4 Linux Permissions ✅
│       └── Audio group membership, PulseAudio access
│
├── B4.5 Installer UI ✅
│   │
│   │  FILE: installer-v2/wizard.html (161K — 9 screens, fully i18n'd)
│   │  + installer-v2/core/brand-content.js (239 lines — educational content)
│   │
│   │  SCREENS (all ✅ implemented):
│   │
│   ├── Screen 1: Welcome ✅
│   │   Brand tornado animation, "Voice-to-text that never stops"
│   │
│   ├── Screen 2: Account Login/Register ✅
│   │   Email + password, device registration (1 of 5)
│   │
│   ├── Screen 3: Hardware Scan ✅
│   │   Animated GPU/RAM/disk detection with checkmarks
│   │
│   ├── Screen 4: Your Languages ✅ (F1)
│   │   Search, select, percentage sliders for language cocktail
│   │
│   ├── Screen 5: Translation Upgrade ✅ (F2)
│   │   Personalized demo, only shows if 2+ languages selected
│   │
│   ├── Screen 6: Engine Recommendation ✅
│   │   WindyTune auto-select with Enthusiast/Gearhead override
│   │
│   ├── Screen 7: Download & Install ✅
│   │   Progress bars with ETA, brand education during wait
│   │
│   ├── Screen 8: Permissions ✅
│   │   Platform-specific permission requests with guidance
│   │
│   └── Screen 9: Complete ✅
│       Quick-start guide, hotkey reference, [Launch Windy Pro]
│
└── B4.6 Packaging 🟡
    │
    │  FILE: installer-v2/packaging.js (109 lines — config defined)
    │
    ├── B4.6.1 Windows (NSIS) 🟡 — Config defined, not E2E tested
    ├── B4.6.2 macOS (DMG) 🟡 — Config defined, not E2E tested
    └── B4.6.3 Linux (AppImage/deb/rpm) 🟡 — Config defined, not E2E tested
    
    NOTE: Packaging configs exist but have not been run against
    the new installer architecture. E2E build testing is next.
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
├── C1.8 404 Page ✅
│   └── NotFound component in App.jsx
│
├── C1.9 Admin Dashboard ✅ [NEW — not in original plan]
│   └── FILE: src/client/web/src/pages/Admin.jsx (15K)
│
├── C1.10 User Profile Page ✅ [NEW]
│   └── FILE: src/client/web/src/pages/Profile.jsx
│
├── C1.11 Web Settings Page ✅ [NEW]
│   └── FILE: src/client/web/src/pages/Settings.jsx
│
├── C1.12 Web Translation Page ✅ [NEW]
│   └── FILE: src/client/web/src/pages/Translate.jsx (16K)
│
└── C1.13 Vault Page ✅ [NEW]
    └── FILE: src/client/web/src/pages/Vault.jsx (12K)
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
├── [x] B4.1-B4.2: Hardware Detection + WindyTune Engine Selection ✅
├── [x] B4.3: Dependency Installer (bundled Python venv + pip + model download) ✅
├── [x] B4.4-B4.5: Permissions + 9-screen Installer UI ✅
├── [x] B4.6: Packaging config (NSIS, DMG, AppImage) ✅ (not E2E tested)
├── [x] B4.0: Clean Slate (prior version uninstall) ✅ [11 Mar 2026]
├── [x] B4.3.0: Bundled Assets Resolver ✅ [11 Mar 2026]
├── [x] 6 Platform Adapters rewritten (Win/Mac/Deb/Fed/Arch/Universal) ✅
└── [x] MVP FEATURE COMPLETE 🎯

CURRENT: MVP HARDENING + STRESS TESTING
├── [x] Installer architecture complete (6,692 lines across 20 files)
├── [ ] AG Opus stress testing installer (IN PROGRESS — 11 Mar 2026)
├── [ ] E2E packaging builds (NSIS/DMG/AppImage)
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
6. **Effects are always opt-in, never forced.** Silent mode is factory default. Theme packs never compromise recording quality.

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
FILE: services/translate-api/server.js (17K) + translate-worker.py
STATUS: 🟡 PARTIALLY IMPLEMENTED (cloud API done, offline CTranslate2 pipeline not started)
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
FILE: src/client/desktop/renderer/conversation-mode.js (289 lines)
STATUS: 🟡 PARTIALLY IMPLEMENTED (UI built, backend translation pipeline pending)
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
│   │  │  WINDY TRANSLATE — $79 one-time OR $8.99/mo            │
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

## 🧬 STRAND I: THEME PACKS & WIDGET CUSTOMIZATION

**Added:** 2026-03-09 by Antigravity + Grant Whitmer
**Priority:** MEDIUM — Engagement/retention multiplier, not critical path
**Philosophy:** Make Windy Pro feel personal, rewarding, and fun — without EVER compromising recording fidelity.

### I0: Critical Design Principles

```
⚠️  THREE LAWS OF STRAND I — NEVER VIOLATE THESE:

LAW 1: COMPLETE ISOLATION
├── The effects system is 100% decoupled from core recording pipeline
├── Effects run in a SEPARATE rendering layer (CSS overlay + Web Audio)
├── Effects NEVER touch: MediaRecorder, AudioContext (mic), WebSocket, Whisper
├── If the effects engine crashes, recording continues unaffected
├── Zero shared state between effects and transcription
├── Performance budget: effects must use < 2% CPU, < 50MB RAM
└── INVARIANT: Removing all of Strand I code = zero change in transcription quality

LAW 2: PER-HOOK-POINT CUSTOMIZATION
├── Users can enable/disable effects on EACH of the 5 hook points independently
├── Example: sound on START + PASTE only, silent during RECORDING
├── Each hook point has its own ON/OFF toggle in Settings
├── Volume slider per hook point (0-100%)
└── Users are never forced into all-or-nothing

LAW 3: UNIVERSAL STATE COLORS (NEVER CHANGE)
├── 🟢 Green strobe = RECORDING (mic is live, audio is being captured)
├── 🟡 Yellow strobe = PROCESSING (transcribing, thinking)
├── 🔴 Red = ERROR (something went wrong)
├── 🔵 Blue flash = INJECTING (pasting text into target app)
├── These colors appear as background GLOW behind ANY widget
├── Widget shimmers/vibrates in sync with voice audio levels
└── INVARIANT: State colors are SACRED. No theme pack changes them. Ever.
```

### I1: Widget Engine
```
FILE: src/client/desktop/renderer/mini-widget.js (181 lines)
STATUS: 🟡 PARTIALLY IMPLEMENTED
PRIORITY: MEDIUM

CODONS:
├── I1.1 WidgetConfig dataclass 🔲
│   ├── type: "stock" | "custom"
│   ├── stock_id: string (e.g., "tornado", "strobe", "lightning")
│   ├── custom_path: string (path to user-uploaded image)
│   ├── size: number (px, user-scalable via existing Aa slider)
│   ├── position: { x: number, y: number } (draggable)
│   └── opacity: number (0.0-1.0)
│
├── I1.2 Stock Widget Gallery 🔲
│   │
│   │  6 BUILT-IN WIDGETS:
│   │  ├── 🌪️ Tornado (current default — already implemented)
│   │  ├── 💚 Green Strobe (pulsing circle — matches website branding)
│   │  ├── ⚡ Lightning Bolt (crackles with voice energy)
│   │  ├── 🌀 Windy Pro Logo (brand mark, professional)
│   │  ├── 🧭 Compass (spins during recording, points N on stop)
│   │  └── 〰️ Sound Wave (real-time waveform visualization)
│   │
│   └── Each stock widget is an SVG or CSS animation (no image files)
│
├── I1.3 Custom Widget Upload 🔲
│   ├── Supported formats: PNG, GIF, SVG, WebP
│   ├── Max file size: 2MB
│   ├── Stored in: app.getPath('userData') + '/widgets/'
│   ├── Aspect ratio preserved, scaled to widget container
│   ├── GIFs animate normally (team logos, pets, custom art)
│   └── Upload via Settings → Widgets → "Upload Custom Widget" button
│
├── I1.4 Voice-Reactive Animation 🔲
│   │
│   │  ALL widgets (stock AND custom) react to voice audio:
│   │
│   ├── Data source: AnalyserNode from B2.6.6 (already exists)
│   │   └── IMPORTANT: Read-only tap on existing audio meter data
│   │   └── DOES NOT create new AudioContext or touch mic stream
│   │
│   ├── Animation behaviors:
│   │   ├── Scale: widget grows/shrinks with volume (1.0x-1.15x range)
│   │   ├── Shake: micro-vibration intensity tracks voice energy
│   │   ├── Glow: state-color aura intensity follows audio level
│   │   └── Rotate: subtle rotation oscillation (±3° max)
│   │
│   ├── CSS transform + will-change: transform (GPU-accelerated)
│   └── requestAnimationFrame loop, throttled to 30fps (saves CPU)
│
└── I1.5 State Color System (Universal) 🔲
    │
    │  Applied as background GLOW behind ANY widget:
    │
    ├── IDLE: no glow (widget is static)
    ├── RECORDING: green glow + voice-reactive shimmer
    ├── PROCESSING: yellow glow + slow pulse
    ├── ERROR: red glow + rapid pulse
    ├── INJECTING: blue flash (200ms, single pulse)
    │
    ├── Implementation: box-shadow with state color + CSS animation
    ├── Same colors from B2.2 (--color-listening, --color-buffering, etc.)
    └── INVARIANT: No theme pack can override these colors
```

### I2: Effects Engine
```
FILE: src/client/desktop/renderer/effects-engine.js (600 lines)
STATUS: ✅ IMPLEMENTED (SoundManager + VisualOverlay + EffectsEngine)
PRIORITY: MEDIUM

ARCHITECTURE NOTE:
│  The EffectsEngine is a PURE OBSERVER. It listens to state change events
│  that the recording pipeline already emits. It NEVER sends commands back.
│  One-way data flow: RecordingPipeline → Events → EffectsEngine → Display
│  If EffectsEngine is deleted, nothing changes functionally.

CODONS:
├── I2.1 EffectHookPoint enum 🔲
│   ├── START    — fires when recording begins
│   ├── DURING   — loops while recording is active
│   ├── STOP     — fires when recording ends
│   ├── PROCESS  — fires when transcription begins
│   └── PASTE    — fires when text is injected into target app
│
├── I2.2 EffectsEngine class 🔲
│   ├── constructor(config: EffectsConfig)
│   ├── bindToRecordingEvents(eventEmitter) — subscribe, never publish
│   ├── triggerEffect(hookPoint: EffectHookPoint, metadata: {})
│   ├── setThemePack(pack: ThemePack)
│   ├── setMode(mode: "silent" | "single" | "surprise")
│   ├── setHookPointEnabled(hookPoint, enabled: boolean)
│   ├── setHookPointVolume(hookPoint, volume: 0-100)
│   ├── previewEffect(hookPoint) — for Settings preview button
│   └── destroy() — cleanup all audio/visual resources
│
├── I2.3 SoundManager class 🔲
│   │
│   │  ISOLATION: Uses its OWN AudioContext, completely separate from mic
│   │
│   ├── constructor() — creates new AudioContext for effects ONLY
│   ├── loadSound(url) → AudioBuffer (cached)
│   ├── playSound(buffer, volume, pitch?) — one-shot playback
│   ├── playLoop(buffer, volume) → loopId — ambient during recording
│   ├── stopLoop(loopId) — stop ambient sound
│   ├── setMasterVolume(0-100)
│   └── dispose() — cleanup AudioContext
│   │
│   │  CRITICAL: This AudioContext is OUTPUT-only (speakers)
│   │  It has ZERO connection to the mic input AudioContext
│   │  It cannot affect recording quality in any way
│   │
│   └── Sound file format: .webm (Opus) or .mp3, max 500KB per effect
│
├── I2.4 VisualOverlay class 🔲
│   │
│   │  CSS overlay layer on TOP of recording UI
│   │  z-index above transcript, below window controls
│   │
│   ├── renderEffect(type, intensity, duration)
│   │   ├── "particles" — CSS particle emitter (snow, sparks, embers)
│   │   ├── "flash" — full-screen color flash (200ms)
│   │   ├── "shake" — CSS transform shake (100-500ms)
│   │   ├── "border-glow" — animated border color sweep
│   │   └── "confetti" — CSS confetti burst
│   │
│   ├── All effects use CSS animations + transforms (GPU-accelerated)
│   ├── pointer-events: none (effects don't block UI interaction)
│   ├── Performance: max 50 particles, auto-cleanup after 2 seconds
│   └── Falls back gracefully on low-end hardware (prefers-reduced-motion)
│
└── I2.5 Effect-Recording Isolation Architecture 🔲

    ┌───────────────────────────────────────────────────────┐
    │                    RECORDING PIPELINE                  │
    │  MediaRecorder → AudioContext(mic) → WebSocket → STT  │
    │                                                        │
    │  Emits events:                                         │
    │  ├── 'recording:start'                                 │
    │  ├── 'recording:stop'                                  │
    │  ├── 'transcription:start'                             │
    │  └── 'transcription:paste'                             │
    └────────────────┬──────────────────────────────────────┘
                     │ (read-only events, one-way)
                     ▼
    ┌───────────────────────────────────────────────────────┐
    │                    EFFECTS ENGINE                       │
    │  EffectsEngine → SoundManager → AudioContext(speakers) │
    │               → VisualOverlay → CSS animations         │
    │                                                        │
    │  ZERO connections back to recording pipeline            │
    │  Own AudioContext (output only)                         │
    │  Own CSS layer (pointer-events: none)                   │
    │  Can be disabled/removed with ZERO functional impact    │
    └───────────────────────────────────────────────────────┘
```

### I3: Theme Pack System
```
FILE: src/client/desktop/renderer/theme-packs/ [NEW DIRECTORY]
STATUS: 🔲 NOT STARTED
PRIORITY: MEDIUM

CODONS:
├── I3.1 ThemePack Schema 🔲
│   │
│   │  Each pack is a JSON manifest + sound files:
│   │
│   ├── manifest.json:
│   │   {
│   │     "id": "wizard",
│   │     "name": "⚡ Wizard",
│   │     "category": "epic",
│   │     "description": "Arcane energy and lightning for creative sessions",
│   │     "author": "Windy Pro",
│   │     "version": "1.0.0",
│   │     "hooks": {
│   │       "start":   { "sound": "spell-charge.webm", "visual": "particles:energy" },
│   │       "during":  { "sound": "ambient-hum.webm",  "visual": "shimmer:blue" },
│   │       "stop":    { "sound": "wand-cast.webm",    "visual": "flash:purple" },
│   │       "process": { "sound": null,                 "visual": "particles:stars" },
│   │       "paste":   { "sound": "thunder.webm",       "visual": "lightning-storm" }
│   │     },
│   │     "scaling": {
│   │       "enabled": true,
│   │       "paste_tiers": [
│   │         { "max_words": 50,  "intensity": 0.3, "label": "spark" },
│   │         { "max_words": 200, "intensity": 0.7, "label": "rumble" },
│   │         { "max_words": 999, "intensity": 1.0, "label": "storm" }
│   │       ]
│   │     }
│   │   }
│   │
│   └── Pack directory structure:
│       theme-packs/
│       ├── _silent/manifest.json        (no sounds, no visuals)
│       ├── classic-beep/manifest.json   (default utilitarian)
│       ├── wizard/manifest.json + sounds/
│       ├── battle-royale/manifest.json + sounds/
│       └── ...
│
├── I3.2 Pack Categories 🔲
│   │
│   │  ┌──────────────────────────────────────────────────────────┐
│   │  │  THEME PACK CATEGORIES                                   │
│   │  ├──────────────────────────────────────────────────────────┤
│   │  │                                                           │
│   │  │  🔇 SYSTEM (always available, not deletable)              │
│   │  │  ├── Silent — zero sounds, zero visuals, zero effects     │
│   │  │  └── Classic Beep — beep↑ on start, beep↓ on stop,       │
│   │  │                     beep✓ on paste (restore broken beep)  │
│   │  │                                                           │
│   │  │  🔊 UTILITARIAN (functional, professional)                │
│   │  │  ├── Soft Chime — gentle chime start/stop/paste           │
│   │  │  ├── Minimal Click — mechanical click, snap, ding         │
│   │  │  └── Vibrate Only — haptic pulse, no audio                │
│   │  │                                                           │
│   │  │  ⚡ EPIC (power, energy, impact)                          │
│   │  │  ├── Wizard — spell charge, lightning storm               │
│   │  │  ├── Dragon — roar, fire breath                           │
│   │  │  └── Midnight — wolf howl, thunder crack                  │
│   │  │                                                           │
│   │  │  🎮 GAMER (gaming-inspired, non-infringing)               │
│   │  │  ├── Battle Royale — weapon rack, airstrike, victory horn │
│   │  │  ├── Block Builder — pickaxe, TNT, level up               │
│   │  │  ├── Space Marine — shield activate, orbital strike        │
│   │  │  ├── Quest Mode — quest chime, treasure chest, fanfare    │
│   │  │  └── Arcade Classic — coin insert, 8-bit, high score      │
│   │  │                                                           │
│   │  │  🎄 SEASONAL (holiday-themed)                             │
│   │  │  ├── Christmas — jingle bells, sleigh, "Ho ho ho!"        │
│   │  │  ├── Halloween — creaking door, witch cackle, ghost       │
│   │  │  ├── Summer — splash, ocean waves, steel drum             │
│   │  │  └── Fireworks — fuse, rocket launch, full finale         │
│   │  │                                                           │
│   │  │  🌍 CULTURAL (country/region-inspired)                    │
│   │  │  ├── Tokyo Nights — taiko, lo-fi rain, koto flourish      │
│   │  │  ├── London Calling — Big Ben, rain, God Save fanfare     │
│   │  │  ├── Dragon Festival — gong, guzheng, dragon drums        │
│   │  │  ├── Bollywood Beat — tabla, sitar, full orchestra        │
│   │  │  ├── Carnival Rio — samba whistle, bossa nova, bateria    │
│   │  │  └── Outback — didgeridoo, crickets, kookaburra laugh    │
│   │  │                                                           │
│   │  │  👨‍👩‍👧 EVERYDAY (cozy, calm, nostalgic)                    │
│   │  │  ├── Morning Coffee — mug set down, brewing, spoon clink  │
│   │  │  ├── Zen Garden — singing bowl, water, wind chime          │
│   │  │  ├── Typewriter — carriage return, keys, ding              │
│   │  │  └── Nature Walk — bird chirp, forest, birdsong chorus     │
│   │  │                                                           │
│   │  └──────────────────────────────────────────────────────────┘
│   │
│   └── Total: 2 system + 3 utilitarian + 3 epic + 5 gamer
│              + 4 seasonal + 6 cultural + 4 everyday = 27 stock packs
│
├── I3.3 Pack Selection Modes 🔲
│   │
│   │  THREE MODES:
│   │
│   ├── MODE 1: Silent (factory default)
│   │   ├── Zero sounds, zero visuals, zero effects
│   │   ├── Widget still shows state colors (green/yellow/red/blue)
│   │   ├── Widget still shimmers with voice (I1.4)
│   │   └── This is what every user gets until they choose otherwise
│   │
│   ├── MODE 2: Single Pack
│   │   ├── User selects one specific pack
│   │   ├── That pack plays for every session
│   │   └── User can customize which hook points are active
│   │
│   └── MODE 3: Surprise Me (Rotate)
│       ├── Each recording session uses a DIFFERENT pack
│       ├── Shuffle-bag algorithm (no repeats until all played)
│       │
│       ├── Sub-modes:
│       │   ├── 🎲 All — rotate through ALL installed packs
│       │   ├── 🎲 Category — rotate within chosen category only
│       │   └── 🎲 Favorites — rotate through ⭐ starred packs only
│       │
│       └── Psychology: novelty-seeking + anticipation dopamine
│           "What pack will I get this time?" before every session
│
└── I3.4 Pack Loader 🔲
    ├── Scan theme-packs/ directory on app start
    ├── Validate each manifest.json against schema
    ├── Pre-load sound files for active pack (lazy-load others)
    ├── Hot-swap: changing pack mid-session applies on NEXT session
    └── Graceful fallback: if pack files missing → fall back to Silent
```

### I4: Dynamic Scaling
```
FILE: src/client/desktop/renderer/effects-engine.js (integrated)
STATUS: 🔲 NOT STARTED
PRIORITY: LOW (enhancement, not core)

CODONS:
├── I4.1 Length-Based Intensity Tiers 🔲
│   │
│   │  The PASTE climax effect scales with how much you recorded:
│   │
│   │  TIER 1 — SPARK (< 50 words):
│   │  └── Subtle effect. Quick sound, small flash.
│   │      "A quick note. Small reward."
│   │
│   │  TIER 2 — RUMBLE (50-200 words):
│   │  └── Medium effect. Longer sound, visible particles.
│   │      "A solid thought. Satisfying feedback."
│   │
│   │  TIER 3 — STORM (200+ words):
│   │  └── Full climax. Maximum intensity, extended duration.
│   │      "You painted a vision. Here's your lightning show."
│   │
│   ├── Word count comes from transcription result (already available)
│   ├── Intensity multiplier: 0.3 (spark) → 0.7 (rumble) → 1.0 (storm)
│   └── Duration multiplier: 0.5s (spark) → 1.5s (rumble) → 3s (storm)
│
├── I4.2 Variable Reward Randomization 🔲
│   │
│   │  SAME tier, DIFFERENT effect every time:
│   │
│   ├── Each pack can define 3-5 variations per tier
│   ├── Randomly selected each time → never exactly the same
│   ├── Slot machine psychology: variable rewards = sustained engagement
│   └── Example (Wizard pack, STORM tier):
│       ├── Variation A: 3 lightning bolts + long thunder roll
│       ├── Variation B: blue energy vortex + electric crackle  
│       └── Variation C: full screen white flash + rumbling bass
│
└── I4.3 Anticipation Building 🔲
    ├── During PROCESS hook, visual hints at incoming tier:
    │   ├── Spark: calm processing animation
    │   ├── Rumble: slightly energized processing
    │   └── Storm: intense processing animation
    └── User subconsciously records longer → bigger reward → records longer
```

### I5: Settings UI — Theme Packs & Effects
```
FILE: src/client/desktop/renderer/settings.js (extend existing)
STATUS: 🔲 NOT STARTED
PRIORITY: MEDIUM

CODONS:
├── I5.1 Settings Section Layout 🔲
│   │
│   │  New collapsible section in Settings panel:
│   │
│   │  ┌─────────────────────────────────────────────────┐
│   │  │  🎨 THEME PACKS & EFFECTS                       │
│   │  │                                                  │
│   │  │  Mode: [🔇 Silent ▾] [⚡ Single Pack ▾] [🎲 Surprise Me ▾]  │
│   │  │                                                  │
│   │  │  Active Pack: [⚡ Wizard ▾]                      │
│   │  │  [▶ Preview]                                     │
│   │  │                                                  │
│   │  │  ── Hook Points ──────────────────────           │
│   │  │  🎬 Start Recording  [ON/OFF] 🔊 ████░░ 70%    │
│   │  │  🎤 During Recording [ON/OFF] 🔊 ██░░░░ 30%    │
│   │  │  ⏹️ Stop Recording   [ON/OFF] 🔊 ████░░ 70%    │
│   │  │  ⏳ Processing       [ON/OFF] 🔊 ██░░░░ 30%    │
│   │  │  📋 Paste            [ON/OFF] 🔊 ██████ 100%   │
│   │  │                                                  │
│   │  │  ── Dynamic Scaling ─────────────────           │
│   │  │  [✓] Scale paste effects with recording length   │
│   │  │                                                  │
│   │  │  ── Widget ──────────────────────────           │
│   │  │  [🌪️ Tornado ▾] [Upload Custom...]              │
│   │  │                                                  │
│   │  └─────────────────────────────────────────────────┘
│   │
│   └── All settings saved via electron-store (existing settings system)
│
├── I5.2 Pack Browser 🔲
│   ├── Grid/list of all installed packs with category tabs
│   ├── Each pack shows: icon, name, description, [▶ Preview] button
│   ├── ⭐ Star/favorite packs (for Surprise Me: Favorites mode)
│   ├── Category filter tabs: All | System | Utilitarian | Epic | Gamer | ...
│   └── Search bar for finding packs by name
│
├── I5.3 Widget Gallery 🔲
│   ├── Visual grid of stock widgets (preview thumbnails)
│   ├── Click to select, shows live preview in mini-window
│   ├── "Upload Custom" button → file picker (PNG/GIF/SVG/WebP, max 2MB)
│   └── Custom widgets shown alongside stock in gallery
│
├── I5.4 Preview System 🔲
│   ├── [▶ Preview] button next to each pack and each hook point
│   ├── Plays the sound + shows the visual in a small preview area
│   ├── Does NOT trigger any recording or transcription
│   └── Preview uses the EffectsEngine.previewEffect() method (I2.2)
│
└── I5.5 Persistence 🔲
    ├── All settings stored in electron-store under "effects" key:
    │   {
    │     "mode": "silent" | "single" | "surprise",
    │     "activePack": "wizard",
    │     "surpriseCategory": "all" | "epic" | "gamer" | "favorites",
    │     "hookPoints": {
    │       "start":   { "enabled": true,  "volume": 70 },
    │       "during":  { "enabled": false, "volume": 30 },
    │       "stop":    { "enabled": true,  "volume": 70 },
    │       "process": { "enabled": false, "volume": 30 },
    │       "paste":   { "enabled": true,  "volume": 100 }
    │     },
    │     "dynamicScaling": true,
    │     "widget": { "type": "stock", "id": "tornado" },
    │     "favorites": ["wizard", "battle-royale", "zen-garden"]
    │   }
    └── Defaults to: mode="silent", all hooks disabled, widget="tornado"
```

### I6: Community Hub
```
FILE: TBD (future — requires cloud infrastructure)
STATUS: 🔲 NOT STARTED (Phase 3+)
PRIORITY: LOW

CODONS:
├── I6.1 Social Activity Feed 🔲
│   │
│   │  Inspired by Venmo's social feed — but for productivity:
│   │
│   ├── Feed entries (all opt-in):
│   │   ├── "Grant unlocked the Dragon pack 🔥"
│   │   ├── "Sarah shared her custom 'Lo-Fi Study' pack"
│   │   ├── "Alex just hit 1,000 prompts with Wizard theme ⚡"
│   │   └── "New community pack trending: 'Cyberpunk Neon' 🌆"
│   │
│   ├── NEVER shared: recording content, transcripts, prompt text
│   ├── ONLY shared: pack usage, pack creations, milestone counts
│   └── Privacy toggle: Settings → Community → "Share my activity" [OFF default]
│
├── I6.2 Usage Leaderboards 🔲
│   ├── Most popular packs this week/month
│   ├── Top pack creators (by installs)
│   ├── "Pack of the Week" curated spotlight
│   └── Stats: total packs created, total installs, active creators
│
├── I6.3 Creator Profiles 🔲
│   ├── Users who publish packs get a public profile
│   ├── Shows: packs created, total installs, average rating
│   ├── Follow creators → notified when they publish new packs
│   └── Gamification: badges for milestones (10 packs, 1K installs, etc.)
│
└── I6.4 Privacy Controls 🔲
    ├── ALL social features OFF by default (private)
    ├── Granular toggles:
    │   ├── "Show my pack usage" [OFF]
    │   ├── "Show my creations" [OFF]
    │   ├── "Show my milestones" [OFF]
    │   └── "Make my profile public" [OFF]
    ├── Users can participate as consumers without sharing anything
    └── INVARIANT: We track behavior (pack installs), NEVER content
```

### I7: Theme Pack Marketplace
```
FILE: TBD (future — requires cloud infrastructure)
STATUS: 🔲 NOT STARTED (Phase 3+)
PRIORITY: LOW

CODONS:
├── I7.1 .windypack Export Format 🔲
│   ├── ZIP file containing: manifest.json + sound files
│   ├── Max total size: 10MB per pack
│   ├── Verified content: no executable code, only JSON + audio + images
│   └── Signed with creator's account key for authenticity
│
├── I7.2 User-Created Pack Builder 🔲
│   ├── In-app pack creation wizard:
│   │   ├── Step 1: Name, description, category, icon
│   │   ├── Step 2: Assign sounds to each hook point (upload or record)
│   │   ├── Step 3: Choose visual effects per hook point
│   │   ├── Step 4: Set dynamic scaling tiers
│   │   └── Step 5: Preview & publish
│   │
│   ├── "Record your own" sounds via mic (novelty — record your dog barking)
│   └── Import/export .windypack files for sharing outside marketplace
│
├── I7.3 Marketplace Browser 🔲
│   ├── Accessible from Settings → Theme Packs → "Browse Marketplace"
│   ├── Categories, search, trending, new arrivals
│   ├── Star ratings (1-5) + review count
│   ├── One-click install
│   └── Report inappropriate content
│
├── I7.4 Content Moderation 🔲
│   ├── Automated: scan for copyrighted audio (fingerprinting)
│   ├── Automated: file size + format validation
│   ├── Community: report button + review queue
│   └── Manual: admin review for flagged content
│
└── I7.5 Monetization (Future) 🔲
    ├── Free packs (default — community sharing)
    ├── Premium packs by Windy Pro (bundled with paid tiers)
    ├── Creator revenue share (future — 70/30 split)
    └── "Featured Creator" program for top pack builders
```

### I-BUG: Restore Broken Start/Stop Beep 🔴
```
STATUS: 🔴 BUG — The app used to beep on start/stop but stopped working
PRIORITY: HIGH (fix independently of Strand I — users need audio feedback NOW)

CODONS:
├── I-BUG.1 Investigate Why Beep Stopped 🔲
│   ├── Check app.js for AudioContext beep code
│   ├── Check if AudioContext was removed during refactoring
│   ├── Check if browser autoplay policy is blocking audio
│   └── Test: does beep work on fresh install?
│
├── I-BUG.2 Restore Beep Functionality 🔲
│   ├── Beep on recording START (rising tone, 200ms)
│   ├── Beep on recording STOP (falling tone, 200ms)
│   ├── ADD: Beep on PASTE (confirmation tone, 150ms)
│   ├── Use OscillatorNode (no audio files needed, works offline)
│   └── Respect system volume, no separate volume control needed
│
└── I-BUG.3 Migration Path 🔲
    ├── Once Strand I is implemented, beep migrates to "Classic Beep" pack
    ├── Users who had beep = auto-migrated to Classic Beep pack
    └── New users default to Silent (but Classic Beep is one click away)
```

---

## 🧬 STRAND J: ADDITIONAL IMPLEMENTED FEATURES (Uncategorized)

**Added:** 11 Mar 2026 by Kit 0C3 Charlie (reconciliation audit)
**Note:** These features were built by Antigravity and exist in the repo but were never added to any DNA strand. Cataloged here for completeness.

### J1: Desktop Feature Additions (Beyond Original Strands)
```
STATUS: ✅ IMPLEMENTED (various dates, mostly by Antigravity)

FILES:
├── J1.1 Upgrade Panel (Stripe Checkout) ✅
│   └── FILE: src/client/desktop/renderer/upgrade.js (541 lines)
│   └── 4-tier pricing cards (Free/$49/$79/$149), Stripe integration
│
├── J1.2 Recording History Panel ✅
│   └── FILE: src/client/desktop/renderer/history.js (~1050 lines)
│   └── Date-grouped list, search, inline playback, export
│
├── J1.3 Auto-Sync Manager ✅
│   └── FILE: src/client/desktop/renderer/auto-sync-manager.js (350 lines)
│   └── + auto-sync.css — cloud sync status, offline queue
│
├── J1.4 Document Translator ✅
│   └── FILE: src/client/desktop/renderer/document-translator.js (265 lines)
│   └── Paste/upload text documents for batch translation
│
├── J1.5 Translation Memory ✅
│   └── FILE: src/client/desktop/renderer/translation-memory.js (244 lines)
│   └── Cache frequently translated phrases for speed
│
├── J1.6 Clone Data Archive ✅
│   └── FILE: src/client/desktop/renderer/clone-data-archive.js (296 lines)
│   └── Soul File / Clone Capture data management
│
├── J1.7 Phone Camera Bridge ✅
│   └── FILE: src/client/desktop/renderer/phone-camera-bridge.js (240 lines)
│   └── Mobile camera → desktop OCR/translation pipeline
│
├── J1.8 Video Preview / Clone Features ✅
│   └── FILES: video-preview.html, video-preload.js, video-clone-features.css
│   └── Video recording for digital twin / clone capture
│
├── J1.9 Changelog Display ✅
│   └── FILE: src/client/desktop/renderer/changelog.js
│   └── In-app changelog / version history
│
└── J1.10 Premium Features Styling ✅
    └── FILE: src/client/desktop/renderer/premium-features.css (14K)
    └── Tier-gated UI styling for paid features
```

### J2: Engine Training Pipeline (Python) ✅ [NEW]
```
STATUS: ✅ IMPLEMENTED (added ~9 Mar 2026 by Antigravity)

FILES:
├── J2.1 LoRA Fine-Tuning ✅
│   └── FILE: src/engine/finetune_whisper_lora.py (327 lines)
│   └── Fine-tune Whisper with LoRA adapters for custom vocabulary
│
├── J2.2 LoRA Adapter Merging ✅
│   └── FILE: src/engine/merge_lora_adapters.py (56 lines)
│   └── Merge LoRA adapters back into base model
│
├── J2.3 CTranslate2 Quantization ✅
│   └── FILE: src/engine/quantize_to_ct2.py (90 lines)
│   └── Quantize fine-tuned models to CTranslate2 INT8 format
│
└── J2.4 Opus Audio Codec ✅
    └── FILE: src/engine/opus-codec.js (57 lines)
    └── Opus encoding for WebSocket audio streaming

NOTE: This pipeline enables WindyProLabs to create custom fine-tuned
engines (lingua specialists, domain-specific models) and distribute
them via HuggingFace in quantized CTranslate2 format.
```

### J3: Translation API Service ✅ [NEW]
```
STATUS: ✅ IMPLEMENTED

FILES: services/translate-api/
├── server.js (17K) — Express API for translation requests
├── translate-worker.py — Python worker for CTranslate2/NLLB
├── download-model.py — Model download utility
├── Dockerfile — Container deployment
├── windy-translate.service — systemd service file
└── README.md — API documentation

NOTE: This is the backend that powers Tier 2 dynamic i18n (G4)
and serves as the dog-fooding translation API. Designed to run
on Veron (GPU server) for production translation.
```

---


---

## 🧬 STRAND K: WINDY CHAT PLATFORM (The Chat Chromosome)

**Added:** 2026-03-12 by Kit 0C3 Charlie + Grant Whitmer
**Priority:** CRITICAL — This is the biggest addition since the original DNA plan. Windy Chat transforms Windy Pro from a transcription tool into a full communication platform.
**Status:** 🔲 NOT STARTED (foundation code exists — see K0)
**Vision:** A WhatsApp-level cross-platform encrypted messaging, media sharing, and video calling system — built on the Matrix protocol, powered by Windy Translate's offline translation engine. Every message, every call, every voice note — translated in real-time, on-device, private by default.

### K0: Foundation — Existing Chat Codebase

```
CURRENT IMPLEMENTATION (March 2026):

FILES (all ✅ IMPLEMENTED — foundation only):
├── src/client/desktop/chat/chat-client.js     (852 lines) — Matrix SDK wrapper
│   ├── Auth: login, register, resumeSession (with safeStorage token encryption)
│   ├── Messaging: sendMessage, getMessages, getCachedMessages
│   ├── Presence: setPresence, presenceMap tracking
│   ├── Rooms: createDM, getContacts, acceptInvite, declineInvite
│   ├── Sync: _startSync with Room.timeline, User.presence, RoomMember.typing
│   ├── Translation: auto-translate via translateFn (chat-translate.js)
│   ├── Offline: _offlineQueue for messages pending reconnection
│   └── E2EE: _initCrypto (best-effort Olm, graceful fallback)
│
├── src/client/desktop/chat/chat-translate.js   (250 lines) — Translation middleware
│   ├── WebSocket connection to local Python translation server
│   ├── LRU cache (500 entries, proper access-order refresh)
│   ├── Request-ID tracking (no FIFO fallback — strict matching)
│   ├── Auto-reconnect with exponential backoff
│   └── Race-condition-safe _connectPromise pattern
│
├── src/client/desktop/chat/chat-preload.js     (65 lines) — IPC bridge
│   ├── 17 invoke APIs (login, register, send, contacts, settings, etc.)
│   ├── 7 event listeners (message, presence, typing, invite, connected, etc.)
│   └── removeAllListeners before re-register (prevents accumulation)
│
├── src/client/desktop/renderer/chat.html       (920+ lines) — Chat UI
│   ├── Login/registration with error states
│   ├── Sidebar (contacts, search, presence dots)
│   ├── Message area (timeline, typing indicator, translated badges)
│   ├── Settings panel, profile panel, new-chat modal
│   ├── Invite confirmation UI (accept/decline cards)
│   └── ARIA labels, landmark roles, keyboard navigation (Escape handlers)
│
├── src/client/desktop/renderer/chat.css        (670 lines) — Dark theme styling
│   ├── Responsive sidebar (collapses to icons at ≤600px)
│   ├── Focus-visible outlines, WCAG AA contrast compliance
│   └── Message bubbles, typing animations, presence indicators
│
└── src/client/desktop/main.js                  (lines 1372–1640) — Chat IPC handlers
    ├── Singleton getChatClient() + _setupChatForwarding()
    ├── 20 ipcMain.handle calls for all chat operations
    ├── Chat window: nodeIntegration:false, contextIsolation:true, sandbox:true
    └── Tray badge updates for unread messages

SDK: matrix-js-sdk@^41.1.0
PROTOCOL: Matrix (https://spec.matrix.org)

STATUS: Foundation is SOLID. Hardened in the Desktop Chat Audit (March 2026):
├── P0-R1: WebSocket _connectPromise race condition ✅ fixed
├── P1-C1: Matrix listener cleanup on re-sync ✅ fixed
├── P1-C7: E2EE disabled until Olm properly configured ✅ fixed
├── P1-M1: removeAllListeners on logout ✅ fixed
├── P1-R3: Login double-click guard ✅ fixed
├── P2-C2/C3: m.direct spec-compliant DM detection ✅ fixed
├── P2-C4: registerRequest (not deprecated register) ✅ fixed
├── P2-R5: Invite confirmation UI (not auto-accept) ✅ fixed
├── P2-R6: insertAdjacentHTML (not innerHTML +=) ✅ fixed
└── P2-R7: escapeAttr XSS hardening ✅ fixed

WHAT'S MISSING (Why this Strand exists):
├── Running on matrix.org = no control, no custom registration, raw @user:matrix.org names
├── No phone/email verification — anyone can create infinite accounts
├── No contact discovery — must know exact Matrix user ID
├── No media sharing — text-only messages
├── No voice/video calling — text chat only
├── No push notifications — must have app open to see messages
├── No E2EE in production — Olm not installed, encryption disabled
├── No backup/restore — lose device = lose all messages
├── Translation is 1:1 only — no group multi-language support
└── No mobile chat client (React Native side not started)
```

### K0.5: Market Context & Competitive Intelligence

```
MESSAGING MARKET SIZE:
├── Global messaging app market: $96.2B (2024) → $174B (2030), 10.3% CAGR
├── WhatsApp: 2.78B monthly active users (2024)
├── Telegram: 900M+ monthly active users
├── Signal: 40M+ monthly active users (privacy-focused segment)
├── iMessage: ~1.3B active devices
├── WeChat: 1.3B MAU (China-dominant)
└── Enterprise: Slack ($1.5B ARR), Teams (320M MAU), Discord (200M MAU)

CROSS-LANGUAGE MESSAGING (Our niche):
├── NOBODY does real-time translation in messaging that works OFFLINE
├── Google Messages: cloud translation (requires internet, mines data)
├── WhatsApp: no built-in translation at all
├── Telegram: basic translate button (cloud, per-message manual click)
├── Signal: zero translation features
├── iMessage: zero translation features
├── WeChat: cloud-only translation (censorship concerns)
└── Microsoft Teams: cloud translation (enterprise-only, $12.50/user/mo)

OUR KILLER DIFFERENTIATOR:
├── 100% OFFLINE translation in a messaging app = unprecedented
├── Matrix protocol = federated, open, self-hostable, E2E encrypted
├── Every message auto-translated on-device — no cloud, no data mining
├── Group chats where each participant sees messages IN THEIR LANGUAGE
├── Video calls with real-time translated subtitles — LOCAL processing
├── Voice messages auto-translated before delivery
├── Zero data collection — privacy by design, not by policy
├── One-time payment — no subscription, no ads, no data monetization
└── Works everywhere: desktop (Electron), iOS (React Native), Android (React Native)

NOBODY ELSE DOES OFFLINE-FIRST TRANSLATED ENCRYPTED MESSAGING.
This is a genuine blue ocean as of March 2026.
```

---

### K1: Our Own Matrix Homeserver (Synapse Deployment)

```
FILES: deploy/synapse/ [NEW DIRECTORY]
STATUS: 🔲 NOT STARTED
PRIORITY: CRITICAL — Everything in Strand K depends on controlling the homeserver

CODONS:
├── K1.1 Synapse Deployment 🔲
│   │
│   │  Synapse = reference Matrix homeserver implementation (Python)
│   │  Alternative: Conduit (Rust, lighter) — evaluate after MVP
│   │
│   ├── K1.1.1 Docker Compose Configuration 🔲
│   │   ├── synapse container (matrixdotorg/synapse:latest)
│   │   ├── PostgreSQL container (synapse DB)
│   │   ├── Redis container (worker coordination)
│   │   ├── Nginx reverse proxy (federation + client API)
│   │   └── Coturn TURN server (NAT traversal for VoIP — K5)
│   │
│   ├── K1.1.2 Homeserver Configuration (homeserver.yaml) 🔲
│   │   ├── server_name: chat.windypro.com
│   │   ├── enable_registration: false (custom registration only — K2)
│   │   ├── max_upload_size_mbs: 100 (for media sharing — K4)
│   │   ├── federation: disabled initially (Windy-users-only network)
│   │   ├── rate_limiting: tuned for real-time chat
│   │   ├── retention_policy: 365 days default
│   │   └── media_store_path: /data/media_store (R2-backed — K8)
│   │
│   ├── K1.1.3 Custom Registration Module 🔲
│   │   ├── FILE: deploy/synapse/windy_registration.py [NEW]
│   │   ├── Synapse auth module that validates Windy Pro accounts
│   │   ├── User registers via Windy app → our API → Synapse creates account
│   │   ├── NO direct Matrix registration (prevents spam accounts)
│   │   ├── Username = Windy display name (not raw @user:matrix.org)
│   │   └── Links Matrix user ID to Windy Pro account ID
│   │
│   ├── K1.1.4 DNS & SSL 🔲
│   │   ├── A record: chat.windypro.com → server IP
│   │   ├── SRV record: _matrix._tcp.windypro.com (federation discovery)
│   │   ├── .well-known/matrix/server — federation endpoint
│   │   ├── .well-known/matrix/client — client endpoint
│   │   └── Let's Encrypt wildcard cert via certbot
│   │
│   └── K1.1.5 Monitoring & Scaling 🔲
│       ├── Prometheus metrics from Synapse
│       ├── Grafana dashboards: MAU, messages/day, media storage
│       ├── Synapse worker mode for horizontal scaling
│       └── Alert: disk usage > 80%, response time > 2s, error rate > 1%
│
├── K1.2 Custom User Identity 🔲
│   │
│   │  PROBLEM: Raw Matrix usernames look like @user:matrix.org — ugly, confusing
│   │  SOLUTION: Windy Chat shows display names everywhere, hides Matrix IDs
│   │
│   ├── K1.2.1 Display Name Registry 🔲
│   │   ├── Users pick display name during onboarding (K2)
│   │   ├── Uniqueness enforced across Windy network
│   │   ├── Format: "Grant Whitmer" or "grant_w" (user's choice)
│   │   ├── Backed by Matrix display_name field
│   │   └── Matrix ID (@windy_abc123:chat.windypro.com) hidden from UI
│   │
│   ├── K1.2.2 Avatar System 🔲
│   │   ├── Profile photo upload (crop, resize, compress)
│   │   ├── Default: auto-generated gradient avatar with initials
│   │   ├── Synced via Matrix profile API
│   │   └── MXC URIs stored on our homeserver media repo
│   │
│   └── K1.2.3 Profile Fields 🔲
│       ├── Display name (required)
│       ├── Bio (optional, 150 chars max)
│       ├── Languages spoken (from Windy language profile — Strand F)
│       ├── Timezone (auto-detected, overridable)
│       └── Online status (online/away/busy/invisible)

DEPENDENCIES: D1 (cloud deployment infrastructure)
NOTE: We MUST control the homeserver to deliver the onboarding
      and contact discovery experience users expect from WhatsApp.
      Running on matrix.org = zero control over registration, identity, or UX.
```

---

### K2: WhatsApp-Style Onboarding

```
FILES: services/chat-onboarding/ [NEW DIRECTORY]
STATUS: 🔲 NOT STARTED
PRIORITY: HIGH — First impressions determine adoption

CODONS:
├── K2.1 Phone / Email Verification 🔲
│   │
│   │  PROVIDER OPTIONS:
│   │  ├── Phone verification: Twilio Verify API ($0.05/verification)
│   │  ├── Email verification: SendGrid ($0.001/email)
│   │  └── Both: user chooses preferred method
│   │
│   ├── K2.1.1 Verification Flow 🔲
│   │   ├── User enters phone number or email
│   │   ├── 6-digit OTP sent via SMS/email
│   │   ├── User enters OTP → verified
│   │   ├── Rate limit: 3 attempts per 10 min, 5 per hour
│   │   ├── Resend cooldown: 60 seconds
│   │   └── Verified identifier linked to Windy Pro account
│   │
│   ├── K2.1.2 Phone Number Normalization 🔲
│   │   ├── International format (E.164): +1234567890
│   │   ├── Country code auto-detection from device locale
│   │   ├── libphonenumber for validation and formatting
│   │   └── Display: local format; store: E.164
│   │
│   └── K2.1.3 Anti-Spam Measures 🔲
│       ├── One account per phone number (or email)
│       ├── SMS rate limiting (Twilio built-in + our limit)
│       ├── CAPTCHA fallback if rate limit triggered
│       └── Account cooling period: 24h between re-registrations
│
├── K2.2 Display Name Setup 🔲
│   │
│   │  ┌─────────────────────────────────────────────────┐
│   │  │  👤  SET UP YOUR PROFILE                        │
│   │  │                                                  │
│   │  │  ┌─────────┐                                    │
│   │  │  │  📸     │  [Upload photo]                    │
│   │  │  │  +ADD   │  or keep auto-generated avatar     │
│   │  │  └─────────┘                                    │
│   │  │                                                  │
│   │  │  Display Name: [___________________]            │
│   │  │  (This is how others will see you)              │
│   │  │                                                  │
│   │  │  Languages: [🇺🇸 English ▾] [+ Add more]       │
│   │  │  (Messages from others will be translated to    │
│   │  │   your primary language automatically)          │
│   │  │                                                  │
│   │  │                         [Continue →]            │
│   │  └─────────────────────────────────────────────────┘
│   │
│   ├── K2.2.1 Name Validation 🔲
│   │   ├── Min 2 chars, max 64 chars
│   │   ├── Unicode allowed (international names)
│   │   ├── Profanity filter (basic — open-source word list)
│   │   ├── Uniqueness check against Windy directory
│   │   └── Suggest alternatives if taken: "Grant W", "Grant Whitmer 2"
│   │
│   └── K2.2.2 Language Selection 🔲
│       ├── Inherits from Windy Pro language profile (Strand F) if available
│       ├── Primary language = auto-translate target
│       ├── Additional languages shown as "also speaks"
│       └── Affects contact discovery suggestions (K3)
│
├── K2.3 QR Code Pairing (Desktop ↔ Mobile) 🔲
│   │
│   │  FLOW (like WhatsApp Web):
│   │  1. Desktop app shows QR code containing: session_id + public_key + timestamp
│   │  2. Mobile app scans QR code using camera
│   │  3. Mobile sends pairing request to server with session_id
│   │  4. Server links desktop session to mobile account
│   │  5. Desktop auto-logs in with delegated credentials
│   │  6. Both devices share the same Matrix access token (or device-specific tokens)
│   │
│   ├── K2.3.1 QR Generation (Desktop) 🔲
│   │   ├── Generate ephemeral key pair (X25519)
│   │   ├── Encode: { session: uuid, pubkey: base64, ts: epoch, server: url }
│   │   ├── Render QR using qrcode npm package (no external dependency)
│   │   ├── QR refreshes every 60 seconds (security)
│   │   └── Show alongside manual code entry fallback
│   │
│   ├── K2.3.2 QR Scanning (Mobile) 🔲
│   │   ├── Use react-native-camera or expo-camera
│   │   ├── Parse QR payload → validate timestamp (< 120s old)
│   │   ├── Send pairing: POST /api/v1/chat/pair { session, signature }
│   │   └── Success → desktop receives WebSocket notification → auto-login
│   │
│   └── K2.3.3 Multi-Device Session Management 🔲
│       ├── Each device gets unique device_id in Matrix
│       ├── Max 5 linked devices per account
│       ├── Device list visible in Settings → Linked Devices
│       ├── Revoke individual devices
│       └── Primary device (mobile) can force-logout all others
│
└── K2.4 Onboarding Complete Screen 🔲

    ┌─────────────────────────────────────────────────┐
    │  🌪️  YOU'RE ALL SET!                            │
    │                                                  │
    │  ┌─────────┐  Hi, Grant!                        │
    │  │ 🧑‍💼    │  Your Windy Chat is ready.         │
    │  │ avatar  │                                    │
    │  └─────────┘                                    │
    │                                                  │
    │  ✅ Phone verified                               │
    │  ✅ Profile created                              │
    │  ✅ Languages: English, Spanish                  │
    │                                                  │
    │  What's next:                                    │
    │  📱 Import contacts to find friends              │
    │  💬 Start a conversation                         │
    │  🌍 Messages auto-translate to your language     │
    │                                                  │
    │              [Start Chatting →]                   │
    └─────────────────────────────────────────────────┘

DEPENDENCIES: K1 (homeserver running), H1 (account server for Windy Pro accounts)
```

---

### K3: Contact Discovery

```
FILES: services/chat-directory/ [NEW DIRECTORY]
STATUS: 🔲 NOT STARTED
PRIORITY: HIGH — Users can't chat if they can't find each other

CODONS:
├── K3.1 Phone Contact Import 🔲
│   │
│   │  PRIVACY-FIRST APPROACH (Signal-style hash matching):
│   │  ├── App reads device contacts (with permission)
│   │  ├── Hash each phone number: SHA256(E.164_number + server_salt)
│   │  ├── Send ONLY hashes to server (never raw phone numbers)
│   │  ├── Server compares hashes against registered user hash table
│   │  ├── Return matches: hash → Windy display name + avatar
│   │  └── Device stores matches locally, raw contacts never leave device
│   │
│   ├── K3.1.1 Permission Request (Mobile) 🔲
│   │   ├── iOS: CNContactStore requestAccess
│   │   ├── Android: READ_CONTACTS permission
│   │   ├── Explain WHY: "Find friends who already use Windy Chat"
│   │   ├── "Skip" option (can import later from Settings)
│   │   └── NEVER block onboarding on contact permission
│   │
│   ├── K3.1.2 Hash Directory Server 🔲
│   │   ├── FILE: services/chat-directory/server.js [NEW]
│   │   ├── POST /api/v1/chat/directory/lookup — batch hash lookup
│   │   ├── Request: { hashes: ["sha256_1", "sha256_2", ...] }
│   │   ├── Response: { matches: [{ hash, displayName, avatar, userId }] }
│   │   ├── Rate limit: 1000 lookups per request, 10 requests per minute
│   │   └── Salt rotation: weekly (re-hash on next sync)
│   │
│   └── K3.1.3 Contact Sync 🔲
│       ├── Initial: full contact book hash upload
│       ├── Incremental: only new/changed contacts on subsequent syncs
│       ├── Background sync: every 24 hours (or manual refresh)
│       └── New match notification: "Sarah just joined Windy Chat!"
│
├── K3.2 Search by Name / Email / Phone 🔲
│   │
│   │  ┌─────────────────────────────────────────────────┐
│   │  │  🔍 FIND PEOPLE                                 │
│   │  │                                                  │
│   │  │  Search: [Grant Whitmer___________] 🔍          │
│   │  │                                                  │
│   │  │  📱 FROM YOUR CONTACTS                          │
│   │  │  ├── 🟢 Sarah Chen (online)        [Message]   │
│   │  │  ├── 🟡 Alex Park (away)           [Message]   │
│   │  │  └── ⚪ Maria Lopez (offline)       [Message]   │
│   │  │                                                  │
│   │  │  🔍 SEARCH RESULTS                              │
│   │  │  ├── Grant W.                       [Invite]    │
│   │  │  └── Grant Whitmer                  [Invite]    │
│   │  │                                                  │
│   │  │  📨 INVITE BY PHONE / EMAIL                     │
│   │  │  └── [Send invite to +1 555-0123]               │
│   │  └─────────────────────────────────────────────────┘
│   │
│   ├── K3.2.1 Directory Search API 🔲
│   │   ├── GET /api/v1/chat/directory/search?q=grant
│   │   ├── Searches: display name (fuzzy), email (exact), phone (E.164)
│   │   ├── Results limited to 20 per query
│   │   ├── Respects user privacy settings (some users opt out of search)
│   │   └── Debounced: 300ms after last keystroke
│   │
│   └── K3.2.2 Invite Non-Users 🔲
│       ├── Send SMS invite: "Grant invited you to Windy Chat!"
│       ├── Send email invite with download link
│       ├── Deep link: windypro.com/chat/join?ref=grant_id
│       ├── Referral tracking for growth metrics
│       └── Limit: 20 invites per day (anti-spam)
│
└── K3.3 Social Media Import (Phase 2) 🔲
    ├── Instagram DM contacts
    ├── Facebook Messenger contacts
    ├── Twitter/X DM contacts
    ├── LinkedIn connections
    └── OAuth2 integration per platform (complex — defer to Phase 2)

DEPENDENCIES: K1 (homeserver), K2 (verified accounts)
```

---

### K4: Rich Media Sharing

```
FILES: src/client/desktop/chat/chat-media.js [NEW]
       src/mobile/src/services/chatMedia.ts [NEW]
STATUS: 🔲 NOT STARTED
PRIORITY: HIGH — Text-only messaging is not competitive in 2026

CODONS:
├── K4.1 Photo Sharing 🔲
│   │
│   │  Matrix event type: m.image
│   │
│   ├── K4.1.1 Photo Capture & Selection 🔲
│   │   ├── Mobile: camera capture + photo library picker
│   │   ├── Desktop: file picker + clipboard paste (Ctrl+V image)
│   │   ├── Drag-and-drop onto chat window (desktop)
│   │   ├── Max file size: 20MB (resized before upload if larger)
│   │   └── Supported formats: JPEG, PNG, WebP, HEIF (convert to JPEG)
│   │
│   ├── K4.1.2 Image Processing Pipeline 🔲
│   │   ├── Generate thumbnail (300px max dimension) for preview
│   │   ├── Strip EXIF metadata (privacy — remove GPS, device info)
│   │   ├── Compress: JPEG quality 85% (good balance of size/quality)
│   │   ├── Upload to Matrix media repo (MXC URI)
│   │   └── Encrypt before upload if room is E2EE (K7)
│   │
│   ├── K4.1.3 Image Display 🔲
│   │   ├── Thumbnail in chat bubble (lazy-loaded)
│   │   ├── Tap to view full-size (lightbox overlay)
│   │   ├── Pinch-to-zoom (mobile), scroll-to-zoom (desktop)
│   │   ├── Save to device (long-press → "Save Image")
│   │   └── Forward to other chats
│   │
│   └── K4.1.4 Translated Captions 🔲
│       ├── User adds optional caption to image
│       ├── Caption auto-translated for recipient (like text messages)
│       ├── Display: original caption + translated caption
│       └── Translation happens on sender's device before send
│
├── K4.2 Video Sharing 🔲
│   │
│   │  Matrix event type: m.video
│   │
│   ├── K4.2.1 Video Capture & Selection 🔲
│   │   ├── Mobile: record video (max 3 min) + library picker
│   │   ├── Desktop: file picker + screen recording clip
│   │   ├── Max file size: 100MB
│   │   └── Supported formats: MP4, WebM, MOV (transcode to MP4)
│   │
│   ├── K4.2.2 Video Processing 🔲
│   │   ├── Generate thumbnail (first frame or middle frame)
│   │   ├── Compress: H.264 720p for mobile, 1080p for desktop
│   │   ├── Duration overlay on thumbnail ("0:42")
│   │   ├── Progressive upload with progress indicator
│   │   └── Background upload (don't block UI)
│   │
│   └── K4.2.3 Video Playback 🔲
│       ├── Inline playback in chat bubble (muted autoplay on scroll)
│       ├── Tap for fullscreen with audio
│       ├── Playback controls: play/pause, scrub, volume
│       └── PiP support (continue watching while scrolling)
│
├── K4.3 Voice Messages 🔲
│   │
│   │  Matrix event type: m.audio
│   │
│   ├── K4.3.1 Voice Recording 🔲
│   │   ├── Hold-to-record button (tap = hold, release = send)
│   │   ├── Slide left to cancel (WhatsApp-style)
│   │   ├── Waveform visualization during recording
│   │   ├── Duration display (max 5 minutes)
│   │   ├── Format: Opus (compact, high quality)
│   │   └── Lock button: tap to lock recording (hands-free mode)
│   │
│   ├── K4.3.2 Voice Message Playback 🔲
│   │   ├── Waveform display in chat bubble
│   │   ├── Play/pause with progress scrubbing
│   │   ├── Playback speed: 1x, 1.5x, 2x
│   │   ├── Earpiece mode: raise to ear = play through earpiece (mobile)
│   │   └── Blue waveform = unplayed, gray = played
│   │
│   └── K4.3.3 Voice Message Translation (KILLER FEATURE) 🔲
│       │
│       │  FLOW:
│       │  1. Sender records voice message in their language
│       │  2. On sender's device: STT → translate → TTS → attach both
│       │  3. Recipient sees: original audio + translated audio + transcript
│       │  4. All processing LOCAL on sender's device
│       │
│       ├── Original audio: Opus (sender's voice)
│       ├── Translated audio: TTS in recipient's language (Piper/Coqui)
│       ├── Transcript: original text + translated text
│       ├── Metadata: { windy_voice_translated: true, src_lang, tgt_lang }
│       └── Recipient can toggle: "Hear original" / "Hear translated"
│
├── K4.4 File Sharing 🔲
│   │
│   │  Matrix event type: m.file
│   │
│   ├── K4.4.1 File Upload 🔲
│   │   ├── Any file type (PDF, DOCX, ZIP, etc.)
│   │   ├── Max file size: 100MB
│   │   ├── File icon + name + size in chat bubble
│   │   ├── Progress indicator during upload
│   │   └── Virus scan on server before delivery (ClamAV)
│   │
│   └── K4.4.2 File Download 🔲
│       ├── Tap to download (don't auto-download large files)
│       ├── Preview: PDFs inline, images inline, others = download
│       ├── Open in default app
│       └── Download progress indicator
│
└── K4.5 Media Gallery 🔲
    ├── Per-conversation media gallery (all photos, videos, files)
    ├── Grid view of shared media
    ├── Filter by type: photos / videos / files / voice messages
    ├── Scrollable timeline (newest first)
    └── Accessible from conversation header: [📎 Media]

DEPENDENCIES: K1 (homeserver media repo), K7 (E2EE for encrypted media)
```


### K5: Video and Voice Calling

```
FILES: src/client/desktop/chat/chat-voip.js [NEW]
       src/mobile/src/services/chatVoIP.ts [NEW]
STATUS: 🔲 NOT STARTED
PRIORITY: MEDIUM (messaging first, then calling)

ARCHITECTURE:
│  Matrix VoIP uses WebRTC with Matrix signaling:
│  ├── 1:1 calls: MSC2746 (WebRTC via m.call.invite / m.call.answer events)
│  ├── Group calls: MSC3401 (LiveKit or Jitsi SFU backend)
│  ├── TURN server: Coturn (NAT traversal — deployed in K1.1.1)
│  └── STUN server: Google STUN (free) or self-hosted
│
│  TRANSLATED SUBTITLES ARCHITECTURE:
│  ├── Remote audio → local STT (Whisper) → translate → render subtitle
│  ├── ALL processing on LOCAL device — never leaves the call
│  ├── ~1.5s latency (STT 500ms + translate 200ms + render 100ms + buffer 700ms)
│  └── Toggle: show/hide subtitles per call participant

CODONS:
├── K5.1 1:1 Voice Calls 🔲
│   │
│   ├── K5.1.1 Call Setup (WebRTC + Matrix Signaling) 🔲
│   │   ├── Caller sends m.call.invite event to room
│   │   ├── Callee receives → shows incoming call UI
│   │   ├── Callee accepts → m.call.answer event
│   │   ├── ICE candidate exchange via m.call.candidates
│   │   ├── TURN/STUN for NAT traversal
│   │   └── Call established → peer-to-peer audio stream
│   │
│   ├── K5.1.2 Incoming Call UI 🔲
│   │   │
│   │   │  ┌─────────────────────────────────────┐
│   │   │  │                                      │
│   │   │  │        ┌──────────┐                 │
│   │   │  │        │  🧑‍💼    │                 │
│   │   │  │        │  avatar  │                 │
│   │   │  │        └──────────┘                 │
│   │   │  │      Grant Whitmer                   │
│   │   │  │      Windy Chat Voice Call           │
│   │   │  │                                      │
│   │   │  │    🔴 Decline      🟢 Accept        │
│   │   │  │                                      │
│   │   │  └─────────────────────────────────────┘
│   │   │
│   │   ├── Full-screen overlay (mobile) or notification (desktop)
│   │   ├── Ringtone with vibration (mobile)
│   │   ├── System notification for background calls
│   │   └── Auto-decline after 30 seconds if no answer
│   │
│   ├── K5.1.3 In-Call Controls 🔲
│   │   ├── Mute/unmute microphone
│   │   ├── Speaker/earpiece toggle (mobile)
│   │   ├── Bluetooth audio device selection
│   │   ├── Hold call
│   │   ├── End call
│   │   ├── Call duration timer
│   │   └── Network quality indicator (excellent/good/poor)
│   │
│   └── K5.1.4 Call Quality 🔲
│       ├── Opus audio codec (adaptive bitrate 16-128 kbps)
│       ├── Echo cancellation (WebRTC built-in AEC)
│       ├── Noise suppression (WebRTC built-in NS)
│       ├── Packet loss concealment
│       └── Automatic bitrate adaptation based on network quality
│
├── K5.2 1:1 Video Calls 🔲
│   │
│   ├── K5.2.1 Camera Management 🔲
│   │   ├── Front/rear camera toggle (mobile)
│   │   ├── Camera selection dropdown (desktop)
│   │   ├── Camera preview before joining call
│   │   ├── Virtual background (blur, image) — stretch goal
│   │   └── Camera off → show avatar instead
│   │
│   ├── K5.2.2 Video Layout 🔲
│   │   ├── Fullscreen: remote video fills screen
│   │   ├── Self-view: PiP corner (draggable)
│   │   ├── Resolution: 720p default, 1080p on good network
│   │   └── Bandwidth adaptive: auto-degrade resolution on poor network
│   │
│   └── K5.2.3 Screen Sharing 🔲
│       ├── Share entire screen or specific window (desktop)
│       ├── Share screen on mobile (iOS ReplayKit, Android MediaProjection)
│       ├── Annotation tools: draw/highlight on shared screen — stretch goal
│       └── Resolution: match source resolution, max 1080p @ 15fps
│
├── K5.3 Group Calls (MSC3401 via LiveKit/Jitsi) 🔲
│   │
│   │  BACKEND: LiveKit (open-source, Rust-based SFU)
│   │  ALTERNATIVE: Jitsi Meet (more mature, Java-based)
│   │  DECISION: Evaluate both — LiveKit preferred for performance
│   │
│   ├── K5.3.1 SFU Deployment 🔲
│   │   ├── LiveKit server container in Docker Compose
│   │   ├── Scalable: 1 SFU handles ~100 concurrent streams
│   │   ├── Media: audio/video routed through SFU (not mesh peer-to-peer)
│   │   └── Signaling: Matrix room state events for call membership
│   │
│   ├── K5.3.2 Group Call UI 🔲
│   │   ├── Grid layout: up to 4 video tiles (2×2)
│   │   ├── Gallery layout: up to 25 tiles (5×5, thumbnails)
│   │   ├── Speaker focus: active speaker highlighted / enlarged
│   │   ├── Participant list sidebar
│   │   └── Audio-only for 5+ participants on poor network
│   │
│   └── K5.3.3 Group Call Features 🔲
│       ├── Max participants: 25 (with SFU)
│       ├── Hand raise button 🤚
│       ├── Chat sidebar during call
│       ├── Screen sharing (one at a time)
│       ├── Record call (local recording, not cloud)
│       └── Meeting link: windypro.com/call/room_id (web-joinable)
│
├── K5.4 Real-Time Translated Subtitles (KILLER FEATURE) 🔲
│   │
│   │  ARCHITECTURE:
│   │  ┌────────────────────────────────────────────────────────┐
│   │  │  Remote participant speaks (Spanish)                    │
│   │  │       ↓                                                 │
│   │  │  WebRTC audio stream received locally                   │
│   │  │       ↓                                                 │
│   │  │  LOCAL Whisper STT: "¿Dónde está la reunión?"          │
│   │  │       ↓                                                 │
│   │  │  LOCAL Translation: "Where is the meeting?"             │
│   │  │       ↓                                                 │
│   │  │  Render subtitle overlay on video                       │
│   │  │                                                         │
│   │  │  ⚡ ALL ON DEVICE — zero cloud, zero data leak          │
│   │  └────────────────────────────────────────────────────────┘
│   │
│   ├── K5.4.1 Subtitle Overlay 🔲
│   │   ├── Semi-transparent bar at bottom of video
│   │   ├── Original text (smaller, above) + translated text (larger, below)
│   │   ├── Speaker name prefix: "Grant: Where is the meeting?"
│   │   ├── Fade out after 5 seconds of silence
│   │   ├── Font size adjustable
│   │   └── Toggle per-participant: "Translate Grant's audio" ON/OFF
│   │
│   ├── K5.4.2 Audio Routing for STT 🔲
│   │   ├── Tap remote audio stream → feed to local Whisper
│   │   ├── Separate AudioContext (read-only, doesn't affect playback)
│   │   ├── Buffer: 2-second sliding window
│   │   └── VAD: only process when speech detected (save CPU)
│   │
│   └── K5.4.3 Multi-Language Group Calls 🔲
│       ├── Each participant sets their language
│       ├── Each participant sees subtitles in THEIR language
│       ├── N participants × N languages = each processes locally
│       ├── No central translation server needed
│       └── CPU budget: ~20% per remote participant being translated
│
├── K5.5 Call History 🔲
│   ├── Call log: date, time, duration, type (voice/video/group), direction
│   ├── Missed call badges (red dot on contact)
│   ├── Call back button (one-tap redial)
│   ├── Filter: all calls / missed / incoming / outgoing
│   └── Stored locally + synced via Matrix room state
│
└── K5.6 Picture-in-Picture 🔲
    ├── iOS: AVPictureInPictureController
    ├── Android: PiP activity mode
    ├── Desktop: frameless always-on-top mini-window
    ├── Show remote video + call controls (mute, end)
    └── Tap PiP to return to full call screen

DEPENDENCIES: K1 (homeserver + TURN server), K7 (E2EE for encrypted calls)
NOTE: 1:1 calls (K5.1, K5.2) can ship before group calls (K5.3).
      Group calls require SFU infrastructure which is a separate deployment.
```

---

### K6: Push Notifications

```
FILES: services/chat-push-gateway/ [NEW DIRECTORY]
STATUS: 🔲 NOT STARTED
PRIORITY: HIGH — Without push, users must keep app open to receive messages

CODONS:
├── K6.1 Matrix Push Gateway 🔲
│   │
│   │  Matrix spec: push notifications flow through a "push gateway"
│   │  that receives events from the homeserver and forwards to FCM/APNs
│   │
│   ├── K6.1.1 Push Gateway Server 🔲
│   │   ├── FILE: services/chat-push-gateway/server.js [NEW]
│   │   ├── Receives: POST /_matrix/push/v1/notify from Synapse
│   │   ├── Payload: { notification: { room_id, event_id, sender, type, content } }
│   │   ├── Routes to FCM (Android) or APNs (iOS) based on device pushkey
│   │   ├── Strips message content for privacy (title only, no body)
│   │   └── Registers with Synapse as push gateway URL
│   │
│   ├── K6.1.2 Synapse Pusher Configuration 🔲
│   │   ├── Client registers pusher: POST /_matrix/client/v3/pushers/set
│   │   ├── Pusher data: { pushkey, app_id, app_display_name, device_display_name }
│   │   ├── kind: "http" (Synapse sends HTTP to our push gateway)
│   │   └── data.url: "https://push.windypro.com/_matrix/push/v1/notify"
│   │
│   └── K6.1.3 Notification Content 🔲
│       ├── Title: sender display name
│       ├── Body: "New message" (privacy — don't leak content in notification)
│       ├── Badge count: total unread across all rooms
│       ├── Sound: default system notification sound
│       └── Action buttons: "Reply" (inline reply), "Mark Read"
│
├── K6.2 Firebase Cloud Messaging (Android) 🔲
│   │
│   ├── K6.2.1 FCM Integration 🔲
│   │   ├── Firebase project setup for Windy Chat
│   │   ├── google-services.json in Android project
│   │   ├── FCM token registration on app start
│   │   ├── Token refresh handling
│   │   └── Data messages (not notification messages — for custom handling)
│   │
│   └── K6.2.2 Android Notification Channels 🔲
│       ├── Channel: "chat_messages" — new messages (default sound + vibrate)
│       ├── Channel: "chat_calls" — incoming calls (ringtone + full-screen intent)
│       ├── Channel: "chat_mentions" — @mentions (priority notification)
│       └── User can customize per-channel in Android Settings
│
├── K6.3 Apple Push Notification Service (iOS) 🔲
│   │
│   ├── K6.3.1 APNs Integration 🔲
│   │   ├── Push certificate or p8 key in Apple Developer portal
│   │   ├── Entitlement: aps-environment (development/production)
│   │   ├── Device token registration via UIApplication delegate
│   │   ├── Token forwarded to push gateway as pushkey
│   │   └── Background refresh for badge count update
│   │
│   └── K6.3.2 iOS Notification Features 🔲
│       ├── Notification content extension (rich preview — avatar + message)
│       ├── Notification service extension (decrypt E2EE content for preview)
│       ├── Inline reply from notification
│       ├── Group notifications by conversation
│       └── Critical alerts for calls (bypass Do Not Disturb)
│
└── K6.4 Per-Conversation Mute 🔲
    ├── Mute options: 1 hour, 8 hours, 1 day, 1 week, forever
    ├── Muted conversations: no push, no sound, badge still counts
    ├── Mention override: @you still notifies even if muted
    ├── Mute state synced via Matrix room account data
    └── Mute icon shown on conversation in contact list

DEPENDENCIES: K1 (homeserver sends push events)
```

---

### K7: E2E Encryption — Production Grade

```
FILES: src/client/desktop/chat/chat-crypto.js [NEW]
       src/mobile/src/services/chatCrypto.ts [NEW]
STATUS: 🔲 NOT STARTED (foundation exists in chat-client.js _initCrypto)
PRIORITY: HIGH — Currently disabled because Olm is not installed

CODONS:
├── K7.1 Olm / Megolm Installation 🔲
│   │
│   │  CURRENT STATE: _initCrypto() in chat-client.js tries to load
│   │  @matrix-org/olm but it's not installed → falls back to unencrypted
│   │
│   ├── K7.1.1 Dependencies 🔲
│   │   ├── npm install @matrix-org/olm (libolm WASM bindings)
│   │   ├── OR: use matrix-js-sdk's built-in Rust crypto (initRustCrypto)
│   │   ├── Decision: Rust crypto preferred (newer, maintained, no external Olm)
│   │   ├── CryptoStore: IndexedDBCryptoStore (desktop) or SQLiteCryptoStore (mobile)
│   │   └── Persist crypto state across app restarts
│   │
│   ├── K7.1.2 Client Initialization 🔲
│   │   ├── createClient({ ...opts, cryptoStore: new IndexedDBCryptoStore() })
│   │   ├── await client.initRustCrypto()
│   │   ├── Set globalErrorOnUnknownDevices(false) — auto-trust new devices
│   │   └── Export secret storage key to backup (K7.3)
│   │
│   └── K7.1.3 Enable DM Encryption 🔲
│       ├── Restore initial_state encryption in createDM()
│       ├── Algorithm: m.megolm.v1.aes-sha2
│       ├── Only enable after K7.1.2 confirms crypto is working
│       └── Existing unencrypted rooms remain unencrypted (no retroactive E2E)
│
├── K7.2 Device Verification 🔲
│   │
│   │  FLOW (interactive verification):
│   │  1. User A requests verification of User B's new device
│   │  2. Both users see emoji comparison (SAS verification)
│   │  3. If emojis match → both confirm → devices cross-signed
│   │  4. Verified device gets green shield ✅ in UI
│   │
│   ├── K7.2.1 SAS Verification 🔲
│   │   ├── Short Authentication String (7 emoji comparison)
│   │   ├── Start via: device info panel → "Verify" button
│   │   ├── Both users confirm emojis match
│   │   └── Matrix events: m.key.verification.start/accept/key/mac/done
│   │
│   ├── K7.2.2 QR Code Verification 🔲
│   │   ├── Scan QR code on other device (faster than emoji)
│   │   ├── QR contains: user ID, device ID, master cross-signing key
│   │   └── One-tap verification after scan
│   │
│   └── K7.2.3 Verification UI 🔲
│       ├── Device list in Settings → Security → Devices
│       ├── Each device: name, last seen, verified status
│       ├── Unverified device warning: ⚠️ on messages from unverified devices
│       └── "Verify all" button for bulk verification
│
├── K7.3 Key Backup (SSSS — Secure Secret Storage and Sharing) 🔲
│   │
│   │  PROBLEM: If user loses device, they lose all encryption keys
│   │  SOLUTION: Encrypted key backup stored on homeserver
│   │
│   ├── K7.3.1 Backup Creation 🔲
│   │   ├── Generate recovery key (48-character base58 string)
│   │   ├── Encrypt all session keys with recovery key
│   │   ├── Upload to homeserver: POST /_matrix/client/v3/room_keys/version
│   │   ├── Show recovery key to user: "SAVE THIS — you'll need it on a new device"
│   │   ├── Option: protect backup with passphrase instead of recovery key
│   │   └── Auto-backup new keys as they're created
│   │
│   ├── K7.3.2 Backup Restore 🔲
│   │   ├── On new device login → prompt for recovery key or passphrase
│   │   ├── Download keys from homeserver
│   │   ├── Decrypt with recovery key/passphrase
│   │   ├── Import into local crypto store
│   │   └── All historical messages become readable
│   │
│   └── K7.3.3 Recovery Key Storage 🔲
│       ├── Option 1: user saves recovery key manually (screenshot, paper)
│       ├── Option 2: stored in iCloud Keychain / Google Password Manager
│       ├── Option 3: stored in Windy Pro account (encrypted with user password)
│       └── Prompt user to verify backup exists during onboarding
│
└── K7.4 Cross-Signing 🔲
    ├── Master signing key: signs all user's device keys
    ├── Self-signing key: signs own devices
    ├── User-signing key: signs other users' master keys
    ├── Trust chain: if I verify User B once, all their devices are trusted
    └── Bootstrapped during first E2EE setup

DEPENDENCIES: K1 (homeserver for key backup storage)
NOTE: E2EE is currently DISABLED (P1-C7 fix removed encryption from createDM).
      K7 re-enables it properly with full crypto initialization.
```

---

### K8: Chat Cloud Backup and Sync

```
FILES: services/chat-backup/ [NEW DIRECTORY]
STATUS: 🔲 NOT STARTED
PRIORITY: MEDIUM (users need this before trusting chat as primary messenger)

CODONS:
├── K8.1 Encrypted Chat Backup 🔲
│   │
│   │  STORAGE: Cloudflare R2 (S3-compatible, zero egress fees)
│   │  ENCRYPTION: AES-256-GCM with user-derived key (password-based)
│   │  SCHEDULE: Daily automatic, manual on-demand
│   │
│   ├── K8.1.1 Backup Contents 🔲
│   │   ├── Message history (all rooms, all events)
│   │   ├── E2EE keys (encrypted key backup — K7.3)
│   │   ├── Contact list and room memberships
│   │   ├── User settings (language, notification prefs, mute states)
│   │   ├── Media: thumbnails only (full media re-downloaded on restore)
│   │   └── Translation memory cache (frequently translated phrases)
│   │
│   ├── K8.1.2 Backup Encryption 🔲
│   │   ├── Derive backup key from user password (PBKDF2, 100K iterations)
│   │   ├── Encrypt backup payload: AES-256-GCM (authenticated encryption)
│   │   ├── Upload encrypted blob to R2: /backups/{userId}/{timestamp}.enc
│   │   ├── Server CANNOT decrypt backups (zero-knowledge)
│   │   └── Max backup size: 500MB (compressed)
│   │
│   ├── K8.1.3 Backup Schedule 🔲
│   │   ├── Automatic: daily at 3 AM local time (background)
│   │   ├── Manual: Settings → Chat → "Back Up Now"
│   │   ├── Incremental: only new messages since last backup
│   │   ├── WiFi-only option (don't use cellular data)
│   │   └── Keep last 7 daily backups (auto-prune older ones)
│   │
│   └── K8.1.4 Backup Status UI 🔲
│       ├── Settings → Chat → Backup: "Last backup: today 3:02 AM"
│       ├── Backup size: "247 MB of 500 MB used"
│       ├── Next backup: "Tomorrow 3:00 AM"
│       └── "Back Up Now" button with progress indicator
│
├── K8.2 Restore on New Device 🔲
│   │
│   │  FLOW:
│   │  1. User logs in on new device
│   │  2. Prompt: "Restore chat history from backup?"
│   │  3. Enter backup password (or recovery key)
│   │  4. Download + decrypt backup from R2
│   │  5. Import messages, keys, settings
│   │  6. Full chat history available immediately
│   │
│   ├── K8.2.1 Restore UI 🔲
│   │   │
│   │   │  ┌─────────────────────────────────────────────────┐
│   │   │  │  📦 RESTORE CHAT HISTORY                        │
│   │   │  │                                                  │
│   │   │  │  We found a backup from your account:            │
│   │   │  │                                                  │
│   │   │  │  📅 March 12, 2026 — 3:02 AM                   │
│   │   │  │  💬 1,247 messages across 23 conversations      │
│   │   │  │  📎 89 media files                              │
│   │   │  │  📦 247 MB                                      │
│   │   │  │                                                  │
│   │   │  │  Backup Password: [________________]            │
│   │   │  │                                                  │
│   │   │  │  [Restore]  [Skip — start fresh]                │
│   │   │  └─────────────────────────────────────────────────┘
│   │   │
│   │   ├── Progress: "Restoring... 67% (834 of 1,247 messages)"
│   │   └── Complete: "✅ Chat history restored!"
│   │
│   └── K8.2.2 Selective Restore 🔲
│       ├── Option: restore all conversations
│       ├── Option: restore specific conversations only
│       ├── Option: restore messages from last N days only
│       └── Media: re-download from homeserver on-demand (not from backup)
│
└── K8.3 Soul File Integration 🔲
    ├── Chat history contributes to Soul File data set
    ├── Voice messages → voice sample corpus (for Clone Capture)
    ├── Translation patterns → improve personal translation model
    ├── Export chat history as part of Soul File export (Strand H5)
    └── Opt-in only: "Include chat history in Soul File?" toggle

DEPENDENCIES: K1 (homeserver), K7 (E2EE keys for backup), H4 (sync infrastructure)
```

---

### K9: Translation Integration — The Killer Feature

```
FILES: src/client/desktop/chat/chat-translate.js (extend existing 250 lines)
       src/mobile/src/services/chatTranslation.ts [NEW]
STATUS: 🔲 NOT STARTED (basic 1:1 translation exists in chat-translate.js)
PRIORITY: CRITICAL — This is what makes Windy Chat different from every other messenger

CODONS:
├── K9.1 Auto-Translate Incoming Messages 🔲
│   │
│   │  CURRENT STATE: chat-client.js calls translateFn() on incoming messages
│   │  if windy_original metadata is present. Translation happens via WebSocket
│   │  to local Python server.
│   │
│   │  TARGET STATE: Every incoming message auto-translates to user's language,
│   │  with graceful fallback chain and zero cloud dependency.
│   │
│   ├── K9.1.1 Translation Pipeline 🔲
│   │   ├── Incoming message received via Matrix sync
│   │   ├── Detect source language (from windy_lang metadata or auto-detect)
│   │   ├── If source ≠ user's language → translate
│   │   ├── Translation chain: local engine → cloud API → original text
│   │   ├── Cache translated text in local DB (keyed by event_id + target_lang)
│   │   └── Display: translated text (primary) + "Show original" toggle
│   │
│   ├── K9.1.2 Translation Engine Priority 🔲
│   │   ├── Priority 1: Local offline engine (Strand E — CTranslate2/NLLB)
│   │   ├── Priority 2: Local Python server (chat-translate.js WebSocket)
│   │   ├── Priority 3: Cloud translation API (if user permits)
│   │   ├── Priority 4: Show original untranslated (never fail silently)
│   │   └── User setting: "Translation mode: Local Only / Local + Cloud / Off"
│   │
│   └── K9.1.3 Translation Indicators 🔲
│       ├── 🌍 icon on translated messages
│       ├── Tap icon → show original text underneath
│       ├── Long-press → "Report bad translation" (feedback loop)
│       └── Shimmer animation while translation is in progress
│
├── K9.2 Original + Translated Display 🔲
│   │
│   │  MESSAGE BUBBLE LAYOUT:
│   │
│   │  ┌──────────────────────────────────────────┐
│   │  │  Grant (🇪🇸 → 🇺🇸)                 2:15 PM │
│   │  │                                           │
│   │  │  Where is the meeting room?                │
│   │  │                                           │
│   │  │  ┈┈┈ 🌍 Translated from Spanish ┈┈┈     │
│   │  │  ¿Dónde está la sala de reuniones?        │
│   │  └──────────────────────────────────────────┘
│   │
│   ├── K9.2.1 Compact Mode (default) 🔲
│   │   ├── Show translated text as primary
│   │   ├── Original text collapsed (tap 🌍 to expand)
│   │   └── Language flag emoji in sender name
│   │
│   ├── K9.2.2 Bilingual Mode 🔲
│   │   ├── Show both original + translated side-by-side
│   │   ├── Original: smaller font, muted color
│   │   ├── Translated: normal font, primary color
│   │   └── Toggle: Settings → Chat → "Show original text: Always / On tap / Never"
│   │
│   └── K9.2.3 Message Search Across Languages 🔲
│       ├── Search finds matches in BOTH original and translated text
│       ├── "pharmacy" matches "Where is the pharmacy?" AND "farmacia"
│       └── Search index covers both language versions
│
├── K9.3 Per-Conversation Translation Settings 🔲
│   │
│   ├── K9.3.1 Conversation Language Override 🔲
│   │   ├── Default: translate to user's primary language
│   │   ├── Override: "In this chat, translate to French" (for practice)
│   │   ├── Override stored in Matrix room account data
│   │   └── "Don't translate this chat" option (for same-language friends)
│   │
│   ├── K9.3.2 Auto-Detect Source Language 🔲
│   │   ├── If sender's language is unknown, auto-detect from message text
│   │   ├── Use fasttext language ID (~1MB model, instant)
│   │   ├── Cache detected language per sender (stable after 3 messages)
│   │   └── User can manually set: "Grant speaks: [Spanish ▾]"
│   │
│   └── K9.3.3 Translation Quality Feedback 🔲
│       ├── Thumbs up/down on translations
│       ├── "Suggest better translation" → manual edit → saved to memory
│       ├── Translation memory improves over time per language pair
│       └── Federated: translation improvements shared across user's devices
│
├── K9.4 Translated Voice Messages 🔲
│   │
│   │  (Detailed in K4.3.3 — cross-reference)
│   │  Sender records → STT → translate → TTS → attach both audio versions
│   │  Recipient toggles: "Hear original" / "Hear translated"
│   │
│   └── K9.4.1 Outgoing Voice Translation Pipeline 🔲
│       ├── Record voice message (Opus audio)
│       ├── Local STT: Whisper transcribes sender's speech
│       ├── Local translate: NLLB translates transcript
│       ├── Local TTS: Piper synthesizes translated text
│       ├── Package: { original_audio, translated_audio, original_text, translated_text }
│       ├── Send as m.audio with windy_voice_translated metadata
│       └── Processing time: ~3-5 seconds for 30-second message
│
├── K9.5 Real-Time Translation in Video Calls 🔲
│   │
│   │  (Detailed in K5.4 — cross-reference)
│   │  Remote audio → local STT → local translate → render subtitle overlay
│   │  ALL processing on user's device — zero cloud
│   │
│   └── K9.5.1 Call Translation Settings 🔲
│       ├── Per-participant toggle: "Translate [Grant's] speech"
│       ├── Subtitle language: defaults to user's primary language
│       ├── Subtitle position: bottom (default), top, left, right
│       ├── Subtitle size: small / medium / large
│       └── "Translate for me" mode: translate ALL participants automatically
│
├── K9.6 Group Chat Multi-Language (THE HOLY GRAIL) 🔲
│   │
│   │  VISION: A group chat with 5 people speaking 5 different languages.
│   │  Each person types/speaks in THEIR language.
│   │  Each person SEES every message in THEIR language.
│   │  No one needs to know or learn anyone else's language.
│   │
│   │  ┌──────────────────────────────────────────────────────┐
│   │  │  GROUP: 🌍 International Project Team                 │
│   │  │                                                       │
│   │  │  Yuki (🇯🇵): Let's finalize the design today.        │
│   │  │  ┈ 今日デザインを確定しましょう。                         │
│   │  │                                                       │
│   │  │  Maria (🇪🇸): Agreed. I'll share the mockups.        │
│   │  │  ┈ De acuerdo. Compartiré los mockups.               │
│   │  │                                                       │
│   │  │  Hans (🇩🇪): Can we also review the timeline?        │
│   │  │  ┈ Können wir auch den Zeitplan überprüfen?          │
│   │  │                                                       │
│   │  │  Wei (🇨🇳): Good idea. I've updated the Gantt chart.│
│   │  │  ┈ 好主意。我已经更新了甘特图。                          │
│   │  │                                                       │
│   │  │  ☝️ YOU see all messages in English.                  │
│   │  │  Yuki sees them in Japanese. Maria in Spanish.       │
│   │  │  Hans in German. Wei in Chinese. Same conversation.  │
│   │  └──────────────────────────────────────────────────────┘
│   │
│   ├── K9.6.1 Group Translation Architecture 🔲
│   │   ├── Sender sends message with windy_original + windy_lang metadata
│   │   ├── Each recipient's device translates locally to THEIR language
│   │   ├── No central translation — N devices × 1 translation each
│   │   ├── Translation cached per (event_id × target_lang)
│   │   └── If recipient and sender share a language → no translation needed
│   │
│   ├── K9.6.2 Group Language Summary 🔲
│   │   ├── Conversation header shows: "🌍 5 languages in this chat"
│   │   ├── Tap to see: who speaks what
│   │   ├── "Your messages are translated for 4 participants"
│   │   └── Language distribution visualization
│   │
│   └── K9.6.3 Performance Budget for Group Translation 🔲
│       ├── Target: < 500ms per message translation
│       ├── Batch translation: if 10 unread messages arrive, translate in batch
│       ├── Lazy translation: only translate visible messages (virtual scroll)
│       ├── Cache hit rate target: > 70% (common phrases repeated in group)
│       └── Memory budget: translation engine ≤ 1GB RAM
│
└── K9.7 Translation Processing — LOCAL by Default 🔲

    CRITICAL INVARIANT (Strand K addition to Critical Invariants):
    ├── Chat translation is LOCAL by default — zero cloud
    ├── User must EXPLICITLY opt-in to cloud translation fallback
    ├── If local engine is unavailable → show untranslated message + download prompt
    ├── NEVER silently fall back to cloud without user consent
    └── Privacy promise: "Your conversations are translated on YOUR device.
        We never see your messages. Not even the translations."

    ENGINE REQUIREMENTS (from Strand E):
    ├── NLLB-200-600M (1.2GB) — covers 200 languages, runs on any modern device
    ├── NLLB-200-1.3B (2.5GB) — better quality, needs 8GB+ RAM
    ├── OPUS-MT bilingual pairs (300MB each) — fastest for 2-language users
    └── CTranslate2 INT8 quantization for CPU efficiency

DEPENDENCIES: Strand E (translation engine), K1 (homeserver), K4 (media for voice messages),
              K5 (video calls for subtitles)
NOTE: THIS IS THE KILLER FEATURE. No other messaging app on Earth offers
      offline-first, on-device, automatic translation in group chats.
      This alone justifies the Windy Chat platform.
```

---

### K-DEP: Strand K Dependency Graph

```
DEPENDENCY GRAPH — RECOMMENDED BUILD ORDER:

Phase 1 — Foundation (Weeks 1-4):
├── K1: Deploy Synapse homeserver (everything depends on this)
├── K7.1: Install Olm/Megolm (E2EE is table stakes)
├── K2: Onboarding (phone verification, profile setup)
└── K6: Push notifications (users need alerts)

Phase 2 — Core Features (Weeks 5-8):
├── K3: Contact discovery (find people to chat with)
├── K4: Media sharing (photos, videos, voice messages)
├── K9.1-K9.3: Auto-translate + per-chat settings
└── K7.2-K7.4: Device verification + key backup

Phase 3 — Differentiators (Weeks 9-12):
├── K5.1-K5.2: 1:1 voice/video calls
├── K9.4: Translated voice messages
├── K8: Cloud backup and sync
└── K9.6: Group multi-language (THE HOLY GRAIL)

Phase 4 — Advanced (Weeks 13-16):
├── K5.3: Group video calls (requires SFU)
├── K5.4: Real-time translated subtitles in calls
├── K2.3: QR code desktop pairing
└── K3.3: Social media contact import

TOTAL ESTIMATED EFFORT:
├── Phase 1: ~160 hours (2 engineers × 4 weeks)
├── Phase 2: ~200 hours (2 engineers × 5 weeks)
├── Phase 3: ~160 hours (2 engineers × 4 weeks)
├── Phase 4: ~120 hours (2 engineers × 3 weeks)
└── TOTAL: ~640 hours (~16 engineer-weeks)

EXISTING CODE REUSE:
├── chat-client.js (852 lines) — solid auth, messaging, presence foundation
├── chat-translate.js (250 lines) — translation middleware, cache, WebSocket
├── chat-preload.js (65 lines) — IPC bridge pattern
├── chat.html/css (1600+ lines) — complete dark-theme chat UI
├── Strand E translation engine — CTranslate2, NLLB, OPUS-MT pipeline
├── Strand H sync infrastructure — R2 upload, offline queue, account server
└── Estimated reuse: ~40% of foundation code already exists
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
| 2026-02-27 | Grant + Kit 0C3 | Pricing update: $8.99/mo monthly option for Windy Translate |
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
| 2026-03-09 | Antigravity + Grant | **v1.6.0**: Added Strand I — Theme Packs & Widget Customization (I1-I7) |
| 2026-03-09 | Antigravity | I0: Three Laws of Strand I — complete isolation, per-hook customization, universal state colors |
| 2026-03-09 | Antigravity | I1: Widget Engine — 6 stock widgets, custom upload (PNG/GIF/SVG/WebP), voice-reactive animation |
| 2026-03-09 | Antigravity | I2: Effects Engine — SoundManager + VisualOverlay, pure observer pattern, isolated AudioContext |
| 2026-03-09 | Antigravity | I3: Theme Pack System — 27 stock packs across 7 categories, 3 selection modes (Silent/Single/Surprise Me) |
| 2026-03-09 | Antigravity | I4: Dynamic Scaling — length-based intensity tiers (spark/rumble/storm), variable reward randomization |
| 2026-03-09 | Antigravity | I5: Settings UI — pack browser, widget gallery, preview system, per-hook-point ON/OFF + volume |
| 2026-03-09 | Antigravity | I6: Community Hub — social activity feed, leaderboards, creator profiles, privacy-first design |
| 2026-03-09 | Antigravity | I7: Theme Marketplace — .windypack format, user-created packs, community rating, content moderation |
| 2026-03-09 | Antigravity | I-BUG: Identified broken start/stop beep — flagged for immediate fix |
| 2026-03-09 | Grant | Theme pack categories: Gamer (non-infringing names), Cultural (6 countries), Everyday (4 packs) |
| 2026-03-09 | Grant | New invariant #6: "Effects are always opt-in, never forced" |
| 2026-03-11 | Kit 0C3 Charlie | **v1.7.0**: Full reconciliation audit — DNA plan vs actual repo state |
| 2026-03-11 | Kit 0C3 Charlie | B4: COMPLETE REWRITE — removed stale PyInstaller strategy, documented actual architecture |
| 2026-03-11 | Kit 0C3 Charlie | B4: Added B4.0 Clean Slate (504 lines), B4.3.0 Bundled Assets (362 lines) |
| 2026-03-11 | Kit 0C3 Charlie | B4: Documented all 6 platform adapters (1,684 lines), download-manager.js (452 lines) |
| 2026-03-11 | Kit 0C3 Charlie | B4: Updated engine sizes from stale ONNX float32 to correct CTranslate2 INT8 |
| 2026-03-11 | Kit 0C3 Charlie | B4: All B4.1-B4.5 codons updated to ✅, B4.6 remains 🟡 (config exists, not E2E tested) |
| 2026-03-11 | Kit 0C3 Charlie | C1: Added 5 new web pages (Admin, Profile, Settings, Translate, Vault) — all ✅ |
| 2026-03-11 | Kit 0C3 Charlie | E1-E2: Updated statuses — translate-api service exists, conversation-mode.js built |
| 2026-03-11 | Kit 0C3 Charlie | I1-I2: Updated statuses — effects-engine.js (600 lines) ✅, mini-widget.js (181 lines) 🟡 |
| 2026-03-11 | Kit 0C3 Charlie | Added Strand J: 10 uncategorized desktop features, engine training pipeline, translate API |
| 2026-03-11 | Kit 0C3 Charlie | Updated phase timeline to reflect current state (installer stress testing in progress) |
| 2026-03-12 | Kit 0C3 Charlie + Grant Whitmer | **v2.0.0**: Added Strand K — Windy Chat Platform (The Chat Chromosome) |
| 2026-03-12 | Kit 0C3 Charlie | K0: Foundation — documented existing chat codebase (852+250+65+920+670 lines), all hardening fixes |
| 2026-03-12 | Kit 0C3 Charlie | K0.5: Market context — $96.2B messaging market, competitor analysis, offline-translated-encrypted differentiation |
| 2026-03-12 | Kit 0C3 Charlie | K1: Our Own Homeserver — Synapse deployment, custom registration, display name registry, avatar system |
| 2026-03-12 | Kit 0C3 Charlie | K2: WhatsApp-Style Onboarding — phone/email verification (Twilio/SendGrid), QR code desktop pairing |
| 2026-03-12 | Kit 0C3 Charlie | K3: Contact Discovery — phone hash-match directory (Signal-style), search, social media import |
| 2026-03-12 | Kit 0C3 Charlie | K4: Rich Media Sharing — photos, videos, voice messages, files via Matrix m.image/m.video/m.audio/m.file |
| 2026-03-12 | Kit 0C3 Charlie | K5: Video & Voice Calling — WebRTC (MSC2746), group calls (MSC3401/LiveKit), real-time translated subtitles |
| 2026-03-12 | Kit 0C3 Charlie | K6: Push Notifications — Matrix push gateway, FCM (Android), APNs (iOS), per-conversation mute |
| 2026-03-12 | Kit 0C3 Charlie | K7: E2E Encryption — Olm/Megolm production, device verification, key backup (SSSS), cross-signing |
| 2026-03-12 | Kit 0C3 Charlie | K8: Chat Cloud Backup — encrypted R2 backup, restore on new device, Soul File integration |
| 2026-03-12 | Kit 0C3 Charlie | K9: Translation Integration — auto-translate, voice message translation, video call subtitles, group multi-language |
| 2026-03-12 | Grant Whitmer | K9.6: Group multi-language — the Holy Grail: 5 people, 5 languages, everyone reads their own language |
| 2026-03-12 | Grant Whitmer | K9.7: Critical invariant — chat translation LOCAL by default, never fall back to cloud without consent |
| 2026-03-12 | Kit 0C3 Charlie | K-DEP: 4-phase build plan (16 engineer-weeks), 40% code reuse from existing foundation |

---

*This document is the single source of truth for Windy Pro development.*
*Any Kit can read this, understand the vision, and execute.*
*Update this document as codons are completed.*

**The Green Strobe Never Lies. Neither does this plan.**
