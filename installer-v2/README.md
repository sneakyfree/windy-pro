# 🌪️ Windy Pro v2.0 — Installation Wizard

## Architecture

```
installer-v2/
├── core/                      # Shared core (used by ALL 6 platform wizards)
│   ├── models.js              # 15 proprietary models catalog (Core/Edge/Lingua)
│   ├── hardware-detect.js     # CPU/RAM/GPU/disk/battery/network detection
│   ├── windytune.js           # WindyTune recommendation engine
│   ├── brand-content.js       # Monikers, feature cards, quotes, loading messages
│   ├── download-manager.js    # Resume-capable model downloader with checksums
│   └── account-manager.js     # Auth, device registration (5-device limit), tiers
│
├── adapters/                  # Platform-specific dependency installers
│   ├── index.js               # Auto-detects platform and returns correct adapter
│   ├── linux-debian.js        # Debian/Ubuntu (APT cocktail)
│   ├── linux-universal.js     # Fedora/Arch/etc (package manager detection + fallbacks)
│   ├── macos.js               # macOS (Homebrew + Metal GPU + permissions)
│   └── windows.js             # Windows (embedded Python + static ffmpeg + CUDA detect)
│
├── screens/
│   └── wizard.html            # Full 6-screen brand experience wizard UI
│
├── wizard-main.js             # Electron main process orchestrator
├── wizard-preload.js          # Secure IPC bridge
├── test-wizard.js             # Test launcher
└── README.md                  # This file
```

## The 6 Screens

1. **Welcome** — Tornado animation, feature highlights, creation quote
2. **Hardware Scan** — Live detection of CPU, RAM, GPU, disk, network, battery
3. **Account** — Login / Register / Try Free (5-device limit)
4. **Model Picker** — All 15 models with family tabs, WindyTune recommendations
5. **Download & Install** — Per-model progress, moniker carousel, feature education cards
6. **Complete** — Green strobe, installed models, keyboard shortcuts

## Testing

```bash
# Simulation mode (no real installs — safe to test UI)
cd windy-pro
npx electron installer-v2/test-wizard.js

# Real install mode (actually installs Python, ffmpeg, downloads models)
npx electron installer-v2/test-wizard.js --real
```

## Build Order

| Phase | Platform | Status |
|-------|----------|--------|
| 0+1 | Shared Core + Linux Debian | ✅ Built |
| 2 | Linux Universal | ✅ Built |
| 3 | macOS | ✅ Built |
| 4 | Windows | ✅ Built |
| 5 | Android | 🔲 Separate native app |
| 6 | iOS | 🔲 Separate native app |

## Brand Experience During Download

- 🌪️ Spinning tornado animation (never looks frozen)
- Moniker carousel every 8 seconds (16 monikers)
- Feature education cards every 15 seconds (14 cards covering WindyTune, Soul File, Translate, Cloud, Pricing, Security, etc.)
- Fun loading messages ("Parting the Red Sea of bad transcription...")
- Per-model progress bars with ✅ checkmarks
- Real-time install log
- ETA with download speed
