#!/bin/bash
# Windy Pro v2.0 — Account Server API Tests
# Run: bash test-api.sh

BASE="http://localhost:8098"
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

echo ""
echo -e "${CYAN}🌪️  Windy Pro Account Server — API Tests${NC}"
echo -e "${CYAN}   Base: ${BASE}${NC}"
echo ""

# ─── 1. Health Check ───
echo -e "${CYAN}═══ 1. Health Check ═══${NC}"
HEALTH=$(curl -s $BASE/health)
echo "$HEALTH" | python3 -m json.tool 2>/dev/null || echo "$HEALTH"
echo ""

# ─── 2. Register ───
echo -e "${CYAN}═══ 2. Register New Account ═══${NC}"
REGISTER=$(curl -s -X POST $BASE/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test User",
    "email": "test@windypro.local",
    "password": "testpass123",
    "deviceId": "dev-test-001",
    "deviceName": "Test Laptop (Linux)",
    "platform": "linux"
  }')
echo "$REGISTER" | python3 -m json.tool 2>/dev/null || echo "$REGISTER"

# Extract token
TOKEN=$(echo "$REGISTER" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null)
REFRESH=$(echo "$REGISTER" | python3 -c "import sys,json; print(json.load(sys.stdin).get('refreshToken',''))" 2>/dev/null)

if [ -z "$TOKEN" ]; then
  echo -e "${RED}❌ No token received. Trying login instead...${NC}"
  
  # Account may already exist — try login
  LOGIN=$(curl -s -X POST $BASE/v1/auth/login \
    -H "Content-Type: application/json" \
    -d '{
      "email": "test@windypro.local",
      "password": "testpass123",
      "deviceId": "dev-test-001",
      "deviceName": "Test Laptop (Linux)",
      "platform": "linux"
    }')
  echo "$LOGIN" | python3 -m json.tool 2>/dev/null || echo "$LOGIN"
  TOKEN=$(echo "$LOGIN" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null)
  REFRESH=$(echo "$LOGIN" | python3 -c "import sys,json; print(json.load(sys.stdin).get('refreshToken',''))" 2>/dev/null)
fi

echo -e "${GREEN}Token: ${TOKEN:0:30}...${NC}"
echo ""

# ─── 3. Duplicate Registration ───
echo -e "${CYAN}═══ 3. Duplicate Registration (should fail 409) ═══${NC}"
curl -s -X POST $BASE/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Dup","email":"test@windypro.local","password":"testpass123"}' | python3 -m json.tool 2>/dev/null
echo ""

# ─── 4. Login ───
echo -e "${CYAN}═══ 4. Login ═══${NC}"
curl -s -X POST $BASE/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@windypro.local",
    "password": "testpass123",
    "deviceId": "dev-test-001",
    "deviceName": "Test Laptop (Linux)",
    "platform": "linux"
  }' | python3 -m json.tool 2>/dev/null
echo ""

# ─── 5. Wrong Password ───
echo -e "${CYAN}═══ 5. Login Wrong Password (should fail 401) ═══${NC}"
curl -s -X POST $BASE/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@windypro.local","password":"wrongpassword"}' | python3 -m json.tool 2>/dev/null
echo ""

# ─── 6. Get Me ───
echo -e "${CYAN}═══ 6. GET /v1/auth/me ═══${NC}"
curl -s -H "Authorization: Bearer $TOKEN" $BASE/v1/auth/me | python3 -m json.tool 2>/dev/null
echo ""

# ─── 7. Get Me without auth ───
echo -e "${CYAN}═══ 7. GET /v1/auth/me without token (should fail 401) ═══${NC}"
curl -s $BASE/v1/auth/me | python3 -m json.tool 2>/dev/null
echo ""

# ─── 8. List Devices ───
echo -e "${CYAN}═══ 8. GET /v1/auth/devices ═══${NC}"
curl -s -H "Authorization: Bearer $TOKEN" $BASE/v1/auth/devices | python3 -m json.tool 2>/dev/null
echo ""

# ─── 9. Register More Devices ───
echo -e "${CYAN}═══ 9. Register Devices (up to 5) ═══${NC}"
for i in 2 3 4 5; do
  echo -e "  Adding device dev-test-00${i}..."
  curl -s -X POST $BASE/v1/auth/devices/register \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"deviceId\":\"dev-test-00${i}\",\"deviceName\":\"Device ${i}\",\"platform\":\"linux\"}" | \
    python3 -c "import sys,json; d=json.load(sys.stdin); print(f'  → {d.get(\"message\",d.get(\"error\",\"\"))} ({d.get(\"count\",\"?\")} devices)')" 2>/dev/null
done
echo ""

# ─── 10. Hit Device Limit ───
echo -e "${CYAN}═══ 10. Register 6th Device (should fail 403) ═══${NC}"
curl -s -X POST $BASE/v1/auth/devices/register \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"dev-test-006","deviceName":"Device 6","platform":"linux"}' | python3 -m json.tool 2>/dev/null
echo ""

# ─── 11. Remove a Device ───
echo -e "${CYAN}═══ 11. Remove Device dev-test-005 ═══${NC}"
curl -s -X POST $BASE/v1/auth/devices/remove \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"dev-test-005"}' | python3 -m json.tool 2>/dev/null
echo ""

# ─── 12. Now 6th Device Should Work ───
echo -e "${CYAN}═══ 12. Register 6th Device After Removal (should succeed) ═══${NC}"
curl -s -X POST $BASE/v1/auth/devices/register \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"dev-test-006","deviceName":"Device 6","platform":"linux"}' | python3 -m json.tool 2>/dev/null
echo ""

# ─── 13. Refresh Token ───
echo -e "${CYAN}═══ 13. Refresh Token ═══${NC}"
if [ -n "$REFRESH" ]; then
  curl -s -X POST $BASE/v1/auth/refresh \
    -H "Content-Type: application/json" \
    -d "{\"refreshToken\":\"$REFRESH\",\"deviceId\":\"dev-test-001\"}" | python3 -m json.tool 2>/dev/null
else
  echo -e "${RED}No refresh token available${NC}"
fi
echo ""

echo -e "${GREEN}✅ All tests complete!${NC}"
echo ""
