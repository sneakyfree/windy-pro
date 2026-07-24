# Windy Word — The Consolidated Plan

**Version 2 — 2026-07-24.** V1 was reviewed and found strong on architecture and weak on commerce.
This version keeps what held up, corrects what didn't, and adds what was missing: a platform strategy,
dates, unit economics, a distribution plan, and the contradictions V1 never named.

**Companions:** `VISION-AND-ROADMAP.md` (what we decided and shipped) and `EXECUTION-PLAN.md` (the
keystones and phase detail). **Doctrine:** `~/kit-army-config/doctrine/00-SEVEN-GUIDING-PRINCIPLES.md` —
decisions below cite the principle that made them rather than escalating to Grant.

---

## Part 0 — The invariant that sits above every phase

The audit found five defects. They share one shape:

| | |
|---|---|
| Prune | a button that can never fire |
| Telemetry | a system that can ship switched off, silently |
| LLM polish | a switch wired to nothing |
| Country geography | a promise with no collector behind it |
| Cloud compute | a pathway pointed at a competitor |

That is not five bugs. **It is one disease: this codebase fails silently.** Things look done, report
success, and do nothing. The Stage-7 saga was the same disease in its worst form — synthetic tests
passed all day while the real feature was dead.

Five patches do not fix a disease. So the countermeasure is a standing invariant:

> ### NO SILENT NO-OPS
> Every user-visible capability either works, or says loudly that it cannot. Enforced at runtime in the
> **packaged artifact**, never in the source tree.

**Shipped 2026-07-24:** `scripts/reality-check.cjs` — a mechanical claim-versus-implementation audit,
wired into CI and installed as a hard gate in the macOS release pipeline. It blocks a release whose
telemetry is inert, and blocks public engine-count claims that exceed the real ladder. It was verified
to hard-fail on the exact copy defect it was written to catch.

**Still owed:** a smoke test that installs the built DMG/EXE on a clean machine and pokes it. Every one
of the five findings would have been caught in minutes by an install-and-use pass. A machine can check
consistency; only a real install proves behaviour.

---

## Part 1 — The business, in one page

Windy Word is not the product. **Windy Word is the doorway.**

The product is a free, local-first, honey-badger-stable voice-to-text app that a grandma can install and
use in sixty seconds without ever touching a terminal **(P1)**. Free forever. The toll at the door is an
email address and a signed, plain-language disclosure — the same bargain Meta, TikTok, and Instagram
strike, except ours is honest, because our content genuinely never leaves the machine.

That doorway opens onto three profit centers:

| # | Profit center | What we sell | Why they buy | First revenue |
|---|---|---|---|---|
| 1 | **Cloud compute** | Fast, clean transcription on a remote GPU | Their laptop throttles and produces garbled text. $4–15/mo fixes it. | ~Dec 2026 |
| 2 | **WindyCloud storage** | Zero-knowledge storage of audio, video, text | 500 MB free on-ramp; 4K video fills a disk fast | ~Q2 2027 |
| 3 | **Windy Clone** | Marketplace for personal avatars and voice clones | We hold the training data. We are the castle. | 2027+ |

The insight tying them together: **today's recordings appreciate in value.** As cloning technology
matures, hundreds of hours of a person talking becomes the most valuable thing they own — and our users
will be the only ordinary people who happen to have it. We are not building a storage business. We are
building the ingestion engine for personal data, and charging rent on it.

None of it works if we lose contact with the users. **Telemetry is load-bearing**, not optional:
content never leaves the device, but counts, durations, engine choice, version, and country come home,
tied to an account.

### The unit economics of "free" — the one line item that grows with success

Free storage is the only part of this business where **winning costs money before it makes any.**
At roughly $0.015/GB-month on R2 (egress free, which is why R2 and not S3):

| Users | If they fill 500 MB | Monthly cost | Revenue |
|---|---|---|---|
| 1 M, 10% active uptake | 50 TB | ~$750 | $0 |
| 1 M, full uptake | 500 TB | ~$7,500 | $0 |
| 100 M, 10% uptake | 5 PB | ~$75,000 | $0 |

Realistic uptake is a fraction, so the near-term number is small. **The direction is what matters**, and
storage cost does not stop when a user churns.

**Decisions (P4 — minimalism applied to liabilities):** provision storage lazily rather than reserving
it; set a dormancy policy with honest advance notice; and make the 500 MB **earned** — verify your
email, or refer someone. That costs nothing, filters drive-by signups, and converts a pure liability
into a growth mechanic.

---

## Part 2 — Ground truth: what is actually built

Read from the code, not from documents.

| Feature | Believed | **Verified** | Evidence |
|---|---|---|---|
| 7 CPU engines, stock | shipped | ✅ Real. Nano → Lite → Core → Edge → Plus → Turbo → Windy Word | `engine-catalog.js:14` |
| Windy Autotune | shipped | ✅ Real — adapts on measured speed | `main.js:7458` |
| Lifetime usage % per engine | "haven't seen it" | ✅ Built and wired into the engine menu | `main.js:7667` |
| Prune unused engines | "haven't seen it" | ⚠️ Built; unreachable on bundled builds — Finding 1 | `main.js:7693` |
| 3 GPU engines | "haven't seen them" | ⚠️ Not 3 extra engines — Finding 2 | `engine-catalog.js:51` |
| Apple GPU support | deferred | ✅ Correctly deferred; detector returns not-capable | `gpu-detect.js:75` |
| LLM polish | gated, unimplemented | ❌ Confirmed: a switch wired to nothing | `main.js:635` |
| Cloud compute | partially wired | ⚠️ Points at OpenAI/Groq — Finding 3 | `app.js:266` |
| R2 storage + quota | wired | ✅ Adapter and quota enforcement real | `routes/storage.ts` |
| Zero-knowledge encryption | the premise | ❌ Not implemented — files readable server-side | `r2-adapter.ts` |
| Telemetry — server | live | ✅ Signup, verification, hatch events flow | `admin-telemetry.ts` |
| Telemetry — app | live | ✅ **Gated as of 2026-07-24** — Finding 4 | `reality-check.cjs` |
| Country geography | promised publicly | ❌ Never captured — Finding 5 | absent |
| **Windows code signing** | assumed handled | ❌ **`"sign": null` — unsigned** — Finding 6 | `package.json build.win` |

**Headline:** the app is in better shape than we thought. The business plumbing underneath it — the
parts that make money and the parts that reach users — is where the holes are.

---

## Part 3 — Findings

**Findings 1–5** are unchanged from V1 and remain the basis of the plan: prune is unreachable until the
lean core lands; the GPU pack adds no new engines (**copy corrected and now gate-enforced, 2026-07-24**);
our cloud is a competitor's; telemetry could ship silent (**gate shipped, 2026-07-24**); country
geography is disclosed but uncollected.

### Finding 6 — We signed the wrong platform _(new, and the most consequential)_

Windows builds are configured `"sign": null`. There is no code-signing certificate in the lockbox. So
**every Windows user gets a full-screen SmartScreen wall: "Windows protected your PC — Unknown
Publisher."**

Hold that against **P1**: if a grandma can't do it without touching a terminal or fat-fingering a token,
it isn't done. A Microsoft scare screen calling our app dangerous is worse than a terminal. Most people
stop there.

Meanwhile we invested a full day and an automated pipeline in **macOS** signing — for roughly a fifth of
the desktop market. The normies and grandmas the entire strategy is denominated in are overwhelmingly on
Windows. The Mac work was necessary — it is the development machine — but sequencing Windows nowhere was
an error.

**Decision (P1):** Windows signing joins Phase 0 and starts immediately. The constraint is **calendar
time, not work**: certificate authorities verify business identity over days-to-weeks. Start now or it
becomes the item that blocks launch three months out.

---

## Part 4 — The plan

Two sequencing rules from the doctrine. **P3:** don't solve problems a much smarter model will solve
better in six months — build the seams, refuse speculative depth. **P4:** witch-hunt feature bloat —
so every phase carries an explicit *not doing* line.

Dates are estimates to be corrected, not commitments. Missing dates get ignored; wrong dates get fixed.

### Phase 0 — Ship what is finished, and unblock Windows · _through mid-Aug 2026_

| Item | Status |
|---|---|
| Staple + Gatekeeper-verify the notarized DMG, then the TCC persistence test | ⏳ automatic, watcher running |
| Engine-count copy corrected | ✅ done 2026-07-24 |
| `reality-check` invariant + release hard gate + CI wiring | ✅ done 2026-07-24 |
| Deploy the website | ⏸ awaiting Grant's approval |
| **Windows code-signing certificate** | 🔴 **not started — long lead time, start now** |
| Universal native addon (`--arch=x64` + `lipo`) so the Intel DMG works | ⏳ |
| Finish the interrupted `windy-stt-pro-ct2` upload to HuggingFace | ⏳ |
| **Legal review of the disclosure** — moved forward from GA | 🔴 **before the site deploys** |

**Done when** a tag produces a signed, notarized macOS build **and** a signed Windows build **and** a
live site, with no manual steps, and the packaged app is proven to phone home.
**Not doing:** any new user-facing feature.

### Phase 1 — The keystones · _mid-Aug → Oct 2026_

Reordered from V1. **Lean core goes first**, not the engine interface: it is the only keystone a user
can feel, it fixes download weight, notarization time and prune in one move, and it is what makes
Windows distribution viable — nobody downloads 4.4 GB onto a five-year-old HP laptop.

1. **Lean core + on-demand everything.** Small app, engines fetched as needed.
2. **One engine interface.** Audio in, text out — CPU, CUDA, Metal, MLX, remote all interchangeable.
3. **One capability probe.** First run detects hardware and language, configures perfectly, asks nothing. This *is* P1 made concrete.
4. **Provider registry.** A second Veron, or AWS, becomes a config row.
5. **Telemetry completion** — country capture, install↔account join. The dashboard becomes real.
6. **Minimal encrypted capture** — pulled forward out of Phase 5 (see Part 6).
7. **Clean-machine smoke test** — the other half of the no-silent-no-ops invariant.

**Not doing:** any new user-facing feature.

### Phase 2 — Cloud compute, the first profit center · _Oct → Dec 2026_

Containerize the engine for CUDA, run it on Veron 1 behind its tunnel, token-gated, as provider one.
Then **build LLM polish for real** — the switch that currently does nothing becomes the premium
centerpiece, with a small local model option for privacy-conscious users on capable hardware.

**Decision (P2):** Veron 1 is where we **prove** cloud compute, not where we **sell** it. It is a
consumer GPU on a residential connection in someone's house; one storm and paying customers lose
service. Take money only once a real provider sits behind the registry.

**Not doing:** billing, tiers, or a paywall until the thing being sold works.

### Phase 3 — The local Cadillac · _Dec 2026 → Feb 2027_
One backend at a time behind the interface: Apple GPU first (works on hardware we own today), then MLX,
then CUDA, then the Neural Engine. **Done when** the flagship runs faster than real time on a Mac,
against ~1.1× today.

### Phase 4 — Global reach · _Q1 2027_
Website *and* app in the user's language, plus language-specialist packs on demand. **Done when** a
Chinese-primary user installs and gets a Chinese-optimized setup, not four English-only engines.

### Phase 5 — Storage and the endgame · _Q2 2027_
Full zero-knowledge WindyCloud, the portal, the meter, the one-tap opt-in. Then avatar ingestion and
Windy Clone as a marketplace. **Done when** we can demonstrate a file uploaded, retrieved on a second
device, and provably unreadable on our own servers — which is simultaneously the product, the legal
shield, and the marketing.

---

## Part 5 — Distribution: how anyone finds out we exist

V1 contained nothing on this. It planned the Trojan horse and everything behind the gates, and said
nothing about how the horse reaches Troy. **This was the largest hole in the document.** The entire
strategy is denominated in a hundred million users; telemetry pointed at users we don't have is
instrumentation aimed at an empty room.

**Phase 0.5 — the first thousand · _Sept 2026_**

- **One channel, done properly**, not five done badly (**P4**). The product is visual and instantly
  demonstrable: someone speaks, text appears where their cursor is. That demos in eight seconds.
- **Instrument arrival, not just usage.** Where did they come from, did they finish installing, did
  they transcribe once, did they come back on day 7. Install-to-first-transcript is the number that
  matters, and today nothing measures it.
- **Referral-for-storage** (see Part 1) is the built-in loop — it costs us capacity we already planned
  to give away.
- **Success is not a download count.** It is: 1,000 installs, a measured day-7 return rate, and ten
  conversations with people who quit — because *why they quit* is the only thing that improves the
  product.

**Not doing:** paid acquisition before the day-7 number is known. Buying users for a product that
doesn't retain is setting money on fire.

---

## Part 6 — Unresolved contradictions

V1 never named these. Both need answers on paper **before** we take custody of anyone's recordings.

### Zero-knowledge encryption contradicts the Windy Clone business
If we hold only ciphertext and only the user holds the key, **we cannot use that data to build
avatars.** The pitch — "we already hold the training data, we're the castle" — quietly assumes we can
read it. By design, we can't.

Resolvable: the user releases a key for one specific job; we process and forget. But that has to be
designed deliberately, or we discover the contradiction after promising both.

### Grandma will lose her key
Zero-knowledge means that when she does, her hundreds of hours are gone forever and **we cannot help
her.** P1 (grandma-proof) and the zero-knowledge premise collide head-on. Every honest answer —
recovery keys, social recovery, an escrow the user opts into — weakens the guarantee somewhat. The
answer must be chosen consciously and disclosed plainly, not discovered at the first support ticket.

### The thesis argues against the ordering
Our strategic core is *today's recordings appreciate in value*. If true, every month without ingestion
is data permanently lost — you cannot retroactively record someone's 2026. Yet storage was scheduled
**last**.

**Decision:** pull a *minimal* encrypted capture path into Phase 1 — not the portal, not the
marketplace, just "your recordings can be safely kept." Start the flywheel while the rest is built.

---

## Part 7 — The three enhancements

V1 listed fifteen. A plan that preaches minimalism while enumerating fifteen additions is not practicing
it (**P4**). Cut to three commitments; the rest are ideas and live in `EXECUTION-PLAN.md`, not here.
**One in, one out** — nothing joins this plan without something leaving it.

1. **The reality-check gate.** ✅ shipped. Cheapest, highest-value item in this document.
2. **Make the honesty visible.** An in-app privacy dashboard showing exactly what is local, what is
   encrypted, and the content-free telemetry we send. Google and Facebook are structurally incapable of
   shipping this screen — which makes it marketing, not overhead.
3. **Retire the competitor cloud path.** Track it as debt with a removal date, not as a feature.

### And one number we must start measuring
**P1 says honey-badger stability beats features — but the plan has no stability metric.** You cannot
defend a claim you don't measure. One crash-free-session rate, tracked from the first release, that has
to hold before each subsequent one.

---

## Part 8 — What only Grant can do

Everything else is mine. These five are not — and they are ordered by how much the calendar punishes
delay.

| | Item | Why it can't wait |
|---|---|---|
| 1 | **Buy a Windows code-signing certificate** | Days-to-weeks of identity verification. Pure waiting. Blocks the majority platform. |
| 2 | **Legal counsel on the disclosure** | We start collecting emails the day the site deploys. Review must precede collection, not follow it. |
| 3 | **Deploy approval for windyword.ai** | Outward-facing. Copy fix is done; needs one word. |
| 4 | **A Mac registered as a build machine** | Apple signing legally requires macOS; the Linux runner can't. This M4 or OC5. |
| 5 | **The spend decision on cloud compute** | When Veron 1 is outgrown. |

---

## The critical path

```
Phase 0  close out + Windows cert  ─┐
         legal review              ─┤
                                    ├─→  K1 Lean core  ─┬─→  Phase 2  Cloud + LLM polish
Phase 0.5  first thousand users   ──┤    K2 Engine seam ├─→  Phase 3  Apple/NVIDIA runtimes
                                    │    K3 Probe       ├─→  Phase 4  i18n + language packs
                                    └────K4 Registry   ─┴─→  Phase 5  Storage → avatars → Clone
```

The keystones are a gate. Build them once, properly, and the phases behind them stop being a queue and
become four workstreams the fleet runs simultaneously.

**Above all of it sits the invariant: no silent no-ops.** It is the only thing in this document that
protects every other thing in it.
