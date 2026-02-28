# Changelog

## v0.6.0 (2026-02-28)

### 🆕 New Features
- **Windy Pro Cloud Storage** — Archive recordings to Windy Pro's distributed cloud (replacing Dropbox/Google Drive)
- **Stripe Payment Integration** — Upgrade to Pro/Translate/Translate Pro directly from the app
- **First-Run Setup Wizard** — Premium 6-step onboarding: mic test, engine selection, account creation, plan selection
- **History Media Badges** — See at a glance which recordings have 📝 text, 🎤 audio, 🎬 video
- **Inline Audio Playback** — Play back recordings directly from the History panel
- **Video Recording** — Webcam capture during recordings (opt-in, for AI avatar/voice clone data)
- **Coupon Code Support** — Enter promo codes during checkout for discounts
- **Feature Gating by Tier** — Free/Pro/Translate/Translate Pro feature limits enforced

### 🔧 Improvements
- Removed Dropbox and Google Drive integration (replaced by Windy Pro Cloud)
- New archive folder UI with 📂 Open and ⚙️ Change buttons
- Archive path displayed in the main UI
- Audio save consistency fixes
- Improved recording mode handling for batch sessions

### 🐛 Bug Fixes
- Fixed null reference crashes from removed Dropbox/Google elements
- Fixed audio timestamp mismatches between .md and .webm files
- Fixed stack overflow on large audio blob base64 encoding

---

## v0.5.0 (2026-02-24)

### 🆕 New Features
- Mini tornado widget with transparent background and voice-reactive animation
- Tornado widget size slider in settings
- Cloud transcription engine support

### 🔧 Improvements
- Hardened IPC security across all handlers
- Full-spectrum smoke test pass

---

## v0.4.0 (2026-02-20)

### 🆕 New Features
- Batch recording mode with LLM-polished output
- Tornado floating widget
- Audio archive with date-organized folders
- History panel with search
- Global hotkey support (Ctrl+Shift+Space, Ctrl+Shift+V)

### 🔧 Improvements
- TurboTax-style installation wizard
- 5 transcription engine options
- Cursor injection for direct paste
