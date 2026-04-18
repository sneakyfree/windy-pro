# Windy Pro — Production Deploy Runbook

**Master deploy document for the Windy ecosystem.** Pro is the identity hub
(account-server, port 8098) — every sister service (Mail, Chat, Cloud,
Clone, Fly, Code, Traveler, Eternitas) verifies JWTs against Pro's
`/.well-known/jwks.json` and calls Pro's credential broker for LLM keys.
Deploy Pro first. Deploy the rest against it.

---

## Table of contents

1. [Architecture in one page](#architecture-in-one-page)
2. [AWS setup](#aws-setup)
3. [Environment variables](#environment-variables)
4. [Domain + DNS](#domain--dns)
5. [SSL via Let's Encrypt + Nginx](#ssl-via-lets-encrypt--nginx)
6. [First-time bootstrap](#first-time-bootstrap)
7. [Deploy & upgrade](#deploy--upgrade)
8. [Rollback plan](#rollback-plan)
9. [Post-deploy smoke test](#post-deploy-smoke-test)

---

## Architecture in one page

```
                    ┌──────────────────┐
   (internet) ─────►│   Nginx TLS term │─────► account-server :8098
                    │  windypro.com    │          │
                    └──────────────────┘          ├── POST /api/v1/auth/*        (signup/login)
                                                  ├── POST /api/v1/agent/hatch   (SSE ceremony)
                                                  ├── POST /api/v1/agent/credentials/issue (HMAC-signed broker)
                                                  ├── GET  /.well-known/jwks.json (sister verify here)
                                                  └── GET  /.well-known/openid-configuration

account-server talks outbound to:
  - Eternitas       $ETERNITAS_URL           (passport issuance + revocation webhook)
  - Windy Mail      $WINDYMAIL_API_URL       (inbox provisioning, SMTP relay)
  - Windy Chat      $WINDY_CHAT_URL          (Matrix onboarding, DM rooms)
  - Windy Cloud     $WINDY_CLOUD_URL         (storage quota, R2 adapter)
  - Windy Fly       $WINDY_AGENT_URL         (remote hatch /hatch/remote)
  - Stripe          api.stripe.com           (billing + webhooks)
  - Twilio          api.twilio.com           (SMS, voice) (optional)
  - OpenAI/Anthropic/Gemini                  (broker-issued LLM calls)

Infra dependencies: PostgreSQL, Redis, Cloudflare R2 (object store),
Let's Encrypt, Nginx.
```

The hot path (identity hub ⇄ sister services) runs inside one VPC; the
cold path (browser ⇄ Nginx) is public. Credential broker tokens are
minted at the hot-path boundary and never leave the VPC except as
short-lived `bk_live_*` values handed to an agent at hatch time.

---

## AWS setup

### One-time account prep

- Route 53 hosted zone for `windypro.com` — or a Cloudflare zone; both
  work. Cloudflare is simpler if you want DDoS protection for free.
- S3 bucket `windypro-backups` (versioning ON, lifecycle: 90 days →
  Glacier) for DB dumps.
- IAM role `windypro-ec2` with:
  - `s3:PutObject` / `s3:GetObject` on the backup bucket
  - `ses:SendEmail` if you relay mail via SES (we don't; Mail uses its
    own MTA on `windymail.ai`)
  - `r2:*` is N/A — R2 is Cloudflare; authenticate via
    `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` env vars instead.
- Security group `windypro-sg`:
  - inbound 80 / 443 from 0.0.0.0/0
  - inbound 22 from your bastion / office CIDR only
  - outbound all

### EC2 instance

| Component     | Value                                                     |
|---------------|-----------------------------------------------------------|
| Instance type | `t3.medium` (2 vCPU, 4 GB). Step up to `t3.large` once DAU ≥ 5k. |
| AMI           | Ubuntu Server 22.04 LTS (x86_64)                          |
| Root EBS      | 40 GB gp3                                                 |
| Data EBS      | 100 GB gp3 mounted at `/var/lib/windypro` (holds Postgres, R2 cold copies, uploads) |
| Key pair      | Separate from dev laptop keys                             |
| IAM           | `windypro-ec2` role                                       |

### Host bootstrap

```bash
# 1. System packages
sudo apt update && sudo apt -y upgrade
sudo apt -y install docker.io docker-compose-plugin nginx certbot python3-certbot-nginx \
                    postgresql-client-15 awscli jq ufw
sudo usermod -aG docker ubuntu
sudo systemctl enable --now docker

# 2. Firewall (belt + braces with the SG)
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22
sudo ufw allow 80
sudo ufw allow 443
sudo ufw --force enable

# 3. Clone repo (pin to a release tag — never deploy from main directly)
sudo mkdir -p /opt/windypro && sudo chown ubuntu:ubuntu /opt/windypro
cd /opt/windypro
git clone https://github.com/sneakyfree/windy-pro.git .
git fetch --tags
git checkout v2.0.0     # replace with the release tag you're deploying

# 4. Create data volume layout
sudo mkdir -p /var/lib/windypro/{postgres,redis,keys,uploads,backups}
sudo chown -R ubuntu:ubuntu /var/lib/windypro
```

### Docker Compose deploy

`deploy/docker-compose.production.yml` already wires account-server,
chat-onboarding, Postgres, Redis, Synapse, and Nginx. Start it with:

```bash
cd /opt/windypro/deploy
cp ../.env.production.example /opt/windypro/.env.production
# Fill in the env file (see next section) — DO NOT COMMIT IT.
chmod 600 /opt/windypro/.env.production

docker compose -f docker-compose.production.yml --env-file /opt/windypro/.env.production pull
docker compose -f docker-compose.production.yml --env-file /opt/windypro/.env.production up -d
docker compose -f docker-compose.production.yml --env-file /opt/windypro/.env.production ps
```

Systemd unit `deploy/systemd/windypro.service` already exists — install
it so the stack auto-starts on reboot:

```bash
sudo cp /opt/windypro/deploy/systemd/windypro.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now windypro
```

---

## Environment variables

Every variable Windy Pro production needs, grouped by purpose. The full
template with safe dummy values is in `.env.production.example`.

### Identity / auth

| Var                           | Purpose |
|-------------------------------|---------|
| `NODE_ENV=production`         | Turns on hard-fail guards (CORS, TRUST_PROXY). |
| `PORT=8098`                   | Account-server listen port. Don't change — sister services hardcode this in dev defaults. |
| `JWT_SECRET`                  | HS256 fallback secret. 64 bytes hex. `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`. |
| `JWT_PRIVATE_KEY_PATH`        | Path inside the container to the RS256 private key PEM (see "First-time bootstrap"). |
| `JWT_PUBLIC_KEY_PATH`         | Path to the RS256 public key PEM. Exposed through `/.well-known/jwks.json`. |
| `JWT_KEY_ID`                  | `kid` claim for the JWKS entry. `windypro-prod-2026-04`. Rotate by incrementing the date. |
| `OIDC_ISSUER`                 | Canonical issuer URL: `https://windypro.com`. |
| `CORS_ALLOWED_ORIGINS`        | Comma-separated: `https://windypro.com,https://windyword.ai`. Hard-fail if unset in prod. |
| `TRUST_PROXY=1`               | Trust one hop (the Nginx in front). Hard-fail if unset in prod. |

### Infrastructure

| Var              | Purpose |
|------------------|---------|
| `DATABASE_URL`   | `postgres://windy:<password>@postgres:5432/windy_identity` |
| `POSTGRES_PASSWORD` | Used by the compose stack to boot the Postgres container. |
| `REDIS_URL`      | `redis://redis:6379`. Unset falls back to in-memory (DO NOT do in prod). |
| `DB_PATH`        | SQLite dev fallback. Unused when `DATABASE_URL` is set. |
| `DATA_ROOT`      | `/data` inside the container; bind-mount `/var/lib/windypro/uploads` to it. |

### Billing (Stripe)

| Var                        | Where to get it |
|----------------------------|-----------------|
| `STRIPE_SECRET_KEY`        | Stripe Dashboard → Developers → API keys → Secret. |
| `STRIPE_WEBHOOK_SECRET`    | Dashboard → Developers → Webhooks → endpoint for `https://windypro.com/api/v1/stripe`. |
| `STRIPE_PRO_PRICE_ID`      | Dashboard → Products → Windy Pro → Price ID. |
| `STRIPE_TRANSLATE_PRICE_ID`, `STRIPE_TRANSLATE_PRO_PRICE_ID` | Same; one per SKU. |

### Mail (outbound SMTP for password resets / verification)

| Var                 | Purpose |
|---------------------|---------|
| `SMTP_HOST`         | `smtp.sendgrid.net` (or Postmark, AWS SES). |
| `SMTP_PORT`         | `587`. |
| `SMTP_USER`         | `apikey` for SendGrid, service key for Postmark. |
| `SMTP_PASSWORD`     | The API key value. |
| `SMTP_FROM`         | `no-reply@windypro.com`. DKIM + SPF records must match this domain. |

### LLM provider keys (managed-credential broker)

The broker holds these centrally; the agent never sees the raw values.
Set the ones you intend to route to — unused ones can be blank.

| Var              | Tier that routes to it |
|------------------|------------------------|
| `OPENAI_KEY`     | `starter` (`gpt-4o-mini`) |
| `ANTHROPIC_KEY`  | `pro`, `enterprise` (`claude-haiku-4-5-20251001`, `claude-sonnet-4-6`) |
| `GEMINI_KEY`     | `free` (`gemini-1.5-flash`) |

### Ecosystem webhook shared secrets

Every inbound webhook is HMAC-verified with a dedicated secret. Generate
each independently: `openssl rand -hex 32`. Rotate yearly or on any
suspected compromise — every rotation requires simultaneous rollout
with the emitting service, so coordinate in `#ecosystem-ops`.

| Var                               | Verifies inbound calls from |
|-----------------------------------|------------------------------|
| `ETERNITAS_WEBHOOK_SECRET`        | Eternitas `passport.revoked/suspended/reinstated`. |
| `WINDYMAIL_SERVICE_TOKEN`         | Pro → Mail authenticated calls (we set this outbound too). |
| `CHAT_SERVICE_TOKEN`              | Pro ↔ Chat onboarding, Matrix provisioning. |
| `WINDY_CLOUD_SERVICE_TOKEN`       | Pro ↔ Cloud for clone-training and quota calls. |
| `BROKER_HMAC_SECRET`              | **Load-bearing.** Any agent host calling `/api/v1/agent/credentials/issue` signs with this. |
| `SYNAPSE_REGISTRATION_SECRET`     | Matches Synapse's `registration_shared_secret` in `homeserver.yaml`. |
| `WINDY_AGENT_SERVICE_TOKEN`       | Pro → windy-agent's `/hatch/remote`. |

### Ecosystem URLs

Override these only if you're pointing at non-default hosts. The
defaults below are what compose wires up.

| Var                    | Default                           |
|------------------------|-----------------------------------|
| `ETERNITAS_URL`        | `https://eternitas.com`            |
| `ETERNITAS_API_KEY`    | Platform API key from Eternitas (`et_plt_…`). |
| `ETERNITAS_SERVICE_TOKEN` | Service-token issued by Eternitas for this install. |
| `WINDYMAIL_API_URL`    | `https://api.windymail.ai`         |
| `WINDY_CHAT_URL`       | `https://chat.windyword.ai`        |
| `WINDY_CLOUD_URL`      | `https://cloud.windypro.com`        |
| `WINDY_AGENT_URL`      | `https://fly.windypro.com`          |

### Twilio (optional — only if you're wiring SMS for agent hatch)

| Var                       | Purpose |
|---------------------------|---------|
| `TWILIO_ACCOUNT_SID`      | `AC…` |
| `TWILIO_AUTH_TOKEN`       | Dashboard → Account → Auth Token. |
| `TWILIO_MESSAGING_SID`    | Messaging-service SID (`MG…`) if using a pool. |

### Storage (Cloudflare R2)

| Var                        | Purpose |
|----------------------------|---------|
| `R2_ACCOUNT_ID`            | Cloudflare R2 → Account ID. |
| `R2_ACCESS_KEY_ID`         | R2 → Manage API tokens → user token. |
| `R2_SECRET_ACCESS_KEY`     | Paired secret. |
| `R2_BUCKET`                | `windypro-uploads`. |
| `R2_PUBLIC_URL`            | Custom domain you bind to the bucket for public reads, e.g. `https://cdn.windypro.com`. |

### Observability (optional)

| Var                    | Purpose |
|------------------------|---------|
| `SENTRY_DSN`           | Error reporting; empty = disabled (graceful). |
| `GRAFANA_OTLP_ENDPOINT`| Metric shipping if you want dashboards. |

---

## Domain + DNS

We are **not** hosting mail locally. Mail lives on `windymail.ai`, a
separate deployment. No MX records on `windypro.com` — only A/AAAA +
TXT for DKIM/SPF so outbound mail (via SendGrid/SES) passes auth.

### Records to create

| Host                        | Type  | Value                                            |
|-----------------------------|-------|--------------------------------------------------|
| `windypro.com.`             | A     | Elastic IP of the EC2                            |
| `windypro.com.`             | AAAA  | IPv6 if you allocated one                        |
| `www.windypro.com.`         | CNAME | `windypro.com.`                                  |
| `account.windypro.com.`     | CNAME | `windypro.com.` (legacy alias; still in use)     |
| `fly.windypro.com.`         | CNAME | Windy Agent host                                 |
| `cloud.windypro.com.`       | CNAME | Windy Cloud host                                 |
| `_acme-challenge.windypro.com.` | TXT | Temporary, written by certbot during issuance.  |
| `windypro.com.`             | TXT   | `v=spf1 include:sendgrid.net -all`               |
| `s1._domainkey.windypro.com.` | TXT | DKIM key from SendGrid.                          |
| `_dmarc.windypro.com.`      | TXT   | `v=DMARC1; p=quarantine; rua=mailto:dmarc@windypro.com` |

**No MX records** — explicit. If you add an MX here, you'll split-brain
with `windymail.ai` and mail delivery becomes undebuggable. Mail for
`@windypro.com` addresses (if you run any) should be forwarded at the
provider level to a Mail inbox.

---

## SSL via Let's Encrypt + Nginx

### Minimal Nginx config

`/etc/nginx/sites-available/windypro.conf`:

```nginx
# HTTP → HTTPS redirect + ACME challenge pass-through
server {
    listen 80;
    server_name windypro.com www.windypro.com;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
    location / {
        return 301 https://$host$request_uri;
    }
}

# TLS termination + reverse proxy to account-server
server {
    listen 443 ssl http2;
    server_name windypro.com www.windypro.com;

    ssl_certificate     /etc/letsencrypt/live/windypro.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/windypro.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;

    # HSTS — 6 months, include sub-domains, preload
    add_header Strict-Transport-Security "max-age=15552000; includeSubDomains; preload" always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    client_max_body_size 100m;

    # SSE — disable buffering so POST /api/v1/agent/hatch streams cleanly
    location /api/v1/agent/hatch {
        proxy_pass http://127.0.0.1:8098;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 120s;
        chunked_transfer_encoding on;
    }

    # Stripe webhook — raw body only, no rewriting
    location /api/v1/stripe {
        proxy_pass http://127.0.0.1:8098;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_request_buffering off;
    }

    location / {
        proxy_pass http://127.0.0.1:8098;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

### Issue the cert

```bash
sudo ln -s /etc/nginx/sites-available/windypro.conf /etc/nginx/sites-enabled/
sudo mkdir -p /var/www/certbot
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d windypro.com -d www.windypro.com \
    --non-interactive --agree-tos -m ops@windypro.com
```

Cert auto-renew via the certbot timer is on by default. Confirm:

```bash
sudo systemctl status certbot.timer
sudo certbot renew --dry-run
```

---

## First-time bootstrap

Run once on a fresh deploy. Each step is idempotent enough to re-run
safely if you have to recover.

### 1. Generate RS256 keypair + JWKS kid

```bash
cd /var/lib/windypro/keys
openssl genrsa -out private.pem 4096
openssl rsa -in private.pem -pubout -out public.pem
chmod 600 private.pem
# Pick a kid you can grep for later in logs:
echo "windypro-prod-$(date +%Y-%m)" | tee kid.txt
```

Put both paths in `.env.production`:

```
JWT_PRIVATE_KEY_PATH=/keys/private.pem
JWT_PUBLIC_KEY_PATH=/keys/public.pem
JWT_KEY_ID=windypro-prod-2026-04
```

The compose file bind-mounts `/var/lib/windypro/keys` → `/keys` in the
container. After reloading the service, `GET
https://windypro.com/.well-known/jwks.json` must return a JWKS object
containing this `kid`. Sister services cache JWKS for 1 hour.

### 2. Apply database migrations

```bash
cd /opt/windypro/account-server
docker compose -f ../deploy/docker-compose.production.yml \
    --env-file /opt/windypro/.env.production \
    exec account-server \
    psql "$DATABASE_URL" -f /app/migrations/001-sqlite-to-postgres.sql
```

The server also runs idempotent `CREATE TABLE IF NOT EXISTS` at startup,
so the SQL file is really just the upfront Postgres bootstrap.

### 3. Seed the admin user

```bash
docker compose -f deploy/docker-compose.production.yml \
    --env-file /opt/windypro/.env.production \
    exec account-server node -e '
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const Database = require("better-sqlite3");      // swap for pg client if Postgres
// ... (see scripts/seed-admin.js once you've committed one; this inline is a placeholder)
'
```

A canonical one-shot `scripts/seed-admin.js` lives in the repo; pass
`ADMIN_EMAIL` + `ADMIN_PASSWORD` as env to it and it inserts the row
with `role='admin'` and a freshly generated `windy_identity_id`.

### 4. Seed integrity baseline

```bash
curl -sS https://windypro.com/admin/integrity/baseline \
     -H "Authorization: Bearer $ADMIN_JWT" \
     -X POST
```

This records the current DB row counts, JWKS kid, and schema hash as
the "known good" state. `/admin/integrity/check` diffs against it.

### 5. Register as an Eternitas platform

```bash
curl -sS https://eternitas.com/platforms/register \
     -H "Content-Type: application/json" \
     -d '{
         "platform_key": "windy_pro_prod",
         "webhook_url": "https://windypro.com/api/v1/identity/eternitas/webhook",
         "events": ["passport.revoked", "passport.suspended", "passport.reinstated", "trust_updated"]
     }'
```

The response includes `et_plt_…` — put that in `ETERNITAS_API_KEY` and
restart. Without this, passport revocations never cascade and broker
tokens stay live after revocation.

### 6. Verify OAuth clients seeded

account-server seeds first-party OAuth clients at startup
(`seedEcosystemClients()`). Confirm:

```bash
docker compose ... exec account-server \
    psql "$DATABASE_URL" -c "SELECT client_id, name FROM oauth_clients;"
```

Expect rows for `windy_chat`, `windy_mail`, `eternitas`, `windy_fly`,
`windy_pro_mobile`, `windy-code`.

---

## Deploy & upgrade

Subsequent deploys:

```bash
cd /opt/windypro
git fetch --tags
git checkout v2.0.1       # new release tag

# Pull new images
cd deploy
docker compose -f docker-compose.production.yml \
    --env-file /opt/windypro/.env.production pull

# Zero-downtime restart: recreate in place (healthcheck gates the switch)
docker compose -f docker-compose.production.yml \
    --env-file /opt/windypro/.env.production up -d --remove-orphans

# Confirm all healthchecks go green
watch -n 2 'docker compose -f docker-compose.production.yml ps'
```

If migrations are needed, run them BEFORE `up -d` from a disposable
one-shot container so an interrupted migration doesn't leave a serving
container mid-schema:

```bash
docker compose -f docker-compose.production.yml \
    --env-file /opt/windypro/.env.production \
    run --rm account-server \
    psql "$DATABASE_URL" -f /app/migrations/002-wave8-broker.sql
```

---

## Rollback plan

You need ≤ 5 minutes to get back to the previous good state.

### Fast path — code rollback only

```bash
cd /opt/windypro
git checkout v2.0.0       # the previous tag
cd deploy
docker compose -f docker-compose.production.yml \
    --env-file /opt/windypro/.env.production pull
docker compose -f docker-compose.production.yml \
    --env-file /opt/windypro/.env.production up -d
```

This is safe when the rolled-back version is schema-compatible with
what's currently in Postgres (forward-additive changes only).

### Full rollback — stop stack + restore DB

Use when a migration corrupted data or the new schema is incompatible.

```bash
# 1. Stop the stack so no new writes hit the broken schema
cd /opt/windypro/deploy
docker compose -f docker-compose.production.yml \
    --env-file /opt/windypro/.env.production down

# 2. Restore the most recent pre-deploy DB dump
aws s3 ls s3://windypro-backups/postgres/ --recursive | tail -5
aws s3 cp s3://windypro-backups/postgres/pre-deploy-2026-04-18.sql.gz /tmp/
gunzip /tmp/pre-deploy-2026-04-18.sql.gz

docker compose -f docker-compose.production.yml \
    --env-file /opt/windypro/.env.production up -d postgres
# Wait ~5s for postgres to come up healthy
docker compose -f docker-compose.production.yml \
    --env-file /opt/windypro/.env.production \
    exec -T postgres psql -U windy -d windy_identity < /tmp/pre-deploy-2026-04-18.sql

# 3. Check out the previous code tag and bring the stack up
cd /opt/windypro && git checkout v2.0.0
cd deploy
docker compose -f docker-compose.production.yml \
    --env-file /opt/windypro/.env.production up -d
```

### Prerequisite — always take a dump first

Every deploy script takes a timestamped dump BEFORE starting the new
version:

```bash
docker compose -f docker-compose.production.yml \
    --env-file /opt/windypro/.env.production \
    exec -T postgres pg_dump -U windy windy_identity \
    | gzip > /tmp/pre-deploy-$(date +%F-%H%M).sql.gz
aws s3 cp /tmp/pre-deploy-*.sql.gz s3://windypro-backups/postgres/
```

If this step fails, the deploy aborts. No dump, no deploy.

### Broker tokens mid-rollback

If you rolled back because a broker-side bug was issuing bad tokens,
revoke everything after the rollback lands:

```bash
docker compose ... exec account-server node -e '
  require("./dist/services/credential-broker").revokeBrokerTokens({
    identity_id: null, passport_number: null,
    reason: "rollback-2026-04-18",
    cascade: true,
  });
'
```

Agents will get 401s on their next call and re-mint through the fixed
code path. The revocation record is append-only.

---

## Post-deploy smoke test

```bash
# Run the full smoke suite
BASE_URL=https://windypro.com ./scripts/smoke-test.sh
```

The script exits non-zero on any failure. It asserts:

- `GET /healthz` → 200
- `GET /.well-known/jwks.json` → a parseable JWKS with ≥ 1 RSA key
- `GET /.well-known/openid-configuration` → valid OIDC metadata with the
  issuer matching `$OIDC_ISSUER`
- Signup accepts a fresh test user
- Login returns a JWT that verifies against the returned JWKS
- `POST /api/v1/agent/hatch` opens an SSE stream and terminates with
  `hatch.complete`

What the script does NOT cover (still manual):

- End-to-end Matrix DM between the user and their freshly-hatched agent
- Stripe checkout → webhook → plan upgrade
- Mail inbox provisioning over to windymail.ai

Those integration tests live in each sister repo's CI matrix and are
triggered cross-repo by the weekly `windy-pro-prod-drill` job.
