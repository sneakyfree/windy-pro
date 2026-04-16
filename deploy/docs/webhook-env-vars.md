# Webhook fan-out — environment variables

The account-server emits identity events (`identity.created` / `.updated` /
`.revoked`) to ecosystem consumers via the fan-out bus. Each consumer needs a
**URL** (where to POST) and a **secret** (per-consumer HMAC-SHA256 shared key
sent as `X-Windy-Signature`).

The producer-side contract (payload shapes, retry schedule, signature
verification snippet) lives in `account-server/docs/webhooks.md`.

---

## Required env vars

A consumer is only fanned out to when **both** its URL and secret are set.
Missing either one → that target is silently skipped.

| Consumer | URL var | Secret var |
|---|---|---|
| Windy Mail | `WINDY_MAIL_URL` | `WINDY_MAIL_WEBHOOK_SECRET` |
| Windy Chat | `WINDY_CHAT_URL` | `WINDY_CHAT_WEBHOOK_SECRET` |
| Windy Cloud | `WINDY_CLOUD_URL` | `WINDY_CLOUD_WEBHOOK_SECRET` |
| Eternitas | `ETERNITAS_URL` | `ETERNITAS_WEBHOOK_SECRET` |
| Windy Clone | `WINDY_CLONE_URL` | `WINDY_CLONE_WEBHOOK_SECRET` |

`*_URL` should be the consumer's base URL (no trailing slash needed —
producer strips it). The producer appends
`/api/v1/webhooks/identity/{event}` per delivery.

---

## Minting a secret

Use 32 random bytes per secret (256 bits — overkill, but cheap):

```sh
openssl rand -hex 32
```

Generate one **per consumer** so a leak at one consumer can't forge events to
the others. Store in your secrets manager (1Password, Doppler, AWS Secrets
Manager, etc.) — never commit to git.

To mint all five at once:

```sh
for c in MAIL CHAT CLOUD ETERNITAS CLONE; do
  echo "WINDY_${c}_WEBHOOK_SECRET=$(openssl rand -hex 32)"
done
```

(Note: Eternitas is named without the `WINDY_` prefix for the URL —
`ETERNITAS_URL` and `ETERNITAS_WEBHOOK_SECRET`.)

---

## Example `.env` template (placeholders only — DO NOT commit real values)

```dotenv
# ─── Webhook fan-out targets ─────────────────────────────────

# Windy Mail
WINDY_MAIL_URL=https://mail.windypro.com
WINDY_MAIL_WEBHOOK_SECRET=REPLACE_WITH_openssl_rand_hex_32

# Windy Chat
WINDY_CHAT_URL=https://chat.windypro.com
WINDY_CHAT_WEBHOOK_SECRET=REPLACE_WITH_openssl_rand_hex_32

# Windy Cloud
WINDY_CLOUD_URL=https://cloud.windypro.com
WINDY_CLOUD_WEBHOOK_SECRET=REPLACE_WITH_openssl_rand_hex_32

# Eternitas
ETERNITAS_URL=https://eternitas.ai
ETERNITAS_WEBHOOK_SECRET=REPLACE_WITH_openssl_rand_hex_32

# Windy Clone
WINDY_CLONE_URL=https://clone.windypro.com
WINDY_CLONE_WEBHOOK_SECRET=REPLACE_WITH_openssl_rand_hex_32
```

---

## Consumer side

Each consumer must:

1. Accept a `POST` to `/api/v1/webhooks/identity/{created,updated,revoked}`.
2. Read the raw body before any JSON parsing middleware mutates it.
3. Verify the `X-Windy-Signature` header against
   `'sha256=' + hmac_sha256(rawBody, MY_WEBHOOK_SECRET)` using a constant-time
   comparison. **Use `crypto.timingSafeEqual`, never `===`.**
4. Treat `X-Windy-Delivery-Id` as the idempotency key — the same delivery
   may be retried if the consumer's 2xx response is lost.
5. Return:
   - `2xx` on success — delivery is marked done
   - `408` / `429` / `5xx` for transient failures — retried per the schedule
     in `account-server/docs/webhooks.md`
   - other `4xx` for permanent rejection — immediately dead-lettered

A reference verification snippet is in `account-server/docs/webhooks.md`.

---

## Rotation

To rotate a consumer's secret without downtime:

1. Generate a new secret with `openssl rand -hex 32`.
2. On the **consumer**, accept BOTH old and new secrets temporarily (try the
   new one first, fall back to the old).
3. Roll out the new secret to the **producer** (`{NAME}_WEBHOOK_SECRET`),
   restart the account-server.
4. Once all in-flight deliveries with the old signature have either landed or
   dead-lettered (worst case 24h per the retry schedule), remove the old
   secret from the consumer.

Do not rotate all consumers' secrets simultaneously — stagger to keep the
ecosystem online.

---

## Verifying production config

After deploying, confirm targets are wired by checking the audit log:

```sql
SELECT event, json_extract(details, '$.target') AS target, COUNT(*)
FROM identity_audit_log
WHERE event IN ('webhook_delivered', 'webhook_failed', 'webhook_dead_lettered')
GROUP BY event, target
ORDER BY target, event;
```

You should see `webhook_delivered` rows accumulating for each configured
target shortly after any account creation / update / deletion.
