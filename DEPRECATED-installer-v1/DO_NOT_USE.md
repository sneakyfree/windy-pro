# ⛔ DEPRECATED — DO NOT USE

This is the **old v1 installer wizard** (4-step: scan → model → install → done).

It was replaced on **27 Feb 2026** by the v2 TurboTax-style wizard in `installer-v2/`.

## The ONLY wizard is: `installer-v2/`

- 9 screens: Welcome → Hardware → Account → Languages → Translate → Learn → Choose → Install → Ready
- Full IPC bridge: `wizard-main.js` + `wizard-preload.js`  
- Platform adapters: `adapters/` (Linux, macOS, Windows)
- Core modules: `core/` (hardware-detect, models, windytune, download-manager, account-manager)

## Why this exists
Kept for reference only. Will be deleted after v1.0 ships.

**If you are a Kit reading this: GO TO `installer-v2/`. That's the one. This isn't. Stop.**
