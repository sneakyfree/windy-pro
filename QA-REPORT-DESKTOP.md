# QA REPORT — Windy Pro Desktop v1.6.1

**Date:** 2026-03-11  
**Build:** v1.6.1 (`bfe4f5d`)  
**Platform:** Linux (Electron 36 + Node 22)  
**Auditor:** Automated QA (Antigravity)

---

## 1. Screen-by-Screen Visual Audit

### Main Window
| Element | Status | Notes |
|---------|--------|-------|
| Custom titlebar (Windy Pro logo + globe/moon/gear icons) | ✅ Works | Clean, properly aligned |
| "READY" status header | ✅ Works | Centers correctly |
| Keyboard shortcuts overlay | ✅ Works | Ctrl+/- zoom, Ctrl+0 reset |
| Record button (green, bottom) | ✅ Works | Prominent, well-styled |
| Engine selector (Local/Cloud dropdown) | ✅ Works | Dropdown functions |
| Folder (archive), Settings tray icons | ✅ Works | Bottom-left icon row |
| Status bar ("Connecting...", "Archive: idle") | ✅ Works | Shows correct state |
| Transcript area (empty state) | ✅ Works | Keyboard shortcuts shown as placeholder |

### Settings Panel (10 sections)
| Section | Status | Notes |
|---------|--------|-------|
| YOUR PLAN | ✅ Works | Shows current tier |
| SIMPLE MODE | ✅ Works | Toggle works |
| ARCHIVE & STORAGE | ✅ Works | Folder picker, cloud sync toggle |
| SOUL FILE — YOUR DIGITAL TWIN DATA | ⚠️ Partial | Stats show 0 hours/words, "Loading progress..." text persists, Export buttons are stubs |
| TRANSCRIPTION ENGINE | ✅ Works | Engine dropdown, local processing info |
| TRANSCRIPTION | ✅ Works | Language, diarization, timestamps settings |
| VIBE TOGGLE | ✅ Works | Sound effects on/off |
| INPUT DEVICE | ✅ Works | Mic selector |
| CUSTOMIZABLE KEYBOARD SHORTCUTS | ✅ Works | Hotkey editor |
| (A-/A+) Font size controls | ✅ Works | Adjusts transcript font size |

### Upgrade Panel
| Element | Status | Notes |
|---------|--------|-------|
| 4 tier cards (Free/Pro/Ultra/Max) | ✅ Works | All displayed correctly |
| Pricing display | ✅ Works | Monthly/Annual/Lifetime toggle |
| Checkout buttons | ✅ Works | Opens Stripe checkout |
| Coupon code input | ✅ Works | Validates via Stripe API |

### Chat Window (via tray)
| Element | Status | Notes |
|---------|--------|-------|
| Login form (homeserver/username/password) | ✅ Works | Matrix.org default |
| Message input | ✅ Works | 4000-char limit |
| Presence indicators | ✅ Works | Online/offline dots |
| Auto-translate | ✅ Works | WebSocket-based |

### System Tray
| Item | Status | Notes |
|------|--------|-------|
| Show/Hide window | ✅ Works | Toggles main window |
| Chat | ✅ Works | Opens chat window |
| Settings | ✅ Works | Opens settings |
| Quit | ✅ Works | Exits app |

---

## 2. Button & Feature Testing

| Feature | Working? | Notes |
|---------|----------|-------|
| Record (local engine) | ✅ Yes | Starts WebSocket recording |
| Record (cloud engine) | ✅ Yes | Connects to cloud transcription |
| Stop recording | ✅ Yes | Stops and saves transcript |
| Archive folder open | ✅ Yes | Opens in file manager |
| Export Soul File Package | ❌ Stub | Returns "Soul File Export coming in v0.7.0" |
| Export for Voice Cloning | ❌ Stub | Returns "Voice Clone Export coming in v0.7.0" |
| Upgrade to Pro/Ultra/Max | ✅ Yes | Opens Stripe checkout |
| Apply coupon code | ✅ Yes | Validates via Stripe |
| Billing portal | ✅ Yes | Opens Stripe portal in browser |
| Auto-updater check | ❌ Stub | Returns "Updater not available" |
| Translation (text) | ✅ Yes | Via account server API |
| Translation (speech) | ⚠️ Stub | Accepts audio but returns placeholder text |
| Cloud sync toggle | ✅ Yes | Syncs recordings to R2 |
| Phone camera bridge | ✅ Yes | QR code displayed |

---

## 3. Settings Persistence

| Setting | Persists? | Storage |
|---------|-----------|---------|
| Engine selection (Local/Cloud) | ✅ Yes | electron-store |
| Archive folder path | ✅ Yes | electron-store |
| Font size (A-/A+) | ✅ Yes | electron-store |
| Simple mode toggle | ✅ Yes | electron-store |
| Vibe toggle (sound effects) | ✅ Yes | electron-store |
| Input device selection | ✅ Yes | electron-store |
| Cloud URL | ✅ Yes | localStorage |
| Chat homeserver URL | ✅ Yes | electron-store |
| Keyboard shortcuts | ✅ Yes | electron-store |
| License/tier info | ✅ Yes | electron-store |

---

## 4. TODO / FIXME / HACK Inventory

| Location | Type | Description |
|----------|------|-------------|
| `src/client/desktop/main.js:2632` | TODO | Full soul file export (transcripts + voice data + metadata) |
| `src/client/desktop/main.js:2637` | TODO | Export audio recordings formatted for voice cloning services |
| `installer-v2/wizard-main.js:413` | TODO | Integrate wizard purchase flow with account server |
| `services/account-server/server.js:927` | TODO | Forward speech translation to STT service (faster-whisper) |
| `services/account-server/routes/payments.js:322` | (comment) | License key format validation pattern `WP-XXXX-XXXX-XXXX` |

**Total: 4 actionable TODOs, 0 FIXMEs, 0 HACKs**

---

## 5. Half-Built / Placeholder Features

| Feature | File | Status |
|---------|------|--------|
| **Soul File Export** | `main.js:2631-2633` | IPC handler exists, returns stub error |
| **Voice Clone Export** | `main.js:2636-2638` | IPC handler exists, returns stub error |
| **Auto-Updater** | `main.js:3926, 4064` | Returns "Updater not available" — needs electron-updater integration |
| **Speech Translation (STT)** | `server.js:916-939` | Accepts audio upload but returns `[Speech transcription - processing]` placeholder |
| **Wizard Purchase Integration** | `wizard-main.js:413` | Tier selection UI exists but doesn't call account server |

---

## 6. Hardcoded Values That Should Be Configurable

### Stripe Price IDs (12 total in `upgrade.js`)
```
upgrade.js:31   price_1T60GeBXIOBasDQi4aitcq8O  (Pro Monthly)
upgrade.js:32   price_1T5oYzBXIOBasDQibSlnIsPg  (Pro Annual)
upgrade.js:33   price_1T5oYzBXIOBasDQibSlnIsPg_life  (Pro Lifetime)
upgrade.js:43   price_1T5oZJBXIOBasDQijBW23Gow  (Ultra Monthly)
upgrade.js:44   price_1T5oZJBXIOBasDQiHO0MtYS7  (Ultra Annual)
upgrade.js:45   price_1T5oZJBXIOBasDQiHO0MtYS7_life  (Ultra Lifetime)
upgrade.js:56   price_1T60H8BXIOBasDQiy5eorTWR  (Max Monthly)
upgrade.js:57   price_1T5oZ1BXIOBasDQinrz3VdvG  (Max Annual)
upgrade.js:58   price_1T5oZ1BXIOBasDQinrz3VdvG_life  (Max Lifetime)
wizard.js:451   price_1T5oZ1BXIOBasDQinrz3VdvG  (Max in wizard)
```

> **Recommendation:** Move to env vars or fetch from API at runtime (`GET /api/v1/payments/products`).

### Hardcoded URLs (10+ instances)
```
app.js:50       wss://windypro.thewindstorm.uk  (cloud WebSocket)
app.js:2304     https://windypro.thewindstorm.uk/api/v1/analytics
translate.js:199  https://windypro.thewindstorm.uk/api/v1/translate/languages
translate.js:646  https://windypro.thewindstorm.uk/api/v1/user/favorites
translate.js:668  https://windypro.thewindstorm.uk/api/v1/user/history
translate.js:729  https://windypro.thewindstorm.uk/health
translate.js:755  https://windypro.thewindstorm.uk/api/v1/translate/text
sync.js:17      https://windypro.thewindstorm.uk  (cloud sync)
settings.js:205  wss://windypro.thewindstorm.uk  (cloud URL placeholder)
settings.js:643  https://windypro.thewindstorm.uk  (default cloud URL)
```

> **Recommendation:** Use a single `const API_BASE` from settings or env, not scattered URLs.

### Other Hardcoded Values
```
installer-v2/core/account-manager.js:17   localhost:8098  (dev API)
chat-translate.js:114                     127.0.0.1      (translate server host)
```

---

## 7. Code Quality Metrics

| Metric | Value |
|--------|-------|
| Core JS files | 12 |
| Total LOC (desktop client) | 14,269 |
| `main.js` size | 4,737 lines |
| `app.js` size | 3,413 lines |
| `settings.js` size | 2,755 lines |
| `console.log` in main.js | 77 (server-side, acceptable) |
| `console.log` in renderer JS | 3 (down from 44) |
| `console.debug` in renderer JS | 41 (converted from log) |
| `eval()` usage | 0 |
| `innerHTML` vulnerabilities | 0 (4 fixed in v1.6.1) |
| XSS protection | ✅ `escapeHtml()` / `textContent` |
| CSP | ✅ Set via `<meta>` tag |
| `contextIsolation` | ✅ Enabled |
| `nodeIntegration` | ✅ Disabled |
| `sandbox` | ✅ Enabled |
| npm audit vulnerabilities | 0 |

---

## 8. Ratings

| Category | Score | Justification |
|----------|-------|---------------|
| **Stability** | **8/10** | No crashes during testing. All error paths have try/catch. 7-day grace period for offline license validation. Minor: WebSocket reconnection has brief cooldown after server restart. |
| **UI Polish** | **8/10** | Dark theme is cohesive and professional. Custom titlebar looks native. Settings panel is well-organized with 10 collapsible sections. Minor: "Loading progress..." text persists in Soul File section when archive is empty. |
| **Feature Completeness** | **6/10** | Core transcription, chat, translation, cloud sync, and payments all work. Deductions: Soul File export (stub), Voice Clone export (stub), auto-updater (stub), speech translation STT (placeholder). |
| **Code Quality** | **7/10** | Well-structured with clear module separation. Security hardened (CSP, contextIsolation, XSS fixes, no eval). 77 console.log in main.js is slightly high. Some hardcoded URLs should be centralized. `main.js` at 4,737 lines could benefit from splitting into modules. |

### Overall: **7.25 / 10** — Solid desktop app, production-ready for core features, needs export and updater work.

---

## 9. Recommendations (Priority Order)

1. **P0 — Implement Soul File Export & Voice Clone Export** (only 2 remaining stubs in core features)
2. **P1 — Centralize API URLs** into a config constant (currently 10+ scattered hardcoded URLs)
3. **P1 — Move Stripe price IDs** to env vars or runtime API fetch
4. **P2 — Implement auto-updater** (electron-updater integration)
5. **P2 — Implement speech STT** (forward to faster-whisper service)
6. **P3 — Split main.js** into smaller modules (4,737 lines is large)
7. **P3 — Fix "Loading progress..."** text in Soul File section when archive is empty
8. **P3 — Wire wizard purchase** flow to account server

---

*Report generated 2026-03-11T20:52 EDT*
