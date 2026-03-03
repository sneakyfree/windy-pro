# Windy Pro

> Voice to text, unlimited. No subscriptions, no time limits.

Real-time speech transcription, translation, and dictation for desktop, web, and mobile. Powered by faster-whisper (local) and Deepgram (cloud).

---

## Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                         Windy Pro Platform                             │
├──────────────────┬──────────────────┬──────────────────────────────────┤
│   Desktop App    │    Web Portal    │       Mobile App                 │
│   (Electron)     │   (React/Vite)   │   (React Native/Expo)           │
│                  │                  │                                  │
│  • Frameless UI  │  • Dashboard     │  • iOS + Android                │
│  • System tray   │  • Translate     │  • Speech translation           │
│  • Global hotkey │  • Admin panel   │  • Voice clone                  │
│  • Auto-paste    │  • Settings      │  • Offline packs                │
│  • Video capture │  • PWA support   │  • Push notifications           │
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
              │  • Admin / billing APIs   │
              │  • Stripe integration     │
              └─────────┬─────────────────┘
                        │
         ┌──────────────┼──────────────┐
         │              │              │
  ┌──────┴──────┐ ┌─────┴─────┐ ┌─────┴──────┐
  │ Transcribe  │ │ Translate │ │  Storage   │
  │ (Whisper)   │ │ (NLLB)    │ │ (Postgres) │
  │  Port 8000  │ │ Port 8099 │ │  Port 5432 │
  └─────────────┘ └───────────┘ └────────────┘
```

## Features

| Feature | Desktop | Web | Mobile |
|---------|---------|-----|--------|
| Real-time transcription | ✅ | ✅ | ✅ |
| Speech-to-speech translation | ✅ | ✅ | ✅ |
| Text translation (200+ languages) | ✅ | ✅ | ✅ |
| Offline transcription (Whisper) | ✅ | ❌ | ✅ |
| Auto-paste to active window | ✅ | ❌ | ❌ |
| System tray + global hotkeys | ✅ | ❌ | ❌ |
| Video recording | ✅ | ❌ | ✅ |
| Admin dashboard | ❌ | ✅ | ❌ |
| PWA (install as app) | ❌ | ✅ | ❌ |
| Push notifications | ❌ | ❌ | ✅ |
| Voice clone | ❌ | ❌ | ✅ |

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
#   Web:           http://localhost:3000
#   Account API:   http://localhost:8098
#   Transcription: http://localhost:8000
#   Translate:     http://localhost:8099
```

## Building Desktop Installers

```bash
# All platforms
npm run dist:all

# Individual platforms
npm run build:linux    # → dist/*.AppImage, dist/*.deb
npm run build:mac      # → dist/*.dmg
npm run build:win      # → dist/*.exe (NSIS)
```

Auto-update is configured via GitHub Releases. Tag a version to trigger:

```bash
git tag v1.5.2
git push --tags
```

## API Reference

### Account Server (`localhost:8098`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/v1/auth/register` | ❌ | Create account |
| POST | `/api/v1/auth/login` | ❌ | Login → JWT |
| POST | `/api/v1/auth/refresh` | 🔄 | Refresh token |
| GET | `/api/v1/auth/me` | ✅ | Current user |
| POST | `/api/v1/auth/change-password` | ✅ | Change password |
| GET | `/api/v1/auth/billing` | ✅ | Subscription info |
| POST | `/api/v1/auth/create-portal-session` | ✅ | Stripe portal |
| GET | `/api/v1/recordings` | ✅ | List recordings |
| POST | `/api/v1/recordings` | ✅ | Upload recording |
| POST | `/translate/text` | ✅ | Text translation |
| POST | `/translate/speech` | ✅ | Speech translation |
| GET | `/user/history` | ✅ | Translation history |
| GET | `/api/v1/admin/users` | 🔐 | User management |
| GET | `/api/v1/admin/stats` | 🔐 | System stats |
| GET | `/api/v1/admin/revenue` | 🔐 | Revenue dashboard |

Auth: ✅ = JWT required, 🔐 = Admin role required, 🔄 = Refresh token

### Transcription API (`localhost:8000`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/transcribe` | Transcribe audio (base64 or file) |
| GET | `/health` | Service health |
| GET | `/models` | Available Whisper models |

## Environment Variables

See [`.env.example`](.env.example) for all variables with descriptions.

## Security

- **Electron**: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`
- **CSP**: Strict Content Security Policy on all windows
- **IPC**: Path traversal guards, input validation, `shell.openExternal` for URLs
- **Navigation**: `will-navigate` blocks non-local origins, popup creation denied
- **Permissions**: Whitelist-only (media, clipboard)
- **Auth**: bcrypt passwords, JWT + refresh tokens, device limits

## Project Structure

```
windy-pro/
├── src/
│   ├── client/
│   │   ├── desktop/        # Electron main + renderer
│   │   ├── web/            # React/Vite web portal
│   │   └── mobile/         # React Native/Expo
│   ├── engine/             # Python transcription engine
│   └── cloud/              # FastAPI cloud API
├── account-server/         # Node.js auth + storage server
├── services/
│   └── translate-api/      # NLLB-200 translation service
├── installer-v2/           # TurboTax-style setup wizard
├── deploy/                 # Docker, nginx, compose configs
├── tests/                  # Python structural + security tests
├── scripts/                # Linux install/post-install scripts
├── assets/                 # App icons
└── .github/workflows/      # CI/CD pipelines
```

## License

MIT License — see [LICENSE](LICENSE)
