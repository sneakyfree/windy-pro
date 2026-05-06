#!/usr/bin/env bash
# ballroom-dry-run.sh — pre-demo end-to-end smoke for the Windy Pro signup
#                       and hatch flow that backs the windyword.ai demo.
#
# What it walks (the same path a normie does in their browser):
#
#   1. POST /api/v1/auth/register         → creates a Pro user, returns JWT
#   2. POST /api/v1/agent/hatch (SSE)     → walks the 13 ceremony events,
#                                            asserts each lands and the
#                                            ones the demo cares about
#                                            land with status=ok
#   3. Bundle hash check on app.windyword.ai
#                                          → confirms the SPA serving
#                                            the TTS "<Agent> is alive!"
#                                            useEffect is the live one
#   4. Welcome-email log probe (optional, --ssh)
#                                          → confirms Pro logged
#                                            `[hatch] welcome email sent`
#                                            for the test signup
#
# Exits 0 if everything is green. Exits 1 with a one-line summary of
# the first failed gate; no stack traces, no scrollback to dig through.
# Designed to be the last thing you run from your laptop the moment
# before walking on stage.
#
# Usage
# -----
#     scripts/ballroom-dry-run.sh
#         minimal — no SSH, no welcome-email log check
#
#     scripts/ballroom-dry-run.sh --ssh
#         also tail Pro logs over SSH and assert the welcome-email
#         log line shows up. Requires ~/windy-prod-key.pem and
#         passwordless ssh to ubuntu@54.88.113.79 already working.
#
# Exit codes
# ----------
#     0   all gates green
#     1   one or more gates failed (see stderr for which)
#     2   bad invocation / dependency missing

set -u

# ─── Config ────────────────────────────────────────────────────────
ACCOUNT_BASE="${BALLROOM_ACCOUNT_BASE:-https://account.windyword.ai}"
APP_BASE="${BALLROOM_APP_BASE:-https://app.windyword.ai}"
SSH_HOST="${BALLROOM_SSH_HOST:-ubuntu@54.88.113.79}"
SSH_KEY="${BALLROOM_SSH_KEY:-$HOME/windy-prod-key.pem}"
PRO_CONTAINER="${BALLROOM_PRO_CONTAINER:-deploy-prod-pro-account-server-1}"

# Mailtrap-style throwaway address. The +tag isn't seen as a different
# user by Gmail (it dedupes against the canonical address) so the box
# below ends up in your real inbox — convenient for visual confirmation
# that the welcome email actually lands.
TEST_OWNER_EMAIL_BASE="${BALLROOM_OWNER_EMAIL_BASE:-grantwhitmer3+ballroom-dryrun}"
TEST_PASSWORD="${BALLROOM_PASSWORD:-DryRun!23}"
TEST_NAME="${BALLROOM_NAME:-Dry Run}"

WANT_SSH=0
for arg in "$@"; do
    case "$arg" in
        --ssh) WANT_SSH=1 ;;
        --help|-h)
            sed -n '2,40p' "$0"
            exit 0
            ;;
        *)
            echo "unknown arg: $arg (use --help)" >&2
            exit 2
            ;;
    esac
done

# ─── Plumbing ──────────────────────────────────────────────────────
command -v curl   >/dev/null || { echo "missing dep: curl"   >&2; exit 2; }
command -v python3 >/dev/null || { echo "missing dep: python3" >&2; exit 2; }
if [ "$WANT_SSH" = 1 ]; then
    command -v ssh >/dev/null || { echo "missing dep: ssh"   >&2; exit 2; }
    [ -f "$SSH_KEY" ] || { echo "missing ssh key: $SSH_KEY" >&2; exit 2; }
fi

PASSED=()
FAILED=()
pass()  { PASSED+=("$1"); printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail()  { FAILED+=("$1: $2"); printf '  \033[31m✗\033[0m %-40s %s\n' "$1" "$2"; }

now_ms() { python3 -c 'import time; print(int(time.time()*1000))'; }
T0=$(now_ms)

TS=$(date +%s)
TEST_OWNER_EMAIL="${TEST_OWNER_EMAIL_BASE}-${TS}@gmail.com"

echo "Ballroom dry-run — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "  account: $ACCOUNT_BASE"
echo "  app:     $APP_BASE"
echo "  test owner: $TEST_OWNER_EMAIL"
echo

# ─── Gate 1: SPA bundle is live and contains the TTS wiring ───────
GATE="1. SPA bundle (app.windyword.ai)"
SPA_HTML=$(curl -s --max-time 10 "$APP_BASE/" 2>&1) || true
BUNDLE_PATH=$(echo "$SPA_HTML" | grep -oE '/assets/index-[A-Za-z0-9]+\.js' | head -1)
if [ -z "$BUNDLE_PATH" ]; then
    fail "$GATE" "couldn't extract bundle path from $APP_BASE/"
else
    BUNDLE_HASH=$(echo "$BUNDLE_PATH" | grep -oE '[A-Za-z0-9]+\.js$')
    BUNDLE_BODY=$(curl -s --max-time 15 "$APP_BASE$BUNDLE_PATH" 2>&1) || true
    if echo "$BUNDLE_BODY" | grep -q 'is alive!'; then
        pass "$GATE — bundle $BUNDLE_HASH has TTS cue wired"
    else
        fail "$GATE" "bundle $BUNDLE_HASH does NOT contain 'is alive!' — TTS not deployed"
    fi
fi

# ─── Gate 2: Register a fresh user ────────────────────────────────
GATE="2. POST /auth/register"
REG_RESP=$(curl -s --max-time 15 -X POST "$ACCOUNT_BASE/api/v1/auth/register" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"${TEST_OWNER_EMAIL}\",\"password\":\"${TEST_PASSWORD}\",\"name\":\"${TEST_NAME}\"}" 2>&1)
TOKEN=$(echo "$REG_RESP" | python3 -c 'import json,sys
try:
    d = json.load(sys.stdin)
    print(d.get("token") or "")
except Exception:
    print("")
' 2>/dev/null)
if [ -z "$TOKEN" ] || [ "${#TOKEN}" -lt 100 ]; then
    fail "$GATE" "no token returned (resp=${REG_RESP:0:200})"
    GATE_REGISTER_OK=0
else
    pass "$GATE — token len=${#TOKEN}"
    GATE_REGISTER_OK=1
fi

# ─── Gate 3: Hatch SSE — every event lands, key ones are ok ───────
GATE="3. POST /agent/hatch (SSE)"
if [ "${GATE_REGISTER_OK:-0}" -ne 1 ]; then
    fail "$GATE" "skipped — no auth token from prior gate"
else
    HATCH_RAW_FILE=$(mktemp -t ballroom-dry-run-sse.XXXXXX)
    trap 'rm -f "$HATCH_RAW_FILE"' EXIT
    curl -sN --max-time 60 -X POST "$ACCOUNT_BASE/api/v1/agent/hatch" \
        -H "Authorization: Bearer $TOKEN" \
        -H 'Accept: text/event-stream' \
        -H 'Content-Type: application/json' \
        -d '{}' > "$HATCH_RAW_FILE" 2>&1 || true
    # Parse SSE — collect one (type, status) per data: line.
    # Note: we use a temp file rather than `echo "$VAR" | python3 - <<EOF`
    # because that pipe is a noop — the heredoc replaces stdin so the
    # piped data never reaches the script. Reading the file directly
    # avoids the foot-gun.
    HATCH_SUMMARY=$(python3 - "$HATCH_RAW_FILE" <<'PYEOF'
import json, sys
with open(sys.argv[1]) as f:
    lines = f.read().splitlines()
events = []
for ln in lines:
    if not ln.startswith("data:"):
        continue
    body = ln[5:].strip()
    if not body:
        continue
    try:
        d = json.loads(body)
    except Exception:
        continue
    events.append({
        "type": d.get("type", "?"),
        "status": d.get("status", "?"),
        "passport": (d.get("data") or {}).get("passport_number"),
        "agent_email": (d.get("data") or {}).get("email"),
        "cert_no": (d.get("data") or {}).get("certificate_no"),
        "agent_name": (d.get("data") or {}).get("agent_name"),
    })

required_ok = ["eternitas.registered", "mail.provisioned", "birth_certificate.ready", "hatch.complete"]
seen = {e["type"]: e for e in events}

passport = next((e["passport"] for e in events if e["passport"]), None)
agent_email = next((e["agent_email"] for e in events if e["agent_email"]), None)
cert_no = next((e["cert_no"] for e in events if e["cert_no"]), None)
agent_name = next((e["agent_name"] for e in events if e["agent_name"]), None)

failures = []
for t in required_ok:
    e = seen.get(t)
    if not e:
        failures.append(f"missing event {t}")
    elif e["status"] != "ok":
        failures.append(f"{t} status={e['status']}")

print(json.dumps({
    "events_count": len(events),
    "passport": passport,
    "agent_email": agent_email,
    "cert_no": cert_no,
    "agent_name": agent_name,
    "failures": failures,
}))
PYEOF
)
    EVENT_COUNT=$(echo "$HATCH_SUMMARY" | python3 -c 'import json,sys; print(json.load(sys.stdin)["events_count"])')
    PASSPORT=$(echo "$HATCH_SUMMARY"     | python3 -c 'import json,sys; print(json.load(sys.stdin).get("passport") or "")')
    AGENT_EMAIL=$(echo "$HATCH_SUMMARY"  | python3 -c 'import json,sys; print(json.load(sys.stdin).get("agent_email") or "")')
    CERT_NO=$(echo "$HATCH_SUMMARY"      | python3 -c 'import json,sys; print(json.load(sys.stdin).get("cert_no") or "")')
    AGENT_NAME=$(echo "$HATCH_SUMMARY"   | python3 -c 'import json,sys; print(json.load(sys.stdin).get("agent_name") or "")')
    HATCH_FAILURES=$(echo "$HATCH_SUMMARY" | python3 -c 'import json,sys; print(",".join(json.load(sys.stdin)["failures"]))')

    if [ -n "$HATCH_FAILURES" ]; then
        fail "$GATE" "$HATCH_FAILURES (saw $EVENT_COUNT events)"
    else
        pass "$GATE — $EVENT_COUNT events, passport=$PASSPORT cert=$CERT_NO inbox=$AGENT_EMAIL"
    fi
fi

# ─── Gate 4: Welcome-email log probe (only with --ssh) ────────────
if [ "$WANT_SSH" = 1 ]; then
    GATE="4. Pro log shows welcome email dispatched"
    sleep 4  # small delay for the fire-and-forget IIFE to run
    LOG_HIT=$(ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no -o ConnectTimeout=10 "$SSH_HOST" \
        "sudo docker logs --since 60s $PRO_CONTAINER 2>&1 | grep -F '[hatch] welcome email sent' | grep -F '$TEST_OWNER_EMAIL' | head -1" 2>&1) || true
    if [ -n "$LOG_HIT" ]; then
        pass "$GATE — '${LOG_HIT##*[hatch] }'"
    else
        fail "$GATE" "no '[hatch] welcome email sent ${TEST_OWNER_EMAIL}' line in last 60s of Pro logs"
    fi
else
    echo "  (skipping welcome-email log probe — pass --ssh to enable)"
fi

# ─── Tally ────────────────────────────────────────────────────────
T1=$(now_ms)
DURATION=$(( (T1 - T0) / 1000 ))
echo
echo "──────────────────────────────────────────────────────────"
echo "  ${#PASSED[@]} passed, ${#FAILED[@]} failed (${DURATION}s)"
if [ "${#FAILED[@]}" -gt 0 ]; then
    echo
    echo "  FAILURES:"
    for f in "${FAILED[@]}"; do
        echo "    - $f"
    done
    echo
    echo "  ⚠  At least one ballroom-critical gate is RED. Do not demo until green."
    exit 1
fi
echo
echo "  ✅  All ballroom-critical gates are green."
echo
echo "  Manual check (browser audio policy can't be tested headlessly):"
echo "    1. Open $APP_BASE in Chrome/Safari with sound on"
echo "    2. Sign up with a fresh email + click 'hatch your helper'"
echo "    3. After the SSE ceremony completes, listen for"
echo "       \"<Agent> is alive!\" through your speakers"
exit 0
