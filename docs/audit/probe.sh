#!/bin/bash
# Phase 1 — curl every endpoint with valid/invalid/missing auth and malformed body.
# Requires account-server running at $API (default http://127.0.0.1:8098).
set -u
API="${API:-http://127.0.0.1:8098}"
OUT=/Users/thewindstorm/windy-pro/docs/audit/probe-results.txt
BIG=$(python3 -c 'print("x"*1024*1024)')   # 1MB payload for oversized-body tests

probe() {
  local label="$1" method="$2" path="$3"
  shift 3
  local start=$(python3 -c 'import time;print(int(time.time()*1000))')
  local out status
  out=$(curl -sS -o /dev/null -w '%{http_code} %{time_total}' -m 5 -X "$method" "$API$path" "$@" 2>&1)
  printf "  %-14s %-6s %-45s → %s\n" "$label" "$method" "$path" "$out"
}

{
  echo "# Probe results — $(date -u +%FT%TZ)"
  echo "# API: $API"
  echo ""

  echo "## 1. Public endpoints — expected 200"
  probe "health"         GET  /health
  probe "jwks"           GET  /.well-known/jwks.json
  probe "oidc-discovery" GET  /.well-known/openid-configuration
  probe "device-page"    GET  /device
  probe "languages"      GET  /api/v1/translate/languages
  probe "updates-check"  GET  /api/v1/updates/check
  probe "download-ver"   GET  /download/version
  echo ""

  echo "## 2. Register flow"
  EMAIL="probe-$(date +%s)@example.com"
  REG=$(curl -sS -X POST "$API/api/v1/auth/register" \
    -H 'Content-Type: application/json' \
    -d "{\"name\":\"Probe\",\"email\":\"$EMAIL\",\"password\":\"ProbePass1\"}")
  STATUS=$(echo "$REG" | python3 -c 'import sys,json;d=json.load(sys.stdin);print("token present" if d.get("token") else "no token: "+str(d.get("error","?")))' 2>/dev/null || echo "NON-JSON: $REG")
  echo "  register         → $STATUS"
  TOKEN=$(echo "$REG" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("token",""))' 2>/dev/null)
  USERID=$(echo "$REG" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("userId",""))' 2>/dev/null)
  echo ""

  echo "## 3. Auth required — missing token (expected 401)"
  probe "me-no-auth"       GET    /api/v1/auth/me
  probe "devices-no-auth"  GET    /api/v1/auth/devices
  probe "identity-no-auth" GET    /api/v1/identity/me
  probe "audit-no-auth"    GET    /api/v1/identity/audit
  probe "logout-no-auth"   POST   /api/v1/auth/logout
  probe "mfa-setup-noauth" POST   /api/v1/auth/mfa/setup
  probe "userinfo-noauth"  GET    /api/v1/oauth/userinfo
  probe "admin-users"      GET    /api/v1/admin/users
  probe "admin-cons-root"  GET    /admin/
  probe "admin-cons-users" GET    /admin/users
  echo ""

  echo "## 4. Auth required — invalid token (expected 401/403)"
  probe "me-bad-token"    GET /api/v1/auth/me      -H "Authorization: Bearer invalid.jwt.here"
  probe "me-alg-none"     GET /api/v1/auth/me      -H "Authorization: Bearer eyJhbGciOiJub25lIn0.eyJ1c2VySWQiOiJhdHRhY2tlciJ9."
  probe "me-empty"        GET /api/v1/auth/me      -H "Authorization: "
  probe "me-wrong-sch"    GET /api/v1/auth/me      -H "Authorization: Basic YWJjOmRlZg=="
  echo ""

  echo "## 5. With valid token — expected 200"
  if [ -n "$TOKEN" ]; then
    probe "me"              GET  /api/v1/auth/me      -H "Authorization: Bearer $TOKEN"
    probe "identity-me"     GET  /api/v1/identity/me  -H "Authorization: Bearer $TOKEN"
    probe "devices"         GET  /api/v1/auth/devices -H "Authorization: Bearer $TOKEN"
    probe "userinfo"        GET  /api/v1/oauth/userinfo -H "Authorization: Bearer $TOKEN"
    probe "mfa-setup"       POST /api/v1/auth/mfa/setup -H "Authorization: Bearer $TOKEN"
    probe "audit-self"      GET  /api/v1/identity/audit -H "Authorization: Bearer $TOKEN"
    probe "scopes"          GET  /api/v1/identity/scopes -H "Authorization: Bearer $TOKEN"
    probe "products"        GET  /api/v1/identity/products -H "Authorization: Bearer $TOKEN"
  else
    echo "  (SKIPPED — no token)"
  fi
  echo ""

  echo "## 6. Malformed body (expected 400/422)"
  probe "reg-bad-json"   POST /api/v1/auth/register    -H 'Content-Type: application/json' -d '{not json'
  probe "reg-empty"      POST /api/v1/auth/register    -H 'Content-Type: application/json' -d '{}'
  probe "reg-bad-email"  POST /api/v1/auth/register    -H 'Content-Type: application/json' -d '{"name":"x","email":"not-email","password":"Aa1bcdefg"}'
  probe "reg-weak-pw"    POST /api/v1/auth/register    -H 'Content-Type: application/json' -d "{\"name\":\"x\",\"email\":\"rp-$(date +%s)@x.test\",\"password\":\"weak\"}"
  probe "login-empty"    POST /api/v1/auth/login       -H 'Content-Type: application/json' -d '{}'
  probe "login-wrong-ct" POST /api/v1/auth/login       -H 'Content-Type: text/plain'       -d '{"email":"x@y.z","password":"P"}'
  probe "verify-bad"     POST /api/v1/auth/verify-email -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" -d '{"code":"not-numeric"}'
  probe "reset-no-token" POST /api/v1/auth/reset-password -H 'Content-Type: application/json' -d '{"token":"short","newPassword":"Aa1bcdefg"}'
  probe "device-bad"     POST /api/v1/oauth/device     -H 'Content-Type: application/json' -d '{}'
  probe "device-unk-cli" POST /api/v1/oauth/device     -H 'Content-Type: application/json' -d '{"client_id":"nonexistent-client","scope":"openid"}'
  echo ""

  echo "## 7. Oversized body (1 MiB, via file)"
  HUGE=$(mktemp)
  python3 -c "import json;print(json.dumps({'name':'x'*1048576,'email':'bulk@x.test','password':'Aa1bcdefg'}))" > "$HUGE"
  probe "reg-huge"       POST /api/v1/auth/register    -H 'Content-Type: application/json' --data-binary "@$HUGE"
  rm -f "$HUGE"
  echo ""

  echo "## 8. Inbound webhook — no signature (expected 401)"
  probe "eternitas-webhook-no-sig" POST /api/v1/identity/eternitas/webhook \
    -H 'Content-Type: application/json' \
    -d '{"event":"passport.registered","passportNumber":"ET-FORGED"}'
  echo ""

  echo "## 9. Forgot-password — no user (should still return 200, no oracle)"
  probe "forgot-unknown"  POST /api/v1/auth/forgot-password -H 'Content-Type: application/json' -d '{"email":"nobody-here@never.test"}'
  probe "reset-garbage"   POST /api/v1/auth/reset-password  -H 'Content-Type: application/json' -d '{"token":"'"$(python3 -c 'print("x"*40)')"'","newPassword":"SecurePass1"}'
  echo ""

  echo "## 10. /device approval form"
  probe "device-html"     GET  /device
  probe "device-prefill"  GET  "/device?user_code=TEST-1234"
  probe "device-denied-form" POST /device/approve -H 'Content-Type: application/x-www-form-urlencoded' -d 'user_code=AAAA-BBBB&email=nobody@x.test&password=wrong&action=approve'
  echo ""

  echo "## 11. CORS preflight"
  probe "cors-preflight"  OPTIONS /api/v1/auth/login \
    -H 'Origin: https://evil.example' \
    -H 'Access-Control-Request-Method: POST' \
    -H 'Access-Control-Request-Headers: Content-Type'
  echo ""

  echo "## 12. Unknown route"
  probe "nonexistent"     GET /api/v1/does/not/exist
  probe "api-catchall"    GET /api/totally/unknown
  echo ""

  # Cleanup
  if [ -n "$TOKEN" ]; then
    curl -sS -o /dev/null -X DELETE "$API/api/v1/auth/me" \
      -H "Authorization: Bearer $TOKEN" \
      -H 'Content-Type: application/json' \
      -d '{"password":"ProbePass1"}'
  fi
} > "$OUT" 2>&1

wc -l "$OUT"
echo "written → $OUT"
