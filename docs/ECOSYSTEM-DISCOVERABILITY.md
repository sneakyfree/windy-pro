# Windy Ecosystem — Discoverability & Cross-Product Model

**Status:** Design proposal, revised 2026-04-19 (v2 — grounded in actual infrastructure)
**Scope:** How users discover, enable, and navigate the multi-product Windy ecosystem without being marketed-at or overwhelmed. Complements `AGENT-ARCHITECTURE.md` and assumes the cross-service plumbing already present in the ecosystem (Eternitas identity, Matrix/mail localpart alignment, shared Push Bus, lifecycle webhooks).

---

## 1. Brand structure

| Layer | Name | Notes |
|---|---|---|
| Identity system | **Eternitas** | `eternitas.ai`; passport format `ET26-XXXX-XXXX`; 5-layer credential stack |
| Engineering repo / codename for the Electron app | `windy-pro` | Existing repo; stays named this |
| Consumer-facing Electron app | **Windy Word** | Desktop wrapper marketed to end users |
| Web products | windychat · windymail · windycloud · windyfly · windyword · windyclone · windycode · windytranslate · windytraveler · eternitas · hifly · etc. | Each standalone at its own domain |
| Ecosystem umbrella | **The Windy ecosystem** | How products collectively self-identify |

The Electron app is marketed as **Windy Word** because voice-to-text is the concrete job it does that needs OS-level features. The rest of the ecosystem is browser-first (see §10).

---

## 2. Core principles

### 2.1 Every product is standalone

Any Windy product must be fully functional with zero awareness of the rest. windychat is a great chat app even if someone never touches windymail. windymail is a great email client even if someone never hatches an Eternitas agent. Integration is a **reward**, not a requirement.

This mirrors Google, Apple, Notion, JetBrains, Adobe — every successful multi-product company. Never Meta / LinkedIn (see anti-patterns in §7).

### 2.2 The agent is optional-but-present

Default agent posture is **passive** (agent exists, responds when addressed, does not autonomously act). "Active mode" (agent takes initiative) requires explicit opt-in. See `AGENT-ARCHITECTURE.md` §§4-6 for the Eternitas-gated permission and memory model.

A user who never turns on the agent still gets a fully working Windy product. The agent is a layer you can add, not a thing you can't remove.

### 2.3 Discovery via integration, not marketing

Users discover sibling products because they're doing something where the sibling product would help — not because we interrupted them with an ad. Golden rule: **never surface a sibling product in a context where the user can't immediately use it.**

### 2.4 The cross-service plumbing already exists

Three real infrastructure pieces already wire the ecosystem together:

- **Eternitas lifecycle webhooks** (`POST /api/v1/webhooks/identity/created`, `POST /api/v1/webhooks/passport/revoked`, HMAC-SHA256-signed) — services provision or tear down eagerly on identity events
- **Matrix localparts align with mail addresses** — `grant.whitmer` on Matrix = `grant.whitmer@windymail.ai`. One canonical identity across every product.
- **Shared Push Bus** — `POST /api/v1/push/notify` (`X-Push-Bus-Token`) on `push-gateway:8103`. Canonical publish endpoint for every service. Gateway fans out to every registered device (FCM/APNs/Web Push). Already used by windymail, windychat, windyclone, windyfly, windycode.

This means new discoverability features don't need new plumbing — they piggyback on the bus and webhooks that are already shipped.

---

## 3. Case study: Google — "discoverable but not pushy"

**Primary: the 9-dot app launcher** (top-right of every product):
- Always present, always same position
- Opens to a grid of sibling products
- Zero notifications, badges, or motion
- Users who want to explore click; users who don't never notice

**Contextual cross-links:**
- Gmail attachments → "Save to Drive"
- Google Docs paste → "Open in Sheets"
- YouTube → "Share via Gmail"
- Each surfaces only when relevant to the user's current action

**One-time tour on signup; skippable; never re-shown.**

**Gentle periodic surfacing:** "What's new" in settings (user-initiated); occasional inbox banner for major features — capped to ~once per quarter, always dismissible.

**What Google does NOT do:** no perpetual banners, no notification badges on unused apps, no modal popups, no forced tutorials.

**Rating:** 9/10. Closest to what we want.

---

## 4. Case study: Apple — "invisible until relevant"

Apple's philosophy is the opposite of marketing — they hide cross-product promotion and let **integration reveal itself through use.**

**System-level surfaces:**
- **Share sheets** (OS-level) — hit share, Apple apps appear naturally (AirDrop, Notes, Messages, Mail)
- **Spotlight search** surfaces apps and their capabilities
- **Continuity / Handoff / AirDrop** — silent cross-device integration
- **Shortcuts app** — automation suggestions
- **Settings app** — one place for every Apple service; discovery happens while adjusting something else

**In-app cross-promotion: essentially zero.** Mail doesn't promote Notes. Notes doesn't promote Reminders. They just integrate.

Apple assumes if an app does its job well, users find related apps when needed. They bet on product quality driving organic discovery.

**Rating:** 10/10 for user respect, 6/10 for discoverability.

---

## 5. Case study: Microsoft — explicit-suite pitch

Prominent launcher grids, persistent Teams sidebar, "Open in X" everywhere. Works because their customer is **enterprise IT** — corporate admins have committed the org to the whole suite. Wrong pattern for individual-choice audiences like ours.

**Takeaway:** if Windy ever goes enterprise, revisit. For normies and pros, emulate Google/Apple.

---

## 6. Case study: Notion / Linear / Figma — the modern playbook

- **Empty states as discovery surfaces.** No files? Empty state shows templates. No cycles? Empty state explains them.
- **Template galleries / example pages** — opt-in
- **Cmd+K / keyboard palette** — features surface through user-initiated search, not push
- **Changelog page** — opt-in, user-initiated
- **Rare, dismissible banners for major launches** — once, then gone per user

**Rating:** 9/10. Very close to what we want.

---

## 7. Anti-patterns to avoid

| Company | Pattern | Why users hate it |
|---|---|---|
| **Meta / Facebook** | Persistent banners for Reels, Marketplace, Dating in every app | Feels desperate; destroys trust |
| **LinkedIn** | Popup "Have you tried LinkedIn News?" on every login | Interrupts intent |
| **Adobe Creative Cloud** | Upsell modals for other apps while using Photoshop | Feels like being nagged by the tool you paid for |
| **Any platform** | Red notification dots on unused features/apps | Poisons the notification system |

**Rank of ecosystem marketing approaches by user sentiment:**
Apple ≥ Notion/Linear > Google > Microsoft > Adobe > Meta.

Windy aims for the Apple / Notion / Google band. Never Adobe or Meta.

---

## 8. Recommendations for Windy

### 8.1 The 9-dot launcher (highest priority)

Top-right corner of every Windy product (web AND Electron). Opens a grid showing all Windy products:

- **Active** (user has enabled): normal icon + color
- **Inactive** (exists, not enabled): dimmed icon + "Enable" tooltip on hover
- **Dismissed** ("not interested"): hidden forever

Zero notifications, zero badges, zero motion. Silently available.

### 8.2 Contextual cross-links

Only when the user is doing something the sibling would help with. Concrete list:

| In product | Cross-link | Trigger |
|---|---|---|
| windychat | "Attach from windycloud" | User clicks attach |
| windychat | "Save conversation to windycloud" | Message thread context menu |
| windymail | "Reply via windychat" | Short reply to contact reachable in windychat |
| windyword | "Save transcript to windycloud" | Recording completes |
| windyword | "Send transcript via windymail" | User selects Share |
| windyfly | "Text from agent number" | Writing an SMS to a family contact |
| windycloud | "Open in windyword" | User has a `.windy-transcript` file |
| Any product | "Verify this agent" → eternitas.ai registry | Incoming message from an unknown `ET-*` sender |

Each link is an action button in-context, never a modal or banner. If the target product isn't enabled, clicking it triggers the enable flow (§8.5).

### 8.3 Grayed-out product tabs in Windy Word

Execution rules:

- **Peripheral position:** horizontal strip at the BOTTOM of the sidebar, or a small "+" affordance. Primary top-tab row is for actively-used things.
- **Muted styling:** lower opacity, no motion, no badges
- **Hover reveals a one-sentence tooltip:** "windyfly — your agent can make calls and send texts."
- **Clicking opens a lightweight preview**, not a forced install/subscribe prompt
- **User can dismiss a tab permanently** — remembered forever on this Eternitas identity
- **Never a notification badge or red dot.** Cardinal rule.

### 8.4 One-time onboarding tour

After the Hatch Ceremony completes (see `src/client/desktop/renderer/hatch-ceremony.js`), show a 30-second skippable walkthrough: "Welcome to the Windy ecosystem. Here are the products available to your agent. Enable what you want now, or add more later from the launcher." Never re-shown unless user clicks "Take the tour again" in settings.

Pairs naturally with the existing Hatch Ceremony's CTA row — the "Done" button can route to the tour the first time, straight to the agent DM on subsequent opens.

### 8.5 Per-product toggle in one settings surface

Single settings page (accessible from 9-dot launcher, from each product's settings, and from the agent when asked) showing every product with:
- Enable / disable toggle
- Short description
- Learn more link
- "Not interested — hide forever"

Never force a user to hunt for how to turn off a product they don't want. Enable / disable events are published to the shared Push Bus as `product.enabled` / `product.disabled` so every subscribed service (mail provisioning, chat room creation, etc.) can react.

### 8.6 The 90/10 ratio

**Active-product UI = 90% of what the user sees. Cross-product affordance = 10%.**

Google Gmail is ~95/5. Apple apps are ~98/2. Notion is ~95/5. Adobe / Meta flip this ratio and alienate users. Windy should hold 90/10 or tighter across every product.

---

## 9. What to market and when

### 9.1 Signup flow (the single big moment)

Driven by the existing Hatch Ceremony:

1. User lands on a Windy product (any of the `windy-*` sites)
2. Creates account → windy-pro account-server provisions identity
3. **Hatch Ceremony runs** (30-sec SSE stream; already built) — Eternitas passport issued, chat room created, mail address aligned, cloud quota allocated, brain assigned
4. Birth certificate shown with CTAs
5. Ecosystem tour (skippable)
6. Land in the product the user came for — fully functional

### 9.2 In-product discovery (ongoing, passive)

- 9-dot launcher always available
- Contextual cross-links in relevant actions
- Empty states hint at sibling products ("No files yet — try windycloud")

### 9.3 Re-engagement (rare, respectful)

- Changelog in settings (user-initiated)
- At most one email per month about ecosystem features — unsubscribable, honored permanently (and reflected in the user's Eternitas operator preferences)
- A "new features" indicator in the 9-dot launcher — a single subtle dot that appears once per major release and disappears after the launcher is opened

### 9.4 Forbidden forever

- Modal popups promoting other products
- Persistent banners inside products
- Notification badges on unused products
- Forced tutorials for products the user didn't ask about
- Any email more frequent than monthly about ecosystem-level announcements

---

## 10. Distribution model

### 10.1 Windy Word (the only desktop download)

Windy Word is the one product that genuinely needs OS-level integration — global hotkeys, system tray, audio capture, local file access, and the mechanic MCP server for self-repair. It gets the desktop installer. Inside, it can present other products as web-views when enabled — but users who only want voice-to-text never see another product unless they go looking.

### 10.2 All other products — browser-first PWAs

windychat, windymail, windycloud, windyfly, windyclone, windycode, windytranslate, windytraveler, eternitas, hifly — web apps at their respective domains. Install-as-PWA for users who want a desktop icon. No standalone Electron download per product.

**Why:** each Electron app is ~200MB; N apps = N × 200MB of disk plus N update loops. Browser-first is the modern pattern (Notion, Linear, Slack all work this way).

### 10.3 When to promote Windy Word

Only in windyword.ai context. "Download Windy Word for desktop hotkeys and tray integration" — shown once on the windyword.ai landing page and once in the product when the user tries a feature that works better with desktop. Never pushed in other products.

---

## 11. The ballroom demo pitch

> *"Every Windy product works perfectly on its own. Use one, use all of them — your choice. When you use more than one, they just start to know each other. Your Eternitas passport is the same across all of them. Your agent from windychat shows up in windymail because you let it. Your recordings from windyword save to windycloud because that's where you told them to go. Nothing is pushed on you. You're in control at every step."*

"In control at every step" is the line normies will repeat after the event. Memorable, trust-building, true.

---

## 12. Success metrics

- **% of users who enable a second product within 30 days of signup** — target: >30% organic (no nag)
- **% of users who dismiss the 9-dot launcher forever** — target: <5% (means it's not intrusive)
- **Support tickets about "stop showing me X"** — target: near-zero
- **Net promoter score after a ballroom event** — target: >50
- **Integrity Index average across the fleet** — target: >700 (indicates the ecosystem is enabling good agent behavior)

If any of these degrade after a change, revert the change. Discoverability never comes at the cost of trust.

---

## 13. Where this plugs into existing DNA strands

Not a net-new effort. Frame as extensions:

| Existing strand / service | New work |
|---|---|
| `windy-pro` renderer | 9-dot launcher component; grayed-out tabs; per-product settings toggle |
| `windy-pro/services/chat-onboarding` | Tour trigger after Hatch Ceremony |
| `push-gateway` | `product.enabled` / `product.disabled` event types |
| Each product's frontend (windychat/web, windymail/web, etc.) | 9-dot launcher embed + contextual cross-link wiring |
| `eternitas` | Store user preferences (dismissed products, tour completed flag, unsubscribes) against the passport |

Each gets a strand-status entry in its `DNA_STRAND_MASTER_PLAN.md`.

---

## 14. Open questions for future sessions

1. Does the 9-dot launcher unify across Windy and non-Windy products the user has connected (e.g. Gmail via OAuth)? Probably not in v1 — keep it Windy-only to avoid branding confusion.
2. How does the agent handle ecosystem discovery? If a user asks the agent "can I do X?", should the agent proactively suggest enabling a sibling product? Yes, but only when the user's question indicates intent. The agent should remember per-user preferences from the soul file ("this user said no to windyfly once — don't re-suggest").
3. What does "enabling" a product cost? Free tier probably covers all products at modest limits; paid tier bundles them. Decide pricing structure in a separate session.
4. Do we ever recommend sibling products in marketing *outside* the Windy ecosystem (e.g. a windychat landing page mentioning windymail)? Yes — external marketing has different rules than in-product. Decide per campaign.
