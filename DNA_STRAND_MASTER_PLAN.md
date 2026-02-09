# 🧬 WINDY PRO — DNA STRAND MASTER PLAN

**Version:** 1.1.0
**Created:** 2026-02-04
**Last Updated:** 2026-02-05
**Authors:** Kit 0 + Kit-0C1Veron + Grant Whitmer
**Philosophy:** Begin with the end in mind. — Stephen R. Covey

---

## 🚨 CRITICAL PATH TO MVP

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    WHAT BLOCKS WHAT (Dependency Graph)                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ✅ A1 (Transcriber) ──┬──> ✅ A3 (Server) ──> 🔴 B2.6 (Audio Stream)   │
│  ✅ A2 (Audio Capture) ─┘                            │                   │
│                                                      ▼                   │
│                                            🔲 B3 (Cursor Injection)      │
│                                                      │                   │
│                                                      ▼                   │
│                                            🔲 B4 (TurboTax Installer)    │
│                                                      │                   │
│                                                      ▼                   │
│                                               🎯 MVP LAUNCH              │
│                                                                          │
│  Legend: ✅ Done | 🔴 Critical Blocker | 🔲 Not Started | 🎯 Goal       │
└─────────────────────────────────────────────────────────────────────────┘
```

### 🔴 CRITICAL BLOCKER IDENTIFIED

**B2.6: Electron Audio Streaming** — The Electron renderer currently does NOT capture audio and stream it to the Python server. The Python `demo.py` works standalone, but the Electron ↔ Python integration is incomplete.

**This must be fixed before anything else works end-to-end.**

---

## 🎯 THE END STATE (What We're Building Toward)

### The Vision in One Sentence
**Windy Pro is a push-button, TurboTax-simple voice-to-text platform that provides unlimited, real-time transcription with absolute confidence that it's recording — local-first for power users, cloud-backed for everyone else.**

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

#### A4: Cloud API Server
```
FILE: src/api/main.py
STATUS: 🔲 NOT STARTED (Phase 2)
PRIORITY: LOW (after MVP)

CODONS:
├── A4.1 FastAPI Application
│   ├── /health — health check
│   ├── /ws/transcribe — WebSocket endpoint
│   ├── /api/auth/register — user registration
│   ├── /api/auth/login — JWT tokens
│   └── /api/vault — prompt history CRUD
│
├── A4.2 Authentication
│   ├── JWT tokens (access + refresh)
│   ├── API key for CLI/automated use
│   └── Rate limiting per user
│
├── A4.3 Audio Handling
│   ├── Opus decoding (from client)
│   ├── Queue management (multiple clients)
│   └── Concurrency limiting (3-5 per KVM4)
│
└── A4.4 Prompt Vault
    ├── PostgreSQL storage
    ├── User-scoped transcripts
    ├── Search by date/keyword
    └── Export to TXT/MD
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

#### B2: Renderer UI ✅ (with critical gap)
```
FILES: src/client/desktop/renderer/
STATUS: 🟡 MOSTLY COMPLETE (Missing B2.6)
TESTED: Manually (UI works, but no audio)

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
│   └── Full UI styling ✅ (320 lines)
│
├── B2.3 app.js - WindyApp class ✅
│   ├── WebSocket connection ✅
│   ├── State management ✅
│   ├── Transcript display ✅
│   ├── Button handlers ✅
│   └── IPC event handlers ✅
│
├── B2.4 Component: TranscriptView ✅
│   ├── Auto-scroll to bottom ✅
│   ├── Partial text styling (italics) ✅
│   └── Timestamp per segment ✅
│
├── B2.5 Component: ControlBar ✅
│   ├── Start/Stop button ✅
│   ├── Clear button ✅
│   ├── Copy button ✅
│   └── Paste button ✅
│
└── B2.6 Audio Capture & Streaming 🔴 CRITICAL GAP
    │
    │  ⚠️ THE ELECTRON RENDERER DOES NOT CAPTURE AUDIO!
    │  
    │  Current state:
    │  - WebSocket connects to Python server ✅
    │  - Commands (start/stop) are sent ✅
    │  - Transcripts are received ✅
    │  - BUT NO AUDIO IS EVER SENT! ❌
    │
    │  What's needed:
    ├── B2.6.1 navigator.mediaDevices.getUserMedia() 🔲
    ├── B2.6.2 AudioContext + ScriptProcessorNode (or AudioWorklet) 🔲
    ├── B2.6.3 Downsample to 16kHz mono 🔲
    ├── B2.6.4 Convert to Int16 PCM bytes 🔲
    ├── B2.6.5 Stream via WebSocket as binary 🔲
    └── B2.6.6 Audio level meter for UI feedback 🔲
    
    IMPLEMENTATION PLAN:
    ┌────────────────────────────────────────────────────────────────┐
    │  // In app.js, add to startRecording():                        │
    │                                                                │
    │  async startAudioCapture() {                                   │
    │    const stream = await navigator.mediaDevices.getUserMedia({  │
    │      audio: {                                                  │
    │        channelCount: 1,                                        │
    │        sampleRate: 16000,  // Whisper expects 16kHz            │
    │        echoCancellation: true,                                 │
    │        noiseSuppression: true                                  │
    │      }                                                         │
    │    });                                                         │
    │                                                                │
    │    const audioContext = new AudioContext({ sampleRate: 16000 });│
    │    const source = audioContext.createMediaStreamSource(stream); │
    │    const processor = audioContext.createScriptProcessor(4096); │
    │                                                                │
    │    processor.onaudioprocess = (e) => {                         │
    │      const float32 = e.inputBuffer.getChannelData(0);          │
    │      const int16 = this.float32ToInt16(float32);               │
    │      if (this.ws.readyState === WebSocket.OPEN) {              │
    │        this.ws.send(int16.buffer);  // Binary!                 │
    │      }                                                         │
    │    };                                                          │
    │                                                                │
    │    source.connect(processor);                                  │
    │    processor.connect(audioContext.destination);                │
    │  }                                                             │
    │                                                                │
    │  float32ToInt16(float32Array) {                                │
    │    const int16 = new Int16Array(float32Array.length);          │
    │    for (let i = 0; i < float32Array.length; i++) {             │
    │      int16[i] = Math.max(-32768,                               │
    │                 Math.min(32767, float32Array[i] * 32768));     │
    │    }                                                           │
    │    return int16;                                               │
    │  }                                                             │
    └────────────────────────────────────────────────────────────────┘
```

#### B3: Cursor Injection
```
FILE: src/client/desktop/injection/ (to be created)
STATUS: 🔲 NOT STARTED (Phase 1.3)
PRIORITY: HIGH (required for MVP)
BLOCKED BY: B2.6

CODONS:
├── B3.1 Windows Implementation 🔲
│   │
│   │  APPROACH: Use robotjs or @nut-tree/nut-js
│   │
│   │  Option A: robotjs (simpler, but binary deps)
│   │  ├── npm install robotjs
│   │  └── robot.keyTap('v', ['control'])
│   │
│   │  Option B: @nut-tree/nut-js (newer, actively maintained)
│   │  ├── npm install @nut-tree/nut-js
│   │  └── keyboard.type(Key.LeftControl, Key.V)
│   │
│   │  Option C: Native node addon (most reliable)
│   │  ├── Use node-ffi-napi to call SendInput
│   │  └── Most complex but most reliable
│   │
│   ├── B3.1.1 Install dependency 🔲
│   ├── B3.1.2 Copy text to clipboard 🔲
│   ├── B3.1.3 Simulate Ctrl+V 🔲
│   ├── B3.1.4 Handle focus (restore previous window) 🔲
│   └── B3.1.5 Test with Notepad, VS Code, Chrome 🔲
│
├── B3.2 macOS Implementation 🔲
│   │
│   │  APPROACH: Use robotjs or AppleScript via osascript
│   │
│   │  Option A: robotjs
│   │  └── robot.keyTap('v', ['command'])
│   │
│   │  Option B: AppleScript (no deps)
│   │  ├── exec('osascript -e "tell app \\"System Events\\" to keystroke \\"v\\" using command down"')
│   │  └── Requires Accessibility permission
│   │
│   ├── B3.2.1 Accessibility permission request 🔲
│   │   └── Show dialog if not granted
│   ├── B3.2.2 Copy text to clipboard 🔲
│   ├── B3.2.3 Simulate Cmd+V 🔲
│   └── B3.2.4 Test with TextEdit, VS Code, Chrome 🔲
│
├── B3.3 Linux Implementation 🔲
│   │
│   │  APPROACH: xdotool (X11) or ydotool (Wayland)
│   │
│   │  X11:
│   │  └── exec('xdotool key ctrl+v')
│   │
│   │  Wayland:
│   │  └── exec('ydotool key ctrl+v')
│   │
│   ├── B3.3.1 Detect X11 vs Wayland 🔲
│   ├── B3.3.2 Install xdotool/ydotool if missing 🔲
│   ├── B3.3.3 Copy text to clipboard 🔲
│   └── B3.3.4 Simulate Ctrl+V 🔲
│
└── B3.4 Injection Flow 🔲
    │
    │  SEQUENCE:
    │  1. User triggers paste (hotkey Ctrl+Shift+V or button)
    │  2. Get current transcript from WindyApp
    │  3. Copy to system clipboard
    │  4. Flash INJECTING state (blue)
    │  5. Simulate Ctrl+V / Cmd+V
    │  6. Return to previous state (IDLE or LISTENING)
    │
    ├── B3.4.1 Implement in main.js IPC handler 🔲
    ├── B3.4.2 Add platform detection 🔲
    └── B3.4.3 Add error handling (permission denied, etc.) 🔲

RECOMMENDED LIBRARY: @nut-tree/nut-js
├── Cross-platform (Win/Mac/Linux)
├── Actively maintained (2024+)
├── TypeScript support
├── Works with Electron
└── npm install @nut-tree/nut-js
```

#### B4: TurboTax Installer
```
FILE: installer/
STATUS: 🔲 NOT STARTED (Phase 1.4)
PRIORITY: HIGH (required for MVP)
BLOCKED BY: B3

CODONS:
├── B4.1 Hardware Detection 🔲
│   │
│   │  MODULE: installer/hardware-detect.js
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
├── B4.2 Model Selection Logic 🔲
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
├── B4.3 Dependency Installation 🔲
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
├── B4.5 Installer UI 🔲
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
│   ├── Screen 3: Model Recommendation 🔲
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

#### C1: Progressive Web App
```
FILE: src/client/web/
STATUS: 🔲 NOT STARTED (Phase 3)
PRIORITY: LOW (post-MVP)

[Unchanged from v1.0 - deferred to Phase 3]
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

WEEK 2 (CURRENT — Kit-0C1Veron):
├── [ ] 🔴 B2.6: Electron Audio Streaming ← CRITICAL BLOCKER
│       ├── Implement navigator.mediaDevices.getUserMedia()
│       ├── AudioContext + ScriptProcessorNode
│       ├── Float32 → Int16 conversion
│       └── WebSocket binary streaming
│
├── [ ] End-to-end test: Electron → Python → Transcript
└── [ ] Fix any latency/buffer issues

WEEK 3:
├── [ ] B3.1: Windows Cursor Injection
├── [ ] B3.2: macOS Cursor Injection
├── [ ] B3.3: Linux Cursor Injection
└── [ ] B3.4: Injection flow integration

WEEK 4:
├── [ ] B4.1-B4.2: Hardware Detection + Model Selection
├── [ ] B4.3: Dependency Bundling (PyInstaller)
├── [ ] B4.4-B4.5: Permissions + Installer UI
├── [ ] B4.6: Packaging (NSIS, DMG, AppImage)
└── [ ] MVP COMPLETE 🎯
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

## 🔬 GAP ANALYSIS — 2026-02-05

Performed by Kit-0C1Veron after full repo audit.

### Strand A (Engine)
| Codon | Status | Gap | Action Required |
|-------|--------|-----|-----------------|
| A1.1-A1.5 | ✅ | None | — |
| A2.1-A2.4 | ✅ | None | — |
| A3.1-A3.3 | ✅ | None | — |
| A4.* | 🔲 | Not started | Phase 2 |

### Strand B (Desktop)
| Codon | Status | Gap | Action Required |
|-------|--------|-----|-----------------|
| B1.1-B1.5 | ✅ | None | — |
| B2.1-B2.5 | ✅ | None | — |
| **B2.6** | 🔴 | **CRITICAL: No audio streaming** | **Implement NOW** |
| B3.1-B3.4 | 🔲 | Not started | Week 3 |
| B4.1-B4.6 | 🔲 | Not started | Week 4 |

### Strand C (Web)
| Codon | Status | Gap | Action Required |
|-------|--------|-----|-----------------|
| C1.* | 🔲 | Not started | Phase 3 |

### Strand D (Infrastructure)
| Codon | Status | Gap | Action Required |
|-------|--------|-----|-----------------|
| D1.* | 🔲 | Not started | Phase 2 |
| D2.* | 🔲 | Not started | Before launch |

### Priority Actions (Immediate)
1. **B2.6: Implement Electron audio streaming** ← BLOCKS EVERYTHING
2. **Test end-to-end flow** (Electron → Python → Transcript)
3. **B3: Cursor injection** (can start in parallel once B2.6 works)

---

## 🚨 KNOWN ISSUES & TECHNICAL DEBT

### Issue #1: Audio Not Streaming from Electron
- **Severity:** CRITICAL
- **Location:** src/client/desktop/renderer/app.js
- **Problem:** `startRecording()` sends `{"action": "start"}` but never streams audio bytes
- **Fix:** Implement B2.6 codons

### Issue #2: Missing electron-store Dependency
- **Severity:** LOW
- **Location:** src/client/desktop/main.js
- **Problem:** `require('electron-store')` but not in package.json dependencies
- **Fix:** `npm install electron-store` (already in package.json, just need npm install)

### Issue #3: Tray Icon Placeholder
- **Severity:** LOW
- **Location:** src/client/desktop/main.js line ~100
- **Problem:** `createTrayIcon()` returns empty native image
- **Fix:** Add actual icon files to assets/

### Issue #4: canvas Dependency Not Installed
- **Severity:** LOW
- **Location:** src/client/desktop/main.js line ~108
- **Problem:** `require('canvas')` will fail — canvas not in deps
- **Fix:** Remove canvas requirement, use pre-made icon files instead

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

---

*This document is the single source of truth for Windy Pro development.*
*Any Kit can read this, understand the vision, and execute.*
*Update this document as codons are completed.*

**The Green Strobe Never Lies. Neither does this plan.**
