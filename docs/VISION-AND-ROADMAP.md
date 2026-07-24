# Windy Word — Vision & Roadmap

_Consolidated 2026-07-24 after a long build + vision session. This is the barn: what we decided, what shipped, and what's next._

## The one-sentence vision

Windy Word is the simplest, slickest **local-first** voice-to-text app — "God's gift to normies and grandmas" — that everyone can get for free (with an email sign-up), whose content never leaves the device unless the user chooses cloud, and which becomes the Trojan horse for an email list, privacy-preserving usage telemetry, and two upsells: **cloud compute** (speed + AI polish) and **zero-knowledge WindyCloud storage**. Long term it is the ingestion engine for personal data and digital-twin avatars.

## Principles (the non-negotiables)

1. **Local-first by default is the moat** — content (audio/video/text) stays on-device unless the user explicitly opts into cloud compute or cloud storage. This is an *enforced technical invariant*, not just copy. It's what makes everything else trustworthy.
2. **Simplicity converts** — grandma gets working in seconds. Fewer choices, clear defaults.
3. **Value-pull, never dark-pattern** — trust is the moat; we win by being useful (multi-device, backup, future-avatar), never by manipulating. Frequent-but-helpful prompts, not addiction mechanics.
4. **Zero-knowledge encryption for cloud storage** — we hold ciphertext only; only the user has the key. This makes trust and the storage business the same thing, and makes biometric (face/voice) data legally survivable.
5. **Content stays local; metadata is fair game** — with honest disclosure we collect usage metadata (counts, durations, device counts, engine, app version, country-level geo) and tie it to accounts for the super-admin dashboard + marketing. We never collect content.
6. **Future-proof via abstraction** — abstract engine *runtimes* and compute *providers* behind stable interfaces so new silicon (M5/M6, NVIDIA waves) and new providers (AWS/Vast) slot in without rewrites.

## Business model (direction — not finalized)

- **Free forever** (email sign-up required, disclosure signed): 7 local engines, up to 10 with a capable NVIDIA GPU, unlimited local recording, offline, auto-detect 99 languages, theme packs + Stage 7.
- **Paid = Cloud** (recommended future shape: collapse Pro/Ultra/Max → **Free + one "Cloud" subscription**): cloud compute (speed on weak hardware), **LLM polish** (the Whisper Flow parity feature), zero-knowledge WindyCloud storage (500 MB free on-ramp → paid tiers). No lifetime on cloud (recurring cost). Monthly + optional annual.
- **Windy Translate is a separate product** — mention/link on the Windy Word site, don't cross-sell it in the funnel.
- **Storage funnel**: video (esp. 4K, via phone-camera sync) fills local disk → user *opts in* to WindyCloud for multi-device access + backup → 500 MB free → paid. Telemetry segments heavy-video accounts for targeted, honest offers.

## Shipped this session (all merged to `main`, 2026-07-24)

- **WindyTune / engine integrity** (`engine-catalog.js` single source of truth, legacy migration, honest badge, persistent rungs, settings-clobber fix). Root-caused from hand test: WindyTune ran whisper `base` while the badge claimed Windy Core.
- **GPU engine pack** (Plus/Turbo/Word, clinic-champion by eval loss; NVIDIA ≥6 GB VRAM + CUDA; Apple Silicon detected but not offered — CT2 has no Metal backend) + per-engine usage %, prune, download-manager fixes.
- **Theme packs & effects overhaul**: 6→**7 stages** (added Stage 7 "Send"), synthesized storm audio (rolling thunder + thunderclap), always-visible pack gallery, 4 new packs (Valhalla, Arcade, Colosseum, Zen Garden), a **rotary visual-intensity dial** (agent-controllable), a true **linear brightness spectrum**, a **nuclear top-end** (exponential last 5%, seismic shake, physical window rattle, ☢️ DANGER mode), and a **whole-screen effects canvas**.
- **Stage 7 "Send" finale** — fires the moment the user hits Enter to send the prompt they just dictated. Native listen-only key monitor running **in the main Electron process** (N-API addon → CGEventTap on a dedicated CFRunLoop thread), scoped to the paste-target app, once per paste. _The whole-day debugging saga's real culprit was macOS **Secure Keyboard Entry** in Terminal blocking all key observation._ Milestones 1 (detection) + 3 (finale end-to-end, send gestures, secure-input awareness) done; Milestone 2 (packaging + signing) in progress.
- **Website (committed, NOT deployed)**: free-tier sign-up with a plain-language **Data & Communications Disclosure** (`/disclosure`), free tile updated to the real app (7–10 engines, unlimited local, offline, 99-language auto-detect), three paid tiles grayed "Coming Soon."

## Delivery plan (prioritized)

### A. Finish what's in flight
1. **Milestone 2 — sign + notarize the Stage-7 macOS build.** Developer ID `VXZ434QL89` (cert in lockbox); `.node` signing gap fixed; notarization submitted (`587356bc…`). Staple + Gatekeeper verify when Apple returns Accepted. Then a **persistence test**: rebuild once, confirm the TCC grant survives (the point of a stable Developer ID).
2. **x64 build** — cross-compile the native addon for x64 so the universal/Intel DMG isn't shipped with a wrong-arch addon.
3. **Deploy the website** — the free-download + disclosure + coming-soon-tiles site (CF Pages, direct-upload; `main` does not auto-deploy).

### B. The cloud profit center (its own milestones)
4. **Containerize the engine** (`server.py` CUDA Docker image) → run on **Veron 1 (RTX 5090)** behind its Cloudflare tunnel, token-gated to just us. First cloud-compute provider.
5. **Endpoint registry** (`{name, wssUrl, token, health, priority}`) so AWS/Vast/RunPod are drop-in later. Provider-agnostic.
6. **Build LLM polish for real** — the "cleanup mode / LLM polish" is currently *defined and gated but unimplemented* (only Whisper's native punctuation exists; the only LLM in-app is for translation). Make it the cloud/premium centerpiece, run on the same GPU node.

### C. Local Cadillac — engine-runtime abstraction (future-proofing)
7. **Engine-runtime abstraction** (the enabling layer) — pick the best runtime per machine.
8. **whisper.cpp/Metal** — Apple Silicon GPU acceleration, works on today's hardware.
9. **MLX** — Apple unified-memory flagship path (512 GB Studio territory).
10. **CUDA enablement** — flip existing CT2 engines to GPU on NVIDIA (5090 wave).
11. **CoreML / Neural Engine** — deepest Apple integration, later.

### D. Global reach
12. **Website i18n** — auto-detect (`Accept-Language`) + dropdown, top ~10 languages.
13. **Language-specialist model packs** — `windy-lingua-*` (~50 languages on HuggingFace `WindyProLabs`), downloaded on demand by detected language. Smart default (multilingual Turbo already serves 99 languages), never bundle all 117 models.

### E. Data / storage / avatars
14. **WindyCloud storage — zero-knowledge**, on Cloudflare **R2** (`windycloud-userdata` bucket; R2's zero egress is decisive vs AWS). 500 MB free on-ramp. Storage meter + one-tap "keep safe + access anywhere" (opt-in). _The WindyCloud portal is not yet deployed — don't advertise storage until it works._
15. **Telemetry policy build** — account-linked usage metadata + country-level geo into the existing `windy-admin` fleet dashboard; login-triggered in-app campaigns; CAN-SPAM email; honest disclosure (lawyer-reviewed before GA). Content never touched.
16. **Digital-twin / avatar ingestion** — Soul File + Windy-Clone already in the ecosystem; the strategy is to *capture raw video now* (it appreciates as avatar tech matures) with zero-knowledge storage.

## Known gaps / cautions to remember

- **Apple Silicon has no GPU acceleration today** — even a 512 GB Studio Ultra runs CT2 on CPU. Item C fixes this; until then "GPU models" = NVIDIA only.
- **Legal**: biometric video (face/voice) is the most-regulated data (GDPR Art. 9, Illinois BIPA). Zero-knowledge encryption is the enabler, not optional. Get counsel before GA on the disclosure + email + storage.
- **Don't advertise unshipped features** (WindyCloud storage) — trust brand.
- **HF uploads**: `WindyProLabs/windy-stt-turbo-ct2` uploaded; `windy-stt-pro-ct2` upload was interrupted — finish it so lean builds can fetch the flagship.
