# Changelog

All notable changes to Windy Pro will be documented in this file.

## [0.4.0] — 2026-02-23

### Added
- **Batch Mode:** Record up to 30 minutes, process with GPU-accelerated Whisper + LLM cleanup
- **Multi-Engine Support:** Choose from Local Whisper, WindyPro Cloud, Deepgram, Groq, or OpenAI
- **Multi-Language:** 13 languages + auto-detect (English, Spanish, French, German, Portuguese, Italian, Japanese, Chinese, Korean, Arabic, Hindi, Russian)
- **Speaker Diarization:** Identify speakers (Cloud & Deepgram engines)
- **Setup Wizard:** Guided first-run wizard for mode, engine, and API key configuration
- **What's New Popup:** Changelog shown once per version update
- **Customizable Keyboard Shortcuts:** Rebind toggle recording and paste transcript hotkeys
- **Transcript History:** Last 20 transcripts with click-to-load, export, and clear
- **Audio Playback:** Re-listen to batch recordings with built-in playback bar
- **Export Options:** Save transcripts as .txt, .md, or .srt subtitles
- **System Tray Enhancements:** Color-coded tray icon (green/red/gray), OS notifications on batch complete
- **Auto-Update Checking:** Checks GitHub releases once per day, "Check for Updates" in settings
- **Opt-In Analytics:** Anonymous usage stats (engine, mode, language, duration) — never transcript content
- **.deb Package Build:** `scripts/build-deb.sh` for Debian/Ubuntu distribution
- **Landing Page:** Marketing website at `src/client/web/public/landing/`

### Changed
- Processing indicator now uses animated spinner with breathing effect
- State transitions use smooth 0.4s CSS animations
- Version watermark displayed subtly in bottom-right corner

### Fixed
- Cloud transcription WebSocket reconnection stability
- Batch recording timer accuracy with session timer
- Settings panel scroll behavior on smaller screens

## [0.3.0] — 2026-02-20

### Added
- Cloud transcription via WindyPro server
- Vault system for transcript archival
- Crash recovery for interrupted sessions
- Settings persistence via electron-store

## [0.2.0] — 2026-02-18

### Added
- Basic Whisper transcription (local)
- Live streaming mode
- Copy to clipboard
- System tray integration

## [0.1.0] — 2026-02-15

### Added
- Initial Electron app shell
- Python FastAPI backend
- Basic recording and playback
