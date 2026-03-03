# Windy Pro v2.0 — Release Notes

## 🚀 What's New

Windy Pro v2.0 is a complete rebuild of the desktop application, adding premium translation features, video recording capabilities, a phone-as-camera bridge, and full cross-device sync. This release represents a production-ready platform for real-time speech translation, digital clone training, and multi-device workflow.

---

## ⭐ Premium Desktop Features

### Real-time Conversation Mode
Split-pane live interpreter desk — two people speak alternating in different languages. Left pane = Language A, Right pane = Language B. Each side has a press-and-hold mic button with live waveform visualization. Real-time transcription via Whisper + cross-pane translation.

### Document Translation
Drag-and-drop PDF, DOCX, TXT, MD, or HTML files. Text extraction via main process IPC. Chunked translation with live progress bar. Preserves formatting where possible.

### Batch Translation
Paste a CSV or list of phrases. Translate all to a target language. Export results as CSV. Integrated with Translation Memory for cached lookups.

### Translation Memory
SQLite-backed persistent cache with in-memory LRU (5000 entries). Hit tracking and confidence scoring. Memory browser UI with search, export, and clear. Automatically caches every translation for instant recall.

### Language Detection
Multi-stage detection engine: script-based identification for 14 non-Latin scripts (Arabic, Chinese, Japanese, Korean, Cyrillic, Thai, Devanagari, Hebrew, Georgian, Armenian, Bengali, Tamil, Telugu), plus word-frequency analysis for 16 Latin-script languages. Returns language code + confidence percentage.

### Voice Clone Manager
Record voice samples with waveform visualization and timer. Upload audio files (WAV, MP3, WebM, OGG, M4A). List clones with status badges. Preview, activate (star), delete. TTS speed/pitch sliders. Stored locally at `~/.config/windy-pro/voice-clones.json`.

### Hotkey Translate
System-wide Ctrl+Shift+T — select text anywhere on desktop, press hotkey, get instant translation in a floating mini-translate window.

---

## 🎬 Video Recording & Clone Training

### Video Recording with Webcam
- Camera dropdown: No Camera / Built-in Webcam / Phone Camera (linked)
- Live preview in a small overlay during recording
- Simultaneous video + audio capture via MediaRecorder (VP9 + Opus)
- Quality presets: 480p, 720p (recommended), 1080p
- Live transcription: chunks every 5 seconds during recording
- After recording: video playback with synced transcript subtitles
- Output: standardized clone training bundle (video + audio + transcript JSON)

### Phone-as-Camera (WebRTC Bridge)
- "Link Phone Camera" button generates QR code with session token
- Scan QR on phone to connect its camera as a desktop webcam
- WebRTC peer connection with STUN server support
- Switch phone front/back camera from desktop UI
- Connection quality indicator: latency, resolution, fps
- Manual code fallback for non-QR scenarios

### Clone Data Archive
- Browse all recording bundles: video thumbnails, transcript preview, duration, size
- Filter by: has video, audio-only, date range, synced from mobile
- Bulk select and export bundles for clone training
- Storage stats: total local storage, cloud storage, bundle count
- "Start Clone Training" button (validates minimum 3 training-ready bundles)

---

## 🔄 Auto-Sync & Offline Support

### Auto-Download from Cloud
- Polls `/api/v1/recordings/list` every 5 minutes for new bundles
- Automatically downloads bundles not present locally
- System tray notification: "3 new recordings synced from iPhone"
- Device tracking: shows all connected devices and their last sync time

### Offline Queue
- Desktop recordings queue for upload when network is unavailable
- Persistent queue (JSON file) survives app restarts
- Auto-retry when connection returns (max 5 retries per item)
- Network-aware: listens for online/offline browser events

### Sync Dashboard
- Connected devices list with last sync time and bundle count
- Pending uploads and downloads counters
- Force sync button for immediate check
- Retry failed uploads button

### Storage Management
- Total local storage used, cloud storage used
- Option to delete local copies of cloud-synced bundles to free space
- Per-bundle storage tracking

---

## 🔧 Backend API Additions

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/recordings/upload` | POST | Chunked multipart upload (500MB limit) |
| `/api/v1/recordings/:id/video` | GET | Video streaming with range request support |
| `/api/v1/recordings/list` | GET | List bundles since timestamp with device_id |
| `/api/v1/rtc/signal` | POST/GET | WebRTC signaling relay |
| `/api/v1/clone/training-data` | GET | List training-ready bundles |
| `/api/v1/clone/start-training` | POST | Queue clone training job |

---

## 📦 Bundle Format (Cross-Platform Standard)

```json
{
  "bundle_id": "uuid",
  "duration_seconds": 127,
  "audio": {"format": "opus", "file": "recording.webm"},
  "video": {"format": "vp9", "resolution": "1080p", "file": "recording.webm", "camera": "front"},
  "transcript": {
    "text": "...",
    "segments": [{"start": 0, "end": 2.5, "text": "...", "confidence": 0.97}]
  },
  "device": {"platform": "desktop", "app_version": "2.0"},
  "sync_status": "local",
  "clone_training_ready": true
}
```

---

## 🏗️ Architecture

- **Renderer Modules**: 11 JavaScript modules loaded via `index.html`
- **IPC Handlers**: 26+ handlers in `main.js` (SQLite, file I/O, API calls)
- **Preload Bridges**: 30+ API methods exposed via `window.windyAPI`
- **CSS**: 3 stylesheets (premium, video/clone, auto-sync)
- **Backend**: Express.js account server with SQLite, multer, JWT auth
- **Security**: CSP headers, path validation, input truncation, auth middleware

---

## 🧪 Test Coverage

- **170+ structural tests** covering all modules, IPC handlers, preload bridges, API routes, HTML/CSS integration, security checks, and bundle format compliance
- All tests passing

---

## 📋 Previous Phases (Included)

- Phase 1: Core desktop features (speech translation UI, system tray, hotkeys, auto-update)
- Phase 2: Web portal (dashboard, billing, admin, PWA)
- Phase 3: Security hardening (sandboxing, CSP, IPC validation)
- Phase 4: Docker, CI/CD, packaging (DMG, AppImage, DEB, NSIS)
