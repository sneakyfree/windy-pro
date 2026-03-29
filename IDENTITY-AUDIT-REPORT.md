# IDENTITY-AUDIT-REPORT.md — Unified Windy Identity Readiness Assessment

_Generated: 28 March 2026_
_Auditor: Claude Opus 4.6_
_Scope: windy-pro account server, chat services, windy-pro-mobile, windy-agent_

---

## Table of Contents

1. [Current State](#1-current-state)
2. [Gap Analysis](#2-gap-analysis)
3. [Shared Infrastructure Map](#3-shared-infrastructure-map)
4. [Bot Identity Questions](#4-bot-identity-questions)
5. [Migration Path](#5-migration-path)
6. [Security Considerations](#6-security-considerations)
7. [Recommended Architecture](#7-recommended-architecture)

---

## 1. Current State

### 1.1 Account Server Overview

Two versions exist:

| Version | Location | Language | Status |
|---------|----------|----------|--------|
| **Primary** | `account-server/` | TypeScript (Express + better-sqlite3) | Active development |
| **Legacy** | `services/account-server/` | JavaScript (Express + better-sqlite3) | Older, monolithic |

The TypeScript version is the canonical implementation. Port **8098**.

### 1.2 Data Model

**Database:** SQLite with WAL mode, foreign keys enforced.

**Core Tables:**

| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `users` | `id` (UUID), `email` (UNIQUE), `name`, `password_hash`, `tier`, `role`, `stripe_customer_id`, `license_key`, `license_tier`, `storage_used`, `storage_limit`, `frozen` | Account identity |
| `devices` | `id`, `user_id` (FK), `name`, `platform`, `registered_at`, `last_seen` | Device tracking, 5-device limit |
| `refresh_tokens` | `token` (UUID PK), `user_id` (FK), `device_id`, `expires_at` | Token lifecycle |
| `recordings` | `id`, `user_id` (FK), `bundle_id`, `transcript_text`, `duration_seconds`, 20+ metadata fields | Voice recording storage |
| `translations` | `id`, `user_id` (FK), `source_lang`, `target_lang`, `source_text`, `translated_text` | Translation history |
| `files` | `id`, `user_id` (FK), `original_name`, `mime_type`, `size`, `type` | Cloud file storage |
| `transactions` | `id`, `user_id`, `amount`, `type`, `status`, `stripe_payment_id` | Billing history |
| `coupons` | `code` (PK), `discount_percent`, `max_uses`, `expires_at` | Discount codes |

**Legacy-only tables:** `subscriptions` (tier, stripe IDs, license_status, payment tracking), `token_blacklist` (for logout revocation).

**No concept of:** products, organizations, workspaces, scopes, or multi-tenancy.

### 1.3 Authentication Flow

```
┌─────────┐     POST /v1/auth/register      ┌──────────────┐
│  Client  │ ─────────────────────────────→  │ Account      │
│          │  { name, email, password,       │ Server       │
│          │    deviceId?, deviceName?,       │ (port 8098)  │
│          │    platform? }                  │              │
│          │                                 │  1. lowercase email
│          │  ←─────────────────────────────  │  2. bcrypt hash (10 rounds)
│          │  { userId, name, email,         │  3. insert user (tier=free)
│          │    tier, token (JWT),           │  4. register device (if < 5)
│          │    refreshToken, devices[] }    │  5. sign JWT + refresh token
└─────────┘                                  └──────────────┘
```

**Login** follows the same pattern: email lookup → bcrypt compare → device upsert → JWT + refresh token.

### 1.4 JWT Structure

| Field | Value |
|-------|-------|
| **Algorithm** | HS256 (HMAC-SHA256) |
| **Access token expiry** | 24 hours |
| **Refresh token expiry** | 30 days |
| **Signing secret** | `JWT_SECRET` env var (dev fallback exists) |

**JWT Payload:**
```json
{
  "userId": "uuid",
  "email": "user@example.com",
  "tier": "free|pro|translate|translate-pro",
  "accountId": "uuid (same as userId)",
  "role": "user|admin",
  "iat": 1711612800,
  "exp": 1711699200
}
```

**Notable:** No product scoping. No audience claim. No issuer claim. The token grants full access to all account server features based solely on tier.

### 1.5 Refresh Token Behavior

- Single-use rotation: old token deleted on refresh, new one issued.
- Stored in `refresh_tokens` table with `device_id` association.
- Legacy version additionally maintains a `token_blacklist` table for explicit logout.

### 1.6 Rate Limiting

| Scope | Limit |
|-------|-------|
| Auth endpoints (register, login) | 5 requests / 60 seconds |
| General read (legacy) | 100 requests / 60 seconds |
| Write operations (legacy) | 30 requests / 60 seconds |

### 1.7 API Endpoints Summary

**Auth:** register, login, refresh, logout, me (GET/PATCH), password change, account deletion (GDPR), device CRUD.

**Product-specific:** recordings CRUD + upload + sync, translations + history + favorites, transcription (REST + WebSocket), file storage with quotas, clone training, billing/Stripe webhooks, admin panel, analytics, license activation, app update checks, download redirects.

**Total:** ~40 endpoints, all behind a single JWT with no product scoping.

### 1.8 Chat Services (Separate Auth Layer)

The chat ecosystem runs as independent microservices with **Bearer Token auth** (not the account server JWT):

| Service | Port | Purpose | Auth |
|---------|------|---------|------|
| chat-onboarding | 8101 | Phone/email OTP, profile setup, QR pairing, Matrix provisioning | Bearer `CHAT_API_TOKEN` |
| chat-directory | 8102 | Hash-based contact lookup (Signal-style), name search, invites | Bearer `CHAT_API_TOKEN` |
| chat-push-gateway | 8103 | FCM + APNs push notifications, per-room mute | Bearer `CHAT_API_TOKEN` |
| chat-backup | 8104 | AES-256-GCM encrypted cloud backup to R2 | Bearer `CHAT_API_TOKEN` |

**Critical finding:** The chat services use a **separate, hardcoded API token** (`CHAT_API_TOKEN` env var) — not the account server's JWT. There is no token exchange or federation between the two auth systems.

### 1.9 Chat Onboarding (K2) Flow

```
1. POST /api/v1/chat/verify/send     → 6-digit OTP via Twilio SMS or SendGrid email
2. POST /api/v1/chat/verify/check    → Validate OTP → receive verification token (UUID)
3. POST /api/v1/chat/profile/setup   → Set display name, languages, avatar
4. POST /api/v1/chat/provision       → Auto-create Matrix account on Synapse
                                        (HMAC-SHA1 nonce signing with admin secret)
                                        → Returns: @windy_name:chat.windypro.com + access_token
```

**OTP details:** 6-digit code, 10-minute expiry, max 3 attempts, 60-second resend cooldown, 24-hour re-registration cooldown. In-memory storage (needs Redis for production).

### 1.10 Mobile App Auth

The mobile app implements **dual-tier authentication**:

**Tier 1 — Cloud Storage (same account server):**
- `POST /api/auth/register` and `POST /api/auth/login` → JWT
- Token stored in `expo-secure-store` (iOS Keychain / Android Keystore)
- Keys: `windy_cloud_jwt`, `windy_cloud_user_id`, `windy_cloud_email`

**Tier 2 — Chat (K2 provisioning):**
- Phone/email OTP → auto-provisioned Matrix credentials
- Token stored in `expo-secure-store`: `windy_matrix_token`, `windy_matrix_user`, `windy_matrix_server`, `windy_matrix_device`

**The two tiers are not linked.** A user can have a cloud account and a separate chat identity with no connection between them.

### 1.11 Agent (Windy Fly) Auth

The agent uses **manual credential injection** via `.env` file:

| Credential | Storage | Purpose |
|------------|---------|---------|
| `WINDY_JWT` | `.env` file | Bearer token for Windy Pro API calls |
| `MATRIX_BOT_TOKEN` or `MATRIX_BOT_PASSWORD` | `.env` file | Matrix/Synapse auth |
| LLM API keys (OpenAI, Anthropic, etc.) | `.env` file | LLM provider auth |
| `ANTHROPIC_OAUTH_*` | `data/.anthropic_oauth.json` (0o600) | Anthropic OAuth with auto-refresh |

**The agent does not authenticate with the account server.** It holds a pre-issued JWT and uses it as a bearer token. There is no login flow, no registration, no token refresh against the account server.

**Eternitas integration:** Documented in BRAND-ARCHITECTURE.md but **not implemented**. No code exists for passport registration, credential issuance, or revocation cascade.

---

## 2. Gap Analysis

### 2.1 Schema Changes Required

**New tables needed:**

```sql
-- Central identity record (replaces per-product user tables)
CREATE TABLE identities (
    id              TEXT PRIMARY KEY,           -- UUID, the Windy ID
    email           TEXT UNIQUE,                -- Primary email (verified)
    phone           TEXT UNIQUE,                -- Primary phone (E.164, verified)
    password_hash   TEXT NOT NULL,
    display_name    TEXT,
    avatar_url      TEXT,
    email_verified  INTEGER DEFAULT 0,
    phone_verified  INTEGER DEFAULT 0,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
);

-- Which products a user has activated
CREATE TABLE identity_products (
    identity_id     TEXT NOT NULL REFERENCES identities(id),
    product         TEXT NOT NULL,              -- 'word', 'chat', 'mail', 'fly', 'clone', 'cloud', 'traveler'
    activated_at    TEXT DEFAULT (datetime('now')),
    tier            TEXT DEFAULT 'free',        -- Product-specific tier
    status          TEXT DEFAULT 'active',      -- 'active', 'suspended', 'deactivated'
    metadata        TEXT,                       -- JSON: product-specific data
    PRIMARY KEY (identity_id, product)
);

-- Product-scoped credentials (Matrix tokens, mail tokens, etc.)
CREATE TABLE product_credentials (
    id              TEXT PRIMARY KEY,
    identity_id     TEXT NOT NULL REFERENCES identities(id),
    product         TEXT NOT NULL,
    credential_type TEXT NOT NULL,              -- 'matrix_token', 'mail_token', 'api_key'
    credential      TEXT NOT NULL,              -- Encrypted
    expires_at      TEXT,
    created_at      TEXT DEFAULT (datetime('now'))
);

-- Bot/agent identity (extends identities for non-human actors)
CREATE TABLE agent_identities (
    identity_id     TEXT PRIMARY KEY REFERENCES identities(id),
    owner_id        TEXT NOT NULL REFERENCES identities(id),  -- Human owner
    agent_type      TEXT DEFAULT 'windyfly',
    eternitas_id    TEXT UNIQUE,                -- ET-XXXXX passport number
    passport_status TEXT DEFAULT 'active',      -- 'active', 'suspended', 'revoked'
    hatched_at      TEXT,
    metadata        TEXT                        -- JSON: birth certificate data, neural fingerprint, etc.
);

-- OAuth clients (for "Sign in with Windy" and third-party apps)
CREATE TABLE oauth_clients (
    client_id       TEXT PRIMARY KEY,
    client_secret   TEXT NOT NULL,
    name            TEXT NOT NULL,
    redirect_uris   TEXT NOT NULL,              -- JSON array
    scopes          TEXT NOT NULL,              -- JSON array of allowed scopes
    owner_id        TEXT REFERENCES identities(id),
    created_at      TEXT DEFAULT (datetime('now'))
);

-- OAuth authorization grants
CREATE TABLE oauth_grants (
    code            TEXT PRIMARY KEY,
    client_id       TEXT NOT NULL REFERENCES oauth_clients(client_id),
    identity_id     TEXT NOT NULL REFERENCES identities(id),
    scopes          TEXT NOT NULL,              -- JSON array of granted scopes
    redirect_uri    TEXT NOT NULL,
    expires_at      TEXT NOT NULL,
    created_at      TEXT DEFAULT (datetime('now'))
);
```

### 2.2 JWT Changes Required

**Current JWT payload** (product-unaware):
```json
{
  "userId": "uuid",
  "email": "user@example.com",
  "tier": "pro",
  "role": "user"
}
```

**Required JWT payload** (product-scoped):
```json
{
  "sub": "windy-id-uuid",
  "iss": "https://id.windypro.com",
  "aud": ["windy-word", "windy-chat"],
  "email": "user@example.com",
  "email_verified": true,
  "phone": "+15551234567",
  "phone_verified": true,
  "display_name": "Grant Whitmer",
  "identity_type": "human",
  "products": {
    "word": { "tier": "ultra", "active": true },
    "chat": { "tier": "free", "active": true },
    "mail": { "tier": "free", "active": true },
    "fly":  { "tier": "pro", "active": true }
  },
  "scopes": ["word:read", "word:write", "chat:message", "mail:read"],
  "iat": 1711612800,
  "exp": 1711699200
}
```

**Key additions:**
- `iss` (issuer) — identifies the Windy Identity service
- `aud` (audience) — which products this token is valid for
- `identity_type` — `human` or `agent`
- `products` — per-product tier and activation status
- `scopes` — fine-grained permission list
- Standard OIDC claims (`sub`, `email_verified`, `phone_verified`)

### 2.3 New Endpoints Required

| Endpoint | Purpose |
|----------|---------|
| `POST /v1/identity/register` | Unified registration (email + password, or phone + OTP) |
| `POST /v1/identity/verify/send` | Send verification OTP (phone or email) |
| `POST /v1/identity/verify/check` | Validate OTP |
| `POST /v1/identity/login` | Unified login (email/password or phone/OTP) |
| `GET /v1/identity/me` | Full identity profile across all products |
| `POST /v1/identity/products/activate` | Activate a product for an identity |
| `DELETE /v1/identity/products/:product` | Deactivate a product |
| `POST /v1/identity/agents/register` | Register a bot identity (human owner required) |
| `POST /v1/identity/agents/:id/revoke` | Revoke agent passport (cascade) |
| `GET /v1/identity/agents` | List owner's agents |
| `POST /v1/oauth/authorize` | OAuth2 authorization endpoint |
| `POST /v1/oauth/token` | OAuth2 token endpoint |
| `GET /v1/oauth/userinfo` | OIDC UserInfo endpoint |
| `GET /.well-known/openid-configuration` | OIDC discovery |
| `GET /.well-known/jwks.json` | Public key set for RS256 verification |

### 2.4 Algorithm Change: HS256 → RS256

The current HS256 (symmetric) signing means **every service that validates tokens must hold the signing secret**. This is a security liability at ecosystem scale.

**Required:** Switch to RS256 (asymmetric). The identity server holds the private key; all other services verify with the public key via JWKS endpoint. This is standard OIDC practice and enables:
- Products to verify tokens without holding secrets
- Key rotation without coordinating secret distribution
- Third-party verification (Eternitas, external apps)

### 2.5 Scope System

**Proposed scope hierarchy:**

```
windy:profile:read          — Read basic identity profile
windy:profile:write         — Update profile

word:read                   — Access recordings and transcripts
word:write                  — Create/edit recordings
word:admin                  — Manage Word subscription

chat:message                — Send/receive messages
chat:rooms                  — Create/manage rooms
chat:contacts               — Access contact directory
chat:admin                  — Manage Chat settings

mail:read                   — Read emails
mail:send                   — Send emails
mail:admin                  — Manage Mail settings
mail:secretary              — Send email AS the user (requires explicit consent)

fly:manage                  — Manage agent configuration
fly:act                     — Agent can perform actions on user's behalf
fly:hatch                   — Create new agents

cloud:read                  — Read cloud storage
cloud:write                 — Upload to cloud storage

clone:read                  — View clone status
clone:train                 — Submit training data

traveler:translate          — Use translation API
traveler:purchase           — Buy translation pairs

eternitas:verify            — Verify bot identities
eternitas:register          — Register new bot identities
```

### 2.6 "Sign in with Windy" (OAuth2/OIDC)

Eternitas and any third-party app need to support "Sign in with Windy." This requires a standard OAuth2 + OIDC implementation:

1. **Authorization Code Flow** for web apps
2. **PKCE** for mobile/native apps
3. **Client Credentials** for service-to-service
4. **Device Code Flow** for CLI tools (e.g., `windy go` during hatch)
5. OIDC discovery at `https://id.windypro.com/.well-known/openid-configuration`

---

## 3. Shared Infrastructure Map

### 3.1 What Can Be Reused

| Component | Current Location | Reusable? | Notes |
|-----------|-----------------|-----------|-------|
| **Twilio SMS verification** | chat-onboarding `/routes/verify.js` | **YES — core asset** | Already handles OTP send/check, phone normalization (E.164), rate limiting. Lift into shared identity service. |
| **SendGrid email verification** | chat-onboarding `/routes/verify.js` | **YES — core asset** | Already handles OTP send/check, HTML templates. Lift into shared identity service. |
| **Matrix auto-provisioning** | chat-onboarding `/routes/provision.js` + windy-agent `matrix_provision.py` | **YES** | HMAC-SHA1 nonce signing against Synapse admin API. Two implementations exist (JS + Python) — consolidate to one. |
| **bcrypt password hashing** | account-server `/routes/auth.ts` | **YES** | Standardize on 12 rounds (legacy value). |
| **JWT generation/validation** | account-server `/middleware/auth.ts` | **PARTIAL** | Reuse middleware pattern, but switch from HS256 to RS256 and add scope/audience validation. |
| **Device management** | account-server `/routes/auth.ts` | **YES** | 5-device limit, registration, revocation. Works as-is for unified identity. |
| **Stripe billing** | account-server `/routes/billing.ts` | **PARTIAL** | Webhook handling works. Needs per-product subscription support (one user, multiple product subscriptions). |
| **Hash-based contact discovery** | chat-directory `/routes/lookup.js` | **YES** | Signal-style privacy-preserving contact lookup. Reusable across all products. |
| **Push notification gateway** | chat-push-gateway `server.js` | **YES** | FCM + APNs routing. Product-agnostic — just needs push token association with unified identity. |
| **Encrypted cloud backup** | chat-backup `server.js` | **YES** | AES-256-GCM + PBKDF2 + R2 storage. Zero-knowledge architecture. Product-agnostic. |
| **QR code pairing** | chat-onboarding `/routes/pair.js` | **YES** | X25519 key exchange, 120s TTL sessions. Useful for desktop ↔ mobile pairing across all products. |
| **Profanity filter** | chat-onboarding `/lib/profanity.js` | **YES** | Display name validation with leet-speak detection. |

### 3.2 What Needs to Be Built

| Component | Priority | Description |
|-----------|----------|-------------|
| **Unified Identity Service** | **CRITICAL** | New service (or major refactor of account-server) that owns the `identities` table and issues product-scoped JWTs. Single source of truth for "who is this person/agent." |
| **OAuth2 / OIDC Provider** | **CRITICAL** | Authorization server with standard flows (auth code, PKCE, client credentials, device code). Required for "Sign in with Windy" and Eternitas federation. |
| **JWKS Endpoint** | **HIGH** | RS256 public key distribution for token verification by all products. |
| **Scope Enforcement Middleware** | **HIGH** | Shared middleware library (npm package) that validates JWT audience + scopes. Every product service imports this. |
| **Product Activation Service** | **HIGH** | When a user signs up for any product, auto-provisions accounts across all products (Matrix, mail inbox, cloud storage, etc.). The "Born Into" engine. |
| **Eternitas Federation Bridge** | **MEDIUM** | OAuth2 client for Eternitas ("Sign in with Windy" from Eternitas side), plus webhook receiver for passport revocation cascade. |
| **Token Exchange Service** | **MEDIUM** | RFC 8693 token exchange — allows a product-scoped token to be exchanged for a differently-scoped token (e.g., Chat token → Mail token for secretary mode). |
| **Windy Mail Provisioning** | **MEDIUM** | Account creation on mail infrastructure (Postfix/Dovecot/Mailcow) triggered by identity activation. |
| **Twilio Number Pool Manager** | **MEDIUM** | Assign/recycle phone numbers from managed pool. Triggered by agent hatch, reclaimed on passport revocation. |
| **Admin Console** | **LOW** | Unified admin panel for identity management, product activation, agent oversight, abuse reports. |

### 3.3 Infrastructure Diagram

```
                        ┌──────────────────────────────────────┐
                        │   Unified Windy Identity Service     │
                        │   (id.windypro.com)                  │
                        │                                      │
                        │  ┌────────────────────────────────┐  │
                        │  │  Identity DB (PostgreSQL)      │  │
                        │  │  identities, products, agents, │  │
                        │  │  oauth_clients, credentials    │  │
                        │  └────────────────────────────────┘  │
                        │                                      │
                        │  ┌──────────┐  ┌──────────────────┐  │
                        │  │ OAuth2 / │  │ Verification     │  │
                        │  │ OIDC     │  │ (Twilio+SendGrid)│  │
                        │  │ Provider │  │ [REUSED from K2] │  │
                        │  └──────────┘  └──────────────────┘  │
                        │                                      │
                        │  ┌──────────┐  ┌──────────────────┐  │
                        │  │ JWKS     │  │ Product          │  │
                        │  │ (RS256)  │  │ Activation       │  │
                        │  └──────────┘  └──────────────────┘  │
                        └────────┬─────────────────────────────┘
                                 │
                    Issues JWTs with product scopes
                                 │
            ┌────────────────────┼────────────────────────┐
            │                    │                        │
            ▼                    ▼                        ▼
  ┌──────────────────┐ ┌─────────────────┐ ┌──────────────────────┐
  │  Windy Word /    │ │  Windy Chat     │ │  Windy Mail          │
  │  Pro Desktop     │ │  (Matrix)       │ │  (windymail.ai)      │
  │                  │ │                 │ │                      │
  │  Validates JWT   │ │  Validates JWT  │ │  Validates JWT       │
  │  Checks:         │ │  Checks:        │ │  Checks:             │
  │  aud=windy-word  │ │  aud=windy-chat │ │  aud=windy-mail      │
  │  scope=word:*    │ │  scope=chat:*   │ │  scope=mail:*        │
  └──────────────────┘ └─────────────────┘ └──────────────────────┘
            │                    │                        │
            ▼                    ▼                        ▼
  ┌──────────────────┐ ┌─────────────────┐ ┌──────────────────────┐
  │  Windy Fly       │ │  Windy Cloud    │ │  Windy Clone         │
  │  (Agent)         │ │  (Storage)      │ │  (Digital Twin)      │
  │                  │ │                 │ │                      │
  │  Agent JWT with  │ │  Validates JWT  │ │  Validates JWT       │
  │  identity_type=  │ │  Checks:        │ │  Checks:             │
  │  agent           │ │  aud=windy-cloud│ │  aud=windy-clone     │
  └──────────────────┘ └─────────────────┘ └──────────────────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │  Eternitas      │
                        │  (Independent)  │
                        │                 │
                        │  "Sign in with  │
                        │   Windy" via    │
                        │   OAuth2/OIDC   │
                        └─────────────────┘
```

---

## 4. Bot Identity Questions

### 4.1 How Does a Windy Fly Agent Authenticate Differently from a Human?

**Current state:** The agent holds a manually-injected `WINDY_JWT` in its `.env` file. There is no agent-specific login flow, no registration, and no token refresh against the account server. The JWT is indistinguishable from a human's JWT.

**Required state:**

| Aspect | Human | Agent (Windy Fly) |
|--------|-------|--------------------|
| **Registration** | Email/password + phone OTP | Programmatic via `POST /v1/identity/agents/register` (owner must be authenticated human) |
| **Login** | Email/password or phone/OTP | Client Credentials flow (client_id + client_secret) or Device Code flow during `windy go` |
| **JWT claim** | `"identity_type": "human"` | `"identity_type": "agent"` |
| **JWT additional claims** | — | `"owner_id": "human-uuid"`, `"eternitas_id": "ET-XXXXX"`, `"passport_status": "active"` |
| **Token lifetime** | 24h access / 30d refresh | Longer-lived (7d access / 90d refresh) since agents run unattended |
| **Scope restrictions** | Full scope per product subscription | Inherits owner's scopes PLUS agent-specific restrictions (e.g., `mail:secretary` requires explicit owner consent) |
| **Revocation** | User-initiated | Owner-initiated OR Eternitas revocation cascade |

### 4.2 Does It Get a JWT?

**Yes.** Agents should receive JWTs from the unified identity service, but with `identity_type: "agent"` and agent-specific claims. This allows all product services to validate agent tokens using the same JWKS-based verification, while distinguishing agents from humans.

### 4.3 Does It Use API Keys?

**For LLM providers:** Yes, API keys remain (OpenAI, Anthropic, etc.). These are external service credentials and are outside the scope of Windy Identity.

**For Windy ecosystem services:** No. Agents should use JWTs issued by the identity service, not static API keys. The current `WINDY_JWT` in `.env` should be replaced with a Client Credentials OAuth2 flow that auto-refreshes.

### 4.4 How Does Eternitas Passport Status Affect Auth?

```
Passport Active (ET-XXXXX, status=active)
├── All product access granted per owner's subscriptions
├── Windy Chat: active, can send/receive
├── Windy Mail: active, can send/receive
├── Phone number: assigned, active
└── API access: full per scopes

Passport Suspended (ET-XXXXX, status=suspended)
├── Read-only access to all products
├── Windy Chat: can read, cannot send
├── Windy Mail: can read, cannot send
├── Phone number: inbound only
└── API access: read-only scopes only
└── Owner notified, given appeal window

Passport Revoked (ET-XXXXX, status=revoked)
├── ALL product access terminated
├── Windy Chat: account deactivated
├── Windy Mail: inbox frozen (30-day data retention, then deleted)
├── Phone number: returned to pool
├── JWT: immediately invalidated (revocation list or short expiry + no refresh)
├── Owner notified
└── Cascade triggered via webhook: Identity Service → all product services
```

### 4.5 The Hatch Flow (Unified Identity)

When `windy go` runs:

```
1. Owner authenticates (Device Code flow → browser → approve → token)
2. POST /v1/identity/agents/register
   → Creates agent identity (identity_type=agent, owner_id=human-uuid)
   → Auto-activates: Chat, Mail, Cloud, Fly
   → Returns: agent JWT (client_credentials grant)
3. Eternitas registration (external API call)
   → Returns: ET-XXXXX passport number
   → Stored in agent_identities.eternitas_id
4. Matrix auto-provisioning (reuse existing Synapse admin API flow)
   → @agentname:chat.windypro.com created
5. Windy Mail provisioning
   → agentname@windymail.ai inbox created
6. Twilio number assignment
   → +1 (555) XXX-XXXX from pool
7. Birth certificate generation
   → Digital: immediate
   → Physical: queued for print + mail
8. Agent hatches with all credentials injected
   → JWT stored in data/.windy_identity.json (0o600)
   → Matrix token stored in data/matrix_store/
   → No more manual .env editing
```

---

## 5. Migration Path

### 5.1 Existing Users

**Current user count:** Unknown (SQLite, likely small — pre-launch).

**Migration strategy:**

```
Phase 1: Schema Migration (Zero Downtime)
├── Create new `identities` table alongside existing `users` table
├── Create `identity_products` table
├── Run migration script:
│   FOR EACH user IN users:
│   ├── INSERT INTO identities (id=user.id, email, password_hash, display_name=name)
│   ├── INSERT INTO identity_products (identity_id=user.id, product='word', tier=user.tier)
│   └── If user has Matrix credentials in onboarding state:
│       └── INSERT INTO identity_products (identity_id=user.id, product='chat')
├── Add `identity_id` FK column to recordings, translations, files, transactions
├── Backfill identity_id = user_id (they're the same UUIDs)
└── Old `users` table kept as read-only backup for 90 days

Phase 2: JWT Migration (Gradual)
├── Identity service begins issuing new-format JWTs (with iss, aud, scopes)
├── Account server accepts BOTH old and new JWT formats (dual validation)
├── Mobile app update: login returns new JWT format
├── Desktop app update: login returns new JWT format
├── After 30 days: old JWT format no longer issued
├── After 60 days: old JWT format no longer accepted
└── agents: immediate — they re-auth on restart anyway

Phase 3: Product Activation (Automatic)
├── All migrated users get 'word' product activated (they were Word users)
├── Users with verified phone/email get 'chat' activated
├── All users get 'cloud' activated (storage is universal)
├── Mail, Fly, Clone, Traveler activated on demand
└── Eternitas: only for agents, not retroactive for humans
```

### 5.2 Data Preservation Guarantees

- **No data loss.** Recordings, translations, files, transactions all retain their existing `user_id` which maps 1:1 to the new `identity_id`.
- **No password reset required.** `password_hash` migrates directly.
- **No re-verification required.** Users who verified phone/email via K2 retain verified status.
- **Devices carry over.** The `devices` table gets an `identity_id` FK added; existing device registrations preserved.

### 5.3 Mobile App Migration

- App update ships with dual-auth support (old JWT + new JWT)
- On first launch after update, if old JWT exists in SecureStore:
  1. Call new `/v1/identity/migrate` endpoint with old JWT
  2. Receive new-format JWT + refresh token
  3. Store new tokens, delete old ones
  4. Seamless — user never sees a login screen

---

## 6. Security Considerations

### 6.1 Token Scoping

**Problem:** Today, a single JWT grants access to everything. A compromised Chat session could read all recordings, access billing, or manage devices.

**Solution:** Product-scoped tokens with audience and scope claims.

| Scenario | Allowed Scopes | Blocked |
|----------|---------------|---------|
| Windy Chat session | `chat:message`, `chat:rooms`, `chat:contacts` | `word:*`, `mail:*`, `cloud:write`, billing |
| Windy Mail session | `mail:read`, `mail:send` | `word:*`, `chat:*`, billing |
| Windy Fly (agent) | Inherits owner's active product scopes, minus `mail:secretary` unless explicitly granted | Cannot self-elevate scopes |
| Desktop app | `word:*`, `cloud:*` | `mail:send` (unless user also has Mail active) |
| Admin panel | `admin:*` (all scopes) | N/A |

**Enforcement:** Every product service validates `aud` (audience) and `scopes` claims. A Chat-audience token gets rejected by the Word API, even if the signature is valid.

### 6.2 Rate Limiting

**Current gaps:**
- No rate limiting on token refresh endpoint
- In-memory rate limiting (resets on service restart)
- No per-user global rate limit (only per-endpoint)

**Required:**
- Redis-backed rate limiting (shared across service instances)
- Per-identity global rate limit (across all products)
- Per-product rate limits (configurable by tier)
- Exponential backoff on failed auth attempts (currently flat 5/min)
- Agent-specific rate limits (agents can be more aggressive than humans)

### 6.3 Abuse Prevention

| Threat | Mitigation |
|--------|------------|
| **Credential stuffing** | Exponential backoff + CAPTCHA after 3 failures + account lockout after 10 |
| **Token theft** | Short access token lifetime (15 min recommended, currently 24h). Refresh token rotation already implemented. |
| **Agent impersonation** | `identity_type` claim in JWT. Products can reject agent tokens for human-only features. |
| **Scope escalation** | Scopes are signed into JWT. No self-service scope modification. Scope changes require re-authentication. |
| **Eternitas bypass** | Agent JWT includes `passport_status`. Products check this on every request. Revocation propagated via webhook + short token expiry. |
| **Cross-product data access** | Audience claim enforcement. Token valid for Chat cannot access Word APIs. |
| **Bot spam (Mail)** | Per-tier send limits, velocity monitoring, recipient diversity checks, content reputation scoring (all documented in BRAND-ARCHITECTURE.md). |

### 6.4 Secretary Mode Disclosure

**The problem:** Windy Fly can send email as the human (`mail:secretary` scope). This is powerful and dangerous.

**Required safeguards:**
1. `mail:secretary` scope requires explicit user consent (OAuth consent screen: "Allow [Agent Name] to send email as you?")
2. Consent is revocable at any time via identity dashboard
3. All secretary-mode emails include a machine-readable header: `X-Windy-Secretary: ET-XXXXX` (agent's Eternitas ID)
4. Human-readable footer option: "Sent by [Agent Name] on behalf of [Owner Name] via Windy Fly"
5. Audit log: every secretary-mode email logged with timestamp, recipient, subject (not body)
6. Rate limit: secretary-mode emails count against the human's daily limit, not the agent's

### 6.5 Critical Security Recommendations

1. **Switch to RS256 immediately.** HS256 with a shared secret across services is the biggest current vulnerability.
2. **Reduce access token lifetime** from 24 hours to 15 minutes. The refresh token flow already supports this.
3. **Move in-memory stores to Redis.** OTP store, verification store, pairing sessions — all currently lost on restart.
4. **Add PKCE to all OAuth flows.** Required for mobile and CLI clients.
5. **Implement token binding.** Associate refresh tokens with device fingerprint to prevent token theft.
6. **Encrypt credentials at rest.** Agent credentials in `.env` files are plaintext. Use OS keychain or encrypted config.

---

## 7. Recommended Architecture

### 7.1 The "Windy ID" Service

A single, purpose-built identity service replaces the current account server's auth functions. The account server continues to serve product-specific APIs (recordings, translations, etc.) but delegates all authentication to Windy ID.

```
                    ┌─────────────────────────────────────────┐
                    │         WINDY ID SERVICE                │
                    │         id.windypro.com                 │
                    │                                         │
                    │  ┌───────────────────────────────────┐  │
                    │  │  PostgreSQL (not SQLite)           │  │
                    │  │  ─────────────────────────────     │  │
                    │  │  identities                        │  │
                    │  │  identity_products                 │  │
                    │  │  agent_identities                  │  │
                    │  │  devices                           │  │
                    │  │  refresh_tokens                    │  │
                    │  │  oauth_clients                     │  │
                    │  │  oauth_grants                      │  │
                    │  │  product_credentials               │  │
                    │  └───────────────────────────────────┘  │
                    │                                         │
                    │  ┌─────────┐ ┌────────┐ ┌───────────┐  │
                    │  │ Auth    │ │ OAuth2 │ │ Verify    │  │
                    │  │ (login, │ │ /OIDC  │ │ (OTP via  │  │
                    │  │  reg,   │ │ Server │ │  Twilio + │  │
                    │  │  refresh│ │        │ │  SendGrid)│  │
                    │  │  )      │ │        │ │           │  │
                    │  └─────────┘ └────────┘ └───────────┘  │
                    │                                         │
                    │  ┌─────────┐ ┌────────┐ ┌───────────┐  │
                    │  │ JWKS    │ │ Agent  │ │ Product   │  │
                    │  │ (RS256  │ │ Reg +  │ │ Activation│  │
                    │  │  keys)  │ │ Hatch  │ │ Engine    │  │
                    │  └─────────┘ └────────┘ └───────────┘  │
                    └──────────────────┬──────────────────────┘
                                       │
                              RS256 JWTs issued
                                       │
               ┌───────────────────────┼───────────────────────┐
               │                       │                       │
               ▼                       ▼                       ▼
     ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
     │  Windy Word /   │    │  Windy Chat     │    │  Windy Mail     │
     │  Pro APIs       │    │  Services       │    │  Service        │
     │  (port 8098)    │    │  (ports 8101-   │    │  (TBD)          │
     │                 │    │   8104)          │    │                 │
     │  • Recordings   │    │  • Messaging    │    │  • IMAP/SMTP    │
     │  • Transcription│    │  • Directory    │    │  • Send/Receive │
     │  • Translation  │    │  • Push         │    │  • Rate limits  │
     │  • Billing      │    │  • Backup       │    │  • Reputation   │
     │  • Cloud files  │    │  • Pairing      │    │                 │
     │                 │    │                 │    │                 │
     │  Validates JWT: │    │  Validates JWT: │    │  Validates JWT: │
     │  aud=windy-word │    │  aud=windy-chat │    │  aud=windy-mail │
     │  via JWKS       │    │  via JWKS       │    │  via JWKS       │
     └─────────────────┘    └─────────────────┘    └─────────────────┘
               │                       │                       │
               ▼                       ▼                       ▼
     ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
     │  Windy Fly      │    │  Windy Cloud    │    │  Windy Clone    │
     │  (Agent)        │    │  (Storage +     │    │  (Digital Twin) │
     │                 │    │   Infra)        │    │                 │
     │  Client Creds   │    │  Backbone for   │    │  Voice/text     │
     │  OAuth2 flow    │    │  all products   │    │  data pipeline  │
     │  identity_type= │    │                 │    │                 │
     │  agent          │    │                 │    │                 │
     └─────────────────┘    └─────────────────┘    └─────────────────┘
                                                            │
                                                            ▼
                                                   ┌─────────────────┐
                                                   │  Eternitas      │
                                                   │  (Independent)  │
                                                   │                 │
                                                   │  Federated via  │
                                                   │  OAuth2/OIDC    │
                                                   │  "Sign in with  │
                                                   │   Windy"        │
                                                   │                 │
                                                   │  Revocation     │
                                                   │  webhook →      │
                                                   │  Windy ID →     │
                                                   │  cascade to all │
                                                   │  products       │
                                                   └─────────────────┘
```

### 7.2 Registration Flow (Unified)

```
User visits ANY Windy product for the first time:

1. "Sign up with Windy" button → redirects to id.windypro.com/register

2. id.windypro.com/register:
   ├── Enter email + password
   │   OR
   ├── Enter phone number → receive OTP → verify
   │   OR
   └── "Sign in with Google/Apple" (future)

3. Identity created in `identities` table

4. Product Activation Engine runs:
   ├── Activate the product they came from (e.g., 'word' if from windyword.com)
   ├── Auto-activate universal products:
   │   ├── 'cloud' (storage — everyone gets it)
   │   └── 'chat' (messaging — everyone gets it, free tier)
   ├── Provision Matrix account on Synapse
   ├── Register in chat directory (hash-based)
   └── [Future] Provision Windy Mail inbox

5. Redirect back to originating product with product-scoped JWT

6. User is now signed in everywhere:
   ├── windyword.com — logged in (word:* scopes)
   ├── windychat.com — account ready (chat:* scopes)
   ├── windymail.ai — inbox ready (mail:* scopes) [future]
   └── Any other Windy product — one click to activate
```

### 7.3 The Google Analogy

| Google | Windy | Function |
|--------|-------|----------|
| Google Account | Windy ID | Central identity |
| Gmail | Windy Mail | Email |
| Google Chat | Windy Chat | Messaging |
| Google Drive | Windy Cloud | Storage |
| Google Translate | Windy Traveler | Translation |
| Google Assistant | Windy Fly | AI agent |
| OAuth2 + OIDC | "Sign in with Windy" | Federation |
| accounts.google.com | id.windypro.com | Identity service |

### 7.4 Implementation Priority

| Phase | Work | Timeline Estimate |
|-------|------|-------------------|
| **Phase 0: Foundation** | [x] SQLite schema (5 new tables + 9 user columns). [x] Identity service (420 lines). [x] REST endpoints. [x] JWT fields (type, scopes, products). [x] Backward compat. [x] 37/37 security findings. | Week 1-2 |
| **Phase 1: Core Identity** | [x] Scoped JWT issuance (DB-backed scopes/products). [x] requireScopes() middleware. [x] Password validation unified (8+ chars, upper+lower+digit). [x] OTP verification promoted to identity-level (Twilio SMS + SendGrid email). [x] Email/phone verification flows. [x] Shared contracts updated. [x] All audit events wired. | Week 3-4 |
| **Phase 2: Product Integration** | [x] Chat profiles activated (chat_profiles table wired). [x] Auto-pending windy_chat on signup. [x] Lazy Matrix provisioning endpoint. [x] SecureStore-compatible credential format for mobile. [x] Chat profile CRUD endpoints. | Week 5-6 |
| **Phase 3: OAuth2/OIDC + Agent Identity** | [x] Bot API keys (wk_ prefix, SHA-256 hashed). [x] Eternitas webhook fully functional (registered, revoked, suspended, verified, trust_updated). [x] Revocation cascade. [x] Secretary mode consent (explicit OAuth-style). [x] Hatch flow credential injection (data/.windy_identity.json). [x] Bot-specific rate limits. | Week 7-10 |
| **Phase 4: DB Hardening + RS256** | [x] RS256 key pair generation (RSA-2048, configurable via JWT_PRIVATE_KEY_PATH or JWKS_KEY_DIR). [x] JWKS endpoint (GET /.well-known/jwks.json with kid rotation). [x] JWT signing migration (RS256 opt-in, HS256 fallback, zero breaking changes). [x] Key rotation support (multiple keys in JWKS, grace period expiry). [x] SQLite backup utility (better-sqlite3 backup API, timestamped, auto-prune). [x] WAL checkpoint (periodic PASSIVE checkpoint, prevents unbounded growth). [x] File upload magic byte validation (415 on MIME mismatch). [x] 29 tests passing (JWKS, OAuth, file validation). | Week 11-12 |
| **Phase 5: Cross-Product SSO** | [x] OAuth2 client registration (oauth_clients table, admin endpoint, bcrypt secrets). [x] Authorization endpoint (GET+POST /api/v1/oauth/authorize, consent flow). [x] Token endpoint (authorization_code, client_credentials, refresh_token, device_code). [x] PKCE support (S256 required for public clients). [x] Device code flow (POST /api/v1/oauth/device, user_code approval). [x] OIDC discovery (GET /.well-known/openid-configuration). [x] UserInfo endpoint (GET /api/v1/oauth/userinfo, standard OIDC claims). [x] Consent tracking (oauth_consents table, revocation). [x] Authorization codes (oauth_codes table, 10min TTL, single-use). [x] First-party auto-approval (is_first_party flag). [x] Shared contracts updated (10 new types). | Week 13-14 |
| **Phase 6: PostgreSQL Migration** | Database migration from SQLite to PostgreSQL. Cross-device session management. Admin console. Token exchange (RFC 8693). | Week 15+ |

### 7.5 Key Decisions Needed

1. **Domain for identity service:** `id.windypro.com`? `accounts.windypro.com`? `auth.windypro.com`?
2. **Database:** PostgreSQL is recommended over SQLite for production identity service. Confirm.
3. **Existing account-server fate:** Refactor into identity service, or keep as product API server that delegates auth to new identity service?
4. **Eternitas timeline:** Does Eternitas need its own identity system, or does it fully delegate to "Sign in with Windy"?
5. **Mobile app versioning:** Force update to unified auth, or support old auth indefinitely?

---

_End of report. No code changes were made. This is research and analysis only._
