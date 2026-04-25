# Production checklist — post-`terraform apply`

Run this **immediately after** the first successful `terraform apply` (and again after every prod deploy). Each item has a one-line shell command — copy/paste, expect the noted output, mark ☐ → ☑.

If anything is **red**, do not announce launch. Check `aws logs tail "/ecs/windy-prod-account-server" --since 10m` and the troubleshooting notes at the bottom.

---

## 0. Setup once per terminal

```sh
export AWS_PROFILE=windy-deployer
export REGION=us-east-1
export API=https://api.windyword.ai
export WEB=https://windyword.ai
export CLUSTER=$(terraform -chdir=deploy/aws output -raw ecs_cluster_name)
export SVC=$(terraform -chdir=deploy/aws output -raw ecs_service_name)
export SECRET_ARN=$(terraform -chdir=deploy/aws output -raw runtime_secrets_arn)
export ZONE_ID=$(aws route53 list-hosted-zones-by-name --dns-name windyword.ai --query 'HostedZones[0].Id' --output text | sed 's|/hostedzone/||')
```

---

## 1. DNS propagation

### ☐ 1.1 Authoritative answer matches the ALB

```sh
NS=$(aws route53 get-hosted-zone --id $ZONE_ID --query 'DelegationSet.NameServers[0]' --output text)
dig +short api.windyword.ai @$NS
```
**Expect:** an `A` record / CNAME pointing at the ALB DNS name (`*.us-east-1.elb.amazonaws.com`). Empty result = the Route 53 alias didn't get created — check `aws_route53_record.api` in state.

### ☐ 1.2 Public resolvers see it

```sh
for r in 1.1.1.1 8.8.8.8 9.9.9.9; do echo "$r → $(dig +short api.windyword.ai @$r)"; done
```
**Expect:** all three return the same A/CNAME within ~60s of apply. If empty, propagation is still in flight — wait, then retry. If still empty after 10 min, your registrar's NS records may not point at Route 53.

---

## 2. TLS

### ☐ 2.1 Cert is valid and from ACM

```sh
echo | openssl s_client -servername api.windyword.ai -connect api.windyword.ai:443 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates
```
**Expect:** `subject=CN=api.windyword.ai`, `issuer=Amazon RSA 2048 M*`, and `notAfter` ≥ 60 days from now. ACM auto-renews 60 days before expiry.

### ☐ 2.2 HTTPS-only (HTTP redirects)

```sh
curl -sI http://api.windyword.ai/health | head -3
```
**Expect:** `HTTP/1.1 301 Moved Permanently` and `Location: https://api.windyword.ai/health`.

### ☐ 2.3 TLS 1.3 actually negotiated

```sh
echo | openssl s_client -tls1_3 -connect api.windyword.ai:443 2>/dev/null | grep -E "Protocol|Cipher" | head -2
```
**Expect:** `Protocol  : TLSv1.3` and a modern cipher (`TLS_AES_*`).

---

## 3. account-server health

### ☐ 3.1 /health returns 200 with database + jwks ok

```sh
curl -sSf $API/health | jq '{status, database, jwks, services, uptime_seconds}'
```
**Expect:** `status:"ok"`, `database:"ok"`, `jwks:"ok"`, `uptime_seconds` ≥ 0. If `database:"error"`, the security group between ECS and RDS isn't open or `DATABASE_URL` is wrong. If `jwks:"error"`, the keypair didn't generate — see troubleshooting below.

### ☐ 3.2 /version (or banner)

```sh
curl -sSf $API/health | jq -r '"\(.service) \(.version)"'
```
**Expect:** `windy-pro-account-server 2.0.0`.

### ☐ 3.3 Both ECS tasks healthy on the ALB

```sh
TG=$(aws elbv2 describe-target-groups --query "TargetGroups[?contains(TargetGroupName, 'account-server')].TargetGroupArn" --output text)
aws elbv2 describe-target-health --target-group-arn $TG --query 'TargetHealthDescriptions[].TargetHealth.State' --output text
```
**Expect:** `healthy healthy` (or whatever your `desired_count` is). `unhealthy` means /health is failing inside the task — see CloudWatch logs.

---

## 4. JWKS published

### ☐ 4.1 JWKS document is non-empty and well-formed

```sh
curl -sSf $API/.well-known/jwks.json | jq '.keys | length, .keys[0] | {kid, kty, alg}'
```
**Expect:** `length` ≥ 1 (usually 1), `kty:"RSA"`, `alg:"RS256"`, and a non-empty `kid`. If `length: 0`, key generation hasn't run yet — restart the task.

### ☐ 4.2 Cache headers set

```sh
curl -sI $API/.well-known/jwks.json | grep -i cache-control
```
**Expect:** `Cache-Control: public, max-age=3600` so consumers don't slam this endpoint.

---

## 5. OIDC discovery

### ☐ 5.1 Issuer + endpoints round-trip

```sh
curl -sSf $API/.well-known/openid-configuration | jq '{issuer, token_endpoint, jwks_uri, device_authorization_endpoint}'
```
**Expect:** `issuer` = `https://api.windyword.ai`, `jwks_uri` = `<issuer>/.well-known/jwks.json`. All endpoint URLs should be HTTPS and live under the same issuer.

---

## 6. /device approval page

### ☐ 6.1 Page renders HTML

```sh
curl -sSf $API/device | grep -E '<title>|name="user_code"' | head -3
```
**Expect:** the page title (`<title>Device approval — Windy</title>`) and the `<input name="user_code"...>` form field. Empty = the route isn't mounted (see `app.use('/', deviceApprovalRoutes)` in server.ts).

### ☐ 6.2 The page is also reachable from the apex if you proxy it

If `windyword.ai/device` is the user-facing URL (mobile shows the bare domain), confirm it routes correctly:
```sh
curl -sSI $WEB/device | head -3
```
Note: this depends on your apex hosting setup. If the apex is on Cloudflare Pages and proxies `/device` to the API, you should see 200; otherwise this is N/A and `api.windyword.ai/device` is the canonical URL.

---

## 7. OAuth flow end-to-end

### ☐ 7.1 Device-code request issues both codes

```sh
DEVICE=$(curl -sSf $API/api/v1/oauth/device \
  -H 'Content-Type: application/json' \
  -d '{"client_id":"windy-code","scope":"openid profile email"}')
echo "$DEVICE" | jq '{user_code, expires_in, verification_uri}'
```
**Expect:** a 4-character or `XXXX-XXXX` user code, `expires_in: 900`, `verification_uri` ending in `/device`. **400 invalid_client = the seed didn't include windy-code** (PR #10 should be merged).

### ☐ 7.2 Polling before approval returns authorization_pending

```sh
DC=$(echo "$DEVICE" | jq -r '.device_code')
curl -sSf $API/api/v1/oauth/token \
  -H 'Content-Type: application/json' \
  -d "{\"grant_type\":\"urn:ietf:params:oauth:grant-type:device_code\",\"device_code\":\"$DC\",\"client_id\":\"windy-code\"}" \
  | jq .
```
**Expect:** `{"error":"authorization_pending", ...}` (NOT `invalid_grant`). This proves the row exists and the polling endpoint is wired.

### ☐ 7.3 JWT verifies against published JWKS

After a real sign-in:
```sh
TOKEN=...   # access_token from a successful flow
curl -sSf $API/api/v1/auth/me -H "Authorization: Bearer $TOKEN" | jq '{userId, email, tier}'
```
**Expect:** the user's profile. `403 Forbidden` = the token didn't verify — usually means JWKS rotation or wrong issuer.

---

## 8. Register → identity round-trip (full happy path)

```sh
EMAIL="prodcheck-$(date +%s)@example.com"

# Register
REG=$(curl -sSf -X POST $API/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d "{\"name\":\"Prod Check\",\"email\":\"$EMAIL\",\"password\":\"ProdCheck1\"}")
echo "$REG" | jq '{userId, windyIdentityId, tier}'
TOKEN=$(echo "$REG" | jq -r '.token')

# Identity hub returns the new user with provisioned products
sleep 2
curl -sSf $API/api/v1/identity/me -H "Authorization: Bearer $TOKEN" \
  | jq '{email: .identity.email, storageLimit: .identity.storageLimit, products: [.products[].product]}'

# Cleanup
curl -sSf -X DELETE $API/api/v1/auth/me \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"password":"ProdCheck1"}' | jq .
```

### ☐ 8.1 Register returned 201 with a `token`
### ☐ 8.2 `identity/me` shows `storageLimit: 524288000` (500 MB free tier)
### ☐ 8.3 `products` array contains at least `windy_pro` and `windy_chat`
### ☐ 8.4 Account self-deletion succeeds

---

## 9. Webhook fan-out fires end-to-end

### ☐ 9.1 Audit log shows `webhook_delivered` after a register

After running the §8 register, query the audit trail:
```sh
TOKEN=$(curl -sSf -X POST $API/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"<admin email>","password":"<admin pw>"}' | jq -r .token)

curl -sSf "$API/api/v1/identity/audit?event=webhook_delivered&limit=10" \
  -H "Authorization: Bearer $TOKEN" \
  | jq '.entries[] | {event, target: .details.target, eventType: .details.event}'
```
**Expect:** entries with `target: "mail"`, `"chat"`, `"cloud"` (the receivers that have URLs configured) and `eventType: "identity.created"`. If you see `webhook_dead_lettered` for a target, that consumer's URL or signing secret is wrong — see `deploy/docs/webhook-env-vars.md`.

### ☐ 9.2 CloudWatch shows the worker log

```sh
aws logs tail "/ecs/windy-prod-account-server" --since 5m --filter-pattern "webhook-bus"
```
**Expect:** lines like `[webhook-bus] worker started (every 30s)` (boot) and, if any deliveries happened, `[webhook-bus] N delivered, M retrying, K dead-lettered` (every 30s when there's traffic).

### ☐ 9.3 No retry-spam on a clean install

```sh
aws logs tail "/ecs/windy-prod-account-server" --since 5m --filter-pattern "dead-lettered" | head
```
**Expect:** **empty**. Anything here means a consumer is rejecting deliveries — most likely a bad webhook secret or 4xx response shape.

---

## 10. Rate limits enforced

### ☐ 10.1 /auth/login caps at 5/min per IP

```sh
for i in 1 2 3 4 5 6 7; do
  printf "Attempt $i: "
  curl -s -o /dev/null -w "%{http_code}\n" -X POST $API/api/v1/auth/login \
    -H 'Content-Type: application/json' \
    -d '{"email":"ratelimit@example.com","password":"WrongPass1"}'
done
```
**Expect:** the first 5 attempts return `401`, the 6th and 7th return `429`. If all 7 return 401, the limiter isn't on (NODE_ENV is incorrectly set to `test` or the rate-limit middleware isn't loaded).

### ☐ 10.2 /forgot-password caps at 3/hr per email

```sh
for i in 1 2 3 4; do
  printf "Attempt $i: "
  curl -s -o /dev/null -w "%{http_code}\n" -X POST $API/api/v1/auth/forgot-password \
    -H 'Content-Type: application/json' \
    -d '{"email":"ratelimit-forgot@example.com"}'
done
```
**Expect:** first 3 = `200`, 4th = `429`. PR #2 limit.

### ☐ 10.3 /send-verification caps at 3/hr per user

After a real signup with `$TOKEN`:
```sh
for i in 1 2 3 4; do
  printf "Attempt $i: "
  curl -s -o /dev/null -w "%{http_code}\n" -X POST $API/api/v1/auth/send-verification \
    -H "Authorization: Bearer $TOKEN"
done
```
**Expect:** first 3 = `200`, 4th = `429`.

---

## 11. Secrets present and pulling cleanly

### ☐ 11.1 Every secret key the app needs is in Secrets Manager

```sh
aws secretsmanager get-secret-value --secret-id $SECRET_ARN \
  --query SecretString --output text | jq 'keys'
```
**Expect:** at minimum `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `MFA_ENCRYPTION_KEY`, and `WINDY_*_WEBHOOK_SECRET` × 5 (`MAIL`, `CHAT`, `CLOUD`, `CLONE`) plus `ETERNITAS_WEBHOOK_SECRET`. If `RESEND_API_KEY` is not present, email send falls back to the stub (logs only) — fine for soft-launch, fix before opening signup publicly.

### ☐ 11.2 The ECS task is actually reading them

```sh
aws ecs describe-services --cluster $CLUSTER --services $SVC \
  --query 'services[0].deployments[0].rolloutState' --output text
```
**Expect:** `COMPLETED`. `FAILED` usually means the task can't pull a secret (IAM permission issue) — check `iam_role_policy.secrets_read` covers the secret ARN.

---

## 12. Process-level handlers

### ☐ 12.1 No unhandled rejections in the last hour

```sh
aws logs filter-log-events --log-group-name "/ecs/windy-prod-account-server" \
  --start-time $(($(date +%s) - 3600))000 \
  --filter-pattern '"unhandledRejection" OR "uncaughtException"' \
  --query 'events[*].message' --output text | head -5
```
**Expect:** **empty**. Any output here is a real bug worth investigating.

---

## Troubleshooting cheat sheet

| Symptom | Most likely cause | Fix |
|---|---|---|
| `/health` returns `"database":"error"` | RDS SG doesn't allow ECS SG on 5432 | Verify `aws_security_group.rds` ingress; if RDS is mid-creation, wait 10 min |
| `/health` returns `"jwks":"error"` | Two tasks raced on cold-start key generation | `aws ecs update-service ... --desired-count 1` → wait healthy → scale back to 2 |
| `400 invalid_client` on `/oauth/device` | Seed missing the client_id | Confirm PR #10 merged; check `oauth_clients` table for `windy-code`/`windy_pro_mobile` |
| Webhooks all `dead_lettered` | Consumer wrong secret or wrong response shape | Read consumer's logs; verify the secret in Secrets Manager matches the consumer's env |
| ALB target `unhealthy` | Container can't pass `/health` (often DB or Redis) | Read CloudWatch logs; usually a missing secret or wrong env var |
| Cert stuck `PENDING_VALIDATION` | Route 53 DNS record wasn't added | Re-run `terraform apply` — `aws_route53_record.acm_validation` should idempotently add it |
| `aws_secretsmanager_secret_version` shows up in plan every run | Sensitive value drift; harmless but noisy | Add `lifecycle { ignore_changes = [secret_string] }` once you accept manual edits |

---

## Sign-off

When every box above is ☑:

- [ ] Tag the deploy: `git tag prod-$(date +%Y%m%d-%H%M) && git push --tags`
- [ ] Note the task definition revision in your deploy log:
  ```sh
  aws ecs describe-services --cluster $CLUSTER --services $SVC \
    --query 'services[0].taskDefinition' --output text
  ```
- [ ] Announce ready in your channel.

If anything stays red after 30 min of investigation, **roll back**:
```sh
aws ecs update-service --cluster $CLUSTER --service $SVC \
  --task-definition <previous-revision-arn>
```

---

## Wave 7 update — 2026-04-18

The sections below were added after the Wave 7 gap-analysis sweep
(PRs #14–#38). Run them on top of the existing §1–§12 checks; they do
NOT replace any prior step.

### W7.1 New / now-required env vars

Every value below **must** be present in Secrets Manager or the task
env before the service will serve traffic. Wave 7 converted several
previously-soft defaults into hard-fails so production can't silently
run in an insecure state.

| Env var | Mandatory in prod? | Behaviour if missing | Wave 7 PR |
|---|---|---|---|
| `TRUST_PROXY` | **yes** | server throws at boot | P0-1 #15 |
| `CORS_ALLOWED_ORIGINS` | **yes** | server throws at boot | P0-7 #15 |
| `JWT_PRIVATE_KEY` (PEM, `\n`-escaped) | **yes** for RS256 | falls back to HS256 (worse key hygiene) | P0-4 #21 |
| `MFA_ENCRYPTION_KEY` (64-char hex) | **yes** | server throws at boot | P1-1 #24 |
| `ETERNITAS_WEBHOOK_SECRET` | **yes** | webhook returns 503 per request | P0-2 #16 |
| `STRIPE_WEBHOOK_SECRET` | **yes** for billing | webhook returns 503 per request | P1-13 #31 |
| `REDIS_URL` | **strongly recommended** behind `desired_count > 1` | rate limiters fall back to per-task MemoryStore → attacker multiplies quota by task count | P1-2 #34 |

Verify all are present:
```sh
aws secretsmanager get-secret-value --secret-id $SECRET_ARN \
  --query SecretString --output text | jq 'keys[]' \
  | sort -u > /tmp/have.txt
cat <<'EOF' | sort -u > /tmp/want.txt
DATABASE_URL
REDIS_URL
JWT_SECRET
JWT_PRIVATE_KEY
MFA_ENCRYPTION_KEY
ETERNITAS_WEBHOOK_SECRET
STRIPE_WEBHOOK_SECRET
WINDY_MAIL_WEBHOOK_SECRET
WINDY_CHAT_WEBHOOK_SECRET
WINDY_CLOUD_WEBHOOK_SECRET
WINDY_CLONE_WEBHOOK_SECRET
EOF
comm -23 /tmp/want.txt /tmp/have.txt   # lists anything missing
```

### W7.2 Webhook secrets — one per (producer, receiver) pair

Every identity-hub → product-service webhook is HMAC-SHA256-signed
with a secret that ONLY the producer and the receiver share. A leak at
one receiver must not let an attacker forge events to another, so
**don't reuse secrets across receivers.** Mint with:

```sh
openssl rand -hex 32
```

Load into Secrets Manager under its canonical name (the account-server
reads these — see `src/services/webhook-bus.ts:50`):

- `WINDY_MAIL_WEBHOOK_SECRET`   (account-server → windy-mail)
- `WINDY_CHAT_WEBHOOK_SECRET`   (account-server → windy-chat)
- `WINDY_CLOUD_WEBHOOK_SECRET`  (account-server → windy-cloud)
- `WINDY_CLONE_WEBHOOK_SECRET`  (account-server → windy-clone)
- `ETERNITAS_WEBHOOK_SECRET`    (eternitas → account-server — validates inbound revocations)

The **same** secret value must be loaded into each receiver's own
config under that service's env var name (owning terminals handle
their side; coordinate via the ecosystem-contracts channel).

### W7.3 Post-deploy ecosystem smoke

Running the per-service checks in §8 + §9 proves the account-server
side works. What they don't prove is that the webhook fan-out
actually lands valid state on every consumer. For that, run the
end-to-end smoke script:

```sh
ACCOUNT_SERVER_URL=$API \
MAIL_URL=https://mail.windyword.ai \
CHAT_URL=https://chat.windyword.ai \
CLOUD_URL=https://cloud.windyword.ai \
ETERNITAS_URL=https://eternitas.windyword.ai \
bash scripts/launch-smoke-test.sh
```

☐ W7.3.1 Script exits 0 and the "pass : N" count covers every non-SKIP
   step. Any FAIL means a receiver failed to pick up a provisioning
   webhook or failed to revoke on cascade — check
   `/api/v1/identity/audit?event=webhook_dead_lettered` and the
   receiver's ingest logs.

### W7.4 Wave 7 behavioural deltas worth knowing

These are live behaviours the deploy inherits from Wave 7 — not
checklist items per se, but worth noting so on-call doesn't
mis-diagnose them as regressions:

- `/api/v1/identity/eternitas/webhook` now **rejects** any payload
  older than 5 minutes or without `agentName` on `passport.registered`
  (P1-15, P1-6). A delayed retry from Eternitas may 401/400.
- `/reset-password?token=…` now renders a real HTML form instead of
  the SPA 404 (P1-14). Browser follows the password-reset email.
- Malformed token / `alg:none` now returns **401** not 403 (P2-3).
  Any downstream client pinned to 403 will silently accept and retry
  indefinitely; update them.
- Name field on register is capped at 128 chars (P2-8). Any prior
  user with >128 chars still works for login; only new registers
  are rejected.
- Backup-code bcrypt cost dropped from 8 to 6 for MFA setup latency
  (P2-1). Unrelated to password hashing, which stays at
  `config.BCRYPT_ROUNDS`.

### W7.5 Cross-terminal product decisions outstanding

These are tracking items owned by other terminals that weren't fully
resolved when Wave 7 landed on this repo. Listed for visibility at
deploy sign-off; the **Blocks deploy?** column reflects our side's
dependency, not the owning terminal's readiness.

| # | Owner terminal | Topic | Blocks deploy? |
|---|---|---|---|
| 1 | windy-mail | `WINDYMAIL_WINDY_ACCOUNT_SERVER_URL` post-merge note from Mail #4 — confirm mail task def has this set | **yes** — receiver can't validate incoming webhooks without it |
| 2 | windy-chat | Chat send endpoint for smoke step D (`TODO(chat)` in `launch-smoke-test.sh`) | no — step is SKIP until resolved |
| 3 | windy-chat | Chat fetch endpoint for smoke step F | no — same |
| 4 | windy-cloud | Generic blob-upload endpoint for smoke step E | no if cloud `/api/v1/upload` exists; yes if we actually need `/archive/code-settings` |
| 5 | eternitas | Eternitas #21 — bot revocation cascade timing (does revocation land synchronously or via retry?) | **yes** if cascade test in §9 depends on synchronous | 
| 6 | eternitas | Eternitas #22 — passport registry prod URL | **yes** — `ETERNITAS_URL` in Secrets Manager must resolve |
| 7 | eternitas | Eternitas #23 — trust-index scoring GA vs. beta flag default | no |
| 8 | windy-pro-mobile | Mobile P1-6 — deep-link handler for `/reset-password` and `/verify-email` | no — web stub (P1-14) covers the 404 for now |
| 9 | windy-code | `WINDY_DEV_PASSPORT` scaffold deletion (unblocked by PR #13 `a3eecb4`) | no — we're the unblocker, they ship when ready |
| 10 | windy-agent | Agent-bus auth contract v2 | no — current contract still works |
| 11 | ops | Actual `*.windyword.ai` cert issuance for chat/mail/cloud subdomains | **yes** for W7.3.1 to pass against real URLs |

Items marked **yes** must be green before announcing launch. Items
marked no can ship post-deploy; open a tracking issue per item in
the ecosystem-contracts channel.

### W7.6 Rollback caveat

A rollback that drops `JWT_PRIVATE_KEY` (revert to pre-P0-4 code)
will silently fall back to HS256. All JWTs minted during the
rolled-forward window stay valid (same `JWT_SECRET`) but any
downstream consumer that pinned RS256 will reject them. Plan a
coordinated JWKS-rotation before rolling back if Wave 7 has already
been live long enough for consumers to cache the RS256 key.

