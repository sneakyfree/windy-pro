# Windy Word — Execution Plan

_Companion to `VISION-AND-ROADMAP.md`. This is the "exactly how": the keystone architecture, phased delivery with a definition-of-done per item, dependencies, and the higher-leverage ideas. Written 2026-07-24._

---

## Part 1 — Four keystone decisions that unlock everything

Before the phases, four architectural bets. Getting these right means every later item is a plug-in, not a rewrite. Getting them wrong means rework forever.

### K1. One Engine-Backend interface (the single most important abstraction)
A transcription request is `audio → text`. Everything that produces text — local CPU, local GPU, a remote GPU, a future runtime — implements **one interface**:
```
Backend.transcribe(audioPath, {model, language, opts}) -> {text, timings, model, device}
Backend.capabilities() -> {device, models[], realtimeFactor}
```
Implementations: `ct2-cpu` (today), `ct2-cuda` (NVIDIA), `whisper-cpp-metal` (Apple GPU), `mlx` (Apple unified memory), `remote-wss` (cloud). The app/engine picks the best available backend; the renderer never knows or cares which ran. **This unifies cloud (Part 4), local runtimes (Part 5), and failover into one seam.** Build it first.

### K2. Lean core + everything-on-demand (fixes the 4.4 GB problem)
The current flagship DMG is **4.4 GB** because it bundles all models. That's a distribution killer at scale. Ship a **lean core** (app + one small multilingual default model + one runtime) and fetch the rest on demand: extra engines, language packs, GPU runtimes, all via the existing `pair-download-manager`. This simultaneously fixes distribution weight, enables **hardware/language-tailored installs**, and makes updates cheap.

### K3. One Capability Probe → one perfect default (the "God's gift to normies" onboarding)
First run does **one** unified probe and configures the optimal experience with zero user choices:
- Hardware (GPU kind/VRAM, RAM, disk) → which backend + which models + GPU-pack offer.
- OS/browser language → which language pack + UI language.
- Then: download the right lean set, pick the right backend, set WindyTune to a sane rung.
This ties together the GPU-detect, WindyTune, runtime-select, and language-detect logic that currently live (or will live) as separate pieces. Grandma gets a working, optimal setup on launch — no menus.

### K4. Provider registry, not hardcoded URLs
Cloud endpoints, storage backends, and (later) LLM-polish nodes all resolve from a registry: `{name, kind, url, token, health, priority, region}`. Adding "AWS GPU" or "a second Veron" is a config row. `transcriptionMode: auto` already picks local↔cloud; extend it to pick among registry entries by health + priority.

---

## Part 2 — How I actually deliver (process)

- **Fleet + parallel agents.** Three machines (this M4, Windy 0 / Fedora, OC5 / iMac) + Veron 1 (5090). Independent workstreams (native runtimes, cloud, web, storage) run in parallel; I orchestrate with subagents/workflows for fan-out work (audits, cross-file migrations, multi-lens verification) and keep the conclusions.
- **Verification discipline (the hard lesson of this session).** Never claim "done" from code-present; verify behavior. Prove-with-a-harness, screenshot/log the real thing, and unit-test the policy layer. The Stage-7 saga (Secure Keyboard Entry) is the cautionary tale — synthetic tests lied; real proof didn't.
- **Definition of Done per item** (below) — each ends in a verifiable artifact, not a hope.
- **One release pipeline** (see NI-1) so shipping is a command, not a 12-step manual ritual.

---

## Part 3 — Phased delivery (with dependencies + DoD)

### Phase 0 — Close out what's in flight (this week)
| Item | How | Done when |
|---|---|---|
| Notarize Stage-7 build | staple + `spctl` assess the submitted DMG (`587356bc…`) | Gatekeeper prints `source=Notarized Developer ID` |
| Persistence proof | rebuild once, confirm the TCC grant survives (the point of a stable Developer ID) | permission not re-prompted after rebuild |
| x64 addon | `node-gyp rebuild --arch=x64`; combine with arm64 via `lipo` into a **universal `.node`** so one addon serves both | universal DMG loads the addon on Intel + Apple Silicon |
| CI/CD (NI-1) | GitHub Actions on the self-hosted runner: tag → build → sign → notarize → staple → CF deploy | `git tag vX` produces a notarized DMG + live site, no manual steps |
| Deploy site | `wrangler pages deploy dist --project-name windypro-webapp` | windyword.ai shows the free-tier + disclosure |

### Phase 1 — The Engine-Backend seam (K1) + lean delivery (K2) + onboarding (K3)
The foundation everything plugs into. Refactor `transcriber.py`/`server.py` to the Backend interface; make the app fetch models on demand; build the unified first-run probe. **Dependency: nothing. Do this before cloud or new runtimes.** DoD: the current CT2-CPU path works *through* the new interface with zero behavior change, and a fresh install pulls only what the machine needs.

### Phase 2 — Cloud profit center
Depends on K1 + K4.
| Item | How | Done when |
|---|---|---|
| Containerize engine | `Dockerfile` on `nvidia/cuda:12-runtime`; `server.py --device cuda --host 0.0.0.0`; bearer-token gate on the WS handshake | image runs the engine on any CUDA host |
| Veron 1 provider | `docker run --gpus all`, `systemd`/compose for 24/7; front with the existing Cloudflare tunnel → `wss://stt.windyword.ai`; token-gate to us only | remote transcription works from the app, gated |
| Registry wiring | add Veron as a registry entry; `transcriptionMode: auto` fails over | app uses cloud when chosen/healthy, local otherwise |
| **LLM polish (real)** | currently *unimplemented* (only Whisper's native punctuation exists). Run an LLM (e.g. Llama-3.x via vLLM/Ollama) on the same GPU node as a `remote-wss` polish backend; wire the `vibeEnabled`/`llmPolish` toggle to it. **Also ship a local option (small LLM via llama.cpp) for privacy-preserving polish on capable machines** (NI-6) | toggling Clean-up Mode actually removes fillers, fixes grammar, punctuates |

### Phase 3 — Local Cadillac (engine runtimes)
Depends on K1. Each is one Backend implementation behind the interface.
1. `whisper-cpp-metal` — Apple GPU today (bundle whisper.cpp + GGUF models).
2. `mlx` — Apple unified-memory flagship (mlx-whisper).
3. `ct2-cuda` — flip existing CT2 engines to GPU on NVIDIA (mostly a device flag).
4. `coreml` — Neural Engine, deepest Apple integration.
DoD: on an Apple Silicon machine, the flagship model runs **under real-time** (vs ~1.1× on CPU today) via the auto-selected backend.

### Phase 4 — Global reach
Depends on K2 (on-demand packs).
- Website i18n: `react-i18next`, JSON/lang, auto-detect `Accept-Language` + dropdown, ~10 languages (machine-translate first pass → human review), RTL for Arabic.
- **App UI i18n too** (NI-8) — menus/settings in the user's language, not just the site.
- Language-specialist packs: extend the engine catalog with `windy-lingua-*` (~50 langs on HF `WindyProLabs`); the probe (K3) offers the right pack by detected language. DoD: a Chinese-primary user installs and gets a Chinese-optimized setup, not four English-only engines.

### Phase 5 — Data / storage / avatars
- **WindyCloud zero-knowledge storage** on R2 (`windycloud-userdata`): client-side encrypt (libsodium/age) before upload; deploy the (currently undeployed) portal; storage meter + one-tap opt-in "keep safe + access anywhere." DoD: a file uploaded, fetched on a second device, and **unreadable server-side** (prove the ciphertext).
- **Telemetry policy build**: join `install_id`↔account, add country geo, feed the `windy-admin` fleet dashboard; a `campaigns` table + login-time check drives in-app offers; CAN-SPAM email. Content never touched.
- **Avatar ingestion**: Soul File / Windy-Clone capture → encrypted storage now; generation as the tech matures.

---

## Part 4 — New ideas (higher-leverage additions)

- **NI-1 — CI/CD release pipeline** on the self-hosted runner. Turns the fragile 12-step sign/notarize/deploy ritual into `git tag`. Single highest-leverage de-risking item; do it in Phase 0.
- **NI-2 — Privacy Dashboard (in-app).** A visible panel showing exactly what's local vs cloud, what's encrypted, and the content-free telemetry we send. Turns the moat into a *feature the user can see* — the thing Google/Facebook structurally can't show. Marketable, trust-building, cheap.
- **NI-3 — Local LLM polish**, not just cloud (folded into Phase 2). Privacy-preserving cleanup on capable machines; cloud for weak ones. Fits the moat and the runtime abstraction.
- **NI-4 — Modular editions from one codebase.** Lean core + on-demand (K2) means "Windy Word Lite" (tiny), "Studio" (all runtimes), and tailored per-language installs are *configurations*, not forks.
- **NI-5 — Benchmark-on-first-run backend selection.** Like WindyTune but for *runtime*: a 5-second probe picks CPU vs Metal vs MLX vs cloud by measured real-time factor. Removes the "why is it slow" support tickets.
- **NI-6 — Referral + shareable moments for virality.** The viral effect clips already help; add "share your Windy Word moment" + referral-for-storage-credit. The product is a Trojan horse — build the sharing in.
- **NI-7 — Telemetry-driven product loop.** The super-admin metadata drives *product* decisions (which engines/langs/features get used → where to invest), not just marketing. Close the loop.
- **NI-8 — App-UI internationalization**, not just the website. The whole in-app experience in the user's language.
- **NI-9 — On-device "data vault" export.** Let users export everything (audio/video/text) as a portable, encrypted archive — reinforces "you own your data," and is the on-ramp to WindyCloud (import the vault to the cloud).
- **NI-10 — Health/observability for cloud.** Each provider exposes `/health`; a tiny router + the super-admin panel show "Veron warm? latency? queue depth?" so cloud never silently degrades (mirrors the app's existing local health check on :9877).

---

## The critical path (what to build in what order)

```
Phase 0 (close out + CI/CD)  →  K1 Backend interface  →  ┌ Phase 2 Cloud + LLM polish
                                K2 Lean/on-demand      →  ├ Phase 3 Apple/NVIDIA runtimes
                                K3 Capability probe     →  ├ Phase 4 i18n + language packs
                                K4 Provider registry    →  └ Phase 5 Storage + telemetry + avatars
```
K1–K4 are the gate. Build them once, well, and phases 2–5 become parallel plug-ins the fleet can run simultaneously.
