#!/usr/bin/env bash
# smoke-test.sh — post-deploy smoke test for a running Windy Pro instance.
#
# Usage:
#   BASE_URL=https://windypro.com ./scripts/smoke-test.sh
#   BASE_URL=http://localhost:8098 ./scripts/smoke-test.sh   # dev
#
# Exits 0 if every check passes, non-zero on first failure. Each check
# prints PASS / FAIL with elapsed time so CI logs stay readable. The
# script aborts on the first failure (set -e) because every later check
# depends on the JWT from /login working — continuing would just cascade
# failures.
#
# What it asserts:
#   1. GET /healthz                         → 200, status=ok
#   2. GET /.well-known/jwks.json           → JWKS with ≥1 key
#   3. GET /.well-known/openid-configuration → valid OIDC metadata
#   4. POST /api/v1/auth/register           → creates a fresh test user
#   5. POST /api/v1/auth/login              → returns a usable JWT
#   6. POST /api/v1/agent/hatch             → SSE stream terminates with hatch.complete
#
# Dependencies: bash ≥ 4, curl, jq. Missing jq fails fast — parsing
# JSON with grep+sed is how production bugs get masked.
#
# This is read-only against ecosystem sister services (it catches
# hatch-flow regressions in Pro without requiring Mail/Chat/Cloud/
# Eternitas to be reachable — the ceremony will emit their `.failed`
# frames if they're down, but `hatch.complete` still fires).

set -euo pipefail

# ─── Config ────────────────────────────────────────────────────
BASE_URL="${BASE_URL:-http://localhost:8098}"
# Strip trailing slash so path concatenation stays clean.
BASE_URL="${BASE_URL%/}"
TEST_EMAIL="${TEST_EMAIL:-smoke-$(date +%s)-$RANDOM@smoke.windypro.test}"
TEST_PASSWORD="${TEST_PASSWORD:-Sm0ke-Pass-$(date +%s)!}"
TEST_NAME="${TEST_NAME:-Smoke Tester}"

# Color helpers — stay off in non-TTY / CI.
if [[ -t 1 ]]; then
    C_GREEN=$'\033[0;32m'; C_RED=$'\033[0;31m'; C_YELLOW=$'\033[0;33m'
    C_DIM=$'\033[2m';       C_RESET=$'\033[0m'
else
    C_GREEN=''; C_RED=''; C_YELLOW=''; C_DIM=''; C_RESET=''
fi

pass() { printf "  %sPASS%s %s %s(%.2fs)%s\n" "$C_GREEN" "$C_RESET" "$1" "$C_DIM" "$2" "$C_RESET"; }
fail() { printf "  %sFAIL%s %s — %s\n" "$C_RED" "$C_RESET" "$1" "$2" >&2; exit 1; }
info() { printf "  %s»%s %s\n" "$C_YELLOW" "$C_RESET" "$1"; }

# elapsed — run a command, capture body + http_status + timing.
# Populates globals RESP_BODY, RESP_STATUS, RESP_DUR.
RESP_BODY=''; RESP_STATUS=''; RESP_DUR=0
do_request() {
    local start end
    start=$(date +%s.%N)
    # Write body to a temp file, status to a var. Keeps large responses
    # off the arg list.
    local tmpfile
    tmpfile=$(mktemp)
    RESP_STATUS=$(curl -sS -o "$tmpfile" -w "%{http_code}" "$@") || true
    RESP_BODY=$(cat "$tmpfile")
    rm -f "$tmpfile"
    end=$(date +%s.%N)
    RESP_DUR=$(awk "BEGIN {print $end - $start}")
}

# Precheck — jq present?
if ! command -v jq >/dev/null 2>&1; then
    printf "jq is required (sudo apt install jq). Aborting.\n" >&2
    exit 2
fi

printf "\n%sWindy Pro smoke test%s  —  %s\n\n" "$C_GREEN" "$C_RESET" "$BASE_URL"

# ─── 1. /healthz ────────────────────────────────────────────────
info "GET /healthz"
do_request "$BASE_URL/healthz"
if [[ "$RESP_STATUS" != "200" ]]; then
    fail "/healthz" "expected 200, got $RESP_STATUS"
fi
if ! echo "$RESP_BODY" | jq -e '.status' >/dev/null 2>&1; then
    fail "/healthz" "response is not JSON with .status field"
fi
HEALTH_STATUS=$(echo "$RESP_BODY" | jq -r '.status')
if [[ "$HEALTH_STATUS" != "ok" && "$HEALTH_STATUS" != "healthy" ]]; then
    fail "/healthz" "status=$HEALTH_STATUS (expected ok)"
fi
pass "/healthz returns 200 + status=ok" "$RESP_DUR"

# ─── 2. /.well-known/jwks.json ─────────────────────────────────
info "GET /.well-known/jwks.json"
do_request "$BASE_URL/.well-known/jwks.json"
if [[ "$RESP_STATUS" != "200" ]]; then
    fail "/.well-known/jwks.json" "expected 200, got $RESP_STATUS"
fi
KEY_COUNT=$(echo "$RESP_BODY" | jq '.keys | length' 2>/dev/null || echo 0)
if [[ "$KEY_COUNT" -lt 1 ]]; then
    fail "/.well-known/jwks.json" "expected ≥1 key, got $KEY_COUNT"
fi
# RS256 key should have kty=RSA with a kid.
if ! echo "$RESP_BODY" | jq -e '.keys[] | select(.kty == "RSA") | .kid' >/dev/null 2>&1; then
    info "(no RSA key present — server is running in HS256 fallback)"
fi
pass "/.well-known/jwks.json returns $KEY_COUNT key(s)" "$RESP_DUR"

# ─── 3. /.well-known/openid-configuration ──────────────────────
info "GET /.well-known/openid-configuration"
do_request "$BASE_URL/.well-known/openid-configuration"
if [[ "$RESP_STATUS" != "200" ]]; then
    fail "OIDC metadata" "expected 200, got $RESP_STATUS"
fi
for field in issuer authorization_endpoint token_endpoint jwks_uri; do
    if ! echo "$RESP_BODY" | jq -e ".${field}" >/dev/null 2>&1; then
        fail "OIDC metadata" "missing required field: $field"
    fi
done
ISSUER=$(echo "$RESP_BODY" | jq -r '.issuer')
pass "OIDC metadata valid (issuer=$ISSUER)" "$RESP_DUR"

# ─── 4. Signup ─────────────────────────────────────────────────
info "POST /api/v1/auth/register  (email=$TEST_EMAIL)"
do_request -X POST "$BASE_URL/api/v1/auth/register" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg e "$TEST_EMAIL" --arg p "$TEST_PASSWORD" --arg n "$TEST_NAME" \
        '{email:$e, password:$p, name:$n}')"
# 200 or 201 are both fine (201 is the spec-correct status, 200 is what
# the current handler returns — don't pin a specific code).
if [[ "$RESP_STATUS" != "200" && "$RESP_STATUS" != "201" ]]; then
    fail "register" "expected 200/201, got $RESP_STATUS — body: $RESP_BODY"
fi
pass "register accepts a fresh test user" "$RESP_DUR"

# ─── 5. Login ──────────────────────────────────────────────────
info "POST /api/v1/auth/login"
do_request -X POST "$BASE_URL/api/v1/auth/login" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg e "$TEST_EMAIL" --arg p "$TEST_PASSWORD" \
        '{email:$e, password:$p}')"
if [[ "$RESP_STATUS" != "200" ]]; then
    fail "login" "expected 200, got $RESP_STATUS — body: $RESP_BODY"
fi
JWT=$(echo "$RESP_BODY" | jq -r '.token // .access_token // empty')
if [[ -z "$JWT" || "$JWT" == "null" ]]; then
    fail "login" "response had no .token/.access_token — body: $RESP_BODY"
fi
# Quick sanity — a JWT has three dot-separated parts.
if [[ "$(echo "$JWT" | awk -F. '{print NF}')" -ne 3 ]]; then
    fail "login" "returned token doesn't look like a JWT"
fi
pass "login returns a usable JWT" "$RESP_DUR"

# ─── 6. Agent hatch SSE ────────────────────────────────────────
#
# The hatch orchestrator depends on Eternitas (Phase 2), Windy Chat
# (Phase 4), Windy Mail (Phase 6), and Windy Fly (Phase 5). During a
# phased ecosystem rollout those services are not yet deployed, and
# the stream ends at `eternitas.registered:failed` rather than a full
# `hatch.complete`. Set SMOKE_SKIP_HATCH=1 on Phase 1-only runs; the
# check re-enables itself by default for Phase 2+.
if [[ "${SMOKE_SKIP_HATCH:-0}" = "1" ]]; then
    info "POST /api/v1/agent/hatch  (SKIPPED via SMOKE_SKIP_HATCH=1)"
    printf "  %sSKIP%s /api/v1/agent/hatch — sister services not yet deployed\n" "$C_YELLOW" "$C_RESET"
else
    info "POST /api/v1/agent/hatch  (SSE; up to 45s for sister services)"
    HATCH_BODY_FILE=$(mktemp)
    START_T=$(date +%s.%N)
    HATCH_STATUS=$(curl -sS -o "$HATCH_BODY_FILE" -w "%{http_code}" \
        -X POST "$BASE_URL/api/v1/agent/hatch" \
        -H "Authorization: Bearer $JWT" \
        -H "Accept: text/event-stream" \
        -H "Content-Type: application/json" \
        -d '{}' \
        --max-time 45 \
        --no-buffer || true)
    END_T=$(date +%s.%N)
    HATCH_DUR=$(awk "BEGIN {print $END_T - $START_T}")
    HATCH_BODY=$(cat "$HATCH_BODY_FILE"); rm -f "$HATCH_BODY_FILE"

    if [[ "$HATCH_STATUS" != "200" ]]; then
        fail "hatch" "expected 200, got $HATCH_STATUS — body: $HATCH_BODY"
    fi
    if ! grep -q "event: hatch.complete" <<<"$HATCH_BODY"; then
        fail "hatch" "SSE stream did not terminate with hatch.complete — body: $(echo "$HATCH_BODY" | tail -c 400)"
    fi
    if grep -q "event: eternitas.registering" <<<"$HATCH_BODY"; then
        pass "hatch SSE ran a fresh ceremony and ended with hatch.complete" "$HATCH_DUR"
    else
        pass "hatch SSE resumed an existing session and ended with hatch.complete" "$HATCH_DUR"
    fi
fi

# ─── Done ──────────────────────────────────────────────────────
printf "\n%sAll checks passed.%s\n\n" "$C_GREEN" "$C_RESET"
