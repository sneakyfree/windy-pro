# Windy Pro

[![Build Status](https://img.shields.io/github/actions/workflow/status/sneakyfree/windy-pro/ci.yml?branch=main&style=flat-square)](https://github.com/sneakyfree/windy-pro/actions)
[![Version](https://img.shields.io/badge/version-2.0.0-blue?style=flat-square)](RELEASE_NOTES.md)
[![Tests](https://img.shields.io/badge/tests-170%2B%20passing-brightgreen?style=flat-square)](tests/)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Desktop%20%7C%20Web%20%7C%20Mobile-purple?style=flat-square)](#)

> Voice to text, unlimited. No subscriptions, no time limits.

Real-time speech transcription, translation, and digital clone training for desktop, web, and mobile. Powered by Whisper (local) and Deepgram (cloud).

---

## Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                         Windy Pro Platform                             │
├──────────────────┬──────────────────┬──────────────────────────────────┤
│   Desktop App    │    Web Portal    │       Mobile App                 │
│   (Electron)     │   (React/Vite)   │   (React Native/Expo)           │
│                  │                  │                                  │
│  • Speech UI     │  • Dashboard     │  • iOS + Android                │
│  • Video Rec     │  • Translate     │  • Speech translation           │
│  • WebRTC Cam    │  • Admin panel   │  • Voice clone                  │
│  • Clone Mgr     │  • Settings      │  • Offline packs                │
│  • Auto-Sync     │  • PWA support   │  • Push notifications           │
│  • Trans Memory  │  • Billing       │  • Wi-Fi Sync                   │
└────────┬─────────┴────────┬─────────┴────────────┬────────────────────┘
         │                  │                      │
         └──────────────────┼──────────────────────┘
                            │
              ┌─────────────┴─────────────┐
              │      Account Server       │
              │  (Node.js + SQLite)       │
              │                           │
              │  • Auth (JWT + refresh)   │
              │  • Recording storage      │
              │  • Translation history    │
              │  • WebRTC signaling       │
              │  • Clone training         │
              │  • Stripe billing         │
              └─────────┬─────────────────┘
                        │
         ┌──────────────┼──────────────┐
         │              │              │
  ┌──────┴──────┐ ┌─────┴─────┐ ┌─────┴──────┐
  │ Transcribe  │ │ Translate │ │  Storage   │
  │ (Whisper)   │ │ (NLLB)    │ │  (SQLite)  │
  │  Port 9123  │ │ Port 8099 │ │            │
  └─────────────┘ └───────────┘ └────────────┘
```

> See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for detailed diagrams.

---

## Features

| Feature | Desktop | Web | Mobile |
|---------|---------|-----|--------|
| Real-time transcription | ✅ | ✅ | ✅ |
| Speech-to-speech translation | ✅ | ✅ | ✅ |
| Text translation (200+ languages) | ✅ | ✅ | ✅ |
| Offline transcription (Whisper) | ✅ | ❌ | ✅ |
| Video recording + clone training | ✅ | ❌ | ✅ |
| Phone-as-Camera (WebRTC) | ✅ | ❌ | ✅ |
| Auto-Sync (cross-device) | ✅ | ❌ | ✅ |
| Translation Memory (SQLite) | ✅ | ❌ | ❌ |
| Real-time Conversation Mode | ✅ | ❌ | ✅ |
| Document Translation (PDF/DOCX) | ✅ | ❌ | ❌ |
| Batch Translation (CSV) | ✅ | ❌ | ❌ |
| Language Detection (50+ langs) | ✅ | ❌ | ❌ |
| Voice Clone Manager | ✅ | ❌ | ✅ |
| System tray + global hotkeys | ✅ | ❌ | ❌ |
| Auto-paste to active window | ✅ | ❌ | ❌ |
| Admin dashboard | ❌ | ✅ | ❌ |
| PWA (install as app) | ❌ | ✅ | ❌ |
| Push notifications | ❌ | ❌ | ✅ |
| Stripe billing | ❌ | ✅ | ✅ |

---

## Screenshots

> _Screenshots are captured from the desktop app v2.0_

| Screenshot | Description |
|------------|-------------|
| `screenshots/translate-ui.png` | Main speech translation screen with waveform |
| `screenshots/conversation-mode.png` | Split-pane live interpreter mode |
| `screenshots/video-recording.png` | Video recording with camera preview |
| `screenshots/clone-archive.png` | Clone data archive with bundle browser |
| `screenshots/sync-dashboard.png` | Auto-sync dashboard showing devices |
| `screenshots/translation-memory.png` | Translation memory browser |
| `screenshots/phone-camera.png` | Phone-as-Camera QR code linking |
| `screenshots/system-tray.png` | System tray menu |

---

## Quick Start

### Prerequisites

- **Node.js** 20+ and **npm**
- **Python** 3.10+ with **pip**
- **FFmpeg** (for audio processing)

### Desktop App (Development)

```bash
# Clone and install
git clone https://github.com/sneakyfree/windy-pro.git
cd windy-pro
npm install
pip install -r requirements.txt

# Copy and configure environment
cp .env.example .env

# Start the Python transcription backend
python -m src.engine.server &

# Start the Electron app
npm start
```

### Web Portal (Development)

```bash
# Start the account server
cd account-server && npm install && node server.js &

# Start the web frontend
cd src/client/web && npm install && npm run dev
# Open http://localhost:5173
```

### Docker (Production)

```bash
# Copy and configure environment
cp .env.example .env
# Edit .env with your secrets

# Build and start all services
cd deploy
docker compose up -d --build

# Services:
#   Web:           http://localhost:5173
#   Account API:   http://localhost:8098
#   Transcription: http://localhost:9123
```

> See [DEPLOYMENT.md](DEPLOYMENT.md) for full production setup with nginx + SSL.

---

## Building Desktop Installers

```bash
# All platforms
npm run dist:all

# Individual platforms
npm run build:linux    # → dist/*.AppImage, dist/*.deb
npm run build:mac      # → dist/*.dmg
npm run build:win      # → dist/*.exe (NSIS)
```

Auto-update is configured via GitHub Releases:

```bash
git tag v2.0.0
git push --tags
```

---

## Documentation

| Document | Description |
|----------|-------------|
| [docs/API.md](docs/API.md) | Full REST API reference (26 endpoints, curl examples) |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture diagrams |
| [docs/MOBILE-SYNC-PROTOCOL.md](docs/MOBILE-SYNC-PROTOCOL.md) | Sync protocol, bundle format, retry strategy |
| [docs/WEBRTC-BRIDGE.md](docs/WEBRTC-BRIDGE.md) | Phone-as-Camera WebRTC protocol |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Docker, nginx, SSL deployment guide |
| [RELEASE_NOTES.md](RELEASE_NOTES.md) | v2.0 feature list |
| [.env.example](.env.example) | Environment variables reference |

### Postman Collection

Import `docs/windy-pro-api.postman_collection.json` into Postman to test all 26 API endpoints immediately.

---

## API Reference

### Account Server (`localhost:8098`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/health` | ❌ | Health check |
| POST | `/api/v1/auth/register` | ❌ | Create account |
| POST | `/api/v1/auth/login` | ❌ | Login → JWT |
| POST | `/api/v1/auth/refresh` | 🔄 | Refresh token |
| GET | `/api/v1/auth/me` | ✅ | Current user |
| GET | `/api/v1/auth/devices` | ✅ | List devices |
| POST | `/api/v1/auth/devices/register` | ✅ | Register device |
| POST | `/api/v1/auth/devices/remove` | ✅ | Remove device |
| POST | `/api/v1/auth/change-password` | ✅ | Change password |
| GET | `/api/v1/auth/billing` | ✅ | Billing info |
| POST | `/api/v1/translate/text` | ✅ | Text translation |
| POST | `/api/v1/translate/speech` | ✅ | Speech translation |
| GET | `/api/v1/translate/languages` | ✅ | Supported languages |
| GET | `/api/v1/user/history` | ✅ | Translation history |
| POST | `/api/v1/user/favorites` | ✅ | Toggle favorite |
| POST | `/api/v1/recordings/upload` | ✅ | Upload recording (500MB) |
| GET | `/api/v1/recordings/:id/video` | ✅ | Stream video |
| GET | `/api/v1/recordings/list` | ✅ | List recordings (sync) |
| POST/GET | `/api/v1/rtc/signal` | ❌ | WebRTC signaling |
| GET | `/api/v1/clone/training-data` | ✅ | Training-ready bundles |
| POST | `/api/v1/clone/start-training` | ✅ | Start training job |
| GET | `/api/v1/admin/users` | 🔐 | User management |
| GET | `/api/v1/admin/stats` | 🔐 | System stats |
| GET | `/api/v1/admin/revenue` | 🔐 | Revenue dashboard |

Auth: ✅ = JWT required, 🔐 = Admin role required, 🔄 = Refresh token

> Full curl examples: [docs/API.md](docs/API.md)

---

## Environment Variables

See [`.env.example`](.env.example) for all variables with descriptions. Key variables:

| Variable | Description |
|----------|-------------|
| `JWT_SECRET` | JWT signing secret (min 32 chars) |
| `STRIPE_SECRET_KEY` | Stripe API key |
| `DEEPGRAM_API_KEY` | Deepgram STT key |
| `GROQ_API_KEY` | Groq inference key |
| `OPENAI_API_KEY` | OpenAI fallback key |
| `DATABASE_PATH` | SQLite database path |

---

## Security

- **Electron**: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`
- **CSP**: Strict Content Security Policy on all windows
- **IPC**: Path traversal guards (5 checks), input validation, truncation
- **Auth**: bcrypt (12 rounds), JWT tokens, device limits (5 max)
- **Admin**: Role-based access control on admin endpoints
- **Navigation**: `will-navigate` blocks non-local origins
- **Permissions**: Whitelist-only (media, clipboard)

---

## Testing

```bash
# Run full structural test suite (170+ tests)
python3 tests/test_final_qa.py

# Run premium feature tests
python3 tests/test_premium_features.py

# Run video/clone feature tests
python3 tests/test_video_clone_features.py
```

---

## Project Structure

```
windy-pro/
├── src/
│   ├── client/
│   │   ├── desktop/           # Electron main + 11 renderer modules
│   │   ├── web/               # React/Vite web portal
│   │   └── mobile/            # React Native/Expo
│   ├── engine/                # Python transcription engine
│   └── cloud/                 # FastAPI cloud API
├── account-server/            # Node.js auth + storage (26 routes)
├── docs/                      # API, architecture, protocol docs
├── services/
│   └── translate-api/         # NLLB-200 translation service
├── installer-v2/              # TurboTax-style setup wizard
├── deploy/                    # Docker, nginx, compose configs
├── tests/                     # Python structural + security tests
├── scripts/                   # Linux install/post-install scripts
├── assets/                    # App icons
└── .github/workflows/         # CI/CD pipelines
```

---

## Contributing

### Getting Started

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Install dependencies: `npm install && pip install -r requirements.txt`
4. Copy environment: `cp .env.example .env`
5. Make your changes
6. Run tests: `python3 tests/test_final_qa.py`
7. Commit with conventional commits: `git commit -m "feat: add my feature"`
8. Push and create a pull request

### Commit Convention

| Prefix | Description |
|--------|-------------|
| `feat:` | New feature |
| `fix:` | Bug fix |
| `docs:` | Documentation |
| `test:` | Testing |
| `refactor:` | Code refactoring |
| `perf:` | Performance improvement |
| `ci:` | CI/CD changes |

### Code Style

- **JavaScript**: ES6+, no semicolons optional, single quotes
- **Python**: PEP 8, type hints where possible
- **CSS**: BEM-ish naming, CSS custom properties for theming
- **Commits**: Conventional commits (see above)

### Architecture Guidelines

- New desktop features: add renderer module in `src/client/desktop/renderer/`
- New IPC channels: add handler in `main.js`, bridge in `preload.js`
- New API routes: add to `account-server/server.js` with `authenticateToken` middleware
- New tests: add to `tests/` directory, follow existing patterns

---

## License

MIT License — see [LICENSE](LICENSE)
