#!/usr/bin/env bash
# Wave 13 Phase 1 — FIRE 3: replace api.windyword.ai with A → EIP.
#
# Safety design:
#   1. Dry run by default (prints plan; no mutations).
#   2. Two-step execute: --plan then --apply. The operator runs --apply
#      only after reviewing the printed old-record payload.
#   3. Always logs the OLD record to stdout so the recovery command is
#      obvious if something goes wrong.
#   4. Never deletes a record by name match alone — always by Cloudflare
#      record ID from the preceding GET.
#
# Required env:
#   CLOUDFLARE_DNS_TOKEN   — the Zone:DNS:Edit token (lockbox section).
#   TARGET_EIP             — the Elastic IP from FIRE 2.
#
# Usage:
#   # 1. Plan:
#   CLOUDFLARE_DNS_TOKEN=… TARGET_EIP=… ./scripts/wave13-dns-cutover.sh --plan
#   # 2. Apply (only after reviewing plan output):
#   CLOUDFLARE_DNS_TOKEN=… TARGET_EIP=… ./scripts/wave13-dns-cutover.sh --apply

set -euo pipefail

MODE="${1:-}"
: "${CLOUDFLARE_DNS_TOKEN:?CLOUDFLARE_DNS_TOKEN is required}"
: "${TARGET_EIP:?TARGET_EIP is required (the Elastic IP from FIRE 2)}"

ZONE_NAME="windyword.ai"
RECORD_NAME="api.windyword.ai"

cfapi() {
    curl -sSfL -H "Authorization: Bearer ${CLOUDFLARE_DNS_TOKEN}" \
               -H "Content-Type: application/json" \
               "$@"
}

# Step 1: find the zone ID
ZONE_ID=$(cfapi "https://api.cloudflare.com/client/v4/zones?name=${ZONE_NAME}" \
    | python3 -c 'import sys, json; r = json.load(sys.stdin); print(r["result"][0]["id"] if r["result"] else "")')
if [ -z "$ZONE_ID" ]; then
    echo "❌ zone not found: $ZONE_NAME" >&2
    exit 1
fi
echo "zone: $ZONE_NAME  id=$ZONE_ID"

# Step 2: find the existing record (there should be exactly one)
OLD_JSON=$(cfapi "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records?name=${RECORD_NAME}")
OLD_COUNT=$(echo "$OLD_JSON" | python3 -c 'import sys, json; print(len(json.load(sys.stdin)["result"]))')
echo "existing records for $RECORD_NAME: $OLD_COUNT"
echo "$OLD_JSON" | python3 -m json.tool

if [ "$OLD_COUNT" -gt 1 ]; then
    echo "⚠️  multiple records found — aborting. Investigate before mutating." >&2
    exit 2
fi

OLD_ID=""
OLD_TYPE=""
OLD_CONTENT=""
OLD_PROXIED="false"
if [ "$OLD_COUNT" -eq 1 ]; then
    # Pass the Cloudflare response in via env (CF_JSON) so the heredoc
    # delimiter isn't competing with stdin for the python interpreter.
    # Emit shell assignments with single-quote-safe escaping.
    OLD_VARS=$(CF_JSON="$OLD_JSON" python3 <<'PY'
import os, json
r = json.loads(os.environ['CF_JSON'])['result'][0]
def q(s):
    return "'" + str(s).replace("'", "'\\''") + "'"
print(f"OLD_ID={q(r['id'])}")
print(f"OLD_TYPE={q(r['type'])}")
print(f"OLD_CONTENT={q(r['content'])}")
print(f"OLD_PROXIED={q(str(r['proxied']).lower())}")
PY
)
    eval "$OLD_VARS"
    echo "OLD → type=$OLD_TYPE  content=$OLD_CONTENT  proxied=$OLD_PROXIED  id=$OLD_ID"
fi

# Step 3: plan vs apply
NEW_BODY=$(python3 -c "
import json
print(json.dumps({
    'type': 'A',
    'name': '${RECORD_NAME}',
    'content': '${TARGET_EIP}',
    'ttl': 300,
    'proxied': False,
    'comment': 'Wave 13 Phase 1 — account-server EIP. Change via wave13-dns-cutover.sh.',
}))
")

if [ "$MODE" = "--plan" ] || [ -z "$MODE" ]; then
    echo
    echo "── PLAN (no changes made) ─────────────────────────────────"
    if [ "$OLD_COUNT" -eq 1 ]; then
        echo "  1. DELETE record ${OLD_ID} (${OLD_TYPE} → ${OLD_CONTENT})"
    fi
    echo "  2. CREATE $(echo "$NEW_BODY" | python3 -c 'import sys, json; print(json.load(sys.stdin))')"
    echo
    echo "Rollback recovery command if needed post-apply:"
    if [ "$OLD_COUNT" -eq 1 ]; then
        echo "  curl -X POST https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records \\"
        echo "    -H \"Authorization: Bearer \$CLOUDFLARE_DNS_TOKEN\" \\"
        echo "    -H \"Content-Type: application/json\" \\"
        echo "    -d '{\"type\":\"$OLD_TYPE\",\"name\":\"$RECORD_NAME\",\"content\":\"$OLD_CONTENT\",\"ttl\":300,\"proxied\":$OLD_PROXIED}'"
    fi
    exit 0
fi

if [ "$MODE" != "--apply" ]; then
    echo "usage: $0 --plan | --apply" >&2
    exit 64
fi

echo
echo "── APPLYING ───────────────────────────────────────────────"

# Delete the old record first (Cloudflare doesn't allow type-change via PATCH).
if [ "$OLD_COUNT" -eq 1 ]; then
    echo "deleting record $OLD_ID …"
    cfapi -X DELETE "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records/${OLD_ID}" \
        | python3 -m json.tool
fi

# Create the new A record.
echo "creating A record …"
cfapi -X POST "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records" \
    --data-raw "$NEW_BODY" \
    | python3 -m json.tool

echo
echo "── VERIFY ─────────────────────────────────────────────────"
echo "dig +short ${RECORD_NAME}  (propagation may take up to TTL=300s):"
dig +short "${RECORD_NAME}" @1.1.1.1 || true
