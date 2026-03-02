#!/bin/bash
# Windy Pro — Services Account Server E2E Test
# Tests all auth flows, recordings, and edge cases against services/account-server
# Run: bash test-e2e.sh

BASE="http://localhost:8098"
PASS=0
FAIL=0
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[0;33m'
NC='\033[0m'
UNIQUE=$(date +%s)
TEST_EMAIL="e2e-${UNIQUE}@test.local"
TEST_PASS="TestPass123!"
TEST_NAME="E2E Tester"

check() {
    local label="$1" expected="$2" actual="$3"
    if echo "$actual" | grep -q "$expected"; then
        echo -e "  ${GREEN}✓ ${label}${NC}"
        ((PASS++))
    else
        echo -e "  ${RED}✗ ${label} — expected '${expected}'${NC}"
        echo -e "    ${YELLOW}Got: $(echo "$actual" | head -c 200)${NC}"
        ((FAIL++))
    fi
}

http_status() {
    local method="$1" url="$2" data="$3" token="$4"
    local auth_header=""
    [ -n "$token" ] && auth_header="-H \"Authorization: Bearer $token\""
    if [ -n "$data" ]; then
        eval curl -s -o /dev/null -w '%{http_code}' -X "$method" "$url" \
            -H "Content-Type: application/json" $auth_header \
            -d "'$data'"
    else
        eval curl -s -o /dev/null -w '%{http_code}' -X "$method" "$url" $auth_header
    fi
}

api_call() {
    local method="$1" path="$2" data="$3" token="$4"
    local auth_header=""
    [ -n "$token" ] && auth_header="-H \"Authorization: Bearer $token\""
    if [ -n "$data" ]; then
        eval curl -s -X "$method" "${BASE}${path}" \
            -H "Content-Type: application/json" $auth_header \
            -d "'$data'"
    else
        eval curl -s -X "$method" "${BASE}${path}" $auth_header
    fi
}

echo ""
echo -e "${CYAN}══════════════════════════════════════════════════${NC}"
echo -e "${CYAN}🌪️  Windy Pro Account Server — E2E Tests${NC}"
echo -e "${CYAN}   Base: ${BASE}${NC}"
echo -e "${CYAN}   User: ${TEST_EMAIL}${NC}"
echo -e "${CYAN}══════════════════════════════════════════════════${NC}"
echo ""

# ─── 1. Health Check ───
echo -e "${CYAN}─── 1. Health Check ───${NC}"
HEALTH=$(api_call GET /health)
check "Health returns ok" '"status":"ok"' "$HEALTH"
check "Health returns service name" '"service":"account-server"' "$HEALTH"
echo ""

# ─── 2. Register ───
echo -e "${CYAN}─── 2. Register ───${NC}"
REG=$(api_call POST /api/v1/auth/register "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASS\",\"name\":\"$TEST_NAME\"}")
check "Register returns token" '"token"' "$REG"
check "Register returns user" '"user"' "$REG"
TOKEN=$(echo "$REG" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null)
echo ""

# ─── 3. Duplicate Registration (409) ───
echo -e "${CYAN}─── 3. Duplicate Registration ───${NC}"
STATUS=$(http_status POST "${BASE}/api/v1/auth/register" "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASS\",\"name\":\"$TEST_NAME\"}")
check "Duplicate returns 409" "409" "$STATUS"
echo ""

# ─── 4. Registration Validation ───
echo -e "${CYAN}─── 4. Validation ───${NC}"
STATUS=$(http_status POST "${BASE}/api/v1/auth/register" '{"email":"bad","password":"short","name":"x"}')
check "Bad email returns 400" "400" "$STATUS"
STATUS=$(http_status POST "${BASE}/api/v1/auth/register" '{"email":"a@b.com","password":"short"}')
check "Missing name returns 400" "400" "$STATUS"
echo ""

# ─── 5. Login ───
echo -e "${CYAN}─── 5. Login ───${NC}"
LOGIN=$(api_call POST /api/v1/auth/login "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASS\"}")
check "Login returns token" '"token"' "$LOGIN"
check "Login returns refreshToken" '"refreshToken"' "$LOGIN"
TOKEN=$(echo "$LOGIN" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null)
REFRESH=$(echo "$LOGIN" | python3 -c "import sys,json; print(json.load(sys.stdin).get('refreshToken',''))" 2>/dev/null)
echo ""

# ─── 6. Wrong Password ───
echo -e "${CYAN}─── 6. Wrong Password ───${NC}"
STATUS=$(http_status POST "${BASE}/api/v1/auth/login" "{\"email\":\"$TEST_EMAIL\",\"password\":\"wrongpass\"}")
check "Wrong password returns 401" "401" "$STATUS"
echo ""

# ─── 7. GET /me ───
echo -e "${CYAN}─── 7. GET /auth/me ───${NC}"
ME=$(api_call GET /api/v1/auth/me "" "$TOKEN")
check "Returns user object" '"user"' "$ME"
check "Email matches" "$TEST_EMAIL" "$ME"
echo ""

# ─── 8. No Auth ───
echo -e "${CYAN}─── 8. No Auth ───${NC}"
STATUS=$(http_status GET "${BASE}/api/v1/auth/me")
check "No token returns 401" "401" "$STATUS"
echo ""

# ─── 9. PATCH /me ───
echo -e "${CYAN}─── 9. Update Profile ───${NC}"
UPDATED=$(api_call PATCH /api/v1/auth/me '{"name":"Updated Name"}' "$TOKEN")
check "Profile updated" '"user"' "$UPDATED"
echo ""

# ─── 10. Change Password ───
echo -e "${CYAN}─── 10. Change Password ───${NC}"
PW_CHANGE=$(api_call PUT /api/v1/auth/password "{\"currentPassword\":\"$TEST_PASS\",\"newPassword\":\"NewPass456!\"}" "$TOKEN")
check "Password changed" '"message"' "$PW_CHANGE"
# Login with new password
LOGIN2=$(api_call POST /api/v1/auth/login "{\"email\":\"$TEST_EMAIL\",\"password\":\"NewPass456!\"}")
check "Login with new password" '"token"' "$LOGIN2"
TOKEN=$(echo "$LOGIN2" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null)
REFRESH=$(echo "$LOGIN2" | python3 -c "import sys,json; print(json.load(sys.stdin).get('refreshToken',''))" 2>/dev/null)
echo ""

# ─── 11. Create Recording ───
echo -e "${CYAN}─── 11. Create Recording ───${NC}"
REC=$(api_call POST /api/v1/recordings '{"transcript":"Hello world from E2E test","recordedAt":"2026-03-02T10:00:00Z","engine":"local","mode":"batch"}' "$TOKEN")
check "Recording created" '"message":"Recording saved"' "$REC"
REC_ID=$(echo "$REC" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
echo ""

# ─── 12. List Recordings ───
echo -e "${CYAN}─── 12. List Recordings ───${NC}"
LIST=$(api_call GET /api/v1/recordings "" "$TOKEN")
check "Recordings list returned" '"recordings"' "$LIST"
check "Pagination returned" '"pagination"' "$LIST"
echo ""

# ─── 13. Get Recording Stats ───
echo -e "${CYAN}─── 13. Recording Stats ───${NC}"
STATS=$(api_call GET /api/v1/recordings/stats "" "$TOKEN")
check "Stats returned" '"stats"' "$STATS"
check "Has total recordings" '"totalRecordings"' "$STATS"
echo ""

# ─── 14. Get Single Recording ───
echo -e "${CYAN}─── 14. Get Recording by ID ───${NC}"
if [ -n "$REC_ID" ]; then
    SINGLE=$(api_call GET "/api/v1/recordings/$REC_ID" "" "$TOKEN")
    check "Recording found" '"recording"' "$SINGLE"
    check "Transcript matches" "Hello world from E2E test" "$SINGLE"
else
    echo -e "  ${YELLOW}⊘ Skipped (no recording ID)${NC}"
fi
echo ""

# ─── 15. Search Recordings ───
echo -e "${CYAN}─── 15. Search Recordings ───${NC}"
SEARCH=$(api_call GET "/api/v1/recordings?search=E2E" "" "$TOKEN")
check "Search returns results" '"recordings"' "$SEARCH"
echo ""

# ─── 16. Delete Recording ───
echo -e "${CYAN}─── 16. Delete Recording ───${NC}"
if [ -n "$REC_ID" ]; then
    DEL=$(api_call DELETE "/api/v1/recordings/$REC_ID" "" "$TOKEN")
    check "Recording deleted" '"message":"Recording deleted"' "$DEL"
    # Verify it's gone
    STATUS=$(http_status GET "${BASE}/api/v1/recordings/$REC_ID" "" "$TOKEN")
    check "Deleted recording returns 404" "404" "$STATUS"
else
    echo -e "  ${YELLOW}⊘ Skipped (no recording ID)${NC}"
fi
echo ""

# ─── 17. Device Management ───
echo -e "${CYAN}─── 17. Device Management ───${NC}"
DEV=$(api_call POST /api/v1/auth/devices '{"deviceName":"E2E Test Device","platform":"linux"}' "$TOKEN")
check "Device registered" '"deviceId"' "$DEV"
DEV_ID=$(echo "$DEV" | python3 -c "import sys,json; print(json.load(sys.stdin).get('deviceId',''))" 2>/dev/null)
DEVS=$(api_call GET /api/v1/auth/devices "" "$TOKEN")
check "Devices listed" '"devices"' "$DEVS"
if [ -n "$DEV_ID" ]; then
    DEVDEL=$(api_call DELETE "/api/v1/auth/devices/$DEV_ID" "" "$TOKEN")
    check "Device removed" '"message":"Device removed"' "$DEVDEL"
fi
echo ""

# ─── 18. Refresh Token ───
echo -e "${CYAN}─── 18. Token Refresh ───${NC}"
if [ -n "$REFRESH" ]; then
    REFRESHED=$(api_call POST /api/v1/auth/refresh "{\"refreshToken\":\"$REFRESH\"}")
    check "Refresh returns new token" '"token"' "$REFRESHED"
    check "Refresh returns new refreshToken" '"refreshToken"' "$REFRESHED"
    NEW_TOKEN=$(echo "$REFRESHED" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null)
    # Verify new token works
    ME2=$(api_call GET /api/v1/auth/me "" "$NEW_TOKEN")
    check "New token works" '"user"' "$ME2"
else
    echo -e "  ${YELLOW}⊘ Skipped (no refresh token)${NC}"
fi
echo ""

# ─── 19. Logout ───
echo -e "${CYAN}─── 19. Logout ───${NC}"
LOGOUT=$(api_call POST /api/v1/auth/logout "" "$TOKEN")
check "Logout successful" '"message"' "$LOGOUT"
# Token should now be blacklisted
STATUS=$(http_status GET "${BASE}/api/v1/auth/me" "" "$TOKEN")
check "Blacklisted token returns 401" "401" "$STATUS"
echo ""

# ─── 20. Delete Account (GDPR) ───
echo -e "${CYAN}─── 20. Delete Account (GDPR) ───${NC}"
# Need a fresh token since old one is blacklisted
LOGIN3=$(api_call POST /api/v1/auth/login "{\"email\":\"$TEST_EMAIL\",\"password\":\"NewPass456!\"}")
FINAL_TOKEN=$(echo "$LOGIN3" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null)
if [ -n "$FINAL_TOKEN" ]; then
    DEL_ACCT=$(api_call DELETE /api/v1/auth/me "" "$FINAL_TOKEN")
    check "Account deleted" '"message":"Account deleted permanently"' "$DEL_ACCT"
    # Verify account is gone
    STATUS=$(http_status POST "${BASE}/api/v1/auth/login" "{\"email\":\"$TEST_EMAIL\",\"password\":\"NewPass456!\"}")
    check "Deleted account cannot login" "401" "$STATUS"
else
    echo -e "  ${YELLOW}⊘ Skipped (cannot re-login)${NC}"
fi
echo ""

# ─── Results ───
echo -e "${CYAN}══════════════════════════════════════════════════${NC}"
TOTAL=$((PASS + FAIL))
echo -e "  ${GREEN}✓ Passed: ${PASS}${NC} / ${TOTAL}"
if [ $FAIL -gt 0 ]; then
    echo -e "  ${RED}✗ Failed: ${FAIL}${NC}"
    echo -e "${RED}⚠️  Some tests failed!${NC}"
    exit 1
else
    echo -e "${GREEN}🎉 All tests passed!${NC}"
fi
echo ""
