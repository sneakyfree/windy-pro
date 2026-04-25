#!/usr/bin/env bash
# launch-smoke-test.sh — cross-product end-to-end smoke test.
#
# Run this right after `terraform apply` (or against a running dev
# ecosystem) to prove that a registration on account-server actually
# fans out through the webhook bus to mail/chat/cloud/clone, that the
# resulting product accounts are usable, and that deletion cascades.
#
# Exits 0 if every required step passes, 1 otherwise. Each step prints
# PASS / FAIL / SKIP with its elapsed time so the log remains readable
# when piped to CI.
#
# Dependencies: bash ≥ 4, curl, jq. A missing jq fails the script fast
# because parsing JSON with grep+sed is how prod bugs get masked.
#
# Configurable via env vars (defaults target dev localhost ports from
# account-server/src/config.ts):
#
#   ACCOUNT_SERVER_URL  default http://localhost:8098
#   MAIL_URL            default http://localhost:8200
#   CHAT_URL            default http://localhost:8101
#   CLOUD_URL           default http://localhost:8103
#   ETERNITAS_URL       default http://localhost:8500
#   SMOKE_PASSWORD      default a strong randomized password per run
#   SMOKE_SKIP_CLEANUP  if set non-empty, leaves the test user in place
#
# Any step whose downstream service endpoint isn't known at this
# commit is marked SKIP rather than failing the run — flagged with a
# TODO comment so the owning terminal can fill it in when their API
# firms up. The script still FAILS on required-step failure.

set -euo pipefail

# ─── Config ────────────────────────────────────────────────────
ACCOUNT_SERVER_URL="${ACCOUNT_SERVER_URL:-http://localhost:8098}"
MAIL_URL="${MAIL_URL:-http://localhost:8200}"
CHAT_URL="${CHAT_URL:-http://localhost:8101}"
CLOUD_URL="${CLOUD_URL:-http://localhost:8103}"
ETERNITAS_URL="${ETERNITAS_URL:-http://localhost:8500}"

# Unique email + strong-enough password so PasswordSchema in
# shared/contracts/validation.ts accepts it (8+ chars, upper, lower, digit).
TS=$(date +%s)
RAND=$(openssl rand -hex 3 2>/dev/null || echo "r${RANDOM}")
SMOKE_EMAIL="${SMOKE_EMAIL:-smoke-${TS}-${RAND}@example.com}"
SMOKE_NAME="${SMOKE_NAME:-Smoke Test ${TS}}"
SMOKE_PASSWORD="${SMOKE_PASSWORD:-SmokeRun${RAND}A1}"

# Required binaries.
for bin in curl jq openssl; do
  command -v "$bin" >/dev/null 2>&1 || { echo "❌ missing dependency: $bin" >&2; exit 2; }
done

# ─── State ─────────────────────────────────────────────────────
START_EPOCH=$(date +%s)
PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0
FAILED_STEPS=()

ACCESS_TOKEN=""
USER_ID=""

# ─── Helpers ───────────────────────────────────────────────────
banner() {
  echo
  echo "━━━ $1 ━━━"
}

# step_name and body run the body; any non-zero exit or explicit
# `_fail <reason>` inside the body records FAIL. Elapsed time printed.
step() {
  local name="$1"; shift
  local started; started=$(date +%s)
  echo "→ ${name}"
  local status="pass"
  local reason=""
  # Run in subshell so `set -e` inside doesn't kill the caller.
  if ! { "$@"; } ; then
    status="fail"
    reason="non-zero exit"
  fi
  local ended; ended=$(date +%s)
  local elapsed=$((ended - started))
  case "$status" in
    pass) echo "  PASS  ${name}  (${elapsed}s)"; PASS_COUNT=$((PASS_COUNT + 1)) ;;
    skip) echo "  SKIP  ${name}  (${elapsed}s)  — ${reason}"; SKIP_COUNT=$((SKIP_COUNT + 1)) ;;
    fail) echo "  FAIL  ${name}  (${elapsed}s)  — ${reason}"; FAIL_COUNT=$((FAIL_COUNT + 1)); FAILED_STEPS+=("$name") ;;
  esac
}

step_skip() {
  local name="$1"
  local reason="$2"
  echo "→ ${name}"
  echo "  SKIP  ${name}  — ${reason}"
  SKIP_COUNT=$((SKIP_COUNT + 1))
}

# curl helper that exits non-zero on HTTP >= 400. Body captured in $RESP_BODY,
# status in $RESP_STATUS. Never prints tokens.
http() {
  local method="$1" url="$2" ; shift 2
  local body_tmp; body_tmp=$(mktemp)
  local status
  status=$(curl -sS -o "$body_tmp" -w '%{http_code}' -X "$method" "$url" "$@")
  RESP_STATUS="$status"
  RESP_BODY=$(cat "$body_tmp")
  rm -f "$body_tmp"
  if [ "$status" -ge 400 ]; then
    echo "    HTTP ${status} from ${method} ${url}" >&2
    echo "    body: $(printf '%s' "$RESP_BODY" | head -c 300)" >&2
    return 1
  fi
  return 0
}

# ─── Step A: register test user ────────────────────────────────
register_user() {
  http POST "${ACCOUNT_SERVER_URL}/api/v1/auth/register" \
    -H 'Content-Type: application/json' \
    -d "$(jq -nc \
            --arg name "$SMOKE_NAME" \
            --arg email "$SMOKE_EMAIL" \
            --arg password "$SMOKE_PASSWORD" \
            '{name:$name, email:$email, password:$password}')" || return 1
  ACCESS_TOKEN=$(printf '%s' "$RESP_BODY" | jq -r '.token // empty')
  USER_ID=$(printf '%s' "$RESP_BODY" | jq -r '.userId // empty')
  if [ -z "$ACCESS_TOKEN" ] || [ -z "$USER_ID" ]; then
    echo "    register response missing token/userId" >&2
    return 1
  fi
  echo "    userId=${USER_ID}"
}

# ─── Step B: poll /identity/me until all 4 products active ─────
# Timeout: 60s total with 2s polling. Webhook fan-out bus retries at
# 0s/5s/30s; 60s budget covers two successful delivery attempts each
# plus handler work.
poll_products_active() {
  local needed=("windy_mail" "windy_chat" "windy_cloud" "windy_clone")
  local deadline=$(( $(date +%s) + 60 ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    http GET "${ACCOUNT_SERVER_URL}/api/v1/identity/me" \
      -H "Authorization: Bearer ${ACCESS_TOKEN}" || { sleep 2; continue; }

    # Collect statuses for every product we care about.
    local all_active="yes"
    for prod in "${needed[@]}"; do
      local status
      status=$(printf '%s' "$RESP_BODY" | jq -r --arg p "$prod" \
        '.products[] | select(.product == $p) | .status' 2>/dev/null | head -n1)
      if [ "$status" != "active" ]; then
        all_active="no"
        break
      fi
    done
    if [ "$all_active" = "yes" ]; then
      echo "    all 4 products active"
      return 0
    fi
    sleep 2
  done
  echo "    timed out — products still not all active" >&2
  printf '%s' "$RESP_BODY" | jq '.products' >&2 || true
  return 1
}

# ─── Step C: send test email ───────────────────────────────────
# windy-mail endpoint per reference_repo_locations.md memory:
# POST /api/v1/send. We send FROM the newly-provisioned mailbox TO
# a throwaway destination on the same domain so the message stays
# internal; failure indicates the mail backing service didn't pick
# up the provisioning webhook.
send_test_email() {
  http POST "${MAIL_URL}/api/v1/send" \
    -H 'Content-Type: application/json' \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -d "$(jq -nc \
            --arg to "selftest@windymail.ai" \
            --arg subject "smoke-test ${TS}" \
            --arg body "launch-smoke-test.sh ping at ${TS}" \
            '{to:$to, subject:$subject, body:$body}')" || return 1
}

# ─── Step D: post a chat message ───────────────────────────────
# windy-chat runs Synapse (Matrix). Matrix send requires a room ID +
# event body, and the onboarding service should have auto-joined the
# new user to their welcome room. Exact endpoint + welcome-room ID
# are owned by the chat terminal — stub here, flip to SKIP until
# chat confirms the path.
post_chat_message() {
  # TODO(chat): replace with authoritative send endpoint + welcome-room
  # discovery once windy-chat publishes it.
  return 99  # sentinel — handled as SKIP below
}

# ─── Step E: upload 1 KB to Windy Cloud ────────────────────────
upload_cloud_blob() {
  local tmp; tmp=$(mktemp)
  # 1 KB of deterministic-but-unique bytes so the exact same smoke run
  # doesn't collide with a previous run's blob in cache.
  printf 'smoke-%s-' "$TS" > "$tmp"
  head -c 1024 /dev/urandom | base64 | head -c 1024 >> "$tmp"

  # Cloud's generic upload endpoint isn't in account-server; we hit
  # windy-cloud directly. The archive/code-settings endpoint from the
  # memory snapshot is a specialised path — leave a TODO for the
  # cloud terminal to confirm the generic blob endpoint.
  if http POST "${CLOUD_URL}/api/v1/upload" \
      -H "Authorization: Bearer ${ACCESS_TOKEN}" \
      -F "file=@${tmp};filename=smoke-${TS}.bin" ; then
    rm -f "$tmp"
    return 0
  fi
  rm -f "$tmp"
  return 1
}

# ─── Step F: read back inbox (JMAP) + chat message ─────────────
read_back_inbox() {
  # windy-mail exposes GET /api/v1/inbox per memory. We just want to
  # see our subject line appear; exact JMAP method-call invocation
  # can slot in here once mail's JMAP gateway is exposed on a stable
  # path. For now the HTTP /inbox proxy is enough to prove the
  # mailbox exists and contains something.
  http GET "${MAIL_URL}/api/v1/inbox?limit=10" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" || return 1
  # Look for our subject; if absent, the send above hasn't flushed
  # through yet — count as fail rather than skip because sending and
  # reading are meant to round-trip within the smoke run.
  if ! printf '%s' "$RESP_BODY" | grep -q "smoke-test ${TS}"; then
    echo "    subject 'smoke-test ${TS}' not found in inbox" >&2
    return 1
  fi
}

read_back_chat() {
  # Paired with post_chat_message — same reason for deferring.
  return 99
}

# ─── Step G: cleanup — delete user, observe cascade ────────────
delete_user_and_verify_cascade() {
  http DELETE "${ACCOUNT_SERVER_URL}/api/v1/auth/me" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" || return 1

  # After delete, /identity/me with the same token must 401
  # (token invalidated) OR 404 (user gone). Either is correct.
  local status
  status=$(curl -sS -o /dev/null -w '%{http_code}' \
    -X GET "${ACCOUNT_SERVER_URL}/api/v1/identity/me" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}")
  if [ "$status" != "401" ] && [ "$status" != "404" ]; then
    echo "    expected 401/404 after delete, got ${status}" >&2
    return 1
  fi

  # The webhook fan-out bus should have enqueued `identity.revoked`
  # events to every configured target. We can only cheaply verify
  # this from outside the account DB, but each product service is
  # supposed to drop the product_account on revocation — mail's
  # /api/v1/inbox for that user should now 401/404.
  local mail_status
  mail_status=$(curl -sS -o /dev/null -w '%{http_code}' \
    -X GET "${MAIL_URL}/api/v1/inbox" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}")
  case "$mail_status" in
    401|403|404) ;;  # all acceptable — user gone from mail
    *) echo "    cascade verify: mail still serves 200 for deleted user (${mail_status})" >&2; return 1 ;;
  esac
}

# ─── Runner ────────────────────────────────────────────────────
main() {
  banner "Cross-product launch smoke test"
  echo "account-server : ${ACCOUNT_SERVER_URL}"
  echo "mail            : ${MAIL_URL}"
  echo "chat            : ${CHAT_URL}"
  echo "cloud           : ${CLOUD_URL}"
  echo "eternitas       : ${ETERNITAS_URL}"
  echo "test user       : ${SMOKE_EMAIL}"

  banner "A. Register test user on account-server"
  step "register user" register_user
  if [ -z "$ACCESS_TOKEN" ]; then
    echo "no access token — cannot continue; aborting." >&2
    exit 1
  fi

  banner "B. Poll /identity/me until mail + chat + cloud + clone active"
  step "product accounts active" poll_products_active

  banner "C. Send test email through windy-mail"
  step "send email" send_test_email

  banner "D. Post a chat message through windy-chat"
  # post_chat_message currently sentinel-SKIPs; keep the wiring so
  # flipping the TODO produces an immediate PASS/FAIL.
  if post_chat_message; then
    step "post chat message" true
  else
    case $? in
      99) step_skip "post chat message" "chat send endpoint pending (TODO(chat))" ;;
      *)  FAIL_COUNT=$((FAIL_COUNT + 1)); FAILED_STEPS+=("post chat message"); echo "  FAIL  post chat message" ;;
    esac
  fi

  banner "E. Upload 1 KB to Windy Cloud"
  step "upload blob" upload_cloud_blob

  banner "F. Round-trip reads (inbox + chat)"
  step "read back inbox" read_back_inbox
  if read_back_chat; then
    step "read back chat" true
  else
    case $? in
      99) step_skip "read back chat" "chat fetch endpoint pending (TODO(chat))" ;;
      *)  FAIL_COUNT=$((FAIL_COUNT + 1)); FAILED_STEPS+=("read back chat"); echo "  FAIL  read back chat" ;;
    esac
  fi

  banner "G. Cleanup + cascade revocation"
  if [ -n "${SMOKE_SKIP_CLEANUP:-}" ]; then
    step_skip "delete user" "SMOKE_SKIP_CLEANUP set"
  else
    step "delete user + cascade" delete_user_and_verify_cascade
  fi

  # ─── Summary ────────────────────────────────────────────────
  local elapsed=$(( $(date +%s) - START_EPOCH ))
  banner "Summary"
  echo "pass : ${PASS_COUNT}"
  echo "fail : ${FAIL_COUNT}"
  echo "skip : ${SKIP_COUNT}"
  echo "time : ${elapsed}s"
  if [ "$FAIL_COUNT" -gt 0 ]; then
    echo "failed steps:"
    for s in "${FAILED_STEPS[@]}"; do echo "  - ${s}"; done
    exit 1
  fi
}

main "$@"
