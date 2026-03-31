# GAP ANALYSIS: Account-Server vs DNA Strand Master Plan

**Generated:** 2026-03-31
**Scope:** `/account-server/src/` checked against `DNA_STRAND_MASTER_PLAN.md` (v2.1.0)
**Method:** Every feature marked complete or in-progress in the DNA was traced to actual code. Every route and service in the codebase was checked against the DNA for coverage.

---

## Features Marked Complete That Are Actually Stubs

| Feature | DNA Status | Reality | Evidence |
|---------|-----------|---------|----------|
| H1.4 `PATCH /api/v1/auth/me` (update profile) | ✅ | **MISSING** | auth.ts has `GET /me` but no `PATCH /me`. Profile update is only on the identity routes (`PATCH /api/v1/identity/me`), not on `auth/me` as the DNA specifies. |
| H1.4 `DELETE /api/v1/auth/me` (account self-deletion / GDPR) | ✅ | **MISSING** | No self-service account deletion endpoint exists. Only admin can delete via `DELETE /api/v1/admin/users/:userId`. GDPR self-service is absent. |
| H2.1 Pagination (50/page, `?page=`, `?search=`, `?from=`, `?to=`) | ✅ | **PARTIAL** | Recordings list uses `?since=` with LIMIT 100, not page-based pagination. No `?search=`, `?from=`, `?to=` query params. No 50/page default. |
| H2.1 Returns `wordCount`, `engine` fields | ✅ | **MISSING** | `listRecordings()` does not return `wordCount` or `engine`. These columns don't exist in the recordings table. |
| H2.1 `PATCH /api/v1/recordings/:id` (update transcript) | ✅ | **MISSING** | No PATCH route for recordings. Users cannot edit transcripts via API. |
| H2.2 `GET /api/v1/recordings/:id/audio` (audio streaming) | ✅ | **MISSING** | Only `/recordings/:id/video` exists. No audio streaming endpoint. |
| H2.2 Content-Type negotiation (webm, mp4, ogg, wav) | ✅ | **HARDCODED** | Video endpoint hardcodes `Content-Type: video/webm`. No content negotiation. |
| H2.3 `POST /api/v1/recordings/export` (ZIP export) | ✅ | **MISSING** | No export endpoint. No ZIP generation code. |
| H2.3 `DELETE /api/v1/recordings/bulk` (bulk delete) | ✅ | **MISSING** | No bulk delete endpoint. Only single-recording delete exists. |
| H2.3 `GET /api/v1/recordings/stats` returns `totalWords`, `totalHours` | ✅ | **PARTIAL** | Stats endpoint exists but returns `totalDuration` (seconds), not hours. No `totalWords` field; returns `totalRecordings`, `totalSize`, `avgQuality` instead. |
| Speech translation (`POST /api/v1/translate/speech`) | ✅ (E0.5 says all complete) | **STUB** | Returns hardcoded `[Detected speech in X]` and `[Translation to Y]`. Sets `X-Stub: true`. No actual speech-to-text or translation. |
| OCR translate (`POST /api/v1/ocr/translate`) | ✅ (J1.7 implies) | **STUB** | Returns `[OCR stub -- connect a real OCR engine]`. Sets `X-Stub: true`. |
| Update check (`GET /api/v1/updates/check`) | ✅ (implied by server listing) | **STUB** | Returns hardcoded version `0.6.0` and static release notes. Sets `X-Stub: true`. |
| Cloud phone provisioning (`POST /api/v1/cloud/phone/provision`) | Stub-labeled in code | **STUB** | Returns hardcoded `+1-555-0100`, `provider: 'stub'`. Sets `X-Stub: true`. |
| Cloud phone release (`POST /api/v1/cloud/phone/release`) | Stub-labeled in code | **STUB** | Returns `released: true` regardless. Sets `X-Stub: true`. |
| Cloud push notifications (`POST /api/v1/cloud/push/send`) | Stub-labeled in code | **STUB** | Logs to console, returns `sent: true, provider: 'stub'`. Sets `X-Stub: true`. |
| WebSocket transcription (`/ws/transcribe`) | ✅ (A4.1 lists it) | **STUB** | Returns fake `[Transcription chunk N]` every 10 audio chunks. No actual transcription engine. Hardcoded confidence `0.92`. This is the account-server's WS handler, not the Python FastAPI server's. |
| Clone training (`POST /api/v1/clone/start-training`) | ✅ (H5 context) | **STUB** | Returns `"Clone training service coming soon"`. Status 202 with instructions to use third-party services. |
| Admin stats `dailyTranslations` | ✅ | **HARDCODED** | Returns `[12, 8, 15, 22, 18, 25, 31]` -- a hardcoded array, not real data. |

---

## Features Marked In-Progress: Actual Completion

| Feature | DNA Status | Actual % | What's Missing |
|---------|-----------|----------|----------------|
| H4.3 Conflict Resolution | 🟡 "basic last-write-wins" | 10% | DNA acknowledges this is basic. No real conflict detection, merge, or soft-delete sync exists in account-server. Only the sync endpoint exists which skips duplicates. |
| H5.3 Export for Digital Twin | 🟡 "future" | 0% | No export endpoint for combined transcripts, voice samples, or metadata ZIP. |
| H6.2 Deploy Auth + Dashboard to Production | 🟡 | 50% | Nginx config and Vite proxy exist (H7), but no evidence of actual SSL/certbot setup or production deployment verification from the account-server codebase. |
| H7.3 CI/CD Pipeline | 🔲 | 0% | No GitHub Actions config found. |
| H7.4 Monitoring | 🔲 | 15% | `/health` endpoint exists, but no UptimeRobot integration, no error alerting, no structured health check beyond basic user/device count. |
| H8.1 Usage Metrics | 🟡 "basic hooks only" | 10% | Only `POST /api/v1/analytics` exists (logs event name to console, returns `{received: true}`). No actual metric storage, no DAU/WAU/MAU, no per-user recording counts over time. |
| H8.2 Dashboard Analytics | 🔲 | 0% | Nothing implemented. |
| H8.3 Privacy-First Analytics | 🔲 | 0% | Nothing implemented. |
| Text translation (Groq/OpenAI fallback) | 🟡 | 70% | Works when API keys are configured. Falls back to stub `[targetLang] originalText` otherwise. Speech translation remains 100% stub. |

---

## Undocumented Features (Not in DNA Strand)

| Feature | Location | Notes |
|---------|----------|-------|
| **Unified Identity Service (Phase 10.0)** | `identity-service.ts`, `routes/identity.ts` | Full identity management: product provisioning, scope management, audit logging, Eternitas webhook, chat profile, bot API keys, secretary consent. DNA Strand H mentions none of this; it far exceeds H1's scope. |
| **OAuth2 / OIDC Server (Phase 5)** | `routes/oauth.ts`, `jwks.ts` | Complete OAuth2 authorization server: authorization code + PKCE, client_credentials, device code flow, refresh token rotation, OIDC discovery, JWKS endpoint. Not in DNA Strand H at all. |
| **Verification (OTP via SMS/Email)** | `routes/verification.ts` | Twilio SMS + SendGrid email OTP verification at identity level. Rate limited, secure. Not in DNA. |
| **Stripe Billing (Full Integration)** | `routes/billing.ts` | Checkout sessions, billing portal, webhook handling (payment_intent.succeeded, invoice.paid, charge.refunded, subscription.deleted), transaction history, billing summary. DNA mentions Stripe only in J1.1 (desktop upgrade panel). |
| **Admin Console (Server-Rendered HTML)** | `routes/admin-console.ts` | Full server-rendered admin dashboard with HTML pages. Not in DNA. |
| **Admin API (Extended)** | `routes/admin.ts` | Detailed user view, freeze/unfreeze accounts, tier changes, user deletion with cascade, storage overview, billing transaction admin, refund processing. DNA only mentions `GET /users`, `GET /stats`, `GET /revenue`. |
| **File Storage (R2 + Local)** | `routes/storage.ts`, `services/r2-adapter.ts` | Full file storage API with Cloudflare R2 backend, storage quotas, upload/download/delete. Not in DNA (DNA H2 covers recordings, not generic file storage). |
| **Download Routes (GitHub Release Proxy)** | `routes/downloads.ts` | Fetches latest GitHub release, redirects to platform-specific installer. Cache-busting. Not in DNA. |
| **Chat Validation Endpoint** | `routes/auth.ts` (`POST /chat-validate`) | Synapse Matrix login bridge. Not in DNA Strand H. |
| **RS256/JWKS Token Signing** | `jwks.ts` | Asymmetric JWT signing with key rotation. DNA only mentions HS256. |
| **Redis Integration** | `redis.ts` | Token blacklisting, OTP storage in Redis with fallback to in-memory. Not in DNA. |
| **PostgreSQL Adapter** | `db/postgres-adapter.ts` | SQLite-to-PostgreSQL abstraction layer. DNA mentions PostgreSQL as planned but marks it 🟡. |
| **DB Maintenance (WAL Checkpoint)** | `db-maintenance.ts` | Periodic WAL checkpointing. Not in DNA. |
| **Contracts Package** | `@windy-pro/contracts` imports | Shared Zod validation schemas, types, and contracts. Not in DNA. |
| **RTC Signaling** | `routes/misc.ts` (`POST/GET /api/v1/rtc/signal`) | WebRTC signaling server for phone-camera-bridge. Not in DNA. |
| **License Key Activation** | `routes/misc.ts` (`POST /api/v1/license/activate`) | Offline license key validation + tier upgrade. Not in DNA. |
| **Webhook Receiver** | `server.ts` (`POST /api/v1/webhooks/identity/created`) | Inbound webhook from ecosystem services. Not in DNA. |

---

## Dead Code

| File/Function | Why It's Dead | Action |
|--------------|---------------|--------|
| `db/postgres-adapter.ts` | Imported conditionally. If `DATABASE_URL` is never set (SQLite mode), this entire module is loaded but the class is never instantiated. Not truly dead, but never exercised in default config. | Keep -- needed for production. |
| `routes/cloud.ts` | All 3 endpoints are pure stubs (X-Stub header). No real functionality. 31 lines of placeholder code. | **Remove or clearly mark as future.** Currently creates false impression of capability. |
| `admin.stats.dailyTranslations` | Hardcoded array `[12, 8, 15, 22, 18, 25, 31]` never comes from real data. | Fix to query actual data or remove. |
| No orphan files detected | All `.ts` files in src/ are imported by at least one other file. | Clean. |

---

## Summary Statistics

| Metric | Count |
|--------|-------|
| **Total DNA features audited (H-strand, account-server scope)** | 42 codons across H1-H8 |
| **Actually complete (real working code)** | 24 |
| **Stubs masquerading as complete** | 10 (speech translation, OCR, updates check, WS transcribe, clone training, cloud phone/release/push, audio streaming missing, bulk ops missing) |
| **Partially complete (accuracy of DNA "in-progress")** | ~35% average (DNA is generous; most 🟡 items are closer to 0-15%) |
| **Features marked ✅ with missing endpoints** | 6 (PATCH auth/me, DELETE auth/me, PATCH recordings/:id, GET recordings/:id/audio, POST recordings/export, DELETE recordings/bulk) |
| **Undocumented features (scope creep/evolution)** | 17 major features not in DNA |
| **Dead code files** | 1 (cloud.ts is 100% stubs); 0 truly orphaned files |

---

## Critical Findings

1. **GDPR Self-Service Deletion is Missing.** DNA says `DELETE /api/v1/auth/me` is ✅. It does not exist. Only admin deletion works. This is a compliance gap.

2. **The account-server has massively outgrown the DNA.** The DNA describes a simple auth + recordings server. The actual codebase is a full identity platform with OAuth2/OIDC, Stripe billing, R2 storage, OTP verification, bot API keys, and Matrix chat provisioning. The DNA needs a major update.

3. **WebSocket transcription on the account-server is fake.** The `/ws/transcribe` handler in `server.ts` returns fabricated transcript chunks. The real transcription happens in the Python FastAPI server (A4). This is misleading if anyone expects the Node server to transcribe.

4. **Six ✅ endpoints from H2 don't exist at all.** Audio streaming, transcript editing, ZIP export, and bulk delete are marked complete but have zero code.

5. **Speech translation is 100% stub.** Despite E0.5 claiming "all implemented," the `POST /translate/speech` endpoint returns hardcoded bracket text and sets X-Stub header. Text translation partially works (with API keys), but speech is completely fake.
