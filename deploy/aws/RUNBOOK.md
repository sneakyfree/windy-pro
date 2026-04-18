# AWS deployment runbook — account-server

**Audience:** operator with access to an AWS account and a machine that has (or can install) `aws` + `terraform` CLIs.

**Goal:** get `api.windyword.ai` serving the account-server from ECS Fargate, backed by RDS Postgres + ElastiCache Redis, with all secrets in Secrets Manager.

**Time budget:** 40–60 minutes for a clean first run (RDS creation is the long pole at ~10 min).

> This runbook complements `deploy/aws/README.md` (which describes what gets provisioned). Read that first if you want a bird's-eye view of resources.

---

## 0. Prerequisites on your workstation

```sh
# Terraform ≥ 1.6
brew install hashicorp/tap/terraform        # macOS
# OR: https://developer.hashicorp.com/terraform/downloads

terraform version       # Confirm ≥ 1.6.0

# AWS CLI v2
brew install awscli     # macOS
aws --version           # Confirm aws-cli/2.x
```

Also required: `docker` (to push the container image).

---

## 1. Create the IAM user Terraform will run as

On the AWS console (or via a superuser AWS CLI session), create an IAM user `windy-deployer`:

```sh
aws iam create-user --user-name windy-deployer
aws iam create-access-key --user-name windy-deployer
# → SAVE THE AccessKeyId + SecretAccessKey. They'll be used by `aws configure`.
```

### Permissions policy

Attach this inline policy (name it `WindyDeployerPolicy`). It's scoped to the services the scaffold uses. **Review before pasting** — this is broad enough to apply the whole scaffold; tighten per-resource with ARN conditions once the stack is stable.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CoreServicesFullAccess",
      "Effect": "Allow",
      "Action": [
        "ec2:*",
        "ecs:*",
        "elasticloadbalancing:*",
        "rds:*",
        "elasticache:*",
        "route53:*",
        "acm:*",
        "secretsmanager:*",
        "logs:*",
        "application-autoscaling:*",
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "ecr:PutImage",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload",
        "ecr:CreateRepository",
        "ecr:DescribeRepositories"
      ],
      "Resource": "*"
    },
    {
      "Sid": "IAMForEcsAndRoles",
      "Effect": "Allow",
      "Action": [
        "iam:CreateRole",
        "iam:DeleteRole",
        "iam:GetRole",
        "iam:PassRole",
        "iam:TagRole",
        "iam:UntagRole",
        "iam:AttachRolePolicy",
        "iam:DetachRolePolicy",
        "iam:PutRolePolicy",
        "iam:GetRolePolicy",
        "iam:DeleteRolePolicy",
        "iam:ListRolePolicies",
        "iam:ListAttachedRolePolicies",
        "iam:CreateServiceLinkedRole"
      ],
      "Resource": "*"
    },
    {
      "Sid": "TerraformStateS3",
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket",
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject"
      ],
      "Resource": [
        "arn:aws:s3:::windy-terraform-state",
        "arn:aws:s3:::windy-terraform-state/*"
      ]
    },
    {
      "Sid": "TerraformStateLock",
      "Effect": "Allow",
      "Action": ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem"],
      "Resource": "arn:aws:dynamodb:*:*:table/windy-terraform-lock"
    }
  ]
}
```

```sh
aws iam put-user-policy --user-name windy-deployer \
  --policy-name WindyDeployerPolicy \
  --policy-document file://windy-deployer-policy.json
```

### `aws configure`

```sh
aws configure --profile windy-deployer
#   AWS Access Key ID:     <from step above>
#   AWS Secret Access Key: <from step above>
#   Default region:        us-east-1
#   Default output:        json

export AWS_PROFILE=windy-deployer      # or use --profile on every command
aws sts get-caller-identity             # Confirms you're authed as windy-deployer
```

---

## 2. Create the Terraform state backend (one-time)

```sh
aws s3api create-bucket \
  --bucket windy-terraform-state \
  --region us-east-1

aws s3api put-bucket-versioning \
  --bucket windy-terraform-state \
  --versioning-configuration Status=Enabled

aws s3api put-bucket-encryption \
  --bucket windy-terraform-state \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

aws s3api put-public-access-block \
  --bucket windy-terraform-state \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

aws dynamodb create-table \
  --table-name windy-terraform-lock \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-1
```

Then un-comment the `backend "s3"` block in `deploy/aws/account-server.tf` so state lives remotely (not on your laptop).

---

## 3. Confirm Route 53 hosted zone for windyword.ai

Terraform looks up the zone via `data.aws_route53_zone.apex`. It must exist already.

```sh
aws route53 list-hosted-zones-by-name --dns-name windyword.ai
# → If empty, create it:
aws route53 create-hosted-zone --name windyword.ai --caller-reference "$(date +%s)"
# → Note the 4 nameservers and update them at your domain registrar (Namecheap/GoDaddy/etc).
#   DNS propagation can take minutes to hours — you can continue with other steps.
```

---

## 4. Build and push the container image

```sh
REGION=us-east-1
ACCT=$(aws sts get-caller-identity --query Account --output text)
REPO=windy-account-server

aws ecr create-repository --repository-name $REPO --region $REGION || true

aws ecr get-login-password --region $REGION \
  | docker login --username AWS --password-stdin $ACCT.dkr.ecr.$REGION.amazonaws.com

cd account-server
docker build -t $REPO:v2.0.0 .
docker tag  $REPO:v2.0.0   $ACCT.dkr.ecr.$REGION.amazonaws.com/$REPO:v2.0.0
docker push $ACCT.dkr.ecr.$REGION.amazonaws.com/$REPO:v2.0.0
```

Save the full image URI — you'll pass it to Terraform.

---

## 5. Terraform init / plan / apply

```sh
cd deploy/aws

terraform init       # Downloads providers + connects to s3 backend

terraform plan -out=plan.tfplan \
  -var "container_image=$ACCT.dkr.ecr.$REGION.amazonaws.com/$REPO:v2.0.0"
#  Review output carefully. Expect ~40 resources to be created.
#  Confirm: aws_acm_certificate.api domain = api.windyword.ai
#           aws_db_instance.main = db.t4g.micro
#           aws_elasticache_cluster.main = cache.t4g.micro
#           aws_secretsmanager_secret.runtime created
#           aws_ecs_service.account_server desired_count = 2

terraform apply plan.tfplan
# RDS takes ~10 min; ACM validation ~2 min; ALB+ECS ~3 min. Be patient.
```

After apply, Terraform prints outputs:

```
api_url             = "https://api.windyword.ai"
alb_dns_name        = "windy-prod-account-server-alb-xxx.us-east-1.elb.amazonaws.com"
db_endpoint         = "windy-prod-account-server-db.xxx.us-east-1.rds.amazonaws.com:5432"
redis_endpoint      = "windy-prod-account-server-redis.xxx.cache.amazonaws.com"
runtime_secrets_arn = "arn:aws:secretsmanager:us-east-1:xxx:secret:windy-prod-account-server/runtime-xxx"
ecs_cluster_name    = "windy-prod-account-server-cluster"
ecs_service_name    = "windy-prod-account-server-svc"
```

---

## 6. Secrets in Secrets Manager

Terraform auto-generates and stores these in `<runtime_secrets_arn>` as a single JSON document:

| Key | Source | Purpose |
|---|---|---|
| `DATABASE_URL` | Terraform (RDS endpoint + password) | Postgres connection |
| `REDIS_URL` | Terraform (ElastiCache endpoint) | Redis for token blacklist / rate limits |
| `JWT_SECRET` | Terraform (`random_password` 64 chars) | HS256 fallback when RS256 not used |
| `JWT_PRIVATE_KEY` | Terraform (`tls_private_key` RSA 2048) | **P0-4**: RS256 signing key, inline PEM. `jwks.ts` parses at boot; `/.well-known/jwks.json` publishes the derived public key. Every ecosystem consumer verifies tokens via this JWKS. Without it, JWKS is empty → all tokens rejected. |
| `MFA_ENCRYPTION_KEY` | Terraform (`random_password` 64 hex chars) | AES-256-GCM key for `mfa_secrets` |
| `WINDY_MAIL_WEBHOOK_SECRET` | Terraform | HMAC secret for Windy Mail fan-out |
| `WINDY_CHAT_WEBHOOK_SECRET` | Terraform | HMAC secret for Windy Chat fan-out |
| `WINDY_CLOUD_WEBHOOK_SECRET` | Terraform | HMAC secret for Windy Cloud fan-out |
| `WINDY_CLONE_WEBHOOK_SECRET` | Terraform | HMAC secret for Windy Clone fan-out |
| `ETERNITAS_WEBHOOK_SECRET` | Terraform | HMAC secret for Eternitas fan-out |

**ECS pulls individual keys** via `valueFrom = "<arn>:<KEY>::"` — see `aws_ecs_task_definition.account_server`'s `secrets` block. They're injected as environment variables into the container at task startup. Never appear in task-def JSON or logs.

### Production hard-fails the server will throw on boot

After Wave 7 P0 hardening, the account-server **refuses to boot** in production when these are missing. Set them in the task-def `environment` array (not Secrets Manager — they're not secret):

- `TRUST_PROXY` — required so rate limiting uses the real client IP behind ALB instead of the LB's IP. Set to `"1"` for a single-LB hop, or an explicit CIDR list for multi-hop.
- `CORS_ALLOWED_ORIGINS` — required to lock down the browser origin list. Set to a comma-separated allow-list.

Example edit to `account-server.tf`:

```hcl
# aws_ecs_task_definition.account_server, container environment:
environment = [
  { name = "NODE_ENV",             value = "production" },
  { name = "PORT",                 value = "8098" },
  { name = "OIDC_ISSUER",          value = "https://${local.api_fqdn}" },
  { name = "TRUST_PROXY",          value = "1" },
  { name = "CORS_ALLOWED_ORIGINS", value = "https://windyword.ai,https://account.windyword.ai" },
]
```

Server logs the proxy trust config at boot: `[server] trust proxy = "1"`.

### Secrets Terraform does NOT generate (add manually)

These need to come from external services — add to the JSON document after `apply`:

```sh
SECRET_ARN=$(terraform -chdir=deploy/aws output -raw runtime_secrets_arn)

# Fetch current value, merge new keys, write back:
CURRENT=$(aws secretsmanager get-secret-value --secret-id $SECRET_ARN --query SecretString --output text)
UPDATED=$(echo "$CURRENT" | jq --arg resend "$RESEND_API_KEY" \
  --arg groq "$GROQ_API_KEY" \
  --arg openai "$OPENAI_API_KEY" \
  --arg stripe "$STRIPE_SECRET_KEY" \
  --arg stripe_wh "$STRIPE_WEBHOOK_SECRET" \
  --arg sentry "$SENTRY_DSN" \
  '. + {
    RESEND_API_KEY:$resend,
    GROQ_API_KEY:$groq,
    OPENAI_API_KEY:$openai,
    STRIPE_SECRET_KEY:$stripe,
    STRIPE_WEBHOOK_SECRET:$stripe_wh,
    SENTRY_DSN:$sentry
  }')
aws secretsmanager put-secret-value --secret-id $SECRET_ARN --secret-string "$UPDATED"
```

Then update `aws_ecs_task_definition.account_server`'s `secrets` array in `account-server.tf` to add each new key as a `{ name, valueFrom }` entry, and re-apply. The manual route works; the declarative route is cleaner long-term — prefer editing the Terraform.

### Propagate webhook secrets to consumer services

The 5 `*_WEBHOOK_SECRET` values live in the producer side. Each consumer (Windy Mail, Chat, Cloud, Clone, Eternitas) must have the **same** value for its matching secret — otherwise their HMAC verification will reject the webhook as a 401.

```sh
# Read the value out of Secrets Manager once, then set it in the consumer's env.
aws secretsmanager get-secret-value --secret-id $SECRET_ARN --query SecretString --output text \
  | jq -r '.WINDY_MAIL_WEBHOOK_SECRET'
#  → paste this into Windy Mail's production environment as the variable its
#    webhook route verifies against. Repeat for CHAT/CLOUD/CLONE/ETERNITAS.
```

Zero-downtime rotation is covered in `deploy/docs/webhook-env-vars.md` — rotate one consumer at a time, accept both old+new during transition.

---

## 7. DNS — Route 53 records

`api.windyword.ai` is **automatic** — Terraform creates an A-alias pointing at the ALB.

Other records you may want to add manually (Terraform doesn't manage them since they're product-specific):

| Subdomain | Target | Purpose |
|---|---|---|
| `windyword.ai` (apex) | Cloudflare Pages / S3 / wherever the marketing site is hosted | Marketing + `/device` approval page |
| `account.windyword.ai` | Same as apex OR a separate web app | Web portal (Profile, Settings, Dashboard) if hosted separately from the API |
| `api.windyword.ai` | ALB (handled by Terraform) | account-server REST + OIDC |
| `chat.windyword.ai` | Synapse / Windy Chat ALB | Matrix homeserver |
| `mail.windyword.ai` | Windy Mail ALB | Mail backend |
| `*.windyword.ai` MX | Windy Mail MX gateway | Inbound email routing (if hosting mailboxes) |

Example: point the apex at Cloudflare:

```sh
aws route53 change-resource-record-sets --hosted-zone-id $ZONE_ID \
  --change-batch '{"Changes":[{"Action":"UPSERT","ResourceRecordSet":{
    "Name":"windyword.ai","Type":"A","TTL":300,
    "ResourceRecords":[{"Value":"104.21.x.x"},{"Value":"172.67.x.x"}]
  }}]}'
```

---

## 8. Smoke tests — confirm each service is up

```sh
# 8.1  account-server health + version
curl -sSf https://api.windyword.ai/health | jq .
# Expect: {"status":"ok","service":"windy-pro-account-server","version":"2.0.0","database":"ok","uptime_seconds":...}

# 8.2  JWKS (public keys for RS256 verification)
curl -sSf https://api.windyword.ai/.well-known/jwks.json | jq .keys[0].kid
# Expect: a key ID string (means JWKS was initialized successfully)

# 8.3  OIDC discovery
curl -sSf https://api.windyword.ai/.well-known/openid-configuration | jq .issuer
# Expect: "https://api.windyword.ai"

# 8.4  Register → should succeed and return a token
TEST_EMAIL="smoke-$(date +%s)@example.com"
REG=$(curl -sSf -X POST https://api.windyword.ai/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d "{\"name\":\"Smoke Test\",\"email\":\"$TEST_EMAIL\",\"password\":\"SmokePass1\"}")
echo "$REG" | jq '{userId, windyIdentityId, tier}'
TOKEN=$(echo "$REG" | jq -r '.token')

# 8.5  Identity hub returns the new user
curl -sSf https://api.windyword.ai/api/v1/identity/me \
  -H "Authorization: Bearer $TOKEN" | jq '{identity: .identity.email, products: .products | length}'

# 8.6  Webhook deliveries — confirm fan-out fired for smoke test identity
#    Requires database access; easiest via Session Manager on the ECS task, or:
aws logs tail "/ecs/windy-prod-account-server" --since 5m --filter-pattern "webhook" --format short
# Expect lines like "[webhook-bus] 5 delivered, 0 retrying, 0 dead-lettered"
# If all 5 dead-lettered: receivers aren't reachable yet (check *_URL env vars).

# 8.7  Clean up the smoke user
curl -sSf -X DELETE https://api.windyword.ai/api/v1/auth/me \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"password":"SmokePass1"}'
```

### If /health returns `"database":"error"`

Usual causes:
- Security group `aws_security_group.rds` doesn't allow the ECS task SG on 5432 — verify in console.
- `DATABASE_URL` in Secrets Manager was set before RDS finished provisioning — re-run apply or `aws ecs update-service --force-new-deployment`.
- Postgres schema hasn't been bootstrapped — the account-server currently initializes schema in SQLite mode only; the Postgres path requires running the schema SQL in `account-server/src/db/postgres-schema.sql` manually against RDS the first time. Plan a proper migration runner before heavy prod use.

### If /health returns `"jwks":"error"`

The first ECS task that starts up is also the one that generates and persists the JWKS keypair. If two tasks race on cold start, one may win and the other may restart. Check logs for `[jwks] Generated new RSA keypair`. If it's missing, force a new deployment with just 1 task, then scale up:

```sh
aws ecs update-service --cluster $CLUSTER --service $SVC --desired-count 1
# wait for healthy
aws ecs update-service --cluster $CLUSTER --service $SVC --desired-count 2
```

---

## 9. Ongoing ops cheatsheet

```sh
# Tail the running service's logs
aws logs tail "/ecs/windy-prod-account-server" --follow

# Force redeploy (e.g. after secret change):
aws ecs update-service --cluster $CLUSTER --service $SVC --force-new-deployment

# Exec into a running task for debug
TASK=$(aws ecs list-tasks --cluster $CLUSTER --service-name $SVC --query 'taskArns[0]' --output text)
aws ecs execute-command --cluster $CLUSTER --task $TASK --container account-server --interactive --command "/bin/sh"
#   (requires ECS Exec enabled on the service — not on by default; add `enable_execute_command = true` to aws_ecs_service if you need this)

# See what's in Secrets Manager (without values — just keys):
aws secretsmanager get-secret-value --secret-id $SECRET_ARN --query SecretString --output text | jq 'keys'

# Open a psql shell against RDS via a bastion or via EC2 Session Manager in the private subnets.
# (Direct connection from outside the VPC is blocked — RDS sits in private subnets.)
```

---

## 10. Tear down (non-prod only)

```sh
cd deploy/aws
terraform destroy -var "container_image=<same image as apply>"
# Deletion protection on prod RDS will block this. Flip var.environment off prod and re-apply first.
```

NAT gateway + RDS storage incur cost even when idle. Destroy staging environments between use.
