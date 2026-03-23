# BRAND-ARCHITECTURE.md — The Windy Family

_Last updated: 19 March 2026_
_Status: ACTIVE — This is the canonical source of truth for all branding decisions._

---

## The Vision

Five interlocking companies that form a flywheel — each one feeds the others, but each can stand alone. Every product makes every other product more valuable.

**Tagline:** _"Stop typing through a straw. Speak your vision into existence."_

---

## The Family

### 🎙️ Windy Word
**What it does:** Voice recording → text transcription (Speech-to-Text)
**Role in the family:** The gateway. Customer acquisition engine. Top of the funnel.
**Website:** windyword.com
**Revenue model:** Subscriptions + lifetime purchases
**Pricing tiers:**
- **Free:** $0 — 1 language, 3 engines, 2-min recordings
- **Windy Pro:** $99 lifetime / $49/yr / $4.99/mo — All 15 engines, 99 langs, 15-min
- **Windy Ultra:** $199 lifetime / $79/yr / $8.99/mo — + 60-min, translation, 25 pairs _(RECOMMENDED)_
- **Windy Max:** $299 lifetime / $149/yr / $14.99/mo — + unlimited, TTS, glossaries, 100 pairs
**Platforms:** Desktop (Electron), iOS, Android
**Ship priority:** #1 — Ships first, generates revenue, proves the market

### 🌍 Windy Traveler
**What it does:** Translation engine marketplace — language pair specialist models
**Role in the family:** The cash cow. Pure margin once models are built.
**Website:** windytraveler.com
**Revenue model:** Individual pairs ($6.99 each) + bundles
**Bundles:**
- **Traveler:** $49 — 25 pairs
- **Polyglot:** $149 — 200 pairs
- **Marco Polo:** $399 — ALL 3,500+ pairs
**The moat:** 2,500 fine-tuned translation pair models. Each is a legally distinct derivative work via LoRA.
**Ship priority:** #2 — Pairs already being built (1,188 on HuggingFace, targeting 2,500). Monetized through Windy Word from day one.

### 💬 Windy Chat
**What it does:** Encrypted messaging with built-in real-time translation
**Role in the family:** The distribution engine. Every cross-language conversation drives Traveler pair purchases.
**Website:** windychat.com
**Revenue model:** Freemium + premium features
**Architecture:** Matrix protocol — E2E encrypted, decentralized
**Strategic vision:** WhatsApp killer. First bot-to-bot communication platform. Agent-friendly.
**Ship priority:** #4 — Needs critical mass of users and a working Traveler engine first

### 🧬 Windy Clone
**What it does:** Converts accumulated voice & text data into a digital likeness — voice clone, avatar, soul file
**Role in the family:** The moonshot. Smallest market today, enormous market in 3-5 years.
**Website:** windyclone.com
**Revenue model:** TBD — likely subscription for ongoing clone refinement
**Strategic vision:** Digital identity persistence. The consumer entry point to digital immortality.
**Ship priority:** #3 — Builds on data from Windy Word users over time

### ☁️ Windy Cloud
**What it does:** Storage, sync, and model delivery infrastructure across all four products
**Role in the family:** The backbone. Every product depends on it.
**Website:** windycloud.com
**Revenue model:** Included in subscriptions + enterprise tiers. Potential future platform play for third-party developers.
**Ship priority:** #5 — Exists as internal infrastructure from day one, becomes an external product later

---

## Parent Company

**TBD** — Under consideration. Candidates include:
- Windy Labs
- Windy Pro Labs (current working name)
- Windstorm Inc
- Other

The parent company is the holding entity that owns stakes in all five product companies. Enables:
- Selling individual companies without losing the others
- Taking investment in one product without diluting the rest
- Tax and liability isolation
- Independent valuations per product

---

## The Flywheel

```
Windy Word (captures voice → text data)
    ↓
Windy Traveler (translates that text → sells pair models)
    ↓
Windy Chat (uses translations in real-time messaging → distribution)
    ↓
Windy Clone (uses ALL accumulated voice/text data → digital likeness)
    ↓
Windy Cloud (stores and syncs everything → infrastructure backbone)
    ↑
    └── feeds back to Word (more devices, more capture)
```

---

## Naming Philosophy

### Why "Windy Word"?

The concept of **creative power through spoken word** is the single most universal theological idea on Earth:

| Tradition | Concept | Believers |
|-----------|---------|-----------|
| Judaism | Ten Utterances — "And God said, let there be light" | ~15M |
| Christianity | Logos — "In the beginning was the Word" (John 1:1) | ~2.4B |
| Islam | Kun fayakun — "Be, and it is" (appears 8× in the Quran) | ~1.9B |
| Hinduism | Om / Vak / Shabda — primordial creative sound | ~1.2B |
| Sikhism | Shabad — the divine Word that created the universe | ~30M |
| Zoroastrianism | Manthra — sacred utterance with creative power | ~200K |
| **Total** | | **~5.5 billion people** |

"Windy Word" taps into a concept that 5.5 billion people already believe: **the spoken word has the power to create reality.** This isn't clever marketing — it's a universal human truth built into the product name.

### Naming Rules

- Every product name is **descriptive** — tells you what it does without explanation
- Every product name passes the **cocktail party test** — list them and people _get it_
- **"Pro"** is reserved as a **tier modifier**, not a product name (Windy Word Pro, Windy Traveler Pro, etc.)
- All names are **short, memorable, and don't collide** with major existing brands

---

## Model Protection Architecture

### The Threat
Buy Marco Polo ($399) → download all 3,500+ .bin model files → airplane mode → request refund → keep models forever.

### Defense Stack (4 layers)

1. **Encrypted Model Files** — Models stored encrypted with AES-256. Key derived from `HKDF(licenseToken + deviceId + appSecret)`. No valid license on this device = useless blobs. Decryption in memory only, never written unencrypted to disk.

2. **License Heartbeat** — App checks entitlement every 48 hours. Tiered offline grace periods:
   - Free: 24 hours
   - Pro: 7 days
   - Ultra: 14 days
   - Max / Marco Polo: 30 days
   - After grace period: models locked (not deleted) until re-verified

3. **RevenueCat Refund Webhooks** — When Apple/Google processes a refund, RevenueCat fires an event → flag user → next online check = models locked and deleted.

4. **Model Watermarking** — Each downloaded model gets a micro LoRA modification unique to the buyer's license ID. Invisible to performance, forensically traceable if models appear on torrent sites.

### What We Accept
- Jailbreak/root extraction of raw weights cannot be prevented (same problem Netflix/Spotify face)
- People who would do this were never going to pay anyway
- The 30-day money-back guarantee is safe — Apple/Google have anti-abuse systems, and our heartbeat catches the rest

---

## Current Repository Structure

| Repo | Contains | Status |
|------|----------|--------|
| `windy-pro` (GitHub: sneakyfree/windy-pro) | Desktop Electron app, Python backend, installer wizard, account server | Active |
| `windy-pro-mobile` (GitHub: sneakyfree/windy-pro-mobile) | React Native + Expo mobile app (iOS + Android) | Active |

Both repos will be rebranded to reflect the Windy Word name when the time is right. This file lives in both repos as the single source of branding truth.

---

## Key Dates

- **2025:** Windy Pro development begins (desktop + mobile)
- **2026-01:** HuggingFace model pipeline starts (target: 3,500+ pairs)
- **2026-03-19:** Brand architecture formalized (this document)
- **TBD:** Domain purchases, website launches, app store listings updated

---

_This document is the canonical reference for all branding, naming, and product family decisions. All AG tabs, Kit clones, and developers should read this before doing any branding-related work._
