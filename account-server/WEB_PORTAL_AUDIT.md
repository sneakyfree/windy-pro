# Web Portal Audit — Windy Pro Account Server

**Date:** 2026-03-31
**Source location:** `/Users/thewindstorm/windy-pro/src/client/web/`
**Stack:** React 19 + React Router 7 + Vite 6 (SPA)

---

## 1. Route Inventory

| Route | Component | Protected | Status |
|---|---|---|---|
| `/` | Landing.jsx | No | OK |
| `/transcribe` | Transcribe.jsx | Yes | OK |
| `/dashboard` | Dashboard.jsx | Yes | OK |
| `/soul-file` | SoulFile.jsx | Yes | OK |
| `/vault` | Vault.jsx | Yes | OK |
| `/translate` | Translate.jsx | Yes | OK |
| `/settings` | Settings.jsx | Yes | OK |
| `/admin` | Admin.jsx | Yes | OK |
| `/profile` | Profile.jsx | Yes | OK |
| `/auth` | Auth.jsx | No | OK |
| `/privacy` | Privacy.jsx | No | OK |
| `/terms` | Terms.jsx | No | OK |
| `*` | NotFound (inline) | No | OK |

**All routes have corresponding component files. No orphaned routes.**

---

## 2. API Endpoint Cross-Reference

### 2.1 Endpoints called by the frontend vs. backend availability

| Frontend call | Backend route | Match? | Notes |
|---|---|---|---|
| `POST /api/v1/auth/login` | `POST /api/v1/auth/login` | YES | |
| `POST /api/v1/auth/register` | `POST /api/v1/auth/register` | YES | |
| `POST /api/v1/auth/logout` | `POST /api/v1/auth/logout` | YES | |
| `GET /api/v1/auth/billing` | `GET /api/v1/auth/billing` | YES | |
| `POST /api/v1/auth/change-password` | `POST /api/v1/auth/change-password` | YES | |
| `POST /api/v1/auth/create-portal-session` | `POST /api/v1/auth/create-portal-session` | YES | |
| `GET /api/v1/recordings` | `GET /api/v1/recordings` | MISMATCH | See finding F1 |
| `GET /api/v1/recordings/stats` | `GET /api/v1/recordings/stats` | YES | |
| `GET /api/v1/recordings/:id` | `GET /api/v1/recordings/:id` | MISMATCH | See finding F2 |
| `DELETE /api/v1/recordings/:id` | `DELETE /api/v1/recordings/:id` | YES | |
| `GET /api/v1/recordings/:id/audio` | **MISSING** | NO | See finding F3 |
| `GET /api/v1/recordings/:id/video` | `GET /api/v1/recordings/:id/video` | YES | |
| `POST /api/v1/stripe/create-checkout-session` | `POST /api/v1/stripe/create-checkout-session` | YES | |
| `GET /api/v1/translate/languages` | `GET /api/v1/translate/languages` | YES | |
| `POST /api/v1/translate/text` | `POST /api/v1/translate/text` | YES | |
| `GET /api/v1/user/history` | `GET /api/v1/user/history` | MISMATCH | See finding F4 |
| `GET /api/v1/admin/users` | `GET /api/v1/admin/users` | YES | |
| `GET /api/v1/admin/stats` | `GET /api/v1/admin/stats` | YES | |
| `GET /api/v1/admin/revenue` | `GET /api/v1/admin/revenue` | YES | |
| `DELETE /api/v1/auth/delete-account` | **MISSING** | NO | See finding F5 |
| `POST /api/v1/analytics` | `POST /api/v1/analytics` | YES | |
| `GET /download/version` | `GET /download/version` | YES | Via download routes |
| `WS /ws/transcribe` | `WS /ws/transcribe` | YES | |

---

## 3. Critical Findings

### F1: Recordings list response shape mismatch (HIGH)

**Frontend expects:** `{ recordings: [...], pagination: { totalPages } }`
- Dashboard.jsx line 76: `data.recordings`, `data.pagination?.totalPages`
- Vault.jsx line 68: `data.recordings`, `data.total`

**Backend returns:** `{ bundles: [...], total, since }`
- recordings.ts line 99: returns `bundles`, not `recordings`

**Impact:** Dashboard and Vault will render empty lists. The `recordings` field will always be undefined.

### F2: Single recording response shape mismatch (HIGH)

**Frontend expects (Dashboard.jsx line 103):** `data.recording` (nested under `recording` key)
- Also accesses `data.recording.hasAudio`, `data.recording.transcript`

**Backend returns (recordings.ts line 183):** Flat object `{ id, transcript, hasVideo, ... }`
- No wrapping `recording` key
- Returns `transcript` (not `transcript_text`), no `hasAudio` field at all

**Impact:** Expanding a recording in Dashboard shows nothing. `expandedData.hasAudio` and `expandedData.transcript` will be undefined.

### F3: Audio streaming endpoint missing (HIGH)

**Frontend uses (Dashboard.jsx line 250, SoulFile.jsx line 178):**
```
GET /api/v1/recordings/:id/audio?token=...
```

**Backend:** Only `GET /api/v1/recordings/:id/video` exists. There is no `/audio` route.

**Impact:** Audio playback in Dashboard and Soul File is completely broken. The audio player will fail to load.

### F4: User history response shape mismatch (MEDIUM)

**Frontend expects (Dashboard.jsx line 91):**
```
{ total, languages, favoriteCount }
```

**Backend returns (translations.ts historyHandler):**
```
{ history: [...], pagination: { limit, offset, total, hasMore } }
```

The frontend tries to read `data.total`, `data.languages`, `data.favoriteCount` which don't exist in the response. The translation stats on the Dashboard will show 0/undefined.

**Also in Profile.jsx line 41:** expects `data.translations` but backend returns `data.history`.

### F5: Delete account endpoint missing (HIGH)

**Frontend calls (Profile.jsx line 59):**
```
DELETE /api/v1/auth/delete-account
```

**Backend:** This endpoint does not exist in `auth.ts` or any other route file. The admin route `DELETE /api/v1/admin/users/:userId` exists but is admin-only.

**Impact:** Users cannot delete their own account via the Profile page. The request will 404.

### F6: Recordings query parameter mismatch (MEDIUM)

**Frontend sends (Dashboard.jsx):** `?page=1&search=...`
**Frontend sends (Vault.jsx):** `?page=1&limit=20&search=...`

**Backend accepts (recordings.ts):** `?since=...` (ISO date string)

The backend does not support `page`, `limit`, or `search` parameters. The frontend pagination and search will have no effect.

### F7: SoulFile uses wrong field names (MEDIUM)

**SoulFile.jsx** accesses `r.has_audio`, `r.has_video`, `r.duration_seconds`, `r.word_count`, `r.recorded_at` (snake_case).

**Backend returns** camelCase: `hasVideo`, `durationSeconds`, `createdAt` (not `recorded_at`), and does not return `wordCount` or `hasAudio` at all.

**Impact:** SoulFile badges, duration, word count, and dates will all show as undefined/NaN.

### F8: Forgot password button is non-functional (LOW)

**Auth.jsx line 131:** The "Forgot password?" button is `type="button"` with no onClick handler. It does nothing.

### F9: Google/GitHub OAuth buttons are non-functional (LOW)

**Auth.jsx lines 173-183:** Both social login buttons are `type="button"` with no onClick handlers. They render but do nothing when clicked. No OAuth flow is wired up on the frontend even though the backend has OAuth routes.

### F10: Admin page has no authorization guard (MEDIUM)

**Admin.jsx** is wrapped in `<ProtectedRoute>` which only checks token expiry. It does NOT verify the user has admin role. Any authenticated user can navigate to `/admin` and the frontend will attempt to load admin data. The backend's `adminOnly` middleware will reject the API calls with 403, but the page still renders with "Loading admin data..." forever (no error handling for 403).

### F11: `apiFetch` duplicated in 5 files (LOW — code quality)

The `apiFetch` helper function is copy-pasted into Dashboard.jsx, Vault.jsx, Settings.jsx, Admin.jsx, Profile.jsx, and SoulFile.jsx. This should be a shared utility module.

### F12: `getToken` / `getUser` duplicated across files (LOW — code quality)

Same pattern: copied into Landing.jsx, Dashboard.jsx, Vault.jsx, Settings.jsx, Admin.jsx, Profile.jsx.

### F13: i18n system built but never used (LOW — dead code)

`i18n.js` defines a full translation system with 10 languages but no component imports or calls `t()`. All UI strings are hardcoded in English.

### F14: `license.js` built but never imported by any component (LOW — dead code)

The license enforcement module exists but is not imported or used by any page or component. Feature gating is not enforced on the frontend.

### F15: `verticals.js` built but never imported by any component (LOW — dead code)

Industry vertical presets exist but are unused by any UI.

---

## 4. Hardcoded URLs

| Location | URL | Issue |
|---|---|---|
| vite.config.js | `http://localhost:8098`, `http://localhost:8000`, `ws://localhost:8000` | Dev proxy config only. OK for development, but these are only used by `vite dev`. |
| Landing.jsx line 522 | `https://apps.apple.com/app/windy-pro` | Placeholder App Store link. |
| Landing.jsx line 527 | `https://play.google.com/store/apps/details?id=pro.windy.app` | Placeholder Play Store link. |
| Landing.jsx line 539 | `https://windypro.thewindstorm.uk/download/latest/linux-install.sh` | Hardcoded domain. Should use relative path. |
| Landing.jsx line 564 | `https://github.com/sneakyfree/windy-pro` | GitHub link. Fine if correct. |

**No hardcoded `localhost` URLs in component source.** All API calls use relative paths (`/api/v1/...`).

---

## 5. Missing CSS Files Check

| Component | CSS Import | File exists? |
|---|---|---|
| Landing.jsx | `./Landing.css` | YES |
| Auth.jsx | `./Auth.css` | YES |
| Dashboard.jsx | `./Dashboard.css` | YES |
| Transcribe.jsx | `./Transcribe.css` | YES |
| Translate.jsx | `./Dashboard.css` | YES (shared) |
| SoulFile.jsx | `./Dashboard.css` | YES (shared) |
| Vault.jsx | `./Dashboard.css` | YES (shared) |
| Settings.jsx | `./Dashboard.css` | YES (shared, plus inline `<style>`) |
| Admin.jsx | `./Dashboard.css` | YES (shared) |
| Profile.jsx | `./Dashboard.css` | YES (shared) |
| Privacy.jsx | `./Legal.css` | YES |
| Terms.jsx | `./Legal.css` | YES |

---

## 6. Asset References Check

| Reference | Location | Exists? |
|---|---|---|
| `/favicon.svg` | index.html | YES (public/) |
| `/manifest.json` | index.html | YES (public/) |
| `/icon-192.png` | index.html | YES (public/) |
| `/sw.js` | main.jsx, index.html | YES (public/) |

---

## 7. Dead / Unused Source Files

| File | Status |
|---|---|
| `src/i18n.js` | DEAD — imported by no component |
| `src/license.js` | DEAD — imported by no component |
| `src/verticals.js` | DEAD — imported by no component |
| `src/analytics.js` | ACTIVE — imported by App.jsx |

---

## 8. Severity Summary

| Severity | Count | Findings |
|---|---|---|
| HIGH | 3 | F1 (recordings list shape), F3 (no audio endpoint), F5 (no delete-account endpoint) |
| MEDIUM | 4 | F2 (single recording shape), F4 (history shape), F6 (query params), F7 (SoulFile field names), F10 (admin no role check) |
| LOW | 6 | F8, F9, F11, F12, F13, F14, F15 |

**Bottom line:** The web portal has significant frontend-backend contract mismatches. The Dashboard, Vault, SoulFile, and Profile pages will all malfunction due to response shape disagreements. Audio playback and account deletion are completely broken due to missing backend endpoints. The app will appear to "work" (pages load, UI renders) but core data-dependent features will show empty states or errors.
