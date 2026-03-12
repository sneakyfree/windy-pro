#!/usr/bin/env bash
##
## Windy Chat — Integration Test Suite
## Tests every API endpoint across all 4 K services.
##
## Usage:
##   bash services/test-chat-services.sh
##
## Prerequisites:
##   All 4 services running on default ports (8101-8104)
##   Or: docker compose -f deploy/docker-compose.chat.yml up -d
##

set -euo pipefail

# ── Config ──
ONBOARDING_URL="${ONBOARDING_URL:-http://localhost:8101}"
DIRECTORY_URL="${DIRECTORY_URL:-http://localhost:8102}"
PUSH_URL="${PUSH_URL:-http://localhost:8103}"
BACKUP_URL="${BACKUP_URL:-http://localhost:8104}"

PASS=0
FAIL=0
TOTAL=0

# ── Helpers ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

assert_status() {
  local label="$1"
  local expected="$2"
  local actual="$3"
  TOTAL=$((TOTAL + 1))
  if [ "$actual" = "$expected" ]; then
    echo -e "  ${GREEN}✓${NC} ${label} (HTTP ${actual})"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}✗${NC} ${label} — expected ${expected}, got ${actual}"
    FAIL=$((FAIL + 1))
  fi
}

assert_json_field() {
  local label="$1"
  local json="$2"
  local field="$3"
  local expected="$4"
  TOTAL=$((TOTAL + 1))
  local actual
  actual=$(echo "$json" | python3 -c "import sys,json; print(json.load(sys.stdin).get('$field',''))" 2>/dev/null || echo "")
  if [ "$actual" = "$expected" ]; then
    echo -e "  ${GREEN}✓${NC} ${label} (${field}=${actual})"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}✗${NC} ${label} — ${field}: expected '${expected}', got '${actual}'"
    FAIL=$((FAIL + 1))
  fi
}

http_status() {
  curl -s -o /dev/null -w "%{http_code}" "$@" 2>/dev/null || echo "000"
}

http_get() {
  curl -s "$@" 2>/dev/null || echo "{}"
}

http_post() {
  curl -s -X POST -H "Content-Type: application/json" "$@" 2>/dev/null || echo "{}"
}

# ══════════════════════════════════════════════════════════
echo -e "\n${CYAN}═══ Windy Chat Integration Tests ═══${NC}\n"

# ── 1. Health Checks ──
echo -e "${YELLOW}▸ Health Checks${NC}"
assert_status "Onboarding health" "200" "$(http_status "${ONBOARDING_URL}/health")"
assert_status "Directory health"  "200" "$(http_status "${DIRECTORY_URL}/health")"
assert_status "Push health"       "200" "$(http_status "${PUSH_URL}/health")"
assert_status "Backup health"     "200" "$(http_status "${BACKUP_URL}/health")"

# ── 2. K2: Onboarding Flow ──
echo -e "\n${YELLOW}▸ K2: Onboarding — Verify${NC}"

# Send OTP
VERIFY_RESP=$(http_post -d '{"type":"email","identifier":"test@example.com"}' "${ONBOARDING_URL}/api/v1/chat/verify/send")
assert_json_field "Send OTP" "$VERIFY_RESP" "success" "True"

# Check OTP status
assert_status "Verify status" "200" "$(http_status "${ONBOARDING_URL}/api/v1/chat/verify/status?identifier=test@example.com")"

# Bad check (wrong code)
BAD_CHECK=$(http_post -d '{"identifier":"test@example.com","code":"000000","type":"email"}' "${ONBOARDING_URL}/api/v1/chat/verify/check")
assert_status "Bad OTP rejected" "400" "$(http_status -X POST -H 'Content-Type: application/json' -d '{"identifier":"test@example.com","code":"000000","type":"email"}' "${ONBOARDING_URL}/api/v1/chat/verify/check")"

echo -e "\n${YELLOW}▸ K2: Onboarding — Profile${NC}"

# Check name availability
NAME_RESP=$(http_get "${ONBOARDING_URL}/api/v1/chat/profile/check-name?name=TestUser42")
assert_json_field "Name available" "$NAME_RESP" "available" "True"

# Check profanity rejection
PROFANE_RESP=$(http_get "${ONBOARDING_URL}/api/v1/chat/profile/check-name?name=admin")
assert_json_field "Profanity blocked" "$PROFANE_RESP" "available" "False"

# Create profile
# Stub mode: server accepts any token → 201. In production with real verification, invalid tokens return 400.
assert_status "Profile created" "201" "$(http_status -X POST -H 'Content-Type: application/json' -d '{"verificationToken":"fake-token","displayName":"IntegTestUser","languages":["en","es"]}' "${ONBOARDING_URL}/api/v1/chat/profile/setup")"

echo -e "\n${YELLOW}▸ K2: Onboarding — QR Pair${NC}"

# Generate QR session
QR_RESP=$(http_post "${ONBOARDING_URL}/api/v1/chat/pair/generate")
SESSION_ID=$(echo "$QR_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('sessionId',''))" 2>/dev/null || echo "")
assert_json_field "QR generated" "$QR_RESP" "ttlSeconds" "120"

# Poll status (should be pending)
if [ -n "$SESSION_ID" ]; then
  STATUS_RESP=$(http_get "${ONBOARDING_URL}/api/v1/chat/pair/status/${SESSION_ID}")
  assert_json_field "Session pending" "$STATUS_RESP" "status" "pending"

  # Confirm pairing
  CONFIRM_RESP=$(http_post -d "{\"sessionId\":\"${SESSION_ID}\",\"authToken\":\"test-token\",\"userId\":\"user_123\"}" "${ONBOARDING_URL}/api/v1/chat/pair/confirm")
  assert_json_field "Pairing confirmed" "$CONFIRM_RESP" "paired" "True"

  # Check paired status
  PAIRED_RESP=$(http_get "${ONBOARDING_URL}/api/v1/chat/pair/status/${SESSION_ID}")
  assert_json_field "Session paired" "$PAIRED_RESP" "status" "paired"
fi

echo -e "\n${YELLOW}▸ K2: Onboarding — Provision${NC}"

PROV_RESP=$(http_post -d '{"chatUserId":"windy_test123","displayName":"TestUser42","verificationToken":"fake-token"}' "${ONBOARDING_URL}/api/v1/chat/provision")
assert_json_field "Matrix provisioned" "$PROV_RESP" "success" "True"

# Check onboarding status
ONBOARD_RESP=$(http_get "${ONBOARDING_URL}/api/v1/chat/provision/onboarding/status?chatUserId=windy_test123")
assert_json_field "Onboarding complete" "$ONBOARD_RESP" "complete" "True"

# ── 3. K3: Contact Discovery ──
echo -e "\n${YELLOW}▸ K3: Directory — Hash Lookup${NC}"

# Get salt
SALT_RESP=$(http_get "${DIRECTORY_URL}/api/v1/chat/directory/salt")
assert_json_field "Salt returned" "$SALT_RESP" "algorithm" "SHA256"

# Register hash
REG_RESP=$(http_post -d '{"userId":"user_abc","displayName":"Alice","identifiers":["+15551234567"]}' "${DIRECTORY_URL}/api/v1/chat/directory/register-hash")
assert_json_field "Hash registered" "$REG_RESP" "success" "True"

# Lookup (no matches for random hash)
LOOKUP_RESP=$(http_post -d '{"hashes":["0000000000000000000000000000000000000000000000000000000000000000"]}' "${DIRECTORY_URL}/api/v1/chat/directory/lookup")
assert_json_field "Lookup works" "$LOOKUP_RESP" "submitted" "1"

# Stats
assert_status "Directory stats" "200" "$(http_status "${DIRECTORY_URL}/api/v1/chat/directory/stats")"

echo -e "\n${YELLOW}▸ K3: Directory — Search & Invite${NC}"

# Register in search directory
http_post -d '{"userId":"user_abc","displayName":"Alice Wonderland","email":"alice@example.com","languages":["en"]}' "${DIRECTORY_URL}/api/v1/chat/directory/register" > /dev/null

# Search
SEARCH_RESP=$(http_get "${DIRECTORY_URL}/api/v1/chat/directory/search?q=Alice")
SEARCH_COUNT=$(echo "$SEARCH_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('count',0))" 2>/dev/null || echo "0")
TOTAL=$((TOTAL + 1))
if [ "$SEARCH_COUNT" -ge 1 ] 2>/dev/null; then
  echo -e "  ${GREEN}✓${NC} Search found matches (count=${SEARCH_COUNT})"
  PASS=$((PASS + 1))
else
  echo -e "  ${RED}✗${NC} Search returned no matches"
  FAIL=$((FAIL + 1))
fi

# Invite
INVITE_RESP=$(http_post -d '{"fromUserId":"user_abc","fromDisplayName":"Alice","type":"email","identifier":"bob@example.com"}' "${DIRECTORY_URL}/api/v1/chat/directory/invite")
assert_json_field "Invite sent" "$INVITE_RESP" "success" "True"

# ── 4. K6: Push Gateway ──
echo -e "\n${YELLOW}▸ K6: Push Gateway${NC}"

# Register push token
PUSH_REG=$(http_post -d '{"pushkey":"test-token-abc","userId":"user_123","platform":"android","deviceName":"Pixel 9"}' "${PUSH_URL}/api/v1/chat/push/register")
assert_json_field "Push registered" "$PUSH_REG" "success" "True"

# Mute conversation
MUTE_RESP=$(http_post -d '{"userId":"user_123","roomId":"!room:chat.windypro.com","duration":"1h"}' "${PUSH_URL}/api/v1/chat/push/mute")
assert_json_field "Room muted" "$MUTE_RESP" "success" "True"

# Unmute
UNMUTE_RESP=$(http_post -d '{"userId":"user_123","roomId":"!room:chat.windypro.com"}' "${PUSH_URL}/api/v1/chat/push/unmute")
assert_json_field "Room unmuted" "$UNMUTE_RESP" "success" "True"

# Matrix push notify
NOTIFY_RESP=$(http_post -d '{"notification":{"room_id":"!room:test","event_id":"$ev1","sender":"@alice:test","sender_display_name":"Alice","type":"m.room.message","devices":[{"pushkey":"test-token-abc","app_id":"com.windypro.chat.android"}],"counts":{"unread":3}}}' "${PUSH_URL}/_matrix/push/v1/notify")
assert_status "Push notify" "200" "$(http_status -X POST -H 'Content-Type: application/json' -d '{"notification":{"room_id":"!room:test","event_id":"$ev1","sender":"@alice:test","devices":[{"pushkey":"test-token-abc","app_id":"com.windypro.chat.android"}],"counts":{"unread":3}}}' "${PUSH_URL}/_matrix/push/v1/notify")"

# ── 5. K8: Backup ──
echo -e "\n${YELLOW}▸ K8: Backup${NC}"

# Create backup
BACKUP_RESP=$(http_post -d '{"userId":"user_123","encryptedData":"dGVzdCBkYXRh","metadata":{"messages":42,"rooms":3}}' "${BACKUP_URL}/api/v1/chat/backup/create")
BACKUP_ID=$(echo "$BACKUP_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('backupId',''))" 2>/dev/null || echo "")
assert_json_field "Backup created" "$BACKUP_RESP" "success" "True"

# List backups
LIST_RESP=$(http_get "${BACKUP_URL}/api/v1/chat/backup/list?userId=user_123")
assert_json_field "Backups listed" "$LIST_RESP" "count" "1"

# Restore backup
if [ -n "$BACKUP_ID" ]; then
  RESTORE_RESP=$(http_post -d "{\"userId\":\"user_123\",\"backupId\":\"${BACKUP_ID}\"}" "${BACKUP_URL}/api/v1/chat/backup/restore")
  assert_json_field "Backup restored" "$RESTORE_RESP" "success" "True"
fi

# ══════════════════════════════════════════════════════════
echo -e "\n${CYAN}═══ Results ═══${NC}"
echo -e "  Total: ${TOTAL}  ${GREEN}Pass: ${PASS}${NC}  ${RED}Fail: ${FAIL}${NC}"

if [ "$FAIL" -gt 0 ]; then
  echo -e "\n${RED}⚠️  ${FAIL} test(s) failed${NC}\n"
  exit 1
else
  echo -e "\n${GREEN}✅ All ${PASS} tests passed${NC}\n"
  exit 0
fi
