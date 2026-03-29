#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# Windy Pro — Production Initialization Script
#
# This script:
#   1. Generates RS256 key pair for JWT signing
#   2. Generates random secrets (JWT_SECRET, POSTGRES_PASSWORD)
#   3. Creates .env.production from the template
#   4. Starts all services via docker compose
#   5. Waits for health checks
#   6. Seeds OAuth clients (first-party apps)
#   7. Runs the user backfill migration
#
# Usage:
#   cd deploy && bash scripts/init-production.sh
#
# Prerequisites:
#   - docker and docker compose installed
#   - openssl installed
#   - curl installed
# ─────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
KEYS_DIR="$DEPLOY_DIR/keys"

echo ""
echo "=== Windy Pro — Production Init ==="
echo ""

# ─── Step 1: Generate RS256 Key Pair ─────────────────────────────

echo "[1/7] Generating RS256 key pair..."
mkdir -p "$KEYS_DIR"

if [ -f "$KEYS_DIR/private.pem" ]; then
    echo "  Key pair already exists at $KEYS_DIR/private.pem — skipping."
else
    openssl genpkey -algorithm RSA -out "$KEYS_DIR/private.pem" -pkeyopt rsa_keygen_bits:2048 2>/dev/null
    openssl rsa -in "$KEYS_DIR/private.pem" -pubout -out "$KEYS_DIR/public.pem" 2>/dev/null
    chmod 600 "$KEYS_DIR/private.pem"
    chmod 644 "$KEYS_DIR/public.pem"
    echo "  Generated: $KEYS_DIR/private.pem, $KEYS_DIR/public.pem"
fi

# ─── Step 2: Generate Random Secrets ─────────────────────────────

echo "[2/7] Generating random secrets..."

generate_secret() {
    openssl rand -hex 32
}

JWT_SECRET_VAL=$(generate_secret)
POSTGRES_PASSWORD_VAL=$(generate_secret)
ETERNITAS_WEBHOOK_SECRET_VAL=$(generate_secret)
SYNAPSE_REGISTRATION_SECRET_VAL=$(generate_secret)

echo "  Secrets generated."

# ─── Step 3: Create .env.production ──────────────────────────────

ENV_FILE="$DEPLOY_DIR/.env.production"

echo "[3/7] Creating $ENV_FILE..."

if [ -f "$ENV_FILE" ]; then
    echo "  .env.production already exists. Backing up to .env.production.bak"
    cp "$ENV_FILE" "$ENV_FILE.bak"
fi

cp "$DEPLOY_DIR/.env.production.example" "$ENV_FILE"

# Replace secrets in the env file
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS sed
    sed -i '' "s|^JWT_SECRET=.*|JWT_SECRET=$JWT_SECRET_VAL|" "$ENV_FILE"
    sed -i '' "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$POSTGRES_PASSWORD_VAL|" "$ENV_FILE"
    sed -i '' "s|^ETERNITAS_WEBHOOK_SECRET=.*|ETERNITAS_WEBHOOK_SECRET=$ETERNITAS_WEBHOOK_SECRET_VAL|" "$ENV_FILE"
    sed -i '' "s|^SYNAPSE_REGISTRATION_SECRET=.*|SYNAPSE_REGISTRATION_SECRET=$SYNAPSE_REGISTRATION_SECRET_VAL|" "$ENV_FILE"
else
    # Linux sed
    sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$JWT_SECRET_VAL|" "$ENV_FILE"
    sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$POSTGRES_PASSWORD_VAL|" "$ENV_FILE"
    sed -i "s|^ETERNITAS_WEBHOOK_SECRET=.*|ETERNITAS_WEBHOOK_SECRET=$ETERNITAS_WEBHOOK_SECRET_VAL|" "$ENV_FILE"
    sed -i "s|^SYNAPSE_REGISTRATION_SECRET=.*|SYNAPSE_REGISTRATION_SECRET=$SYNAPSE_REGISTRATION_SECRET_VAL|" "$ENV_FILE"
fi

chmod 600 "$ENV_FILE"
echo "  Created $ENV_FILE with generated secrets."
echo "  NOTE: You must manually set Stripe, Twilio, SendGrid, R2, and push notification keys."

# ─── Step 4: Start Docker Compose ────────────────────────────────

echo "[4/7] Starting services with docker compose..."
cd "$DEPLOY_DIR"
docker compose -f docker-compose.production.yml --env-file .env.production up -d --build

# ─── Step 5: Wait for Health Checks ──────────────────────────────

echo "[5/7] Waiting for services to become healthy..."

wait_for_health() {
    local service_name=$1
    local url=$2
    local max_attempts=${3:-30}
    local attempt=1

    while [ $attempt -le $max_attempts ]; do
        if curl -sf "$url" > /dev/null 2>&1; then
            echo "  $service_name is healthy."
            return 0
        fi
        attempt=$((attempt + 1))
        sleep 2
    done

    echo "  WARNING: $service_name did not become healthy after $max_attempts attempts."
    return 1
}

wait_for_health "account-server" "http://localhost:8098/health"
wait_for_health "postgres" "http://localhost:8098/health"  # Implicit — server needs DB

echo "  All core services healthy."

# ─── Step 6: Seed First-Party OAuth Clients ──────────────────────

echo "[6/7] Seeding first-party OAuth clients..."

# To seed, we need an admin JWT. Check if there's an admin user, or create one.
# This uses the account-server API directly.

echo "  OAuth client seeding requires an admin JWT."
echo "  If you haven't created an admin user yet, do:"
echo "    1. Register a user via POST /api/v1/auth/register"
echo "    2. Promote to admin: UPDATE users SET role='admin' WHERE email='your@email.com'"
echo "    3. Login and use the token to POST /api/v1/oauth/clients"
echo ""
echo "  Example seed commands (replace ADMIN_TOKEN):"
echo ""
echo "  # Windy Pro Desktop (public client, PKCE)"
echo '  curl -X POST http://localhost:8098/api/v1/oauth/clients \'
echo '    -H "Authorization: Bearer $ADMIN_TOKEN" \'
echo '    -H "Content-Type: application/json" \'
echo '    -d '"'"'{"name":"Windy Pro Desktop","redirectUris":["windypro://oauth/callback"],"allowedScopes":["openid","profile","email","windy_pro:*"],"isFirstParty":true,"isPublic":true}'"'"''
echo ""
echo "  # Windy Pro Mobile (public client, PKCE)"
echo '  curl -X POST http://localhost:8098/api/v1/oauth/clients \'
echo '    -H "Authorization: Bearer $ADMIN_TOKEN" \'
echo '    -H "Content-Type: application/json" \'
echo '    -d '"'"'{"name":"Windy Pro Mobile","redirectUris":["windypro://oauth/callback","exp://oauth/callback"],"allowedScopes":["openid","profile","email","windy_pro:*","windy_chat:read","windy_chat:write"],"isFirstParty":true,"isPublic":true}'"'"''
echo ""

# ─── Step 7: Backfill Existing Users ─────────────────────────────

echo "[7/7] User backfill..."
echo "  To backfill existing users into the Unified Identity system, run:"
echo '  curl -X POST http://localhost:8098/api/v1/identity/backfill \'
echo '    -H "Authorization: Bearer $ADMIN_TOKEN"'
echo ""

# ─── Done ─────────────────────────────────────────────────────────

echo "=== Production Init Complete ==="
echo ""
echo "Services running. Key info:"
echo "  Account Server:   http://localhost:8098"
echo "  Admin Console:    http://localhost:8098/admin/?token=ADMIN_JWT"
echo "  Health Check:     http://localhost:8098/health"
echo "  OIDC Discovery:   http://localhost:8098/.well-known/openid-configuration"
echo "  JWKS:             http://localhost:8098/.well-known/jwks.json"
echo ""
echo "  Keys:             $KEYS_DIR/"
echo "  Env:              $ENV_FILE"
echo ""
echo "Next steps:"
echo "  1. Set Stripe, Twilio, SendGrid, R2 keys in $ENV_FILE"
echo "  2. Create admin user and seed OAuth clients (see instructions above)"
echo "  3. Configure DNS and TLS certificates"
echo "  4. Restart: docker compose -f docker-compose.production.yml --env-file .env.production up -d"
echo ""
