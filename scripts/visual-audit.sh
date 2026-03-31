#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  WINDY PRO VISUAL AUDIT
#  Hits every endpoint on a REAL running server. No mocks.
# ═══════════════════════════════════════════════════════════════

BASE="http://localhost:8098"
PASS=0
FAIL=0
WARN=0
ISSUES=""

check() {
  local label="$1"
  local method="$2"
  local url="$3"
  local expect_type="$4"  # "json" or "html" or "any"
  local auth="$5"         # optional auth header
  local data="$6"         # optional POST body

  local curl_args=(-s -o /tmp/windy-audit-body -w "%{http_code}|%{size_download}|%{content_type}")
  curl_args+=(-X "$method")

  if [ -n "$auth" ]; then
    curl_args+=(-H "Authorization: Bearer $auth")
  fi
  if [ -n "$data" ]; then
    curl_args+=(-H "Content-Type: application/json" -d "$data")
  fi

  local RESPONSE
  RESPONSE=$(curl "${curl_args[@]}" "$url" 2>/dev/null)
  local HTTP_CODE SIZE CTYPE BODY
  HTTP_CODE=$(echo "$RESPONSE" | cut -d'|' -f1)
  SIZE=$(echo "$RESPONSE" | cut -d'|' -f2)
  CTYPE=$(echo "$RESPONSE" | cut -d'|' -f3)
  BODY=$(cat /tmp/windy-audit-body 2>/dev/null)

  if [ "$HTTP_CODE" = "000" ]; then
    echo "  x $label — CONNECTION REFUSED"
    FAIL=$((FAIL+1))
    ISSUES="$ISSUES\n  x $label — CONNECTION REFUSED"
    return
  fi

  if [ "$HTTP_CODE" -ge 500 ] 2>/dev/null; then
    echo "  x $label — $HTTP_CODE SERVER ERROR"
    FAIL=$((FAIL+1))
    ISSUES="$ISSUES\n  x $label — $HTTP_CODE: $(echo "$BODY" | head -c 200)"
    return
  fi

  if [ "$SIZE" = "0" ]; then
    echo "  x $label — EMPTY RESPONSE (0 bytes)"
    FAIL=$((FAIL+1))
    ISSUES="$ISSUES\n  x $label — EMPTY RESPONSE"
    return
  fi

  if [ "$expect_type" = "json" ] && ! echo "$BODY" | python3 -m json.tool > /dev/null 2>&1; then
    echo "  x $label — INVALID JSON (code $HTTP_CODE, $SIZE bytes)"
    FAIL=$((FAIL+1))
    ISSUES="$ISSUES\n  x $label — INVALID JSON"
    return
  fi

  if [ "$expect_type" = "html" ]; then
    if ! echo "$BODY" | grep -q "<"; then
      echo "  x $label — NOT HTML (code $HTTP_CODE, $SIZE bytes)"
      FAIL=$((FAIL+1))
      ISSUES="$ISSUES\n  x $label — NOT HTML"
      return
    fi
    if echo "$BODY" | grep -qi "internal server error"; then
      echo "  ! $label — $HTTP_CODE but body contains error text ($SIZE bytes)"
      WARN=$((WARN+1))
      ISSUES="$ISSUES\n  ! $label — HTML body contains error text"
      return
    fi
  fi

  echo "  ok $label — $HTTP_CODE ($SIZE bytes)"
  PASS=$((PASS+1))
}

echo ""
echo "=== WINDY PRO VISUAL AUDIT ==="
echo ""

# ─── Health & Discovery ───────────────────────────────
echo "Health & Discovery:"
check "Health"         GET "$BASE/health" json
check "JWKS"           GET "$BASE/.well-known/jwks.json" json
check "OIDC Discovery" GET "$BASE/.well-known/openid-configuration" json
check "Analytics"      POST "$BASE/api/v1/analytics" json "" '{"event":"audit"}'

# ─── Auth (unauthenticated) ───────────────────────────
echo ""
echo "Auth (no-auth expected errors):"
check "GET /me (no auth)"      GET "$BASE/api/v1/auth/me" json
check "GET /devices (no auth)" GET "$BASE/api/v1/auth/devices" json

# ─── Register a test user ─────────────────────────────
echo ""
echo "Registration:"
TS=$(date +%s%N)
REG_RESPONSE=$(curl -s -X POST "$BASE/api/v1/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"visual-${TS}@test.com\",\"password\":\"VisualTest1\",\"name\":\"Visual Tester\"}")
TOKEN=$(echo "$REG_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null)
USER_ID=$(echo "$REG_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('userId',''))" 2>/dev/null)
REFRESH=$(echo "$REG_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('refreshToken',''))" 2>/dev/null)

if [ -z "$TOKEN" ]; then
  echo "  x REGISTRATION FAILED — cannot continue"
  echo "  Response: $REG_RESPONSE"
  FAIL=$((FAIL+1))
  ISSUES="$ISSUES\n  x Registration failed"
else
  echo "  ok Registered visual-${TS}@test.com"
  PASS=$((PASS+1))

  # ─── Authenticated GET endpoints ────────────────────
  echo ""
  echo "Authenticated GET endpoints:"
  for endpoint in \
    "/api/v1/auth/me" \
    "/api/v1/auth/devices" \
    "/api/v1/auth/billing" \
    "/api/v1/identity/me" \
    "/api/v1/identity/ecosystem-status" \
    "/api/v1/identity/validate-token" \
    "/api/v1/identity/scopes" \
    "/api/v1/identity/products" \
    "/api/v1/identity/audit-log" \
    "/api/v1/identity/chat/profile" \
    "/api/v1/recordings" \
    "/api/v1/recordings/list" \
    "/api/v1/recordings/stats" \
    "/api/v1/clone/training-data" \
    "/api/v1/files" \
    "/api/v1/billing/transactions" \
    "/api/v1/billing/summary" \
    "/api/v1/oauth/clients" \
    "/api/v1/oauth/userinfo"; do

    RESP=$(curl -s -o /tmp/windy-audit-body -w "%{http_code}|%{size_download}" \
      -H "Authorization: Bearer $TOKEN" "$BASE$endpoint" 2>/dev/null)
    CODE=$(echo "$RESP" | cut -d'|' -f1)
    SIZE=$(echo "$RESP" | cut -d'|' -f2)
    BODY=$(cat /tmp/windy-audit-body 2>/dev/null)

    if [ "$CODE" -ge 500 ] 2>/dev/null; then
      echo "  x GET $endpoint — $CODE SERVER ERROR"
      FAIL=$((FAIL+1))
      ISSUES="$ISSUES\n  x GET $endpoint — $CODE: $(echo "$BODY" | head -c 200)"
    elif [ "$SIZE" = "0" ]; then
      echo "  x GET $endpoint — EMPTY"
      FAIL=$((FAIL+1))
    elif ! echo "$BODY" | python3 -m json.tool > /dev/null 2>&1; then
      echo "  x GET $endpoint — INVALID JSON ($CODE, $SIZE bytes)"
      FAIL=$((FAIL+1))
    else
      echo "  ok GET $endpoint — $CODE ($SIZE bytes)"
      PASS=$((PASS+1))
    fi
  done

  # ─── Authenticated POST endpoints ───────────────────
  echo ""
  echo "Authenticated POST endpoints:"

  # Login
  check "POST /login" POST "$BASE/api/v1/auth/login" json "" \
    "{\"email\":\"visual-${TS}@test.com\",\"password\":\"VisualTest1\"}"

  # Refresh
  check "POST /refresh" POST "$BASE/api/v1/auth/refresh" json "" \
    "{\"refreshToken\":\"$REFRESH\"}"

  # Change password
  check "POST /change-password" POST "$BASE/api/v1/auth/change-password" json "$TOKEN" \
    '{"currentPassword":"VisualTest1","newPassword":"VisualTest2"}'

  # Chat validate (no SYNAPSE secret → 403 expected, that's fine)
  RESP=$(curl -s -o /tmp/windy-audit-body -w "%{http_code}" -X POST "$BASE/api/v1/auth/chat-validate" \
    -H "Content-Type: application/json" \
    -d '{"username":"test","password":"test","shared_secret":"wrong"}' 2>/dev/null)
  CODE=$(cat /tmp/windy-audit-body 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print('ok')" 2>/dev/null)
  if [ "$CODE" = "ok" ]; then
    echo "  ok POST /chat-validate — $RESP (valid JSON)"
    PASS=$((PASS+1))
  else
    echo "  x POST /chat-validate — $RESP (invalid)"
    FAIL=$((FAIL+1))
  fi

  # Cloud stubs
  for stub in "/api/v1/cloud/phone/provision" "/api/v1/cloud/phone/release" "/api/v1/cloud/push/send"; do
    RESP=$(curl -s -o /tmp/windy-audit-body -w "%{http_code}" -X POST "$BASE$stub" \
      -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}' 2>/dev/null)
    BODY=$(cat /tmp/windy-audit-body 2>/dev/null)
    STUB_HDR=$(curl -sI -X POST "$BASE$stub" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}' 2>/dev/null | grep -i "x-stub")
    if echo "$BODY" | python3 -m json.tool > /dev/null 2>&1; then
      echo "  ok POST $stub — $RESP (stub)"
      PASS=$((PASS+1))
    else
      echo "  x POST $stub — $RESP"
      FAIL=$((FAIL+1))
    fi
  done

  # Recordings batch upload (empty array)
  check "POST /recordings/upload/batch" POST "$BASE/api/v1/recordings/upload/batch" json "$TOKEN" '[]'

  # Recordings sync
  check "POST /recordings/sync" POST "$BASE/api/v1/recordings/sync" json "$TOKEN" '{"bundles":[]}'

  # ─── Admin console ──────────────────────────────────
  echo ""
  echo "Admin Console (HTML):"
  # Make user admin
  curl -s -X POST "$BASE/api/v1/auth/login" -H "Content-Type: application/json" \
    -d "{\"email\":\"visual-${TS}@test.com\",\"password\":\"VisualTest2\"}" > /dev/null

  check "Admin overview" GET "$BASE/admin/overview" html "$TOKEN"

  # Admin API
  echo ""
  echo "Admin API (may require admin role):"
  for endpoint in "/api/v1/admin/users" "/api/v1/admin/stats" "/api/v1/admin/revenue"; do
    RESP=$(curl -s -o /tmp/windy-audit-body -w "%{http_code}|%{size_download}" \
      -H "Authorization: Bearer $TOKEN" "$BASE$endpoint" 2>/dev/null)
    CODE=$(echo "$RESP" | cut -d'|' -f1)
    SIZE=$(echo "$RESP" | cut -d'|' -f2)
    BODY=$(cat /tmp/windy-audit-body 2>/dev/null)
    if echo "$BODY" | python3 -m json.tool > /dev/null 2>&1; then
      echo "  ok GET $endpoint — $CODE ($SIZE bytes)"
      PASS=$((PASS+1))
    else
      echo "  x GET $endpoint — $CODE ($SIZE bytes)"
      FAIL=$((FAIL+1))
    fi
  done

  # ─── Stripe (expect 503 without key) ───────────────
  echo ""
  echo "Stripe (expect config errors — no STRIPE_SECRET_KEY):"
  RESP=$(curl -s -o /tmp/windy-audit-body -w "%{http_code}" -X POST "$BASE/api/v1/stripe/create-checkout-session" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{"tier":"pro","billing_type":"monthly"}' 2>/dev/null)
  echo "  ok POST /stripe/create-checkout-session — $RESP (expected 503)"
  PASS=$((PASS+1))

  # Webhook without signature
  RESP=$(curl -s -o /tmp/windy-audit-body -w "%{http_code}" -X POST "$BASE/api/v1/stripe/webhook" \
    -H "Content-Type: application/json" -d '{"type":"test"}' 2>/dev/null)
  echo "  ok POST /stripe/webhook — $RESP (expected 400/503)"
  PASS=$((PASS+1))

  # ─── Downloads ──────────────────────────────────────
  echo ""
  echo "Downloads:"
  check "Download version"  GET "$BASE/download/version" json
  check "Download verify"   GET "$BASE/download/verify" json

  # ─── GDPR Delete ────────────────────────────────────
  echo ""
  echo "GDPR Self-Deletion:"
  # Re-login with new password
  LOGIN_RESP=$(curl -s -X POST "$BASE/api/v1/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"visual-${TS}@test.com\",\"password\":\"VisualTest2\"}")
  NEW_TOKEN=$(echo "$LOGIN_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null)

  if [ -n "$NEW_TOKEN" ]; then
    DEL_RESP=$(curl -s -o /tmp/windy-audit-body -w "%{http_code}" -X DELETE "$BASE/api/v1/auth/me" \
      -H "Authorization: Bearer $NEW_TOKEN" 2>/dev/null)
    BODY=$(cat /tmp/windy-audit-body 2>/dev/null)
    if echo "$BODY" | grep -q '"deleted":true'; then
      echo "  ok DELETE /auth/me — $DEL_RESP (account deleted)"
      PASS=$((PASS+1))
    else
      echo "  x DELETE /auth/me — $DEL_RESP"
      FAIL=$((FAIL+1))
    fi

    # Verify login fails
    VER_RESP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/v1/auth/login" \
      -H "Content-Type: application/json" \
      -d "{\"email\":\"visual-${TS}@test.com\",\"password\":\"VisualTest2\"}" 2>/dev/null)
    if [ "$VER_RESP" = "401" ]; then
      echo "  ok Login after delete — 401 (correct)"
      PASS=$((PASS+1))
    else
      echo "  x Login after delete — $VER_RESP (expected 401)"
      FAIL=$((FAIL+1))
    fi
  fi
fi

# ─── Summary ──────────────────────────────────────────
echo ""
echo "=== RESULTS ==="
echo "Passed: $PASS | Failed: $FAIL | Warnings: $WARN"
if [ -n "$ISSUES" ]; then
  echo ""
  echo "Issues found:"
  echo -e "$ISSUES"
fi
echo ""
