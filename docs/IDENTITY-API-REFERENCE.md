# Windy Identity API Reference

_Version: 1.0 (Phase 6)_
_Base URL: `https://windypro.thewindstorm.uk`_

---

## Authentication

All protected endpoints require a Bearer token in the Authorization header:

```
Authorization: Bearer <jwt-or-api-key>
```

Supported authentication methods:
1. **JWT (HS256 or RS256)** -- Issued by `/api/v1/auth/login` or `/api/v1/oauth/token`
2. **Bot API Key** -- Prefix `wk_`, issued by `/api/v1/identity/api-keys`

---

## Scope Hierarchy

| Scope | Matches | Description |
|-------|---------|-------------|
| `admin:*` | Everything | Superuser access |
| `windy_pro:*` | `windy_pro:read`, `windy_pro:write`, etc. | Full Windy Pro access |
| `windy_chat:*` | `windy_chat:read`, `windy_chat:write` | Full Windy Chat access |
| `windy_chat:read` | Exact | Read chat messages |
| `windy_chat:write` | Exact | Send chat messages |
| `windy_mail:*` | `windy_mail:read`, `windy_mail:send`, etc. | Full Windy Mail access |
| `windy_mail:read` | Exact | Read emails |
| `windy_mail:send` | Exact | Send emails |
| `windy_mail:secretary` | Exact | Send as delegate (bot-only) |
| `windy_fly:*` | `windy_fly:read`, `windy_fly:write`, etc. | Full Windy Fly access |
| `eternitas:verify` | Exact | Verify bot passports |
| `eternitas:register` | Exact | Register new bot passports |

Wildcards: `product:*` matches any permission within that product. `admin:*` matches everything.

---

## 1. Auth

### POST /api/v1/auth/register

Create a new account.

**Auth:** None
**Rate limit:** 5/min

```bash
curl -X POST https://windypro.thewindstorm.uk/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Grant",
    "email": "grant@windypro.com",
    "password": "MyPass123",
    "deviceId": "device-uuid",
    "deviceName": "MacBook Pro",
    "platform": "macos"
  }'
```

**Response (201):**
```json
{
  "userId": "uuid",
  "name": "Grant",
  "email": "grant@windypro.com",
  "tier": "free",
  "token": "eyJhbG...",
  "refreshToken": "uuid",
  "devices": [{ "id": "device-uuid", "name": "MacBook Pro", "platform": "macos" }]
}
```

### POST /api/v1/auth/login

Authenticate and receive tokens.

**Auth:** None
**Rate limit:** 5/min

```bash
curl -X POST https://windypro.thewindstorm.uk/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{ "email": "grant@windypro.com", "password": "MyPass123" }'
```

**Response (200):** Same shape as register.

### POST /api/v1/auth/refresh

Exchange refresh token for new access token (rotation).

**Auth:** None

```bash
curl -X POST https://windypro.thewindstorm.uk/api/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{ "refreshToken": "uuid", "deviceId": "device-uuid" }'
```

**Response (200):**
```json
{
  "token": "eyJhbG...",
  "refreshToken": "new-uuid",
  "tier": "pro",
  "userId": "uuid",
  "name": "Grant"
}
```

### POST /api/v1/auth/logout

Invalidate tokens and blacklist current access token.

**Auth:** Required (Bearer JWT)

```bash
curl -X POST https://windypro.thewindstorm.uk/api/v1/auth/logout \
  -H "Authorization: Bearer eyJhbG..."
```

### GET /api/v1/auth/me

Get current user info.

**Auth:** Required

### POST /api/v1/auth/change-password

Change password (requires current password).

**Auth:** Required

---

## 2. Identity

### GET /api/v1/identity/me

Extended identity info including products, scopes, chat profile, passport.

**Auth:** Required

```bash
curl https://windypro.thewindstorm.uk/api/v1/identity/me \
  -H "Authorization: Bearer eyJhbG..."
```

**Response (200):**
```json
{
  "identity": {
    "id": "uuid",
    "email": "grant@windypro.com",
    "name": "Grant",
    "tier": "pro",
    "identityType": "human",
    "emailVerified": true,
    "phoneVerified": false,
    "preferredLang": "en",
    "createdAt": "2026-03-28T00:00:00Z"
  },
  "products": [
    { "id": "uuid", "product": "windy_pro", "status": "active" },
    { "id": "uuid", "product": "windy_chat", "status": "active" }
  ],
  "scopes": ["windy_pro:*", "windy_chat:read", "windy_chat:write"],
  "chatProfile": { "matrixUserId": "@windy_grant:chat.windypro.com", "onboardingComplete": true }
}
```

### PATCH /api/v1/identity/me

Update display name, language, avatar, phone.

**Auth:** Required

```bash
curl -X PATCH https://windypro.thewindstorm.uk/api/v1/identity/me \
  -H "Authorization: Bearer eyJhbG..." \
  -H "Content-Type: application/json" \
  -d '{ "displayName": "Grant W.", "preferredLang": "en" }'
```

### GET /api/v1/identity/products

List active product accounts.

**Auth:** Required

### POST /api/v1/identity/products/provision

Provision a new product for the identity.

**Auth:** Required

```bash
curl -X POST https://windypro.thewindstorm.uk/api/v1/identity/products/provision \
  -H "Authorization: Bearer eyJhbG..." \
  -H "Content-Type: application/json" \
  -d '{ "product": "windy_chat" }'
```

### GET /api/v1/identity/scopes

List identity scopes.

**Auth:** Required

### POST /api/v1/identity/scopes/grant

Grant scopes to an identity (admin only).

**Auth:** Required (admin)

### DELETE /api/v1/identity/scopes/:scope?identityId=uuid

Revoke a scope (admin only).

**Auth:** Required (admin)

### GET /api/v1/identity/audit

Query audit log entries.

**Auth:** Required (self or admin)

```bash
curl "https://windypro.thewindstorm.uk/api/v1/identity/audit?limit=20&event=login" \
  -H "Authorization: Bearer eyJhbG..."
```

### POST /api/v1/identity/backfill

One-time migration to seed existing users with product accounts and scopes.

**Auth:** Required (admin)

### POST /api/v1/identity/chat/provision

Lazy Matrix account provisioning for chat.

**Auth:** Required

### GET /api/v1/identity/chat/profile

Get chat profile (Matrix user ID, display name, languages).

**Auth:** Required

### POST /api/v1/identity/api-keys

Create a bot API key. Returns the raw key once.

**Auth:** Required (admin or bot operator)

```bash
curl -X POST https://windypro.thewindstorm.uk/api/v1/identity/api-keys \
  -H "Authorization: Bearer eyJhbG..." \
  -H "Content-Type: application/json" \
  -d '{
    "identityId": "bot-uuid",
    "scopes": ["windy_chat:read", "windy_chat:write"],
    "label": "Production key"
  }'
```

**Response (201):**
```json
{
  "apiKey": "wk_abc123...",
  "keyPrefix": "wk_abc123...",
  "id": "key-uuid",
  "scopes": ["windy_chat:read", "windy_chat:write"],
  "warning": "Store this API key securely. It will not be shown again."
}
```

### DELETE /api/v1/identity/api-keys/:keyId

Revoke an API key.

**Auth:** Required

### GET /api/v1/identity/api-keys?identityId=uuid

List API keys (metadata only, no raw keys).

**Auth:** Required

### POST /api/v1/identity/secretary/consent

Grant or revoke secretary mode consent for a bot.

**Auth:** Required

### GET /api/v1/identity/secretary/status?botIdentityId=uuid

Check secretary consent status.

**Auth:** Required

### POST /api/v1/identity/hatch/credentials

Generate structured credentials for a newly hatched bot agent.

**Auth:** Required (admin)

### POST /api/v1/identity/eternitas/webhook

Process Eternitas passport lifecycle events.

**Auth:** Webhook signature (HMAC-SHA256)

---

## 3. Verification

### POST /api/v1/identity/verify/send

Send a 6-digit OTP via SMS or email.

**Auth:** Required
**Rate limit:** 5/min, 10/hour per identifier

```bash
curl -X POST https://windypro.thewindstorm.uk/api/v1/identity/verify/send \
  -H "Authorization: Bearer eyJhbG..." \
  -H "Content-Type: application/json" \
  -d '{ "type": "email", "identifier": "grant@windypro.com" }'
```

**Response (200):**
```json
{
  "success": true,
  "type": "email",
  "identifier": "grant@windypro.com",
  "message": "Verification code sent to your email",
  "expiresInSeconds": 600
}
```

### POST /api/v1/identity/verify/check

Validate OTP and mark identity as verified.

**Auth:** Required

```bash
curl -X POST https://windypro.thewindstorm.uk/api/v1/identity/verify/check \
  -H "Authorization: Bearer eyJhbG..." \
  -H "Content-Type: application/json" \
  -d '{ "identifier": "grant@windypro.com", "code": "123456", "type": "email" }'
```

### GET /api/v1/identity/verify/status

Check verification status for email and phone.

**Auth:** Required

---

## 4. OAuth2

### POST /api/v1/oauth/clients

Register an OAuth2 client (admin only).

**Auth:** Required (admin)

```bash
curl -X POST https://windypro.thewindstorm.uk/api/v1/oauth/clients \
  -H "Authorization: Bearer eyJhbG..." \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My App",
    "redirectUris": ["https://myapp.com/callback"],
    "allowedScopes": ["windy_pro:read"],
    "isPublic": false
  }'
```

### GET /api/v1/oauth/clients

List registered OAuth clients (admin only).

**Auth:** Required (admin)

### GET /api/v1/oauth/authorize

Start authorization code flow.

**Auth:** Required
**Rate limit:** 30/min

Query parameters:
- `client_id` (required)
- `redirect_uri` (required)
- `response_type=code` (required)
- `scope` (space-separated, optional)
- `state` (recommended)
- `code_challenge` (required for public clients, PKCE S256)
- `code_challenge_method=S256`

First-party clients auto-approve. Third-party clients return `consent_required`.

### GET /api/v1/oauth/consent

HTML consent page for third-party clients.

**Auth:** Required

Query parameters: same as /authorize.

### POST /api/v1/oauth/authorize

Submit consent decision.

**Auth:** Required

```json
{
  "client_id": "my-app",
  "redirect_uri": "https://myapp.com/callback",
  "scope": "windy_pro:read",
  "state": "random-state",
  "code_challenge": "base64url-sha256-hash",
  "approved": true
}
```

### POST /api/v1/oauth/token

Exchange code/credentials for tokens.

**Auth:** None (client authenticates via body or Basic auth)
**Rate limit:** 10/min

**authorization_code:**
```bash
curl -X POST https://windypro.thewindstorm.uk/api/v1/oauth/token \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "authorization_code",
    "code": "auth-code",
    "redirect_uri": "https://myapp.com/callback",
    "client_id": "my-app",
    "code_verifier": "original-pkce-verifier"
  }'
```

**client_credentials:**
```bash
curl -X POST https://windypro.thewindstorm.uk/api/v1/oauth/token \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "client_credentials",
    "client_id": "my-app",
    "client_secret": "wcs_..."
  }'
```

**device_code:**
```bash
curl -X POST https://windypro.thewindstorm.uk/api/v1/oauth/token \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
    "device_code": "device-code-hex",
    "client_id": "windy_fly"
  }'
```

**Response (200):**
```json
{
  "access_token": "eyJhbG...",
  "token_type": "Bearer",
  "expires_in": 900,
  "refresh_token": "uuid",
  "scope": "windy_pro:*"
}
```

**Error codes:** `invalid_request`, `invalid_client`, `invalid_grant`, `unsupported_grant_type`, `authorization_pending`, `expired_token`, `access_denied`

### POST /api/v1/oauth/device

Request a device code for CLI/headless auth.

**Auth:** None

```bash
curl -X POST https://windypro.thewindstorm.uk/api/v1/oauth/device \
  -H "Content-Type: application/json" \
  -d '{ "client_id": "windy_fly", "scope": "windy_fly:*" }'
```

**Response (200):**
```json
{
  "device_code": "hex-string",
  "user_code": "ABCD-1234",
  "verification_uri": "https://windypro.thewindstorm.uk/device",
  "verification_uri_complete": "https://windypro.thewindstorm.uk/device?code=ABCD-1234",
  "expires_in": 900,
  "interval": 5
}
```

### POST /api/v1/oauth/device/approve

User approves/denies a device code (from web UI).

**Auth:** Required

### GET /api/v1/oauth/userinfo

OIDC UserInfo endpoint.

**Auth:** Required

**Response (200):**
```json
{
  "sub": "user-uuid",
  "name": "Grant",
  "email": "grant@windypro.com",
  "email_verified": true,
  "preferred_username": "grant",
  "locale": "en",
  "identity_type": "human"
}
```

### GET /api/v1/oauth/consents

List user's active OAuth consents.

**Auth:** Required

### DELETE /api/v1/oauth/consents/:clientId

Revoke consent for a client.

**Auth:** Required

---

## 5. OIDC Discovery

### GET /.well-known/openid-configuration

OpenID Connect provider metadata.

**Auth:** None

**Response (200):**
```json
{
  "issuer": "https://windypro.thewindstorm.uk",
  "authorization_endpoint": "https://windypro.thewindstorm.uk/api/v1/oauth/authorize",
  "token_endpoint": "https://windypro.thewindstorm.uk/api/v1/oauth/token",
  "userinfo_endpoint": "https://windypro.thewindstorm.uk/api/v1/oauth/userinfo",
  "jwks_uri": "https://windypro.thewindstorm.uk/.well-known/jwks.json",
  "device_authorization_endpoint": "https://windypro.thewindstorm.uk/api/v1/oauth/device",
  "scopes_supported": ["openid", "profile", "email", "phone", "windy_pro:*", "windy_chat:read", "windy_chat:write", "windy_mail:read", "windy_mail:send", "windy_fly:*"],
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "client_credentials", "refresh_token", "urn:ietf:params:oauth:grant-type:device_code"],
  "id_token_signing_alg_values_supported": ["RS256", "HS256"],
  "code_challenge_methods_supported": ["S256"]
}
```

### GET /.well-known/jwks.json

JSON Web Key Set for RS256 token verification.

**Auth:** None
**Cache:** 1 hour

**Response (200):**
```json
{
  "keys": [
    {
      "kty": "RSA",
      "use": "sig",
      "alg": "RS256",
      "kid": "abc123...",
      "n": "base64url-modulus",
      "e": "AQAB"
    }
  ]
}
```

---

## Error Responses

All errors follow a consistent format:

```json
{
  "error": "error_code_or_message",
  "error_description": "Human-readable description (OAuth endpoints only)"
}
```

Common HTTP status codes:
- `400` -- Bad request / validation error
- `401` -- Authentication required or invalid
- `403` -- Insufficient permissions / scope
- `404` -- Resource not found
- `429` -- Rate limit exceeded
- `500` -- Internal server error

---

## JWT Token Payload

Tokens issued by the identity system include these claims:

```json
{
  "userId": "uuid",
  "email": "user@example.com",
  "tier": "free|pro|translate|translate-pro|bot",
  "accountId": "uuid",
  "type": "human|bot",
  "scopes": ["windy_pro:*", "windy_chat:read"],
  "products": ["windy_pro", "windy_chat"],
  "iss": "windy-identity",
  "iat": 1711612800,
  "exp": 1711613700
}
```

- Access tokens expire in 15 minutes
- Refresh tokens expire in 30 days
- RS256 tokens include a `kid` header for JWKS verification
- Old HS256 tokens without `scopes` are treated as `human` with `windy_pro:*`
