#!/usr/bin/env bash
# ═══════════════════════════════════════════════════
# Windy Ecosystem Integration Test
# ═══════════════════════════════════════════════════
#
# Tests the full user journey: registration → auth → provisioning → dashboard
#
# Usage:
#   ./scripts/test-ecosystem.sh                    # default: http://localhost:8098
#   ./scripts/test-ecosystem.sh https://windyword.ai  # test against production
#
set -euo pipefail

BASE_URL="${1:-http://localhost:8098}"
PASS=0
FAIL=0
TOKEN=""
TEST_EMAIL="test-$(date +%s)-${RANDOM}@example.com"
TEST_PASSWORD="TestPass123!"

check() {
    local name="$1"
    shift
    if "$@" > /dev/null 2>&1; then
        echo "  ✅ $name"
        ((PASS++))
    else
        echo "  ❌ $name"
        ((FAIL++))
    fi
}

echo ""
echo "🧪 Windy Ecosystem Integration Test"
echo "   Target: $BASE_URL"
echo "   Test user: $TEST_EMAIL"
echo ""

# ── 1. Health Checks ──────────────────────────────
echo "── Health Checks ──"
check "Account server /health" curl -sf "$BASE_URL/health"
check "JWKS endpoint" curl -sf "$BASE_URL/.well-known/jwks.json"

HEALTH=$(curl -sf "$BASE_URL/health" 2>/dev/null || echo "{}")
echo "   Health: $HEALTH" | head -c 200
echo ""

# ── 2. User Registration ─────────────────────────
echo ""
echo "── User Registration ──"
REGISTER=$(curl -sf -X POST "$BASE_URL/api/v1/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\",\"name\":\"Integration Test\"}" \
    2>/dev/null || echo "{}")

TOKEN=$(echo "$REGISTER" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null || echo "")
check "Register returns JWT" [ -n "$TOKEN" ]

if [ -z "$TOKEN" ]; then
    echo "   ⚠️  Registration failed — trying login instead"
    LOGIN=$(curl -sf -X POST "$BASE_URL/api/v1/auth/login" \
        -H "Content-Type: application/json" \
        -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}" \
        2>/dev/null || echo "{}")
    TOKEN=$(echo "$LOGIN" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null || echo "")
fi

if [ -z "$TOKEN" ]; then
    echo "   ⛔ Cannot proceed without auth token"
    echo ""
    echo "══════════════════════════════"
    echo "  Results: $PASS passed, $FAIL failed"
    echo "══════════════════════════════"
    exit 1
fi

# ── 3. Auth Verification ─────────────────────────
echo ""
echo "── Auth Verification ──"
check "GET /auth/me with JWT" curl -sf -H "Authorization: Bearer $TOKEN" "$BASE_URL/api/v1/auth/me"
check "GET /identity/me" curl -sf -H "Authorization: Bearer $TOKEN" "$BASE_URL/api/v1/identity/me"
check "Token validation endpoint" curl -sf -H "Authorization: Bearer $TOKEN" "$BASE_URL/api/v1/identity/validate-token"

# ── 4. Ecosystem Provisioning ────────────────────
echo ""
echo "── Ecosystem Provisioning ──"
PROVISION=$(curl -s -X POST "$BASE_URL/api/v1/identity/ecosystem/provision-all" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"display_name":"Integration Test"}' \
    2>/dev/null || echo "{}")
echo "   Provision result: $(echo "$PROVISION" | head -c 300)"
echo ""
check "Provision-all returns 200" curl -sf -X POST "$BASE_URL/api/v1/identity/ecosystem/provision-all" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"display_name":"Integration Test"}'

# ── 5. Ecosystem Status ──────────────────────────
echo ""
echo "── Ecosystem Status ──"
STATUS=$(curl -sf -H "Authorization: Bearer $TOKEN" "$BASE_URL/api/v1/identity/ecosystem-status" 2>/dev/null || echo "{}")
echo "   Status: $(echo "$STATUS" | head -c 400)"
echo ""
check "Ecosystem status returns products" echo "$STATUS" | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'products' in d" 2>/dev/null

# ── 6. Recordings API ────────────────────────────
echo ""
echo "── Recordings API ──"
check "GET /recordings" curl -sf -H "Authorization: Bearer $TOKEN" "$BASE_URL/api/v1/recordings"
check "GET /recordings/stats" curl -sf -H "Authorization: Bearer $TOKEN" "$BASE_URL/api/v1/recordings/stats"

# ── 7. Web Dashboard ─────────────────────────────
echo ""
echo "── Web Dashboard ──"
DASH_CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/dashboard" 2>/dev/null || echo "000")
check "Dashboard returns 200 (SPA)" [ "$DASH_CODE" = "200" ]
check "Auth page loads" curl -sf "$BASE_URL/auth" -o /dev/null

# ── 8. Cleanup (delete test user) ────────────────
echo ""
echo "── Cleanup ──"
DEL_RESULT=$(curl -s -X DELETE "$BASE_URL/api/v1/auth/me" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"password\":\"$TEST_PASSWORD\"}" \
    2>/dev/null || echo "{}")
check "Delete test account" echo "$DEL_RESULT" | grep -q "deleted\|success" 2>/dev/null

# ── Results ──────────────────────────────────────
echo ""
echo "══════════════════════════════"
echo "  Results: $PASS passed, $FAIL failed"
echo "══════════════════════════════"

[ "$FAIL" -eq 0 ] && exit 0 || exit 1
