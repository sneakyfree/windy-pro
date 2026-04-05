# Ecosystem API Reference — Windy Pro Account Server

_Generated: 29 March 2026_
_Server: `account-server/` (port 8098)_
_Source of truth for all ecosystem product integrations._

---

## Overview

The Windy Pro Account Server is the central identity and data service for the entire Windy ecosystem. Every product authenticates through it, and many use it for storage, transcription, translation, and billing.

### Consumers

| Abbreviation | Product | Repo |
|---|---|---|
| **WPD** | Windy Pro Desktop (Electron) | `windy-pro` |
| **WPM** | Windy Pro Mobile (Expo) | `windy-pro-mobile` |
| **WEB** | Windy Pro Web (React SPA) | `windy-pro/src/client/web` |
| **WC** | Windy Chat | `windy-chat` |
| **WM** | Windy Mail | `windy-mail` (planned) |
| **WF** | Windy Fly (AI Agent) | `windy-agent` |
| **ET** | Eternitas (Bot Registry) | `eternitas` (planned) |
| **ADM** | Admin Console (internal) | `windy-pro/account-server` |

### Authentication Methods

| Method | Header / Mechanism | Used By |
|---|---|---|
| **JWT** | `Authorization: Bearer <jwt>` | All human-facing clients |
| **Bot API Key** | `Authorization: Bearer wk_<key>` | Windy Fly agents |
| **Webhook Signature** | `X-Eternitas-Signature` HMAC-SHA256 | Eternitas webhooks |
| **None** | No auth required | Health, discovery, public endpoints |

---

## 1. Authentication

### POST /api/v1/auth/register

Create a new user account.

| Field | Value |
|---|---|
| **Auth** | None |
| **Rate Limit** | 5/minute per IP |
| **Consumers** | WPD, WPM, WEB |

**Request Body:**
```json
{
  "name": "string (required)",
  "email": "string (required)",
  "password": "string (required, min 8 chars, must include uppercase + lowercase + digit)",
  "deviceId": "string (optional)",
  "deviceName": "string (optional)",
  "platform": "string (optional — darwin | linux | windows)"
}
```

**Response (201):**
```json
{
  "userId": "uuid",
  "windyIdentityId": "uuid — universal cross-product identity",
  "name": "string",
  "email": "string",
  "tier": "free",
  "token": "JWT access token (15m expiry)",
  "refreshToken": "uuid (30d expiry)",
  "devices": [{ "id", "name", "platform", "registered_at", "last_seen" }]
}
```

**Errors:** `409` email exists, `400` validation failed (weak password, missing fields), `429` rate limited

**Side Effects:** Creates `product_accounts` row for `windy_pro` (active) and `windy_chat` (pending). Grants `windy_pro:*` scope. Logs `register` audit event.

---

### POST /api/v1/auth/login

Authenticate with email and password.

| Field | Value |
|---|---|
| **Auth** | None |
| **Rate Limit** | 5/minute per IP |
| **Consumers** | WPD, WPM, WEB |

**Request Body:**
```json
{
  "email": "string (required)",
  "password": "string (required)",
  "deviceId": "string (optional)",
  "deviceName": "string (optional)",
  "platform": "string (optional)"
}
```

**Response (200):**
```json
{
  "userId": "uuid",
  "windyIdentityId": "uuid",
  "name": "string",
  "email": "string",
  "tier": "free | pro | translate | translate_pro",
  "token": "JWT",
  "refreshToken": "uuid",
  "devices": [...]
}
```

**Errors:** `401` invalid credentials (same message for wrong password and nonexistent user — no enumeration), `429` rate limited

---

### POST /api/v1/auth/refresh

Exchange a refresh token for a new JWT + refresh token pair.

| Field | Value |
|---|---|
| **Auth** | None (refresh token in body) |
| **Consumers** | WPD, WPM, WEB |

**Request Body:**
```json
{
  "refreshToken": "uuid (required)",
  "deviceId": "string (optional)"
}
```

**Response (200):**
```json
{
  "token": "new JWT",
  "refreshToken": "new uuid (old one invalidated)",
  "tier": "string",
  "userId": "uuid",
  "name": "string"
}
```

**Errors:** `401` invalid or expired refresh token

**Note:** Refresh tokens are single-use. Using an old refresh token after rotation returns 401.

---

### POST /api/v1/auth/logout

Invalidate the current session.

| Field | Value |
|---|---|
| **Auth** | JWT |
| **Consumers** | WPD, WPM, WEB |

**Response (200):** `{ "success": true }`

**Side Effects:** Deletes all refresh tokens for user. Blacklists the access token (Redis + DB). Logs `logout` audit event.

---

### GET /api/v1/auth/me

Get current user profile.

| Field | Value |
|---|---|
| **Auth** | JWT |
| **Consumers** | WPD, WPM, WEB |

**Response (200):**
```json
{
  "userId": "uuid",
  "name": "string",
  "email": "string",
  "tier": "string",
  "createdAt": "ISO 8601",
  "devices": [...],
  "deviceLimit": 5
}
```

---

### POST /api/v1/auth/change-password

| Field | Value |
|---|---|
| **Auth** | JWT |
| **Consumers** | WPM, WEB |

**Request Body:**
```json
{
  "currentPassword": "string (required)",
  "newPassword": "string (required, same strength rules as registration)"
}
```

**Response (200):** `{ "success": true }`

**Errors:** `401` wrong current password, `404` user not found

---

### GET /api/v1/auth/devices

| Field | Value |
|---|---|
| **Auth** | JWT |
| **Consumers** | WPD, WPM, WEB |

**Response (200):**
```json
{
  "devices": [{ "id", "name", "platform", "registered_at", "last_seen" }],
  "count": 2,
  "limit": 5,
  "remaining": 3
}
```

---

### POST /api/v1/auth/devices/register

| Field | Value |
|---|---|
| **Auth** | JWT |
| **Consumers** | WPD, WPM |

**Request Body:** `{ "deviceId": "string", "deviceName": "string", "platform": "string" }`

**Response (201):** `{ "message": "Device registered", "devices": [...], "count", "limit" }`

**Errors:** `403` device limit reached (5 max)

---

### POST /api/v1/auth/devices/remove

| Field | Value |
|---|---|
| **Auth** | JWT |
| **Consumers** | WPD, WPM, WEB |

**Request Body:** `{ "deviceId": "string" }`

**Response (200):** `{ "message": "Device removed", "devices": [...], "count", "limit", "remaining" }`

---

### GET /api/v1/auth/billing

| Field | Value |
|---|---|
| **Auth** | JWT |
| **Consumers** | WEB |

**Response (200):** `{ "email", "tier", "createdAt", "stripeCustomerId", "payments": [] }`

---

### POST /api/v1/auth/create-portal-session

| Field | Value |
|---|---|
| **Auth** | JWT |
| **Consumers** | WEB |

**Response (200):** `{ "url": null, "message": "Stripe portal not configured" }`

**Note:** Stub — awaiting Stripe portal integration.

---

## 2. Unified Identity

### GET /api/v1/identity/me

Extended identity profile across all products.

| Field | Value |
|---|---|
| **Auth** | JWT or Bot API Key |
| **Consumers** | WPD, WPM, WEB, WC, WM, WF, ET |

**Response (200):**
```json
{
  "identity": {
    "id": "uuid (internal)",
    "windyIdentityId": "uuid (cross-product)",
    "email": "string",
    "name": "string",
    "tier": "string",
    "identityType": "human | bot",
    "phone": "string (E.164) | null",
    "displayName": "string | null",
    "avatarUrl": "string | null",
    "emailVerified": true,
    "phoneVerified": false,
    "passportId": "ET-XXXXX | null",
    "preferredLang": "en",
    "lastLoginAt": "ISO 8601 | null",
    "createdAt": "ISO 8601",
    "updatedAt": "ISO 8601"
  },
  "products": [
    { "id", "identity_id", "product": "windy_pro", "status": "active", "metadata": {} }
  ],
  "scopes": [
    { "id", "identity_id", "scope": "windy_pro:*", "granted_at" }
  ],
  "chatProfile": { "...or null" },
  "passport": { "...or null" }
}
```

---

### PATCH /api/v1/identity/me

| Field | Value |
|---|---|
| **Auth** | JWT |
| **Consumers** | WPM, WEB, WC |

**Request Body (all optional):**
```json
{
  "displayName": "string",
  "preferredLang": "ISO 639-1 code",
  "avatarUrl": "URL",
  "phone": "E.164 string"
}
```

**Response (200):** `{ "success": true }`

---

### GET /api/v1/identity/products

| Field | Value |
|---|---|
| **Auth** | JWT or Bot API Key |
| **Consumers** | WPD, WPM, WEB, WF |

**Response (200):** `{ "products": [{ "id", "identity_id", "product", "status", "metadata", "created_at" }] }`

---

### POST /api/v1/identity/products/provision

Activate a new product for the current identity.

| Field | Value |
|---|---|
| **Auth** | JWT |
| **Consumers** | WPD, WPM, WEB, WF |

**Request Body:** `{ "product": "windy_pro | windy_chat | windy_mail | windy_fly", "metadata": {} }`

**Response (201):** `{ "account": { "id" }, "provisioned": true }`

---

### GET /api/v1/identity/scopes

| Field | Value |
|---|---|
| **Auth** | JWT or Bot API Key |
| **Consumers** | All |

**Response (200):** `{ "scopes": [{ "id", "identity_id", "scope", "granted_at", "granted_by" }] }`

---

### POST /api/v1/identity/scopes/grant

| Field | Value |
|---|---|
| **Auth** | JWT + Admin role |
| **Consumers** | ADM |

**Request Body:** `{ "identityId": "uuid", "scopes": ["scope1", "scope2"] }`

**Response (200):** `{ "success": true }`

---

### DELETE /api/v1/identity/scopes/:scope

| Field | Value |
|---|---|
| **Auth** | JWT + Admin role |
| **Consumers** | ADM |

**Query:** `?identityId=uuid`

**Response (200):** `{ "revoked": true }`

---

### GET /api/v1/identity/audit

| Field | Value |
|---|---|
| **Auth** | JWT (own logs) or JWT + Admin (any user) |
| **Consumers** | WEB, ADM |

**Query:** `?identityId=&limit=50&offset=0&event=login`

**Response (200):** Array of audit log entries with `id`, `identity_id`, `event`, `details`, `ip_address`, `user_agent`, `created_at`.

---

### POST /api/v1/identity/chat/provision

Lazy-provision a Matrix account on Synapse.

| Field | Value |
|---|---|
| **Auth** | JWT |
| **Consumers** | WPM, WC |

**Request Body:** `{ "displayName": "string (optional)" }`

**Response (201 — first provision):**
```json
{
  "success": true,
  "matrix": {
    "matrixUserId": "@windy_name:chat.windypro.com",
    "accessToken": "syt_...",
    "deviceId": "ABCDEF",
    "homeServer": "https://chat.windypro.com"
  },
  "secureStoreKeys": {
    "windy_matrix_token": "syt_...",
    "windy_matrix_user": "@windy_name:chat.windypro.com",
    "windy_matrix_server": "https://chat.windypro.com",
    "windy_matrix_device": "ABCDEF"
  }
}
```

**Response (200 — already provisioned):** Same shape with existing credentials.

---

### GET /api/v1/identity/chat/profile

| Field | Value |
|---|---|
| **Auth** | JWT |
| **Consumers** | WPM, WC |

**Response (200):** `{ "profile": { ... } | null, "provisioned": boolean }`

---

### POST /api/v1/identity/api-keys

Generate a bot API key (`wk_` prefix).

| Field | Value |
|---|---|
| **Auth** | JWT (must be operator of the bot, or admin) |
| **Consumers** | WF, ADM |

**Request Body:**
```json
{
  "identityId": "uuid of the bot identity",
  "scopes": ["windy_chat:*", "windy_mail:read"],
  "label": "string (optional)",
  "expiresInDays": 365
}
```

**Response (201):**
```json
{
  "apiKey": "wk_abc123... (shown once, never again)",
  "keyPrefix": "wk_abc1",
  "id": "uuid",
  "scopes": ["..."],
  "expiresAt": "ISO 8601"
}
```

---

### DELETE /api/v1/identity/api-keys/:keyId

| Field | Value |
|---|---|
| **Auth** | JWT |
| **Consumers** | WF, ADM |

**Response (200):** `{ "revoked": true }`

---

### GET /api/v1/identity/api-keys

| Field | Value |
|---|---|
| **Auth** | JWT |
| **Consumers** | WF, ADM |

**Query:** `?identityId=uuid (optional, defaults to self)`

**Response (200):** `{ "keys": [{ "id", "identity_id", "key_prefix", "label", "scopes", "status", "created_at", "expires_at", "last_used_at" }] }`

---

### POST /api/v1/identity/secretary/consent

Grant or revoke permission for a bot to send email as the human owner.

| Field | Value |
|---|---|
| **Auth** | JWT (human owner) |
| **Consumers** | WEB, WPM, WF |

**Request Body:** `{ "botIdentityId": "uuid", "consent": true | false }`

**Response (200):** `{ "success": true, "consentId": "uuid" }`

---

### GET /api/v1/identity/secretary/status

| Field | Value |
|---|---|
| **Auth** | JWT |
| **Consumers** | WF, WM |

**Query:** `?botIdentityId=uuid` (required for bots, ignored for humans)

**Response (200 — human):** `{ "consented": false, "identity_type": "human", "message": "Secretary consent is only applicable to bot identities" }`

**Response (200 — bot):** `{ "botIdentityId": "uuid", "hasConsent": true }`

---

### POST /api/v1/identity/eternitas/webhook

Receive bot lifecycle events from Eternitas.

| Field | Value |
|---|---|
| **Auth** | HMAC-SHA256 signature via `ETERNITAS_WEBHOOK_SECRET` |
| **Rate Limit** | 10/minute |
| **Consumers** | ET |

**Request Body:**
```json
{
  "event": "passport.registered | passport.revoked | passport.suspended | passport.verified | trust_updated",
  "passportNumber": "ET-XXXXX",
  "agentName": "string",
  "operatorEmail": "string",
  "timestamp": "ISO 8601",
  "signature": "HMAC hex string",
  "trustScore": 0.0-1.0
}
```

**Response (200 — registered):**
```json
{
  "received": true,
  "identityId": "uuid",
  "productsProvisioned": ["windy_chat", "windy_mail"],
  "apiCredentials": { "apiKey": "wk_...", "keyPrefix": "wk_..." }
}
```

**Response (200 — revoked/suspended):** `{ "received": true, "identityId": "uuid", "productsAffected": 2, "cascadeCompleted": true }`

---

### POST /api/v1/identity/hatch/credentials

Generate structured credential file for a new Windy Fly agent.

| Field | Value |
|---|---|
| **Auth** | JWT + Admin role |
| **Consumers** | WF (via admin/CLI) |

**Request Body:** `{ "identityId": "uuid" }`

**Response (200):**
```json
{
  "credentials": {
    "version": 1,
    "identityId": "uuid",
    "passportNumber": "ET-XXXXX",
    "identityType": "bot",
    "apiKey": "wk_...",
    "scopes": ["..."],
    "products": ["windy_chat", "windy_mail"],
    "operatorIdentityId": "uuid",
    "createdAt": "ISO 8601"
  },
  "filePath": "data/.windy_identity.json",
  "fileMode": "0o600"
}
```

---

### POST /api/v1/identity/backfill

Migrate existing users to identity system.

| Field | Value |
|---|---|
| **Auth** | JWT + Admin role |
| **Consumers** | ADM |

**Response (200):** `{ "success": true, "usersProcessed": 100, "accountsCreated": 100 }`

---

## 3. Verification (OTP)

### POST /api/v1/identity/verify/send

Send a 6-digit OTP via SMS or email.

| Field | Value |
|---|---|
| **Auth** | JWT |
| **Rate Limit** | 5/minute, 10/hour (keyed on IP + identifier) |
| **Consumers** | WPM, WEB, WC |

**Request Body:**
```json
{
  "type": "phone | email",
  "identifier": "+15551234567 or user@example.com",
  "countryCode": "+1 (optional, for phone normalization)"
}
```

**Response (200):** `{ "success": true, "type": "phone", "identifier": "(redacted)", "message": "Verification code sent", "expiresInSeconds": 600 }`

---

### POST /api/v1/identity/verify/check

Validate an OTP code.

| Field | Value |
|---|---|
| **Auth** | JWT |
| **Consumers** | WPM, WEB, WC |

**Request Body:**
```json
{
  "identifier": "string",
  "code": "string (6 digits)",
  "type": "phone | email",
  "countryCode": "string (optional)"
}
```

**Response (200):** `{ "success": true, "verified": true, "verificationToken": "uuid", "type": "email" }`

**Side Effects:** Sets `email_verified=1` or `phone_verified=1` on user record.

---

### GET /api/v1/identity/verify/status

| Field | Value |
|---|---|
| **Auth** | JWT |
| **Consumers** | WPM, WEB |

**Response (200):** `{ "email": "user@example.com", "emailVerified": true, "phone": "+15551234567", "phoneVerified": false }`

---

## 4. OAuth2 / OpenID Connect

### POST /api/v1/oauth/clients

Register an OAuth2 client application.

| Field | Value |
|---|---|
| **Auth** | JWT + Admin role |
| **Consumers** | ADM |

**Request Body:**
```json
{
  "name": "Windy Chat",
  "redirectUris": ["https://chat.windypro.com/auth/callback"],
  "allowedScopes": ["windy_chat:*"],
  "isFirstParty": true,
  "isPublic": false
}
```

**Response (201):** `{ "clientId": "uuid", "clientSecret": "wcs_... (confidential only)", "name", "redirectUris", "allowedScopes", "isFirstParty", "isPublic" }`

---

### GET /api/v1/oauth/clients

| Field | Value |
|---|---|
| **Auth** | JWT + Admin role |
| **Consumers** | ADM |

**Response (200):** `{ "clients": [...] }`

---

### GET /api/v1/oauth/authorize

OAuth2 Authorization endpoint.

| Field | Value |
|---|---|
| **Auth** | JWT |
| **Rate Limit** | 30/minute |
| **Consumers** | WC, WM, WF, ET |

**Query Parameters:**
- `client_id` (required)
- `redirect_uri` (required)
- `response_type=code` (required)
- `scope` (optional, space-separated)
- `state` (recommended)
- `code_challenge` (required for public clients)
- `code_challenge_method=S256` (required with code_challenge)

**Response (200 — first-party auto-approve):** `{ "redirect": "https://...", "code": "uuid", "state": "..." }`

**Response (200 — third-party):** `{ "consent_required": true, "client": { "clientId", "name" }, "requestedScopes": [...] }`

---

### POST /api/v1/oauth/authorize

Submit consent decision.

| Field | Value |
|---|---|
| **Auth** | JWT |
| **Consumers** | WEB (consent form) |

**Request Body (JSON or form):**
```json
{
  "client_id": "string",
  "redirect_uri": "string",
  "scope": "string (space-separated)",
  "state": "string",
  "code_challenge": "string",
  "approved": true
}
```

**Response (200):** `{ "redirect": "https://...?code=...&state=..." }`

---

### POST /api/v1/oauth/token

Exchange authorization code, client credentials, refresh token, or device code for tokens.

| Field | Value |
|---|---|
| **Auth** | Client credentials (Basic auth or body) for confidential clients; none for public |
| **Rate Limit** | 20/minute |
| **Consumers** | WC, WM, WF, ET, WPD, WPM |

**Grant: authorization_code**
```json
{
  "grant_type": "authorization_code",
  "code": "uuid",
  "redirect_uri": "string",
  "client_id": "string",
  "code_verifier": "string (PKCE — required for public clients)"
}
```

**Grant: client_credentials**
```json
{
  "grant_type": "client_credentials",
  "client_id": "string",
  "client_secret": "string",
  "scope": "string (optional)"
}
```

**Grant: refresh_token**
```json
{
  "grant_type": "refresh_token",
  "refresh_token": "string",
  "client_id": "string"
}
```

**Grant: device_code**
```json
{
  "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
  "device_code": "string",
  "client_id": "string"
}
```

**Response (200):**
```json
{
  "access_token": "JWT",
  "token_type": "Bearer",
  "expires_in": 900,
  "refresh_token": "string (not for client_credentials)",
  "scope": "string"
}
```

---

### POST /api/v1/oauth/device

Initiate Device Code flow (for CLI tools like `windy go`).

| Field | Value |
|---|---|
| **Auth** | None |
| **Consumers** | WF (hatch), WPD (CLI login) |

**Request Body:** `{ "client_id": "windy_fly", "scope": "windy_fly:* windy_chat:*" }`

**Response (200):**
```json
{
  "device_code": "uuid",
  "user_code": "ABCD-EFGH",
  "verification_uri": "https://windypro.thewindstorm.uk/api/v1/oauth/device/verify",
  "verification_uri_complete": "https://windypro.thewindstorm.uk/api/v1/oauth/device/verify?user_code=ABCD-EFGH",
  "expires_in": 900,
  "interval": 5
}
```

---

### POST /api/v1/oauth/device/approve

User approves a device code.

| Field | Value |
|---|---|
| **Auth** | JWT |
| **Consumers** | WEB |

**Request Body:** `{ "user_code": "ABCD-EFGH", "approved": true }`

**Response (200):** `{ "success": true, "message": "Device approved" }`

---

### GET /api/v1/oauth/userinfo

Standard OIDC UserInfo endpoint.

| Field | Value |
|---|---|
| **Auth** | JWT |
| **Consumers** | WC, WM, WF, ET |

**Response (200):**
```json
{
  "sub": "uuid (windyIdentityId)",
  "name": "string",
  "preferred_username": "string (email)",
  "email": "string",
  "email_verified": true,
  "phone_number": "+15551234567 | null",
  "phone_number_verified": false,
  "picture": "url | null",
  "locale": "en",
  "identity_type": "human | bot"
}
```

---

### GET /api/v1/oauth/consents

| Field | Value |
|---|---|
| **Auth** | JWT |
| **Consumers** | WEB |

**Response (200):** `{ "consents": [{ "client_id", "scopes", "granted_at", "client_name", "is_first_party" }] }`

---

### DELETE /api/v1/oauth/consents/:clientId

| Field | Value |
|---|---|
| **Auth** | JWT |
| **Consumers** | WEB |

**Response (200):** `{ "revoked": true }`

---

### GET /api/v1/oauth/consent

Renders HTML consent page for third-party clients.

| Field | Value |
|---|---|
| **Auth** | JWT |
| **Consumers** | WEB (browser redirect) |

**Query:** `?client_id=...&redirect_uri=...&scope=...&state=...&code_challenge=...`

**Response (200):** HTML page with Allow/Deny buttons.

---

## 5. Recordings

### GET /api/v1/recordings

| Field | Value |
|---|---|
| **Auth** | JWT |
| **Consumers** | WPD, WPM, WEB |

**Query:** `?since=ISO8601` (default: all)

**Response (200):** `{ "bundles": [{ "id", "bundle_id", "created_at", "duration_seconds", "transcript_text", "has_video", "source", "device_platform", ... }], "total", "since" }`

---

### GET /api/v1/recordings/list

Alias for `GET /api/v1/recordings`. Same behavior.

| **Consumers** | WPD, WPM |

---

### GET /api/v1/recordings/check

| Field | Value |
|---|---|
| **Auth** | JWT |
| **Consumers** | WPD, WPM |

**Query:** `?bundle_id=uuid`

**Response (200):** `{ "exists": true, "bundle_id": "uuid" }`

---

### GET /api/v1/recordings/stats

| Field | Value |
|---|---|
| **Auth** | JWT |
| **Consumers** | WPD, WPM, WEB |

**Response (200):**
```json
{
  "totalRecordings": 42,
  "totalDuration": 3600.5,
  "totalSize": 1048576,
  "avgQuality": 85,
  "videoRecordings": 3,
  "cloneReady": 10,
  "firstRecording": "ISO 8601",
  "lastRecording": "ISO 8601"
}
```

---

### GET /api/v1/recordings/:id

| Field | Value |
|---|---|
| **Auth** | JWT |
| **Consumers** | WPD, WPM, WEB |

**Response (200):** Full recording object with all metadata.

**Errors:** `404` not found

---

### DELETE /api/v1/recordings/:id

| Field | Value |
|---|---|
| **Auth** | JWT |
| **Consumers** | WEB |

**Response (200):** `{ "deleted": true, "id": "uuid" }`

---

### POST /api/v1/recordings/upload

| Field | Value |
|---|---|
| **Auth** | JWT |
| **Max Size** | 500MB |
| **Consumers** | WPD, WPM |

**Request (multipart):**
- `media` — audio or video file (magic byte validated)
- `duration_seconds`, `has_video`, `video_resolution`, `camera_source`, `device_platform`, `app_version`, `clone_training_ready`, `bundle_id`, `transcript_text`, `transcript_segments`

**Response (201):** `{ "id": "uuid", "bundle_id": "uuid", "file_size": 1048576 }`

---

### POST /api/v1/recordings/upload/chunk

Chunked upload for large files.

| Field | Value |
|---|---|
| **Auth** | JWT |
| **Consumers** | WPD, WPM |

**Request Body:** `{ "bundle_id", "chunk_index", "total_chunks", "data", "file_type" }`

**Response (200):** `{ "received": true, "chunk_index", "bundle_id" }`

---

### POST /api/v1/recordings/upload/batch

Batch upload multiple recording metadata records.

| Field | Value |
|---|---|
| **Auth** | JWT |
| **Consumers** | WPD |

**Request Body:** Array of recording objects.

**Response (200):** `{ "uploaded": 5, "errors": [] }`

---

### POST /api/v1/recordings/sync

Sync recordings from desktop to cloud.

| Field | Value |
|---|---|
| **Auth** | JWT |
| **Consumers** | WPD |

**Request Body:** `{ "bundles": [{ "bundle_id", "created_at", "duration_seconds", "transcript", ... }] }`

**Response (200):** `{ "synced": 5, "skipped": 1, "errors": [] }`

---

### GET /api/v1/recordings/:id/video

Stream video with HTTP Range support.

| Field | Value |
|---|---|
| **Auth** | JWT |
| **Consumers** | WPD, WEB |

**Response:** `206 Partial Content` or `200 OK` with `video/webm` content.

---

## 6. Transcription

### POST /api/v1/transcribe

Single-file speech-to-text.

| Field | Value |
|---|---|
| **Auth** | Optional (guest allowed) |
| **Max Size** | 25MB |
| **Consumers** | WPD, WPM, WEB |

**Request (multipart):**
- `audio` — audio file
- `language` — ISO 639-1 (default: `en`)
- `engine` — `cloud-standard` (default)

**Response (200):**
```json
{
  "segments": [{ "id", "text", "startTime", "endTime", "confidence", "language", "partial" }],
  "fullText": "string",
  "language": "en",
  "duration": 12.5,
  "engine": "groq-whisper"
}
```

---

### POST /api/v1/transcribe/batch

Batch transcription (up to 20 files).

| Field | Value |
|---|---|
| **Auth** | Optional |
| **Consumers** | WPD |

**Response (200):** `{ "results": [{ "index", "segments", "fullText", "language", "duration", "error?" }] }`

---

### WS /ws/transcribe

Real-time streaming transcription via WebSocket.

| Field | Value |
|---|---|
| **Auth** | JWT via first message |
| **Consumers** | WPD, WEB |

**Protocol:**
1. Client connects
2. Client sends: `{ "type": "auth", "token": "JWT" }`
3. Server responds: `{ "type": "ack", "authenticated": true }`
4. Client sends: `{ "type": "config", "language": "en", "engine": "cloud-standard" }`
5. Server responds: `{ "type": "state", "state": "listening" }`
6. Client sends: binary audio chunks (PCM/WebM)
7. Server responds: `{ "type": "transcript", "text": "...", "partial": true, "confidence": 0.95 }`
8. Client sends: `{ "type": "stop" }`
9. Connection closes with final transcript

**Auth timeout:** 10 seconds. Connection closed with code `4001` if no auth received.

---

## 7. Translation

### POST /api/v1/translate/text

| Field | Value |
|---|---|
| **Auth** | JWT |
| **Consumers** | WPD, WPM, WEB, WF |

**Request Body:** `{ "text": "Hello", "sourceLang": "en", "targetLang": "es" }`

**Response (200):**
```json
{
  "id": "uuid",
  "sourceText": "Hello",
  "translatedText": "Hola",
  "sourceLang": "en",
  "targetLang": "es",
  "confidence": 0.95,
  "type": "text",
  "engine": "groq"
}
```

---

### POST /api/v1/translate/speech

| Field | Value |
|---|---|
| **Auth** | JWT |
| **Max Size** | 10MB |
| **Consumers** | WPM |

**Request (multipart):** `audio` file + `sourceLang` + `targetLang`

**Response (200):** Same shape as text translation + `audioData` field.

---

### GET /api/v1/translate/languages

| Field | Value |
|---|---|
| **Auth** | None |
| **Consumers** | WPD, WPM, WEB |

**Response (200):** `{ "languages": [{ "code": "en", "name": "English" }, ...] }` (12 languages)

---

### GET /api/v1/user/history

Translation history.

| Field | Value |
|---|---|
| **Auth** | JWT |
| **Consumers** | WPM, WEB, WF |

**Query:** `?limit=20&offset=0`

**Response (200):** `{ "history": [{ "id", "source_lang", "target_lang", "source_text", "translated_text", "confidence", "type", "created_at" }], "pagination": { "limit", "offset", "total", "hasMore" } }`

---

### POST /api/v1/user/favorites

Toggle favorite on a translation.

| Field | Value |
|---|---|
| **Auth** | JWT |
| **Consumers** | WPM, WEB |

**Request Body:** `{ "translationId": "uuid" }`

**Response (200):** `{ "favorited": true, "translationId": "uuid", "favoriteId": "uuid" }`

---

## 8. File Storage

### POST /api/v1/files/upload

| Field | Value |
|---|---|
| **Auth** | JWT |
| **Consumers** | WPD, WPM |

**Request (multipart):** `file` + `type` (optional) + `sessionDate` + `metadata` (JSON)

**Response (200):** `{ "ok": true, "fileId": "uuid", "size": 1024, "storageUsed": 5000, "storageLimit": 524288000 }`

**Errors:** `413` storage limit exceeded

---

### GET /api/v1/files

| Field | Value |
|---|---|
| **Auth** | JWT |
| **Consumers** | WPD, WPM, WEB |

**Query:** `?page=1&limit=50`

**Response (200):** `{ "ok": true, "files": [...], "total", "storageUsed", "storageLimit" }`

---

### GET /api/v1/files/:fileId

Download a file.

| Field | Value |
|---|---|
| **Auth** | JWT (owner or admin) |
| **Consumers** | WPD, WPM, WEB |

**Response:** Binary file download.

---

### DELETE /api/v1/files/:fileId

| Field | Value |
|---|---|
| **Auth** | JWT (owner only) |
| **Consumers** | WEB |

**Response (200):** `{ "ok": true }`

---

## 9. Clone Training

### GET /api/v1/clone/training-data

| Field | Value |
|---|---|
| **Auth** | JWT |
| **Consumers** | WPD, WPM, WF |

**Response (200):** `{ "bundles": [{ "id", "bundle_id", "duration_seconds", "clone_training_ready", ... }], "total" }`

---

### POST /api/v1/clone/start-training

| Field | Value |
|---|---|
| **Auth** | JWT |
| **Consumers** | WPD, WPM |

**Request Body:** `{ "bundle_ids": ["uuid", "uuid"] }`

**Response (200):** `{ "jobId": "uuid", "status": "queued", "bundle_count": 3, "estimated_time": "2-4 hours" }`

**Note:** Stub — returns X-Stub header.

---

## 10. Billing

### POST /api/v1/stripe/webhook

Stripe payment event handler.

| Field | Value |
|---|---|
| **Auth** | Stripe signature (`stripe-signature` header) |
| **Consumers** | Stripe (external) |

**Events handled:** `payment_intent.succeeded`, `invoice.paid`, `charge.refunded`, `customer.subscription.deleted`, `invoice.payment_failed`

**Response (200):** `{ "received": true }`

---

### GET /api/v1/billing/transactions

| Field | Value |
|---|---|
| **Auth** | JWT |
| **Consumers** | WEB |

**Query:** `?status=&limit=50&offset=0`

**Response (200):** `{ "ok": true, "transactions": [...], "total", "limit", "offset" }`

---

### GET /api/v1/billing/summary

| Field | Value |
|---|---|
| **Auth** | JWT |
| **Consumers** | WEB |

**Response (200):** `{ "ok": true, "totalSpent": 49.99, "activeSubscriptions": 1, "tier": "pro", "storageUsed": 5000, "storageLimit": 5368709120 }`

---

## 11. Admin API

All admin endpoints require `JWT + Admin role`.

| Endpoint | Method | Consumers | Description |
|---|---|---|---|
| `/api/v1/admin/users` | GET | ADM | List users (paginated, searchable) |
| `/api/v1/admin/users/:userId` | GET | ADM | User detail with files, recordings, devices |
| `/api/v1/admin/users/:userId/freeze` | POST | ADM | Freeze/unfreeze account |
| `/api/v1/admin/users/:userId/tier` | POST | ADM | Change tier and storage limit |
| `/api/v1/admin/users/:userId` | DELETE | ADM | Cascade-delete user and all data |
| `/api/v1/admin/stats` | GET | ADM | Server statistics (users, recordings, uptime, memory) |
| `/api/v1/admin/revenue` | GET | ADM | Revenue report (total, MRR, plan counts) |
| `/api/v1/admin/overview` | GET | ADM | Dashboard summary (totals, storage breakdown) |
| `/api/v1/admin/billing/transactions` | GET | ADM | All transactions (filterable by user, status) |
| `/api/v1/admin/billing/refund` | POST | ADM | Process refund (Stripe + tier downgrade) |

---

## 12. Admin Console (HTML)

Server-rendered admin dashboard. Auth via `windy_admin_token` cookie or `?token=` query param.

| Endpoint | Method | Description |
|---|---|---|
| `/admin/` | GET | Dashboard — stats, recent audit log |
| `/admin/users` | GET | User list — paginated, searchable |
| `/admin/users/:id` | GET | User detail — products, scopes, devices, actions |
| `/admin/oauth-clients` | GET | OAuth client list |
| `/admin/audit` | GET | Audit log — filterable by event, identity, date |
| `/admin/bots` | GET | Bot identity registry |

---

## 13. Miscellaneous

| Endpoint | Method | Auth | Consumers | Description |
|---|---|---|---|---|
| `GET /health` | GET | None | All | Service health check |
| `POST /api/v1/analytics` | POST | None | WPD, WPM, WEB | Client telemetry |
| `GET /api/v1/updates/check` | GET | None | WPD | App update check (stub) |
| `POST /api/v1/license/activate` | POST | JWT | WPD | License key activation |
| `POST /api/v1/rtc/signal` | POST | None | WPD | WebRTC signaling |
| `GET /api/v1/rtc/signal` | GET | None | WPD | WebRTC signal polling |
| `POST /api/v1/ocr/translate` | POST | Optional | WPM | OCR + translate (stub) |
| `GET /download/latest/:platform` | GET | None | WEB | Redirect to GitHub release |
| `GET /download/verify` | GET | None | WPD | Verify release integrity |
| `GET /download/version` | GET | None | WPD | Current version |

---

## 14. Discovery Endpoints

| Endpoint | Response | Cache | Consumers |
|---|---|---|---|
| `GET /.well-known/jwks.json` | JWK Set (RS256 public keys) | 1 hour | WC, WM, WF, ET |
| `GET /.well-known/openid-configuration` | OIDC provider metadata | 1 hour | WC, WM, WF, ET |

---

## 15. JWT Payload Structure

Every JWT issued by this server contains:

```json
{
  "userId": "uuid (internal account ID)",
  "email": "string",
  "tier": "free | pro | translate | translate_pro",
  "accountId": "uuid (same as userId)",
  "windyIdentityId": "uuid (universal cross-product ID)",
  "type": "human | bot",
  "scopes": ["windy_pro:*", "windy_chat:read"],
  "products": ["windy_pro", "windy_chat"],
  "iss": "windy-identity",
  "iat": 1711612800,
  "exp": 1711613700
}
```

**Signing:** RS256 (with `kid` for JWKS lookup) when configured, HS256 fallback.
**Access token TTL:** 15 minutes.
**Refresh token TTL:** 30 days.

---

## 16. Pre-Registered OAuth Clients

| Client ID | Product | Type | PKCE Required | Auto-Approve |
|---|---|---|---|---|
| `windy_chat` | Windy Chat | Confidential | No | Yes |
| `windy_mail` | Windy Mail | Confidential | No | Yes |
| `windy_fly` | Windy Fly | Public | Yes | Yes |
| `eternitas` | Eternitas | Confidential | No | Yes |
| `windy_pro_desktop` | Desktop App | Public | Yes | Yes |
| `windy_pro_mobile` | Mobile App | Public | Yes | Yes |

---

## 17. Scope Hierarchy

```
windy_pro:*           — Full Windy Pro access (recordings, transcription, translation, files)
windy_chat:*          — Full Windy Chat access (messaging, contacts, rooms)
windy_chat:read       — Read-only chat access
windy_mail:*          — Full Windy Mail access
windy_mail:read       — Read-only mail access
windy_mail:send       — Send email
windy_mail:secretary  — Send email AS the human owner (requires explicit consent)
windy_fly:*           — Full agent management
windy_fly:manage      — Configure agent
windy_fly:act         — Agent can perform actions on owner's behalf
windy_fly:hatch       — Create new agents
windy_cloud:*         — Full cloud storage access
windy_clone:*         — Full clone access
windy_clone:train     — Submit training data
eternitas:verify      — Verify bot identities
eternitas:register    — Register new bots
admin:*               — Full admin access (superuser)
```

---

_This document is the master API reference for the Windy ecosystem. All product repos should reference it when integrating with the account server._
