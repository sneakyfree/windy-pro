#!/usr/bin/env bash
#
# Pre-release sanity checks. Run this FIRST before any other release
# script. Fails fast if anything's off. Safe to run repeatedly.
#
# Checks:
#   1. Working tree clean (no uncommitted / untracked files)
#   2. On main branch (warn only — installer-bundling-v3 is OK during
#      the beta)
#   3. Up to date with origin
#   4. package.json version looks like semver
#   5. CHANGELOG.md mentions the current version
#   6. CI is green on the current HEAD
#   7. Required tooling present (node 20+, python 3.11+, curl)
#   8. No uncommitted security-relevant files (anything matching the
#      secret-keyword pattern) — prevents accidentally leaking a .env.
#
# Usage:
#   ./scripts/release/preflight.sh [--dry-run] [--skip-ci-check]
#
# Exits 0 if ready to release, 1 otherwise.

# shellcheck source=_common.sh
source "$(dirname "$0")/_common.sh"

if [[ " $* " == *" --help "* ]]; then
  sed -n '2,20p' "$0"
  exit 0
fi

SKIP_CI=0
for arg in "$@"; do
  case "$arg" in
    --skip-ci-check) SKIP_CI=1 ;;
  esac
done

EXIT_CODE=0
say_fail() { printf "%b✗%b %s\n" "$C_ERR" "$C_END" "$*" 1>&2; EXIT_CODE=1; }

# ── 1. Working tree clean ─────────────────────────────────────────────
if [ -n "$(git status --porcelain)" ]; then
  say_fail "working tree has uncommitted changes:"
  git status --short 1>&2
else
  ok "working tree clean"
fi

# ── 2. Branch ─────────────────────────────────────────────────────────
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$BRANCH" = "main" ] || [ "$BRANCH" = "master" ]; then
  ok "on branch $BRANCH"
else
  warn "on branch '$BRANCH', not main — OK for beta but confirm intent before tagging"
fi

# ── 3. Up to date with origin ─────────────────────────────────────────
if run git fetch origin --quiet 2>/dev/null; then
  LOCAL=$(git rev-parse @)
  REMOTE=$(git rev-parse "@{u}" 2>/dev/null || echo "")
  if [ -z "$REMOTE" ]; then
    warn "branch has no upstream — skipping fetch comparison"
  elif [ "$LOCAL" = "$REMOTE" ]; then
    ok "branch is up to date with origin/$BRANCH"
  else
    say_fail "branch is out of sync with origin/$BRANCH (local=$LOCAL remote=$REMOTE)"
  fi
else
  warn "git fetch failed — skipping remote comparison"
fi

# ── 4. Version looks like semver ──────────────────────────────────────
VERSION="$(pkg_version)"
if [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-z.]+[0-9]*)?$ ]]; then
  ok "package.json version: $VERSION"
else
  say_fail "package.json version '$VERSION' isn't semver-shaped"
fi

# ── 5. CHANGELOG mentions this version ────────────────────────────────
if [ -f "CHANGELOG.md" ]; then
  if grep -q "$VERSION" CHANGELOG.md; then
    ok "CHANGELOG.md mentions version $VERSION"
  else
    warn "CHANGELOG.md doesn't mention version $VERSION — add a section before tagging"
  fi
else
  warn "CHANGELOG.md not found"
fi

# ── 6. CI green on HEAD ───────────────────────────────────────────────
if [ "$SKIP_CI" -eq 1 ]; then
  log "skipping CI check (--skip-ci-check)"
elif command -v gh >/dev/null 2>&1; then
  SHA="$(git rev-parse HEAD)"
  # Get conclusion of the latest completed CI run on this SHA
  STATE="$(gh run list --workflow=ci.yml --branch "$BRANCH" --limit 3 \
    --json headSha,conclusion,status --jq \
    "map(select(.headSha == \"$SHA\" and .status == \"completed\"))[0].conclusion" \
    2>/dev/null || echo "")"
  case "$STATE" in
    success) ok "ci.yml green on $BRANCH@${SHA:0:7}" ;;
    "")      warn "ci.yml hasn't completed yet on $SHA — wait or --skip-ci-check" ;;
    *)       say_fail "ci.yml is $STATE on $BRANCH@${SHA:0:7}" ;;
  esac
else
  warn "gh CLI not installed — skipping CI check"
fi

# ── 7. Required tooling ───────────────────────────────────────────────
check_cmd() {
  local cmd="$1" min="$2" ver_cmd="$3"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    say_fail "$cmd not installed (need $min+)"
    return
  fi
  local v
  v="$(eval "$ver_cmd" 2>&1 | head -1)"
  ok "$cmd: $v"
}
check_cmd node '20' 'node -v'
check_cmd python3 '3.11' 'python3 --version'
check_cmd curl 'any' 'curl --version | head -1'
check_cmd npm '10' 'npm --version'

# ── 8. No secrets staged ──────────────────────────────────────────────
SECRET_PATTERNS='(\.env$|\.env\.|credentials\.json|private[_-]?key|id_rsa|\.pem$)'
TRACKED_SECRETS="$(git ls-files | grep -E "$SECRET_PATTERNS" || true)"
if [ -n "$TRACKED_SECRETS" ]; then
  say_fail "secret-shaped files tracked in git:"
  printf '  %s\n' $TRACKED_SECRETS 1>&2
else
  ok "no secret-shaped files tracked"
fi

# ── Summary ───────────────────────────────────────────────────────────
if [ "$EXIT_CODE" -eq 0 ]; then
  ok "preflight passed — safe to proceed"
else
  fail "preflight found blockers (see above) — fix before releasing"
fi
