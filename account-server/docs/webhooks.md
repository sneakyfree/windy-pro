# Producer-side webhook contract — `account-server` identity events

This document is the **source of truth** for the identity events the
account-server emits. Consumers (Windy Mail, Chat, Cloud, Eternitas, Clone)
subscribe by exposing the endpoints documented below and configuring a
shared HMAC secret in the account-server's environment.

Per the cross-product contract framework, contracts live with the producer:
this file is canonical, and consumers are expected to validate against it.

---

## Transport

Each event becomes one **`POST` per consumer** to:

```
{CONSUMER_BASE_URL}/api/v1/webhooks/identity/{event}
```

Where `{event}` is the suffix after `identity.` — i.e. `created`, `updated`,
or `revoked`.

### Headers

| Header | Value |
|---|---|
| `Content-Type` | `application/json` |
| `X-Windy-Signature` | `sha256=<hex>` — HMAC-SHA256 of the raw request body, keyed by the **per-consumer** shared secret. Each consumer has its own secret so a leak at one can't forge events to others. |
| `X-Windy-Event` | The event name (`identity.created` etc.) — convenience for routing. |
| `X-Windy-Delivery-Id` | UUID of this delivery row. Stable across retries — consumers can use it for idempotency. |

### Verification (consumer side)

```ts
import crypto from 'crypto';
const expected = 'sha256=' + crypto
  .createHmac('sha256', process.env.WINDY_MAIL_WEBHOOK_SECRET!)
  .update(rawBody)
  .digest('hex');
if (!crypto.timingSafeEqual(Buffer.from(headerSig), Buffer.from(expected))) {
  return res.status(401).end();
}
```

Use `crypto.timingSafeEqual` — never `===` — to compare signatures.

---

## Reliability

### Retry schedule

If the consumer returns non-2xx (or the request fails / times out), the
delivery is retried on this schedule:

| Attempt | Delay from prior attempt |
|---|---|
| 1 | immediate |
| 2 | +5s |
| 3 | +30s |
| 4 | +5m |
| 5 | +1h |
| 6 | +6h |
| 7 | +24h |

After the 7th failure the delivery is **dead-lettered** (kept in
`webhook_deliveries.dead_lettered_at` for forensics; no more attempts).

### Idempotency

A given `X-Windy-Delivery-Id` may be delivered more than once if a 2xx
response is lost (e.g. the consumer commits and then the connection drops
before we see the ACK). Consumers MUST treat the same delivery ID as
idempotent.

### 4xx behavior

A 4xx response (other than 408 / 429) is treated as **unrecoverable** and
dead-letters immediately rather than burning the full retry schedule. Use
4xx to permanently reject malformed events; use 5xx for transient issues.

---

## Events

All events share these base fields. Per-event additions are listed below.

```jsonc
{
  "event": "identity.created" | "identity.updated" | "identity.revoked",
  "windy_identity_id": "uuid",                  // Universal cross-product identity
  "email": "user@example.com",                   // Lowercased
  "display_name": "Jane Doe" | null,
  "tier": "free" | "pro" | "enterprise" | null,
  "created_at": "2026-04-16T18:00:00.000Z" | null,
  "first_name": "Jane",                          // Best-effort split of display_name
  "last_name": "Doe",                            // May be ""
  "preferred_local_part": "jane.doe"             // Sanitized email local-part
}
```

### `identity.created`

Fired after a successful `POST /api/v1/auth/register`. Consumers should
provision their per-product accounts (mailbox, chat profile, cloud quota,
etc.) keyed by `windy_identity_id`.

No additional fields beyond the base.

### `identity.updated`

Fired after a successful `PATCH /api/v1/auth/me`. Adds:

```jsonc
{
  "changed": {
    "display_name": "...",   // Only present when changed in this request
    "avatar_url": "...",
    "phone": "+15551234567",
    "preferred_lang": "en"
  }
}
```

Consumers SHOULD diff `changed` and only update fields they care about
rather than re-syncing the whole identity.

### `identity.revoked`

Fired immediately **before** account deletion (cascade delete strips the
identity row). Consumers should suspend or delete their per-product
accounts. Adds:

```jsonc
{
  "revoked_at": "2026-04-16T18:00:00.000Z",
  "reason": "self_deleted" | "admin" | "compliance"
}
```

---

## Configuration

The producer skips any consumer whose URL or secret env var is missing.

| Consumer | URL env | Secret env |
|---|---|---|
| Windy Mail | `WINDY_MAIL_URL` | `WINDY_MAIL_WEBHOOK_SECRET` |
| Windy Chat | `WINDY_CHAT_URL` | `WINDY_CHAT_WEBHOOK_SECRET` |
| Windy Cloud | `WINDY_CLOUD_URL` | `WINDY_CLOUD_WEBHOOK_SECRET` |
| Eternitas | `ETERNITAS_URL` | `ETERNITAS_WEBHOOK_SECRET` |
| Windy Clone | `WINDY_CLONE_URL` | `WINDY_CLONE_WEBHOOK_SECRET` |

In production, a configured URL without a secret causes that consumer to
be skipped (warned in logs). In development the secret may be empty —
consumers that don't verify signatures will still accept events.

---

## Storage

Deliveries persist in the `webhook_deliveries` table:

| Column | Notes |
|---|---|
| `id` | UUID, primary key, equals `X-Windy-Delivery-Id` |
| `event_type` | `identity.created` / `identity.updated` / `identity.revoked` |
| `target` | `mail` / `chat` / `cloud` / `eternitas` / `clone` |
| `target_url` | Absolute URL; resolved at enqueue time (env changes after enqueue won't affect this delivery) |
| `payload` | Raw JSON body (preserved for replay + signature consistency) |
| `signature` | `sha256=<hex>`; computed at enqueue time |
| `attempts` | Count of attempts already made |
| `next_attempt_at` | ISO timestamp; worker polls `WHERE next_attempt_at <= now` |
| `delivered_at` | Set on first 2xx; non-null = success |
| `dead_lettered_at` | Set after 7 failed attempts or on unrecoverable 4xx |
| `last_error` | Truncated body or error message from the last attempt |

A background worker in `services/webhook-bus.ts` drains due deliveries
every 30 seconds. Deliveries are also attempted **immediately** off the
producing route's response path so the happy path doesn't wait 30s.

---

## Audit events

The producer logs to `identity_audit_log`:

- `webhook_delivered` — first successful 2xx
- `webhook_failed` — non-success, will retry
- `webhook_dead_lettered` — terminal failure

Filter by `event` in the audit query API to inspect delivery health.
