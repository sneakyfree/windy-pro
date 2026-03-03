# Windy Pro — System Architecture

## High-Level Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         WINDY PRO ECOSYSTEM                            │
│                                                                         │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────────┐  │
│  │  Desktop App  │    │  Mobile App  │    │    Web Portal             │  │
│  │  (Electron)   │    │  (React      │    │   (React + Vite)         │  │
│  │               │    │   Native)    │    │   windypro.              │  │
│  │  • Speech UI  │    │  • Android   │    │   thewindstorm.uk        │  │
│  │  • Video Rec  │    │  • iOS       │    │                          │  │
│  │  • WebRTC     │    │  • Recording │    │  • Dashboard             │  │
│  │  • Clone Mgr  │    │  • Offline   │    │  • Admin Panel           │  │
│  │  • Auto-Sync  │    │  • Wi-Fi     │    │  • Billing               │  │
│  │  • Trans Mem  │    │    Sync      │    │  • Translate              │  │
│  └──────┬───────┘    └──────┬───────┘    └───────────┬──────────────┘  │
│         │                    │                        │                  │
│         │         ┌──────────┴────────────┐          │                  │
│         │         │    WebRTC Signaling    │          │                  │
│         │         │   POST/GET /rtc/signal │          │                  │
│         │         └──────────┬────────────┘          │                  │
│         │                    │                        │                  │
│         └────────────────────┼────────────────────────┘                  │
│                              │                                           │
│                    ┌─────────▼──────────┐                               │
│                    │   Nginx Reverse    │                                │
│                    │   Proxy (443/80)   │                                │
│                    └────┬─────────┬─────┘                               │
│                         │         │                                      │
│              ┌──────────▼──┐  ┌───▼────────────────┐                    │
│              │  Vite Dev   │  │   Account Server   │                    │
│              │  Server     │  │   (Express.js)     │                    │
│              │  :5173      │  │   :8098             │                    │
│              │             │  │                     │                    │
│              │  • React    │  │  • Auth / JWT       │                    │
│              │  • SPA      │  │  • Translate API    │                    │
│              │  • Proxy    │  │  • Device Mgmt      │                    │
│              │    → :8098  │  │  • Recording Store  │                    │
│              └─────────────┘  │  • Billing/Stripe   │                    │
│                               │  • Admin Panel      │                    │
│                               │  • RTC Signaling    │                    │
│                               │  • Clone Training   │                    │
│                               └────────┬────────────┘                    │
│                                        │                                 │
│                              ┌─────────▼──────────┐                     │
│                              │     SQLite DB      │                      │
│                              │   accounts.db      │                      │
│                              │                    │                      │
│                              │  • users           │                      │
│                              │  • devices         │                      │
│                              │  • translations    │                      │
│                              │  • recordings      │                      │
│                              └────────────────────┘                      │
│                                                                          │
│              ┌──────────────────────────────────────┐                    │
│              │  Python Transcription Backend        │                    │
│              │  (FastAPI + Uvicorn) :9123            │                    │
│              │                                      │                    │
│              │  • POST /transcribe (Whisper STT)    │                    │
│              │  • POST /detect-language              │                    │
│              │  • GET /health                       │                    │
│              └──────────────────────────────────────┘                    │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow: Recording → Sync → Clone Training

```
┌────────────────────────────────────────────────────────────────────┐
│                     RECORDING PIPELINE                             │
│                                                                    │
│  1. CAPTURE                                                        │
│  ┌─────────┐     ┌──────────────┐     ┌─────────────┐            │
│  │ Camera  │────▶│ MediaRecorder│────▶│ WebM Blob   │            │
│  │ + Mic   │     │ (VP9+Opus)   │     │ (video+audio)│            │
│  └─────────┘     └──────────────┘     └──────┬──────┘            │
│                                               │                    │
│  2. TRANSCRIPTION                             │                    │
│  ┌──────────────┐     ┌──────────────┐       │                    │
│  │ Audio Stream │────▶│ Whisper STT  │       │                    │
│  │ (5s chunks)  │     │ (via IPC)    │       │                    │
│  └──────────────┘     └──────┬───────┘       │                    │
│                               │               │                    │
│  3. BUNDLE                    │               │                    │
│  ┌────────────────────────────▼───────────────▼──────────────┐    │
│  │                    Clone Training Bundle                   │    │
│  │  {                                                        │    │
│  │    bundle_id: "uuid",                                     │    │
│  │    audio: { format: "opus", file: "rec.webm" },           │    │
│  │    video: { format: "vp9", resolution: "1080p" },         │    │
│  │    transcript: { text: "...", segments: [...] },           │    │
│  │    device: { platform: "desktop", app_version: "2.0" },   │    │
│  │    clone_training_ready: true                              │    │
│  │  }                                                        │    │
│  └─────────────────────────┬─────────────────────────────────┘    │
│                             │                                      │
│  4. LOCAL SAVE              │                                      │
│  ┌──────────────────────────▼───────────────────────────────┐     │
│  │  ~/.config/windy-pro/clone-bundles/                       │     │
│  │  ├── <uuid>.webm              (media file)                │     │
│  │  └── clone-bundles.json       (manifest)                  │     │
│  └──────────────────────────┬───────────────────────────────┘     │
│                             │                                      │
│  5. SYNC TO CLOUD           │                                      │
│  ┌──────────────────────────▼───────────────────────────────┐     │
│  │  POST /api/v1/recordings/upload                           │     │
│  │  ┌─ multipart/form-data ─────────────────────────────┐   │     │
│  │  │  media: <binary>                                   │   │     │
│  │  │  bundle_id, duration, has_video, transcript,       │   │     │
│  │  │  device_platform, clone_training_ready             │   │     │
│  │  └───────────────────────────────────────────────────┘   │     │
│  └──────────────────────────┬───────────────────────────────┘     │
│                             │                                      │
│  6. AUTO-SYNC               │                                      │
│  ┌──────────────────────────▼───────────────────────────────┐     │
│  │  Desktop polls GET /api/v1/recordings/list?since=TS       │     │
│  │  → Downloads new bundles from other devices               │     │
│  │  → Shows tray notification                                │     │
│  │  → Saves to local archive                                 │     │
│  └──────────────────────────┬───────────────────────────────┘     │
│                             │                                      │
│  7. CLONE TRAINING          │                                      │
│  ┌──────────────────────────▼───────────────────────────────┐     │
│  │  POST /api/v1/clone/start-training                        │     │
│  │  { bundle_ids: ["uuid1", "uuid2", "uuid3"] }             │     │
│  │  → Validates ≥3 training-ready bundles                    │     │
│  │  → Queues training job                                    │     │
│  │  → Returns job ID + estimated time                        │     │
│  └──────────────────────────────────────────────────────────┘     │
└────────────────────────────────────────────────────────────────────┘
```

---

## Component Responsibilities

| Component | Technology | Port | Responsibility |
|-----------|-----------|------|----------------|
| **Desktop App** | Electron + Node.js | — | Main process, IPC, system tray, auto-update |
| **Renderer** | Vanilla JS + CSS | — | 11 UI modules, real-time recording, WebRTC |
| **Account Server** | Express.js + SQLite | 8098 | Auth, translation, recordings, admin, billing |
| **Web Frontend** | React + Vite | 5173 | SPA dashboard, admin, translate, billing |
| **Transcription** | Python FastAPI | 9123 | Whisper STT, language detection |
| **Nginx** | Reverse proxy | 80/443 | SSL termination, routing, WebSocket |
| **SQLite** | Database | — | Users, devices, translations, recordings |

---

## IPC Architecture (Desktop)

```
  Renderer Process (11 modules)
         │
         │  window.windyAPI.translateOffline(...)
         │  window.windyAPI.saveCloneBundle(...)
         │  window.windyAPI.fetchRemoteBundles(...)
         │
    ┌────▼────┐
    │ Preload │  contextBridge.exposeInMainWorld
    │   .js   │  30+ API bridges
    └────┬────┘
         │
         │  ipcRenderer.invoke('channel', data)
         │
    ┌────▼────┐
    │  Main   │  63 ipcMain.handle() handlers
    │  .js    │  SQLite, file I/O, HTTP calls
    └────┬────┘
         │
         ├──▶ Local SQLite (translation memory)
         ├──▶ File system (bundles, voice clones)
         └──▶ Account Server HTTP API
```

---

## Security Architecture

```
┌─ Client Layer ───────────────────────────────────────────┐
│  • Input truncation (500 chars max on IPC)               │
│  • Content-Security-Policy (script-src 'self')           │
│  • Context isolation (nodeIntegration: false)             │
│  • Sandbox enabled                                       │
└──────────────────────────────────────────────────────────┘
         │
┌─ Transport Layer ────────────────────────────────────────┐
│  • HTTPS/TLS via nginx                                   │
│  • JWT tokens (24h expiry)                               │
│  • Rate limiting (100 req/15min)                         │
└──────────────────────────────────────────────────────────┘
         │
┌─ Server Layer ───────────────────────────────────────────┐
│  • bcrypt password hashing (12 rounds)                   │
│  • Path traversal validation (5 checks)                  │
│  • Auth middleware on 21 endpoints                       │
│  • Admin role gating                                     │
│  • Parameterized SQL queries                             │
└──────────────────────────────────────────────────────────┘
```
