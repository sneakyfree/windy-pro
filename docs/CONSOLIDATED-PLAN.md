# Windy Word — The Consolidated Plan

_Written 2026-07-24 by the CTO seat, at Grant's request: salvage every prior planning thread into one
understanding, verify it against the actual code, and lay out what to build with my enhancements —
ready for a single go/no-go._

**Companions:** `VISION-AND-ROADMAP.md` (the barn — what we decided and shipped) and
`EXECUTION-PLAN.md` (the keystones K1–K4 and phases). This document supersedes neither; it **verifies**
them against the code, corrects what turned out to be wrong, and adds what they were missing.

**Decision doctrine:** `~/kit-army-config/doctrine/00-SEVEN-GUIDING-PRINCIPLES.md`. Every call below is
derived from those principles rather than escalated to Grant. Where a principle decided something, I
name it: **(P3)**, **(P4)**, etc.

---

## Part 1 — The business, in one page

Windy Word is not the product. **Windy Word is the doorway.**

The product is a free, local-first, honey-badger-stable voice-to-text app that a grandma can install and
use in sixty seconds without ever touching a terminal **(P1)**. It is free forever. The toll at the door
is an email address and a signed, plain-language disclosure — the same bargain Meta, TikTok, and Instagram
strike, except ours is honest, because our content genuinely never leaves the machine.

That doorway opens onto three profit centers, in the order they mature:

| # | Profit center | What we sell | Why they buy |
|---|---|---|---|
| 1 | **Cloud compute** | Fast, clean transcription on a remote GPU | Their laptop gets hot, throttles, and produces garbled text. $4–15/mo fixes it. |
| 2 | **WindyCloud storage** | Zero-knowledge storage of audio / video / text | 500 MB free on-ramp; 4K video fills a disk fast; multi-device access and backup. |
| 3 | **Windy Clone** | A marketplace for personal avatars and voice clones | We already hold the training data, encrypted. We are the castle; everyone else is shopping in our courtyard. |

The strategic insight that ties them together: **today's recordings appreciate in value.** As avatar and
cloning technology matures, hundreds of hours of a person talking becomes the most valuable thing they
own — and by then, our users will be the only ordinary people who happen to have it. We are not building
a storage business. We are building the ingestion engine for personal data, and charging rent on it.

None of this works if we lose contact with the users. **Telemetry is therefore load-bearing**, not a
nice-to-have: content never leaves the device, but counts, durations, engine choice, app version, and
country-level geography come home, tied to an account. That is what makes the super-admin dashboard —
"87 million active right now, 2 million in Beijing, average prompt 45 seconds" — and the Year-of-the-Dragon
storage promotion possible.

---

## Part 2 — Ground truth: what is actually built

I read the code rather than trusting the docs. Grant flagged two things he had never seen; both turned
out to be built, and the reason he has not seen them is more interesting than the features themselves.

| Feature | Believed status | **Verified status** | Evidence |
|---|---|---|---|
| 7 CPU engines, stock | shipped | ✅ **Real.** Nano → Lite → Core → Edge → Plus → Turbo → Windy Word | `lib/engine-catalog.js:14-22` |
| Windy Autotune | shipped | ✅ **Real.** Adapts up/down the ladder on measured speed | `main.js:7458-7476` |
| Per-engine lifetime usage % | "haven't seen it" | ✅ **Built and wired** — counts at the transcription choke point, shows in the engine menu | `main.js:7667`, `renderer/app.js:2004` |
| Delete/prune unused engines | "haven't seen it" | ⚠️ **Built, but inert on our own build** — see Finding 1 | `main.js:7693`, `app.js:2080` |
| 3 GPU engines | "haven't seen them" | ⚠️ **Not 3 extra engines** — see Finding 2 | `engine-catalog.js:51-55` |
| Apple GPU support | deliberately deferred | ✅ Correctly deferred; detector returns `capable: false` for Apple | `lib/gpu-detect.js:75` |
| LLM polish / cleanup mode | gated, unimplemented | ✅ **Confirmed: a switch wired to nothing.** Only a pricing-tier flag exists | `main.js:635-638, 9398` |
| Cloud compute pathway | partially wired | ⚠️ **Half-built, and pointed at the wrong provider** — see Finding 3 | `app.js:266-272, 2367` |
| R2 storage + 500 MB quota | wired up | ✅ Adapter + quota enforcement real | `routes/storage.ts`, `services/r2-adapter.ts` |
| Zero-knowledge encryption | the whole premise | ❌ **Not implemented.** Files are stored readable server-side | no crypto in `r2-adapter.ts` |
| Telemetry (server-side) | live | ✅ Real: signup, verify, hatch events | `services/admin-telemetry.ts` |
| Telemetry (from the app) | live | ⚠️ **Ships switched off unless the build machine is configured** — see Finding 4 | `intel.js:63-66`, `scripts/gen-telemetry-config.cjs:26-29` |
| Country-level geography | promised on the website | ❌ **Never captured.** No code reads it — see Finding 5 | `routes/` — no `CF-IPCountry` |

**The headline:** the app is in better shape than we thought. The *business plumbing underneath it* —
the parts that make the money — is where the holes are.

---

## Part 3 — Five findings that change the plan

### Finding 1 — The prune button cannot fire on the build we ship
Prune deliberately refuses to touch anything inside the signed app bundle, and only deletes models the
user downloaded to `~/.windy-pro/model/`. Our flagship build bundles **all seven engines**. So on the
DMG we are about to ship, nothing is ever prunable and the trash icon never appears. The feature Grant
designed is real, correct, and currently unreachable.

**This is not a bug to patch — it is the argument for the lean core (K2).** Once the app ships small and
fetches engines on demand, prune lights up by itself. One fix, two problems solved.

### Finding 2 — "Up to 10 engines" is not true, and it is on the website right now
The GPU pack is not three new engines. It is the same three top-rung models (`plus`, `turbo`,
`pro-engine`) re-run with `device=cuda`. A GPU machine gets the **same seven names**, three of them
faster. `Landing.jsx:364` currently promises "7 voice engines included — up to 10 with a capable GPU."

**Decision (P1 + trust):** we do not invent three cosmetic menu rows to make the number true. We fix the
copy to *"7 voice engines — GPU-accelerated on capable NVIDIA hardware."* Fewer, honest, clearer. This
must land **before** the site deploys.

### Finding 3 — Our "cloud" is currently OpenAI and Groq
The cloud pathway exists (`transcriptionMode: auto | cloud_only`, automatic failover when local
transcription runs slower than 2× real-time). But per `Privacy.jsx:55`, the cloud engines it reaches are
**OpenAI and Groq** — we are paying competitors to serve our premium tier, and shipping our users' audio
to them. Veron 1 is not wired in.

**Decision (P2 — portability is the moat):** keep the abstraction, replace the tenant. Veron 1 becomes
the first provider behind the registry (K4), with OpenAI/Groq demoted to fallback. We must never be a
reseller of a competitor's inference on our own premium tier.

### Finding 4 — A shipped build can be telemetry-silent, and nothing complains
The desktop telemetry client is hard-inert unless `telemetry.generated.json` is populated at package
time from environment variables. That file is committed empty on purpose (so it is never leaked into
git), and the generator **deliberately no-ops with a log line if the env vars are missing**. The release
script calls it — but nothing verifies the result. Build the DMG on a machine without those two
variables exported and we ship an app that phones home never, with a green build and no error.

Given that Grant's single non-negotiable is *never lose contact with the users*, this is the highest-risk
item in the entire codebase.

**Decision (P1):** the release pipeline gets a **hard gate** — verify the packaged app contains a live
ingest URL and token, and **fail the release** otherwise. A silent failure on the one metric the business
runs on is unacceptable.

### Finding 5 — We promise country-level geography and never collect it
`Disclosure.jsx:51` tells users we collect country-level location. No code anywhere captures it. This is
over-disclosure rather than a privacy violation — legally the safe direction — but it means the Beijing
promotion Grant described **cannot be built today**, because the country column does not exist.

**Decision:** capture it at the edge (Cloudflare hands us `CF-IPCountry` for free), country only, never
finer. Ship it with the telemetry work in Phase 1, not later.

---

## Part 4 — The plan

Sequencing rule, straight from **P3**: *do not solve problems a much smarter model will solve better in
six months.* We build the **seams** now — the places where future capability plugs in — and refuse to
build speculative depth. And from **P4**: every phase below has an explicit "not doing" line, because
feature bloat is what killed OpenClaw.

### Phase 0 — Ship what is already finished _(days)_
The Stage-7 signed macOS build is sitting in Apple's notarization queue. Nothing here is new work; it is
closing loops.

1. Staple + Gatekeeper-verify the DMG when Apple returns Accepted, then the persistence test (rebuild once, confirm the permission grant survives). **Automatic — running now.**
2. Fix the "up to 10 engines" copy (Finding 2), then deploy the website. **Blocked on the copy fix only.**
3. Add the telemetry hard-gate to the release pipeline (Finding 4).
4. Universal native addon (`node-gyp --arch=x64` + `lipo`) so the Intel DMG is not broken.
5. Finish the interrupted HuggingFace upload of `windy-stt-pro-ct2` — lean builds cannot fetch the flagship until it lands.

**Done when:** `git tag v1.8.1` produces a notarized DMG *and* a live site, with no manual steps, and the packaged app is proven to be phoning home.

### Phase 1 — The four keystones _(the gate; everything else plugs into these)_
Carried forward from `EXECUTION-PLAN.md`, unchanged, because they were right:

- **K1 — one Engine-Backend interface.** `audio → text`, one seam. CPU, CUDA, Metal, MLX, and remote all become interchangeable implementations. Build this first; it is what makes Phases 2–4 parallel plug-ins instead of rewrites.
- **K2 — lean core + on-demand everything.** Kills the 4.4 GB download, makes notarization fast, tailors installs per machine and language, and **switches on the prune feature** (Finding 1).
- **K3 — one capability probe → one perfect default.** First run detects hardware and language and configures everything, with zero questions asked. This *is* P1 made concrete.
- **K4 — provider registry.** Adding "AWS GPU" or a second Veron becomes a config row, never a code change (P2).

Plus, folded in here rather than deferred: **telemetry completion** — country capture (Finding 5) and the account↔install join, so the super-admin dashboard becomes real.

**Not doing:** any new user-facing feature during this phase.

### Phase 2 — Cloud compute, the first profit center
Containerize the Python engine on CUDA, run it on Veron 1 (RTX 5090, Mount Pleasant) behind its
Cloudflare tunnel, token-gated, registered as provider #1 (K4). Then **build LLM polish for real** — the
switch that currently does nothing becomes the premium centerpiece, running on the same GPU box, with a
small local model option for privacy-conscious users on capable machines.

**Not doing:** billing, tiers, or a paywall until the thing being sold actually works.

### Phase 3 — The local Cadillac
One backend implementation at a time behind K1: `whisper-cpp-metal` (Apple GPU, works on hardware
Grant owns today), `mlx`, `ct2-cuda`, `coreml`. **Done when** the flagship model runs faster than
real-time on a Mac — versus roughly 1.1× today.

### Phase 4 — Global reach
Website *and* app internationalization, plus `windy-lingua-*` language packs fetched on demand (K2).
**Done when** a Chinese-primary user installs and gets a Chinese-optimized setup instead of four
English-only engines.

### Phase 5 — Storage, and the endgame
Zero-knowledge WindyCloud on R2: client-side encryption before upload, the storage meter, the one-tap
opt-in, and the currently-undeployed portal. **Done when** we can demonstrate a file uploaded, retrieved
on a second device, and provably unreadable on our own servers. That demonstration is simultaneously the
product, the legal shield for biometric data, and the marketing.

Then avatar ingestion, and Windy Clone as a marketplace.

---

## Part 5 — What I am adding to the plan

Beyond the ten enhancements already in `EXECUTION-PLAN.md` (which stand), five additions that came out
of reading the code:

- **NI-11 — The release hard-gate.** Finding 4. Cheapest, highest-value item in this document.
- **NI-12 — Make the honesty visible.** An in-app Privacy Dashboard showing exactly what is local, what is encrypted, and the content-free telemetry we send. Google and Facebook are structurally incapable of shipping this screen. That makes it marketing, not overhead.
- **NI-13 — Double-confirm the prune, on-brand.** Today it is a single native `confirm()` dialog — jarring, and one click from deleting a 1.5 GB download. Grant specified a double confirmation; **P1** agrees. Replace it with the app's own two-step dialog when K2 makes prune reachable.
- **NI-14 — Show the usage bars from day one.** Percentages are hidden until an engine has been used at least once, which is why they look missing. Show every engine with an honest `0%` instead — the feature is invisible precisely when a new user is deciding whether to trust it.
- **NI-15 — Retire the competitor cloud path.** Finding 3. Track it as debt with a removal date, not as a feature.

---

## Part 6 — What only Grant can do

Everything else is mine. These four are not:

1. **Deploy approval for windyword.ai** — outward-facing. Copy fix first, then one word from Grant.
2. **A macOS machine registered as a CI runner** — Apple code-signing legally requires macOS; the Linux Kit 0 runner cannot do it. This M4 or OC5.
3. **Legal counsel before general availability** — the disclosure, the email program, and especially biometric video (GDPR Art. 9, Illinois BIPA). Zero-knowledge encryption is the enabler here, not a nicety.
4. **The spend decision on cloud compute** when Veron 1 is outgrown.

---

## The critical path

```
Phase 0  ship what's done  ─┐
                            ├─→  K1 backend seam  ─┬─→  Phase 2  cloud + LLM polish
         telemetry gate ────┤    K2 lean core      ├─→  Phase 3  Apple/NVIDIA runtimes
                            │    K3 capability probe├─→  Phase 4  i18n + language packs
                            └────K4 provider registry─→ Phase 5  storage → avatars → Windy Clone
```

K1–K4 are the gate. Build them once, properly, and Phases 2–5 stop being a queue and become four
workstreams the fleet runs at the same time.
