# Legal review checklist — Windy Word free tier

_Prepared 2026-07-24 for counsel. Companion to the draft at `/disclosure`
(`src/client/web/src/pages/Disclosure.jsx`), the Privacy Policy, and the Terms._

**Written by an engineer, not a lawyer.** Nothing here is legal advice. It is a list of the places
where I believe our intended business model touches regulated ground, written so counsel can spend
their time answering questions rather than reverse-engineering the product.

## What the product actually does today (so the review matches reality)

| | |
|---|---|
| Transcription | Runs **on the user's machine**. Audio, video, and text never leave the device by default. |
| Account | Email + password. Required for the free download. |
| Usage telemetry | Counts, durations, session lengths, device counts, engine choice, app version, OS. **No content.** Country-level geography is disclosed but **not yet collected** — see Q7. |
| Cloud transcription | Exists, opt-in, currently routed to **third-party providers (OpenAI, Groq)**. Being replaced with our own hardware. |
| WindyCloud storage | Backend exists; **not generally available**. Files are currently stored **unencrypted at rest by us** — end-to-end encryption is planned, not built. |
| Windy Clone (voice/avatar) | **Does not exist.** Described in the disclosure only to set expectations before users accumulate recordings. |

## The business model, stated plainly

Free app, forever, in exchange for an email address and permission to market a few times a year — by
email and by in-app message. Later, three optional paid offerings: cloud compute, cloud storage, and
voice/avatar cloning built from the user's own accumulated recordings.

The strategic premise is that users accumulate **years of their own voice and video** on their
machines, and that this becomes valuable to them later. That premise is precisely what makes the
questions below load-bearing.

---

## Questions for counsel, in priority order

### Q1 — Does storing voice recordings, before any cloning, already trigger biometric law?
This is the question I am least able to answer and most worried about.

Illinois **BIPA** carries a private right of action with statutory damages per violation, and requires
written release **before** collection. Texas **CUBI** and Washington **HB 1493** are adjacent. Our plan
has users accumulating voice and video for months or years *before* any cloning feature exists.

- Does audio held **on the user's own device**, which we cannot access, constitute collection by us?
- Does audio a user uploads to **our** storage become a biometric identifier in our possession, even if
  we never process it biometrically?
- Does the answer change once Windy Clone exists and that same stored audio becomes trainable?
- What consent must be captured, and **at what moment** — signup, upload, or cloning?

If collection begins at upload rather than at cloning, our consent flow is in the wrong place and the
disclosure needs restructuring before WindyCloud ships.

### Q2 — Our email consent is opt-out. Is that sufficient outside the US?
The draft follows the US **CAN-SPAM** model: we may email, users may unsubscribe. My understanding is
that this is **not** sufficient under EU **GDPR/ePrivacy** (prior opt-in) or Canada's **CASL** (express
consent, significant penalties).

- Do we need a geo-conditional opt-in checkbox at signup rather than a global opt-out?
- Does the "soft opt-in" for existing customers cover a free account with no purchase?
- Same question for **in-app marketing messages** — are they treated as electronic messages under CASL?

### Q3 — Is routing data to third-party cloning vendors a "sale" or "sharing" under CCPA/CPRA?
Windy Clone is intended as a **marketplace**: we would act as intermediary and pass user data to
outside cloning providers.

- Does that make us a seller/sharer requiring a "Do Not Sell or Share My Personal Information" link?
- Biometric data is **sensitive personal information** under CPRA — what additional limits apply?
- What contractual terms (DPAs, sub-processor disclosure) must be in place with each vendor?

### Q4 — Digital replica and right-of-publicity statutes
Tennessee's **ELVIS Act**, California's digital-replica statutes, and New York's right of publicity all
bear on synthesized voice and likeness.

- What consent language is required to create a replica of a user's own voice/likeness for their own use?
- What changes if a user later wants to license or sell their own clone through our marketplace?
- What is our exposure if a user uploads recordings of **someone else** and clones them? Assume this
  will happen. What detection or attestation is expected of us?

### Q5 — Governing entity, jurisdiction, and the terms we don't have
- Which entity contracts with users — **Windstorm Labs LLC**? (Certificate of organization is on file.)
- Governing law and venue.
- Are arbitration and class-action waiver advisable given BIPA's private right of action?
- Limitation of liability, particularly for **data loss** — see Q6.

### Q6 — The key-loss problem
We intend end-to-end encryption where only the user holds the key. That means **if a user loses their
key, their data is unrecoverable by anyone, including us.** Our target user is explicitly
non-technical.

- What disclosure is required for irreversible data loss of this kind?
- Does offering optional key escrow or recovery create obligations that defeat the purpose?
- Does "we cannot recover your data" survive as a limitation of liability, or is it a consumer-protection
  problem?

### Q7 — Disclosure/implementation mismatches (I have flagged these to engineering)
Counsel should know that the following are **stated but not yet true**, and tell us which must be
corrected before the page goes live rather than after:

1. **Country-level geography** is disclosed but never collected. Over-disclosure — we describe
   collection we do not perform. *(Being fixed in Phase 1.)*
2. **Encryption of stored files.** The draft deliberately avoids claiming end-to-end encryption because
   it is not implemented. Please confirm the current wording does not imply more than we do.
3. **Cloud transcription** currently sends audio to OpenAI and Groq. The Privacy Policy names them.
   Confirm this is adequately disclosed and that the sub-processor relationship is papered.

### Q8 — Age assurance
The draft states 13+ with parental permission under 18. There is currently **no age gate mechanism** —
only a sentence.

- Is a self-attestation checkbox sufficient, or is verifiable parental consent required?
- **COPPA** exposure if under-13 users sign up despite the statement?
- Does the biometric angle raise the effective age floor?

### Q9 — International data transfer
- Where should the storage bucket be located, and do we need EU-region storage for EU users?
- Standard contractual clauses for transfers out of the EU/UK?

---

## What we will not do (so counsel can hold us to it)

- We do not sell user **content**.
- We do not sell email addresses.
- We do not read, listen to, or upload content the user has not explicitly chosen to send.
- We do not use a user's voice or likeness for our own marketing without separate, specific permission.
- We do not treat account signup as consent for cloud upload or cloning. Each is asked separately, at
  the moment it happens.

These are product commitments, already reflected in the draft and enforced in the codebase's design.
If any of them creates a legal problem rather than solving one, we would rather hear it now.

---

## Practical asks

1. **Redline the disclosure** at `/disclosure` — it is deliberately plain-language, and we would like to
   keep it readable by a non-technical adult even after review.
2. Tell us the **minimum** that must change before we can accept signups from the public, separately
   from what should change before general availability. We are trying to sequence correctly rather than
   block everything on a full review.
3. Flag anything in the **business model itself** — not just the wording — that will not survive
   contact with the law, while it is still cheap to change.
