# OAuth Providers — Operator Runbook

Windy account-server supports four consumer-side OAuth providers for
"Sign in with X" on `app.windyword.ai`. This doc covers provisioning,
env config, and operational notes for each.

All four follow the same shape:
- `GET /api/v1/auth/oauth/<provider>/start` — signs HMAC state, 302s to IdP.
- Provider callback (`GET` for Google/GitHub/Facebook, **`POST`** for Apple's
  `response_mode=form_post`) — verifies state, exchanges code, finds or
  creates the Windy user via `_oauth-helpers.upsertUserFromOAuth`, mints a
  Windy JWT, 302s to the SPA finish page with tokens in the URL fragment.
- Returns 503 when its env vars are unset (Google falls back to its own
  finish page at `/auth/google/finish`; the other three use the generic
  `/auth/oauth/finish`).

User linkage strategy lives in `_oauth-helpers.upsertUserFromOAuth`:
1. `(provider, provider_user_id)` lookup in `oauth_identities` — wins.
2. Verified-email fallback (`emailVerified===true`) — links to existing
   `users.email`. Refuses to link when the IdP doesn't attest verification.
3. Otherwise, creates a new `users` row + `oauth_identities` link.

The `oauth_identities` table is created by SQLite schema bootstrap and by
Postgres migration `004-oauth-identities-2026-05-24.sql`.

---

## Google

**Status:** ✅ live in production since 2026-05-06.

**Provisioning (one-time):**
- GCP project `windy-word-oauth` (project number `903006157217`)
- Console: https://console.cloud.google.com/auth/clients?project=windy-word-oauth
- Lockbox: `ACCESS_LOCKBOX.md` → "Windy Word OAuth (Web — Sign-in-with-Google for windyword.ai)"
- Pre-launch task (tracked): rotate secret + publish consent screen before
  opening prod traffic past hand-curated test users.

**Env vars (account-server):**
```bash
GOOGLE_OAUTH_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-...
GOOGLE_OAUTH_REDIRECT_URI=https://account.windyword.ai/api/v1/auth/oauth/google/callback
GOOGLE_OAUTH_POST_LOGIN_REDIRECT=https://windyword.ai/auth/google/finish
```

**Notes:**
- Google's `/userinfo` returns `email_verified=true` for all consumer
  accounts. The helper defaults to verified when the claim is missing.
- Finish page is provider-specific (`/auth/google/finish`) because the path
  is baked into the GCP redirect config — migrating to the shared
  `/auth/oauth/finish` is a separate rotation.

---

## GitHub

**Status:** code shipped 2026-05-24; OAuth App not yet provisioned.

**Provisioning (one-time, do this before flipping env vars):**
1. https://github.com/settings/developers (use `sneakyfree` account — see
   lockbox §9 GITHUB)
2. **New OAuth App**:
   - Application name: `Windy Word`
   - Homepage URL: `https://windyword.ai`
   - Authorization callback URL: `https://account.windyword.ai/api/v1/auth/oauth/github/callback`
   - (Optional) App description, logo
3. Note the Client ID; generate a new Client Secret.
4. Add to `ACCESS_LOCKBOX.md` under §9 GITHUB as **"Windy Word GitHub OAuth"**.

**Env vars (account-server):**
```bash
GITHUB_OAUTH_CLIENT_ID=Iv1.xxx
GITHUB_OAUTH_CLIENT_SECRET=...
GITHUB_OAUTH_REDIRECT_URI=https://account.windyword.ai/api/v1/auth/oauth/github/callback
GITHUB_OAUTH_POST_LOGIN_REDIRECT=https://windyword.ai/auth/oauth/finish
```

**Notes:**
- `/user` returns `email: null` when the user has set their primary email
  to private. We always cross-check `/user/emails` to find the verified
  primary; that requires `user:email` scope.
- Refuses to link to an existing Windy account when GitHub doesn't attest
  the email is verified — prevents takeover via an unverified email
  attached to a fresh GitHub account.

---

## Apple

**Status:** code shipped 2026-05-24; Services ID + .p8 not yet provisioned.

**Provisioning (one-time):**

1. **Sign in with Apple capability** — ✅ already enabled on App ID
   `uk.thewindstorm.windypro` (capability `APPLE_ID_AUTH`, set 2026-05-18).
   See lockbox §"iOS code-signing chain — LIVE STATE".

2. **Services ID** (this is the OAuth client_id for web):
   - developer.apple.com → Certificates, Identifiers & Profiles → Identifiers
   - "+" → **Services IDs** → Continue
   - Description: `Windy Word Web Sign In`
   - Identifier: e.g. `ai.windyword.signin` (used as `APPLE_SERVICES_ID`)
   - Save, then **Configure** the row:
     - Enable **Sign In with Apple**
     - Primary App ID: `uk.thewindstorm.windypro`
     - **Domains and Subdomains**: `windyword.ai`, `account.windyword.ai`
     - **Return URLs**: `https://account.windyword.ai/api/v1/auth/oauth/apple/callback`
   - Save.

3. **Sign in with Apple key** (separate from the existing ASC API key
   `7RMH7GRPJN`, which is App Store Connect, not Sign in with Apple):
   - developer.apple.com → Keys → "+" → name `Windy Word Sign In`
   - Enable **Sign in with Apple**, configure primary App ID
     `uk.thewindstorm.windypro`
   - Continue → Register → **Download** the `.p8` (one-time only)
   - Save the file to `~/kit-army-config/secrets/AuthKey_<KEY_ID>.p8` (mode 600)
   - Note the 10-char Key ID for `APPLE_KEY_ID`

4. **Update lockbox** under "iOS code-signing chain" with the new Services
   ID + Key ID + .p8 path.

**Env vars (account-server):**
```bash
APPLE_TEAM_ID=VXZ434QL89
APPLE_SERVICES_ID=ai.windyword.signin   # whatever you chose in step 2
APPLE_KEY_ID=<10-char>
# Prefer file-based for prod:
APPLE_PRIVATE_KEY_PATH=/opt/windy-pro/secrets/AuthKey_<KEY_ID>.p8
# Or inline for dev:
APPLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
APPLE_OAUTH_REDIRECT_URI=https://account.windyword.ai/api/v1/auth/oauth/apple/callback
APPLE_OAUTH_POST_LOGIN_REDIRECT=https://windyword.ai/auth/oauth/finish
```

**Notes:**
- The OAuth client_secret is NOT a static string. Apple requires a fresh
  ES256 JWT (header: `{alg:"ES256",kid:APPLE_KEY_ID}`,
  payload: `{iss:APPLE_TEAM_ID, sub:APPLE_SERVICES_ID, aud:"https://appleid.apple.com", iat, exp ≤ 6mo}`)
  signed with the `.p8` private key. We mint one per token-exchange call
  with a 5-minute TTL.
- `name`/`email` arrive ONLY on the first authorization, in the form-post
  `user` field. After that the helper's `(provider, provider_user_id)`
  lookup handles linkage from the `id_token`'s `sub` alone.
- Private email relay: users can choose `@privaterelay.appleid.com`
  forwarders. Store as-is; the `is_private_email` claim is logged for audit.
- The id_token's signature is verified against Apple's JWKS at
  `https://appleid.apple.com/auth/keys` (cached 10 minutes).

---

## Facebook

**Status:** code shipped 2026-05-24; FB App not yet provisioned.

**Provisioning (one-time):**

1. https://developers.facebook.com → My Apps → **Create App**
   - Type: **Consumer**
   - Display name: `Windy Word`
   - App contact email: `grantwhitmer3@gmail.com`
2. App Dashboard → **Settings → Basic**:
   - App Domain: `windyword.ai`
   - Privacy Policy URL: `https://windyword.ai/privacy`
   - Terms of Service URL: `https://windyword.ai/terms`
   - Category: pick the closest match
3. App Dashboard → **Add product → Facebook Login → Web**:
   - Site URL: `https://windyword.ai`
   - Settings → **Valid OAuth Redirect URIs**:
     `https://account.windyword.ai/api/v1/auth/oauth/facebook/callback`
4. Note App ID + App Secret (Settings → Basic).
5. Add to `ACCESS_LOCKBOX.md` as a new section, e.g.
   "Windy Word Facebook App".

**App Review** (out-of-band, ~1-2 weeks, blocks prod traffic):
- Default `email` permission is **only available to app admins/test users**
  until reviewed.
- Submit App Review: App Review → Permissions and Features → request `email`.
- Required: screencast of the email-permission flow + business verification.
- Until approved, deploy is "soft live": logged-out users see the FB button,
  click leads to FB's "this app isn't available" page unless they're on the
  test-user list.

**Env vars (account-server):**
```bash
FACEBOOK_OAUTH_CLIENT_ID=1234567890123456
FACEBOOK_OAUTH_CLIENT_SECRET=...
FACEBOOK_OAUTH_REDIRECT_URI=https://account.windyword.ai/api/v1/auth/oauth/facebook/callback
FACEBOOK_OAUTH_POST_LOGIN_REDIRECT=https://windyword.ai/auth/oauth/finish
```

**Notes:**
- ~10% of FB users have no email on the account. The helper rejects
  email-less signups with `OAUTH_NO_EMAIL` → SPA renders `#error=no_email`.
- Facebook attests email verification implicitly: once an email is on the
  account, Facebook has verified it. The helper treats `email !== null` as
  `emailVerified: true`.
- Pin Graph API version (currently `v19.0`) in `facebook-oauth.ts` —
  Facebook deprecates major versions every ~2 years; bump deliberately.

---

## Deploying the env vars

The prod account-server runs in container
`deploy-prod-pro-account-server-1` on EC2 `i-07cef803a6a3f86b4`
(EIP `54.88.113.79`). Update `/opt/windy-pro/deploy-prod/.env.production`
on the box (see lockbox §"Windy Pro Prod Deploy Layout") and:

```bash
cd /opt/windy-pro/deploy-prod
docker compose --env-file .env.production up -d --force-recreate pro-account-server
docker logs deploy-prod-pro-account-server-1 --tail 50 | grep -E "OAuth|configured"
```

Verify each provider's 503 → 302 flip with:
```bash
curl -sI https://account.windyword.ai/api/v1/auth/oauth/<provider>/start | head -5
```

---

## Monitoring

Every successful OAuth login emits an `identity.created` (new users) or
`audit_log` row (returning users). Look for:

```bash
docker exec deploy-prod-pro-account-server-1 \
  sqlite3 /app/data/accounts.db \
  "SELECT via, COUNT(*) FROM identity_audit_log WHERE event_type IN ('register','login') GROUP BY via;"
```

(Prod is Postgres — same query against `DATABASE_URL`.)
