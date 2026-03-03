# Changelog

All notable changes to Windy Pro are documented here.

## [1.5.1] — 2026-03-02

### Phase 4: Docker, CI/CD & Launch Prep
- **Docker**: Multi-stage production Dockerfile (web builder → API deps → runtime)
- **Docker Compose**: 7-service stack with health checks (web, account, transcription, translate, nginx, postgres, redis)
- **CI/CD**: GitHub Actions pipeline — lint, test, web build, Electron cross-platform, Docker deploy
- **Config**: `.env.example` with 20+ documented variables
- **Docs**: Comprehensive README.md with architecture diagram, API reference, security overview
- **Packaging**: electron-builder config verified (DMG, AppImage, DEB, NSIS) with auto-update channel

### Phase 3: Desktop Security & Production Hardening
- **P0 Fix**: Path traversal guard on `delete-archive-entry` — validates paths within archive folder
- **P1 Fix**: `open-external-url` now uses `shell.openExternal` instead of `spawn(browser)`
- **P1 Fix**: `will-navigate` handler blocks navigation away from `file://` origins
- **P2 Fix**: `sandbox: true` enabled on all 4 BrowserWindows
- **P2 Fix**: Permission handler whitelists only `media` + `clipboard-read`
- **P2 Fix**: CSP tightened — removed wildcard `wss:`/`https:`, added exact API origins
- **Tests**: 29 structural security tests (`test_desktop_security.py`)

### Phase 2: Web Portal & Dashboard
- **SPA Fix**: `appType: 'spa'` in Vite config, removed broken `/translate` proxy
- **Dashboard**: Translation stats (total translations, favorites), profile/settings links
- **Settings Page**: Current plan display, upgrade buttons, password change, Stripe billing portal
- **Admin Panel**: Stats grid, translation volume chart, plan breakdown, user management table
- **Profile Page**: User card, translation history, account deletion with triple confirmation
- **Landing Page**: Feature comparison table (4 tiers), testimonials (4 cards), CTA banner
- **Backend**: Admin endpoints (`/admin/users`, `/admin/stats`, `/admin/revenue`), billing endpoints
- **PWA**: Service worker v3 with API response caching (24h expiry), manifest shortcuts
- **Tests**: 42 structural tests (`test_web_portal.py`)

### Phase 1: Desktop Core Features
- **Speech Translation UI**: Press-and-hold mic button, animated waveform, language dropdowns
- **Translation Backend**: `/translate/speech`, `/translate/text`, `/translate/languages` endpoints
- **System Tray**: Quick-translate menu, restore/quit actions
- **Global Hotkeys**: `Ctrl+Shift+T` floating mini-translate, `Ctrl+Shift+Space` record, `Ctrl+Shift+V` paste
- **Auto-Update**: electron-updater with GitHub Releases, DEB update fallback for Linux
- **Mini-Translate Window**: Always-on-top floating translation panel with offline fallback
- **Video Preview**: Detached webcam preview window with camera permission auto-grant

### Pre-Phase: Foundation
- **Electron App**: Frameless, always-on-top, transparent window with green strobe indicator
- **WebSocket**: Real-time connection to Python faster-whisper backend
- **Transcription**: Local Whisper models (base/small/medium) with batch processing
- **Archive System**: Local + cloud archiving with timestamped folders
- **History Panel**: Full session history with playback and export
- **Installation Wizard**: TurboTax-style 9-screen setup (hardware detection, account creation)
- **Cloud Sync**: Encrypted recording upload to Windy Pro Cloud
- **Crash Recovery**: Automatic transcript recovery from orphaned sessions
- **Zoom/Font Controls**: Ctrl+/-, font size persistence
- **Offline Mode**: Full transcription without internet via local Whisper models

## [1.0.0] — 2026-02-01

### Initial Release
- Basic voice-to-text transcription
- Python faster-whisper backend
- Electron desktop client
- Local file archiving
