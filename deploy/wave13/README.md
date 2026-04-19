# Wave 13 Phase 1 — AWS deploy artifacts

Everything under `deploy/wave13/` is the Phase 1 ribbon — the keystone
account-server deployment on `api.windyword.ai`. Sister repos consume
this service's JWKS; they cannot deploy until this is live.

## Files

| File                                     | Purpose                                                                 |
|------------------------------------------|-------------------------------------------------------------------------|
| `docker-compose.aws.yml`                 | Lean compose: account-server + Redis. External RDS via `DATABASE_URL`.  |
| `nginx-api.windyword.ai.conf`            | Host-side nginx: TLS term + SSE-safe proxy to :8098.                    |
| `user-data.sh.tmpl`                      | Cloud-init bootstrap. Runs once on first boot.                          |

## Secret strategy

- Every secret except the **RDS master password** is generated **on the
  EC2 instance** by `user-data.sh.tmpl` using `openssl rand -hex 32`.
  That keeps them out of the operator's shell history and the PR
  transcript.
- The RDS password is generated at FIRE 1 (`aws rds create-db-instance`
  requires it at create time). It's passed into user-data once via the
  `__RDS_PASSWORD__` placeholder; after FIRE 2 it lives only in
  `/opt/windy-pro/.env.production` on the instance.
- RS256 keypair: generated on the instance with `openssl genrsa 4096`.
  `JWT_KEY_ID` is the current year-month so rotation is natural.

## Checkpoint sequence (do NOT autonomously run)

Each step is gated on an explicit "fire step N" from the operator:

1. **FIRE 1 — RDS**: `aws rds create-db-instance` db.t3.micro Postgres 16
   `windy-pro-identity`. ~15 min to `available`. Deletion protection ON.
2. **FIRE 2 — EC2 + EIP**: allocate Elastic IP, render user-data with
   RDS endpoint + password, launch t3.small, attach EIP.
3. **FIRE 3 — DNS**: replace `api.windyword.ai` CNAME with A record → EIP
   (proxied=false for ACME). Wait until resolution propagates.
4. **FIRE 4 — Lockbox**: read AWS secret into scoped env for whichever
   of steps 1/2 hadn't been run yet. Never echo plaintext.
5. **FIRE 5 — certbot**: `certbot --nginx -d api.windyword.ai`. Issues
   Let's Encrypt cert and uncomments the 443 server block.

After each checkpoint: capture resource IDs (RDS endpoint, EIP, AMI,
instance ID, certificate fingerprint) for the morning briefing.

## Rollback

- **RDS**: deletion protection is ON by design. Flip to OFF first,
  then `aws rds delete-db-instance --skip-final-snapshot` for a clean
  tear-down. Keep a snapshot if there's real data.
- **EC2**: `aws ec2 terminate-instances --instance-ids <i-…>` followed
  by `aws ec2 release-address --allocation-id <eip-alloc>`. EIP billing
  stops only after release.
- **DNS**: keep the pre-change CNAME value logged in the morning brief
  so a recovery is `PUT records/<id>` with the prior value.
- **Let's Encrypt**: `certbot revoke --cert-path …` is rarely needed;
  a stale cert on an IP that no longer serves that hostname doesn't
  leak anything. Just let it expire in 90 days.

## Verify after FIRE 5

```bash
BASE_URL=https://api.windyword.ai scripts/smoke-test.sh
```

The Wave 9 smoke script asserts:
- `/healthz` → 200
- JWKS has ≥1 key
- OIDC metadata valid
- signup + login + hatch SSE → ok

Capture the full output in the PR body.
