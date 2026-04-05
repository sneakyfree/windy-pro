#!/bin/bash
# Generate RS256 key pair for JWT signing (JWKS)
# Keys are saved to account-server/keys/

set -euo pipefail

KEYS_DIR="$(cd "$(dirname "$0")/../account-server/keys" 2>/dev/null || echo "$(dirname "$0")/../account-server/keys"; pwd -P 2>/dev/null || echo "$(dirname "$0")/../account-server/keys")"
KEYS_DIR="$(dirname "$0")/../account-server/keys"
KEYS_DIR="$(cd "$(dirname "$0")/.."; pwd)/account-server/keys"

echo "Generating RS256 key pair..."
mkdir -p "$KEYS_DIR"

# Generate 2048-bit RSA private key
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$KEYS_DIR/private.pem" 2>/dev/null

# Derive public key
openssl pkey -in "$KEYS_DIR/private.pem" -pubout -out "$KEYS_DIR/public.pem" 2>/dev/null

# Restrict private key permissions
chmod 600 "$KEYS_DIR/private.pem"
chmod 644 "$KEYS_DIR/public.pem"

echo "Keys generated:"
echo "  Private: $KEYS_DIR/private.pem (600)"
echo "  Public:  $KEYS_DIR/public.pem  (644)"
echo ""
echo "Set in account-server/.env:"
echo "  JWKS_KEY_DIR=./keys"
echo "  — OR —"
echo "  JWT_PRIVATE_KEY_PATH=./keys/private.pem"
