#!/usr/bin/env bash
# ============================================================================
# WINDY PRO DESKTOP — HARDENING SCRIPT
# Run this from the windy-pro repo root on any machine.
# Usage: bash harden-windy-pro.sh [--fix]
#   --fix  Auto-fix what can be fixed (formatting, deps, etc.)
# ============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

FIX=false
[[ "${1:-}" == "--fix" ]] && FIX=true

PASS=0
WARN=0
FAIL=0
FIXES=0

pass()  { PASS=$((PASS+1)); echo -e "  ${GREEN}✅ PASS${NC} — $1"; }
warn()  { WARN=$((WARN+1)); echo -e "  ${YELLOW}⚠️  WARN${NC} — $1"; }
fail()  { FAIL=$((FAIL+1)); echo -e "  ${RED}❌ FAIL${NC} — $1"; }
fixed() { FIXES=$((FIXES+1)); echo -e "  ${BLUE}🔧 FIXED${NC} — $1"; }
section() { echo -e "\n${BLUE}━━━ $1 ━━━${NC}"; }

echo -e "${BLUE}╔════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   WINDY PRO DESKTOP — HARDENING AUDIT      ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}"
echo "  Repo: $(pwd)"
echo "  Date: $(date '+%Y-%m-%d %H:%M %Z')"
echo "  Mode: $( $FIX && echo 'FIX (auto-repair)' || echo 'AUDIT (read-only)' )"

# ── 1. GIT HEALTH ──────────────────────────────────────────────────────────
section "1. GIT HEALTH"

if git rev-parse --is-inside-work-tree &>/dev/null; then
  pass "Inside a git repo"
else
  fail "Not a git repo!"
  exit 1
fi

BRANCH=$(git branch --show-current)
if [[ "$BRANCH" == "main" || "$BRANCH" == "master" ]]; then
  pass "On branch: $BRANCH"
else
  warn "On branch '$BRANCH' — expected main/master"
fi

if git remote get-url origin &>/dev/null; then
  REMOTE=$(git remote get-url origin)
  pass "Remote origin: $REMOTE"
else
  fail "No remote origin configured"
fi

DIRTY=$(git status --porcelain | wc -l)
if [[ "$DIRTY" -eq 0 ]]; then
  pass "Working tree clean"
else
  warn "$DIRTY uncommitted change(s)"
  git status --porcelain | head -10
fi

LOCAL=$(git rev-parse HEAD 2>/dev/null)
REMOTE_HEAD=$(git rev-parse origin/main 2>/dev/null || git rev-parse origin/master 2>/dev/null || echo "unknown")
if [[ "$LOCAL" == "$REMOTE_HEAD" ]]; then
  pass "In sync with remote"
elif [[ "$REMOTE_HEAD" == "unknown" ]]; then
  warn "Can't determine remote HEAD — run 'git fetch' first"
else
  fail "Out of sync with remote! Local: ${LOCAL:0:7}, Remote: ${REMOTE_HEAD:0:7}"
  if $FIX; then
    git pull origin "$BRANCH" && fixed "Pulled latest from origin"
  fi
fi

# ── 2. DEPENDENCY HEALTH ──────────────────────────────────────────────────
section "2. DEPENDENCY HEALTH"

if [[ -f package-lock.json ]]; then
  pass "package-lock.json exists"
else
  fail "No package-lock.json — builds won't be reproducible"
fi

if [[ -d node_modules ]]; then
  pass "node_modules present"
else
  warn "node_modules missing — run 'npm install'"
  if $FIX; then
    npm install && fixed "Installed dependencies"
  fi
fi

# Check for known vulnerability scan
if command -v npm &>/dev/null; then
  AUDIT_OUT=$(npm audit --json 2>/dev/null || true)
  CRITICAL=$(echo "$AUDIT_OUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('metadata',{}).get('vulnerabilities',{}).get('critical',0))" 2>/dev/null || echo "?")
  HIGH=$(echo "$AUDIT_OUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('metadata',{}).get('vulnerabilities',{}).get('high',0))" 2>/dev/null || echo "?")
  if [[ "$CRITICAL" == "0" && "$HIGH" == "0" ]]; then
    pass "No critical/high npm vulnerabilities"
  elif [[ "$CRITICAL" == "?" ]]; then
    warn "Could not parse npm audit output"
  else
    fail "npm audit: $CRITICAL critical, $HIGH high vulnerabilities"
    if $FIX; then
      npm audit fix --force 2>/dev/null && fixed "Ran npm audit fix --force" || warn "npm audit fix failed — manual review needed"
    fi
  fi
fi

# ── 3. SECRETS & SECURITY ────────────────────────────────────────────────
section "3. SECRETS & SECURITY"

# Check .gitignore
if [[ -f .gitignore ]]; then
  pass ".gitignore exists"
  for pattern in ".env" "node_modules" "dist" "*.pem" "*.key"; do
    if grep -q "$pattern" .gitignore 2>/dev/null; then
      pass ".gitignore covers: $pattern"
    else
      warn ".gitignore missing pattern: $pattern"
      if $FIX; then
        echo "$pattern" >> .gitignore && fixed "Added '$pattern' to .gitignore"
      fi
    fi
  done
else
  fail "No .gitignore!"
fi

# Check for leaked secrets in tracked files
echo "  Scanning for potential secrets in tracked files..."
SECRET_HITS=$(git grep -lE '(sk-[a-zA-Z0-9]{20,}|AKIA[A-Z0-9]{16}|ghp_[a-zA-Z0-9]{36}|password\s*[:=]\s*["\x27][^"\x27]{8,})' -- '*.js' '*.ts' '*.json' '*.py' '*.html' 2>/dev/null | grep -v node_modules | grep -v package-lock || true)
if [[ -z "$SECRET_HITS" ]]; then
  pass "No obvious secrets found in tracked files"
else
  fail "Potential secrets found in:"
  echo "$SECRET_HITS" | head -10
fi

# Check for .env files that shouldn't be committed
ENV_FILES=$(git ls-files | grep -E '^\.env' || true)
if [[ -z "$ENV_FILES" ]]; then
  pass "No .env files tracked in git"
else
  fail "Tracked .env files (should be gitignored): $ENV_FILES"
fi

# ── 4. BUILD HEALTH ─────────────────────────────────────────────────────
section "4. BUILD HEALTH"

if [[ -f package.json ]]; then
  # Check that key scripts exist
  for script in "start" "build" "test"; do
    if python3 -c "import json; d=json.load(open('package.json')); assert '$script' in d.get('scripts',{})" 2>/dev/null; then
      pass "Script defined: $script"
    else
      warn "Missing script: $script"
    fi
  done
fi

# Check Electron builder config
if [[ -f electron-builder.yml ]] || grep -q '"build"' package.json 2>/dev/null; then
  pass "Electron builder config found"
else
  warn "No electron-builder config found"
fi

# Check if dist exists and is reasonable
if [[ -d dist ]]; then
  DIST_SIZE=$(du -sm dist 2>/dev/null | cut -f1)
  pass "dist/ exists (${DIST_SIZE}MB)"
else
  warn "No dist/ directory — hasn't been built yet"
fi

# ── 5. TEST HEALTH ──────────────────────────────────────────────────────
section "5. TEST HEALTH"

TEST_COUNT=$(find tests/ -type f \( -name "*.py" -o -name "*.test.*" \) 2>/dev/null | wc -l)
if [[ "$TEST_COUNT" -gt 0 ]]; then
  pass "$TEST_COUNT test file(s) found in tests/"
else
  fail "No test files found!"
fi

# Run tests if pytest available
if command -v python3 &>/dev/null && python3 -c "import pytest" 2>/dev/null; then
  echo "  Running pytest (quick mode)..."
  if python3 -m pytest tests/ -v --ignore=tests/test_cloud_api.py --tb=short -q 2>/dev/null; then
    pass "All tests passing"
  else
    fail "Some tests failed — check output above"
  fi
else
  warn "pytest not available — can't run tests"
fi

# ── 6. DOCUMENTATION ────────────────────────────────────────────────────
section "6. DOCUMENTATION"

for doc in README.md LICENSE CHANGELOG.md; do
  if [[ -f "$doc" ]]; then
    pass "$doc exists"
  else
    warn "Missing: $doc"
  fi
done

# ── 7. CI/CD ────────────────────────────────────────────────────────────
section "7. CI/CD"

if [[ -d .github/workflows ]]; then
  WF_COUNT=$(ls .github/workflows/*.yml 2>/dev/null | wc -l)
  pass "$WF_COUNT GitHub Actions workflow(s) found"
else
  warn "No .github/workflows/ — no CI/CD configured"
fi

# ── 8. ENVIRONMENT TEMPLATE ─────────────────────────────────────────────
section "8. ENVIRONMENT"

if [[ -f .env.example ]]; then
  pass ".env.example exists (template for new developers)"
else
  warn "No .env.example — new clones won't know what env vars are needed"
fi

# ── SUMMARY ─────────────────────────────────────────────────────────────
section "SUMMARY"
echo ""
echo -e "  ${GREEN}✅ Passed: $PASS${NC}"
echo -e "  ${YELLOW}⚠️  Warnings: $WARN${NC}"
echo -e "  ${RED}❌ Failed: $FAIL${NC}"
if $FIX; then
  echo -e "  ${BLUE}🔧 Fixed: $FIXES${NC}"
fi
echo ""

if [[ "$FAIL" -eq 0 ]]; then
  echo -e "  ${GREEN}🎉 REPO IS HEALTHY${NC}"
  exit 0
elif [[ "$FAIL" -le 3 ]]; then
  echo -e "  ${YELLOW}⚠️  REPO NEEDS MINOR ATTENTION${NC}"
  exit 1
else
  echo -e "  ${RED}🚨 REPO NEEDS SERIOUS HARDENING${NC}"
  exit 2
fi
