# Windy Ecosystem — Discoverability & Cross-Product Model

**Status:** Design proposal, 2026-04-19
**Scope:** How users discover, enable, and navigate the multi-product Windy ecosystem (windychat, windymail, windycloud, windyfly, windyword, etc.) without being marketed-at or overwhelmed. Complements `AGENT-ARCHITECTURE.md`.

---

## 1. Brand structure

| Layer | Name | Notes |
|---|---|---|
| Engineering repo / codename | `windy-pro` | Existing repo; stays named this for continuity |
| Consumer-facing Electron app | **Windy Word** | The desktop wrapper normies download |
| Web products | windychat · windymail · windycloud · windyfly · windyword · etc. | Each standalone at its own domain |
| Ecosystem umbrella | **The Windy ecosystem** | How Windy products collectively self-identify |

The Electron app is marketed as "Windy Word" (voice-to-text with an agent) because voice-to-text is the concrete job it does that needs OS-level features. The rest of the ecosystem is browser-first (see §5).

---

## 2. Core principles

### 2.1 Every product is standalone

Any Windy product must be fully functional with zero awareness of the rest of the ecosystem. windychat is a great chat app even if a user never touches windymail. windymail is a great email client even if a user never hatches an agent. Integration is a **reward**, not a requirement.

This mirrors Google, Apple, Notion, JetBrains, Adobe — every successful multi-product company. Never Meta/LinkedIn (see anti-patterns in §8).

### 2.2 The agent is optional-but-present

Default agent posture for new users is **passive** — the agent exists, responds when addressed, but does not autonomously act. "Active mode" (agent takes initiative) requires explicit opt-in. See `AGENT-ARCHITECTURE.md` §§5, 10 for the capability gating and permission model.

A user who never turns on the agent still gets a fully working Windy product. The agent is a layer that can be added, not a thing that can't be removed.

### 2.3 Discovery happens via integration, not marketing

Users discover sibling products because they're doing something where the sibling product would help — not because we interrupted them with an ad. The golden rule: **never surface a sibling product in a context where the user can't immediately use it.**

---

## 3. Case study: Google (the "discoverable but not pushy" gold standard)

**Primary mechanism — the 9-dot app launcher** (top-right of every Google product):
- Always present, always same position
- Opens to a grid of sibling products
- Zero notifications, badges, or motion
- Users who want to explore click it; users who don't never notice it

**Contextual cross-links (second layer):**
- Gmail attachments → "Save to Drive"
- Google Docs paste → "Open in Sheets"
- YouTube → "Share via Gmail"
- Each surfaces only when relevant to the user's current action

**One-time tour on signup:**
- Optional, skippable, dismissible forever
- Not re-shown

**Gentle periodic surfacing:**
- "What's new" section in settings (user-initiated)
- Occasional inbox banner for major features — capped to ~once per quarter, always dismissible

**What Google specifically does NOT do:**
- No perpetual banners
- No notification badges on unused apps
- No modal popups
- No forced tutorials for products the user didn't ask about

**Rating:** 9/10. The ecosystem we should closest emulate.

---

## 4. Case study: Apple (the "invisible until relevant" philosophy)

Apple's approach is the opposite of marketing — they **hide** cross-product promotion entirely and let integration reveal itself through use.

**System-level surfaces:**
- **Share sheets** — OS-level. Hit share, Apple apps appear naturally (AirDrop, Notes, Messages, Mail). Primary discovery mechanism.
- **Spotlight search** — surfaces apps and their capabilities when searching
- **Continuity / Handoff / AirDrop** — silent cross-device integration; feels like magic
- **Shortcuts app** — automation suggestions
- **Settings app** — ONE place for every Apple service; discovery happens while adjusting something unrelated

**In-app cross-promotion: essentially zero.** Mail doesn't promote Notes. Notes doesn't promote Reminders. They just integrate.

**New device setup is the one aggressive moment** — iPhone/Mac setup walks through the ecosystem once, then never again.

**Core principle:** if a product does its job well, users find related apps when they need them. Apple bets on quality driving organic discovery.

**Rating:** 10/10 for user respect, 6/10 for discoverability. Users already-in-Apple-orbit benefit; users new to Apple may miss features that exist.

---

## 5. Case study: Microsoft (explicit-suite pitch)

**Approach:** prominent launcher grids, persistent Teams sidebar, "Open in X" everywhere, heavy cross-links.

**Why it works for them:** their customer is **enterprise IT**, not the end user. Corporate admins have already committed the org to the whole suite. Microsoft isn't marketing — they're enabling already-committed users to find their tools.

**Takeaway for Windy:** if the customer is an individual choosing a la carte (our case: normies and pros), emulate Google/Apple. Microsoft's approach would feel pushy to our audience. If Windy ever goes enterprise/team, revisit.

**Rating:** works for context, wrong for ours.

---

## 6. Case study: Notion, Linear, Figma (the modern playbook)

- **Empty states as discovery surfaces.** No files in Figma? Empty state shows templates. No cycles in Linear? Empty state explains cycles. Discovery is opt-in by inaction.
- **Template galleries / example pages.** Users who click learn; users who don't aren't bothered.
- **Cmd+K / keyboard palette.** Features surface through user-initiated search, not push.
- **Changelog page** — opt-in, user-initiated.
- **Rare, dismissible banners for major launches** — once, then gone forever per user.

**Rating:** 9/10. Very close to what we want for Windy.

---

## 7. Anti-patterns to avoid

| Company | Pattern | Why users hate it |
|---|---|---|
| **Meta / Facebook** | Persistent banners for Reels, Marketplace, Dating in every app | Feels desperate; destroys trust |
| **LinkedIn** | Popup "Have you tried LinkedIn News?" on every login | Interrupts intent; users learn to mash Escape |
| **Adobe Creative Cloud** | Upsell modals for other apps while using Photoshop | Feels like being nagged by the tool you paid for |
| **Any platform** | Red notification dots on unused features/apps | Poisons the notification system; users either disable notifications entirely or learn to ignore them |

Rank of ecosystem marketing approaches by user sentiment:

**Apple ≥ Notion/Linear > Google > Microsoft > Adobe > Meta**

Windy aims for the Apple/Notion/Google band. Never Adobe or Meta.

---

## 8. Recommendations for Windy

### 8.1 The 9-dot launcher (highest priority)

Top-right corner of every Windy product (web AND Electron). Opens a grid showing all Windy products:

- **Active products** (user has enabled them): normal icon + color
- **Inactive products** (exist, user hasn't enabled): dimmed icon + "Enable" tooltip on hover
- **Dismissed products** (user said "not interested"): hidden entirely (remember this choice permanently)

Zero notifications, zero badges, zero motion. Silently available.

### 8.2 Contextual cross-links

Surface sibling products only when the user is doing something the sibling would help with.

| In product | Cross-link | Trigger |
|---|---|---|
| windychat | "Attach from windycloud" | User clicks attach button |
| windychat | "Save conversation to windycloud" | User selects message thread context menu |
| windymail | "Reply via windychat" | User composing a short reply to a contact reachable in windychat |
| windyword | "Save transcript to windycloud" | User completes a recording |
| windyword | "Send transcript via windymail" | User selects "Share" on a transcript |
| windyfly | "Text from agent number" | User writing an SMS to a family contact |
| windycloud | "Open in windyword" | User has a `.windy-transcript` file |

Each link is an action button in-context, never a modal or banner. If the target product isn't enabled, clicking it triggers the enable flow (§8.5).

### 8.3 Grayed-out product tabs in Windy Word Electron

Execution rules so it drives flywheel without nagging:

- **Peripheral position**: horizontal strip at the BOTTOM of the sidebar, or a small "+" affordance — never a primary top-tab row. Primary position is for things the user actively uses.
- **Muted styling**: lower opacity, no motion, no badges
- **Hover reveals one-sentence tooltip**: "windyfly — your agent can make calls and send texts."
- **Clicking opens a lightweight preview**, not a forced install/subscribe prompt
- **User can dismiss a tab permanently** ("Not interested in windyfly") and it stays hidden forever on this account
- **Absolutely no notification badge or red dot.** Ever. For any reason. This is the cardinal rule.

### 8.4 One-time onboarding tour (on signup, once)

After hatching, show a 30-second skippable walkthrough: "Welcome to the Windy ecosystem. Here are the products available to you. Enable what you want now, or add more later from the launcher." Every subsequent login: no tour, no nag. Available from settings as "Take the tour again" for users who want it.

### 8.5 Per-product toggle in one settings surface

Single settings page (accessible from 9-dot launcher, from each product's settings, and from the agent when asked) showing every product with:
- Enable / disable toggle
- Short description
- Learn more link
- "Not interested — hide forever" option

Never force a user to hunt for how to turn off a product they don't want.

### 8.6 The 90/10 ratio

**Active-product UI = 90% of what the user sees. Cross-product affordance = 10%.**

Google Gmail main window is ~95% email, ~5% launcher + nav. Apple apps skew further, more like 98/2. Notion is ~95/5. Adobe / Meta flip this ratio and alienate users. Windy should hold 90/10 or tighter across every product.

---

## 9. What to market and when

### 9.1 Signup flow (the single big moment)

New user signs up at any windy-\*.ai/.com. Onboarding asks in sequence:
1. Create account (email + password or SSO)
2. Hatch agent? [optional] → if yes, short personality-config wizard
3. Show the ecosystem tour (skippable)
4. Land them in the product they came for — fully functional

### 9.2 In-product discovery (ongoing, passive)

- 9-dot launcher always available
- Contextual cross-links in relevant actions
- Empty states hint at sibling products ("No files yet — try windycloud")

### 9.3 Re-engagement (rare, respectful)

- Changelog in settings (user-initiated)
- At most one email per month about new ecosystem features (unsubscribable, honored permanently)
- A "new features" indicator in the 9-dot launcher — a single subtle dot that appears once per major release and disappears after the launcher is opened

### 9.4 Forbidden forever

- Modal popups promoting other products
- Persistent banners inside products
- Notification badges on unused products
- Forced tutorials for products the user didn't ask about
- Any email more frequent than monthly about ecosystem-level announcements

---

## 10. Distribution model

### 10.1 Windy Word (Electron app) — the only desktop download

Windy Word is the one product that genuinely needs OS-level integration (global hotkeys, system tray, audio capture, local file access). It gets the desktop installer. It can present other products as web-views in tabs when the user enables them — but users who only want Windy Word voice-to-text never see another product unless they go looking.

### 10.2 All other products — browser-first PWAs

windychat, windymail, windycloud, windyfly — web apps at their respective domains. Install-as-PWA for users who want a desktop icon. No standalone Electron download for each; the web version is the primary version.

**Why:** each Electron app is ~200MB; five apps = 1GB+ of disk space and five separate update loops. Browser-first is the modern pattern (Notion, Linear, Slack all are browser-first with optional desktop wrappers).

### 10.3 When to promote Electron

Only in windyword context. "Download Windy Word for the desktop hotkeys and tray integration" — shown once on the windyword.ai landing page and in the product when user tries a feature that works better with desktop. Never pushed in other products.

---

## 11. The ballroom demo pitch

> *"Every Windy product works perfectly on its own. Use one, use all of them — your choice. When you use more than one, they just start to know each other. Your agent from windychat shows up in windymail because you let it. Your recordings from windyword save to windycloud because that's where you told them to go. Nothing is pushed on you. You're in control at every step."*

"In control at every step" is the line normies and grandmas will repeat after the event. Memorable, trust-building, true.

---

## 12. Success metrics (how we know this is working)

- **% of users who enable a second product within 30 days of signup** — target: >30% organic (no nag)
- **% of users who dismiss the 9-dot launcher forever** — target: <5% (means it's not intrusive)
- **Support tickets about "stop showing me X"** — target: near-zero
- **Net promoter score after ballroom demo** — target: >50

If any of these metrics degrade after a change, revert the change. Discoverability never comes at the cost of trust.

---

## 13. Open questions for future sessions

1. Does the 9-dot launcher unify across Windy and non-Windy products the user has connected (e.g. Gmail via OAuth)? Probably not in v1 — keep it Windy-only to avoid branding confusion.
2. How does the agent handle ecosystem discovery? If user asks their agent "can I do X?", should the agent proactively suggest enabling a sibling product? Almost certainly yes — but only when the user's question indicates intent. See AGENT-ARCHITECTURE.md §10 on how the agent's soul file can remember per-user preferences ("this user said no to windyfly once — don't re-suggest it unless circumstances change").
3. What does "enabling" a product actually cost / take? If windycloud requires storage allocation, that's a billing decision. Free tier probably covers all products at modest limits.
4. Do we ever recommend sibling products in marketing *outside* the Windy ecosystem (e.g. a windychat landing page mentioning windymail)? Probably yes — external marketing has different rules than in-product. Decide per campaign.
