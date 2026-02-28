# 🌪️ WINDY PRO — COMPLETE DEPENDENCY MANIFEST
**Version:** 0.5.0
**Updated:** 27 Feb 2026 by Kit 0C3 Charlie
**Rule:** The installer bundles EVERYTHING. Users never chase a dependency. Period.

---

## 📦 SYSTEM PACKAGES (Linux .deb)
The installer must ensure these are present. Install via `apt-get` or bundle.

| Package | Purpose | Required? |
|---------|---------|-----------|
| `python3` (≥3.10) | Engine runtime | ✅ CRITICAL |
| `python3-venv` | Isolated Python environment | ✅ CRITICAL |
| `python3-pip` | Package manager | ✅ CRITICAL |
| `libportaudio2` | Audio I/O (sounddevice backend) | ✅ CRITICAL |
| `portaudio19-dev` | PortAudio development headers | ✅ CRITICAL |
| `ffmpeg` | Audio format conversion | ✅ CRITICAL |
| `xdotool` | Cursor injection (X11) | ✅ CRITICAL |
| `ydotool` | Cursor injection (Wayland) | ✅ CRITICAL |
| `xclip` | Clipboard operations (X11) | ✅ CRITICAL |
| `xsel` | Clipboard backup (X11) | 🟡 RECOMMENDED |
| `libasound2` | ALSA audio library | ✅ CRITICAL (usually pre-installed) |
| `libsndfile1` | Audio file reading | ✅ CRITICAL (usually pre-installed) |

### macOS Equivalents
| Package | Install Method |
|---------|---------------|
| Python 3 | Bundled via PyInstaller or Homebrew |
| PortAudio | `brew install portaudio` or bundled |
| FFmpeg | `brew install ffmpeg` or bundled |
| Accessibility | macOS permission prompt (no install) |

### Windows Equivalents
| Package | Install Method |
|---------|---------------|
| Python 3 | Bundled via PyInstaller |
| PortAudio | Bundled with sounddevice wheel |
| FFmpeg | Bundled in extraResources |
| PowerShell | Pre-installed on Windows 10/11 |

---

## 🐍 PYTHON PACKAGES (pip, inside venv)
All installed in isolated venv at `~/.windy-pro/venv/`

### Core Engine (REQUIRED)
| Package | Version | Size | Purpose |
|---------|---------|------|---------|
| `faster-whisper` | 1.2.1 | ~5 MB | Speech-to-text engine |
| `ctranslate2` | 4.7.1 | ~15 MB | Optimized inference runtime |
| `numpy` | 2.4.2 | ~20 MB | Numerical computation |
| `onnxruntime` | 1.24.2 | ~30 MB | ONNX model inference |
| `tokenizers` | 0.22.2 | ~5 MB | Text tokenization |
| `huggingface_hub` | 1.4.1 | ~2 MB | Model downloading |
| `sounddevice` | 0.5.5 | ~50 KB | Audio capture (Python-side) |
| `cffi` | 2.0.0 | ~500 KB | C FFI (sounddevice dependency) |
| `pycparser` | 3.0 | ~300 KB | C parser (cffi dependency) |
| `av` | 16.1.0 | ~20 MB | Audio/video processing |

### WebSocket Server (REQUIRED)
| Package | Version | Purpose |
|---------|---------|---------|
| `websockets` | 16.0 | WebSocket server for Electron↔Python |

### Cloud API (OPTIONAL — only for cloud mode)
| Package | Version | Purpose |
|---------|---------|---------|
| `fastapi` | 0.129.0 | REST API framework |
| `uvicorn` | 0.41.0 | ASGI server |
| `pydantic` | 2.12.5 | Data validation |
| `slowapi` | 0.1.9 | Rate limiting |
| `httpx` | 0.28.1 | HTTP client |

### Utilities
| Package | Version | Purpose |
|---------|---------|---------|
| `tqdm` | 4.67.3 | Progress bars (model download) |
| `PyYAML` | 6.0.3 | Config file parsing |
| `rich` | 14.3.3 | Pretty terminal output |
| `filelock` | 3.24.3 | Safe file locking |

### Full frozen list: `requirements.txt` (55 packages)

---

## ⚡ NODE.JS / ELECTRON (Desktop Client)
| Package | Version | Purpose |
|---------|---------|---------|
| `electron` | 28.3.3 | Desktop app framework |
| `electron-store` | 8.x | Settings persistence |
| `electron-updater` | 6.x | Auto-update support |
| `electron-builder` | 24.x | Packaging (dev only) |

---

## 🧠 WHISPER MODELS (Downloaded by Installer)
Downloaded from Hugging Face during installation, cached in `~/.cache/huggingface/`

| Engine Name (User-Facing) | Model ID | Size | For |
|---------------------------|----------|------|-----|
| Edge Spark | faster-whisper-tiny | 42 MB | Free tier |
| Edge Pulse | faster-whisper-base | 78 MB | Free tier |
| Edge Standard | faster-whisper-small | 168 MB | Plus tier |
| Edge Global | faster-whisper-medium (multilingual) | 515 MB | Pro tier |
| Edge Pro | faster-whisper-medium (en-only distilled) | 515 MB | Pro tier |
| Core Spark | faster-whisper-tiny (CUDA) | 75 MB | Free tier (GPU) |
| Core Pulse | faster-whisper-base (CUDA) | 142 MB | Plus tier (GPU) |
| Core Standard | faster-whisper-small (CUDA) | 466 MB | Plus tier (GPU) |
| Core Global | faster-whisper-large-v3 | 1.5 GB | Pro tier (GPU) |
| Core Pro | faster-whisper-large-v3 (en distilled) | 1.5 GB | Pro tier (GPU) |
| Core Turbo | faster-whisper-large-v3-turbo | 1.6 GB | Pro tier (GPU) |
| Core Ultra | faster-whisper-large-v3 | 2.9 GB | Pro Max tier (GPU) |
| Lingua Español | fine-tuned Spanish | 500 MB | Pro tier |
| Lingua Français | fine-tuned French | 500 MB | Pro tier |
| Lingua हिन्दी | fine-tuned Hindi | 500 MB | Pro tier |

---

## 🔧 INSTALLER CHECKLIST (What the wizard MUST do)

```
1. CHECK Python ≥ 3.10 installed
   ├── If missing: install via system package manager or bundled
   └── If wrong version: warn and offer to install

2. CREATE venv at ~/.windy-pro/venv/
   └── python3 -m venv ~/.windy-pro/venv

3. INSTALL Python packages
   └── ~/.windy-pro/venv/bin/pip install -r requirements.txt

4. CHECK system audio libraries
   ├── libportaudio2 (apt install libportaudio2)
   ├── ffmpeg (apt install ffmpeg)
   └── If missing: install automatically (needs sudo or prompt user)

5. CHECK cursor injection tools
   ├── X11: xdotool, xclip
   ├── Wayland: ydotool
   └── If missing: install automatically

6. DOWNLOAD Whisper model(s)
   ├── Based on hardware scan + user selection
   ├── Show progress bar with ETA
   └── Verify checksum after download

7. SET permissions
   ├── Microphone: test access, prompt if denied
   ├── Accessibility: guide user through OS settings
   └── File write: ensure ~/.windy-pro/ is writable

8. CONFIGURE
   ├── Write config to ~/.windy-pro/config.json
   ├── Register hotkeys
   └── Create desktop shortcut / start menu entry

9. VERIFY
   ├── Start Python server, confirm WebSocket responds
   ├── Start Electron, confirm it connects
   ├── Run 3-second audio capture test
   └── Display "✅ Everything works!" or specific error
```

---

## 📊 TOTAL INSTALL SIZE (by tier)

| Tier | Python + Deps | Model(s) | Electron | Total |
|------|--------------|----------|----------|-------|
| Free (Edge Spark) | ~100 MB | 42 MB | ~150 MB | ~292 MB |
| Free (Edge Pulse) | ~100 MB | 78 MB | ~150 MB | ~328 MB |
| Plus (Edge Standard) | ~100 MB | 168 MB | ~150 MB | ~418 MB |
| Pro (Edge Global) | ~100 MB | 515 MB | ~150 MB | ~765 MB |
| Pro Max (Core Ultra) | ~100 MB | 2.9 GB | ~150 MB | ~3.15 GB |

---

*This manifest is the single source of truth for what Windy Pro needs to run.*
*Every dependency listed here MUST be handled by the installer.*
*If it's not in this list, we don't need it. If we need it, it's in this list.*
