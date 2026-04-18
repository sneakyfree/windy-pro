#!/bin/bash
# Phase 7 — Concurrency torture.
# 100 parallel signups (duplicate emails + unique emails), parallel logins for
# one account (refresh-token race), parallel provisioning.
set -u
API="${API:-http://127.0.0.1:8098}"
OUT=/Users/thewindstorm/windy-pro/docs/audit/concurrency-results.md

{
  echo "# Concurrency torture — $(date -u +%FT%TZ)"
  echo ""

  echo "## Test 1: 100 parallel register — ALL unique emails"
  echo ""
  STAMP=$(date +%s%N)
  for i in $(seq 1 100); do
    curl -sS -o /tmp/cc1-$i.out -w "%{http_code}\n" -X POST "$API/api/v1/auth/register" \
      -H 'Content-Type: application/json' \
      -d "{\"name\":\"cc1-$i\",\"email\":\"cc1-${STAMP}-$i@x.test\",\"password\":\"Aa1bcdefg\"}" &
  done
  wait
  echo '```'
  sort /tmp/cc1-*.out 2>/dev/null | uniq -c | sort -rn | head -5
  echo '```'
  echo "Expect: ~100 × 201 (all succeed, unique emails have no collision)"
  rm -f /tmp/cc1-*.out
  echo ""

  echo "## Test 2: 100 parallel register — SAME email (race on UNIQUE constraint)"
  echo ""
  DUPE="cc2-${STAMP}@x.test"
  for i in $(seq 1 100); do
    curl -sS -o /tmp/cc2-$i.out -w "%{http_code}\n" -X POST "$API/api/v1/auth/register" \
      -H 'Content-Type: application/json' \
      -d "{\"name\":\"cc2-$i\",\"email\":\"$DUPE\",\"password\":\"Aa1bcdefg\"}" &
  done
  wait
  echo '```'
  sort /tmp/cc2-*.out 2>/dev/null | uniq -c | sort -rn | head -5
  echo '```'
  echo "Expect: exactly 1 × 201, 99 × 409 (duplicate email). **P0 if any 500s appear.**"
  # Also check: only ONE user row exists
  echo "Row count for $DUPE:"
  sqlite3 /Users/thewindstorm/windy-pro/account-server/accounts.db "SELECT COUNT(*) FROM users WHERE email='$DUPE'"
  rm -f /tmp/cc2-*.out
  echo ""

  echo "## Test 3: 50 parallel /login for one user — refresh-token race"
  echo ""
  EMAIL="cc3-${STAMP}@x.test"
  curl -sS -o /dev/null -X POST "$API/api/v1/auth/register" \
    -H 'Content-Type: application/json' \
    -d "{\"name\":\"cc3\",\"email\":\"$EMAIL\",\"password\":\"Aa1bcdefg\"}"
  for i in $(seq 1 50); do
    curl -sS -o /tmp/cc3-$i.out -w "%{http_code}\n" -X POST "$API/api/v1/auth/login" \
      -H 'Content-Type: application/json' \
      -d "{\"email\":\"$EMAIL\",\"password\":\"Aa1bcdefg\"}" &
  done
  wait
  echo '```'
  sort /tmp/cc3-*.out 2>/dev/null | uniq -c | sort -rn | head -5
  echo '```'
  echo "Expect: mix of 200 + 429 (rate limit = 5/min per IP in prod; set to 10000 in test mode)."
  echo "Refresh-token rows for this user:"
  UID=$(sqlite3 /Users/thewindstorm/windy-pro/account-server/accounts.db "SELECT id FROM users WHERE email='$EMAIL'")
  sqlite3 /Users/thewindstorm/windy-pro/account-server/accounts.db "SELECT COUNT(*) FROM refresh_tokens WHERE user_id='$UID'"
  echo "Expect: 1. >1 = refresh-token leak."
  rm -f /tmp/cc3-*.out
  echo ""

  echo "## Test 4: Latency distribution — 200 sequential register + login"
  echo ""
  if which hey >/dev/null 2>&1; then
    # Register 200 — use hey with constant body template via Content-Type header
    BASE="cc4-${STAMP}"
    echo "### hey: POST /api/v1/auth/register × 200 (5 concurrent, random email via cookie trick)"
    echo '```'
    # hey cannot vary body per request; run a small static burst to get a latency
    # profile on DUPLICATE-email attempts (409 path is realistic under attack)
    hey -n 200 -c 5 -m POST -T application/json \
      -d "{\"name\":\"cc4\",\"email\":\"${BASE}-static@x.test\",\"password\":\"Aa1bcdefg\"}" \
      "$API/api/v1/auth/register" 2>&1 | tail -40
    echo '```'
  else
    echo "(hey not installed — skipping latency test)"
  fi
} > "$OUT" 2>&1
wc -l "$OUT"
echo "written → $OUT"
