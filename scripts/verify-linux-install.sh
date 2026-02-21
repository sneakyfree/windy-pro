#!/usr/bin/env bash
# Windy Pro — Linux Install Verification Script
# Run after packaging to validate:
#   1. Binary exists and is executable
#   2. Desktop entry is valid
#   3. Exec= line handles paths with spaces
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

pass() { echo -e "${GREEN}✓ $1${NC}"; }
fail() { echo -e "${RED}✗ $1${NC}"; FAILED=1; }

FAILED=0

echo "=== Windy Pro Linux Install Verification ==="
echo

# 1. Check binary
BINARY=$(command -v windy-pro 2>/dev/null || echo "")
if [ -z "$BINARY" ]; then
  # Try common install paths
  for p in /usr/bin/windy-pro /usr/local/bin/windy-pro /opt/Windy\ Pro/windy-pro; do
    if [ -f "$p" ]; then BINARY="$p"; break; fi
  done
fi

if [ -n "$BINARY" ]; then
  pass "Binary found: $BINARY"
  if [ -x "$BINARY" ]; then
    pass "Binary is executable"
  else
    fail "Binary is NOT executable: $BINARY"
  fi
else
  fail "Binary not found in PATH or common locations"
fi

# 2. Check desktop entry
DESKTOP_FILE=""
for d in /usr/share/applications/windy-pro.desktop \
         /usr/local/share/applications/windy-pro.desktop \
         "$HOME/.local/share/applications/windy-pro.desktop"; do
  if [ -f "$d" ]; then DESKTOP_FILE="$d"; break; fi
done

if [ -n "$DESKTOP_FILE" ]; then
  pass "Desktop entry found: $DESKTOP_FILE"

  # 3. Validate Exec= line
  EXEC_LINE=$(grep "^Exec=" "$DESKTOP_FILE" 2>/dev/null || echo "")
  if [ -n "$EXEC_LINE" ]; then
    pass "Exec= line found: $EXEC_LINE"
    # Check for quoting (handles paths with spaces)
    if echo "$EXEC_LINE" | grep -q '"'; then
      pass "Exec= line has proper quoting for space-safe paths"
    else
      fail "Exec= line lacks quoting — may fail with paths containing spaces"
    fi
  else
    fail "No Exec= line found in desktop entry"
  fi

  # Validate with desktop-file-validate if available
  if command -v desktop-file-validate &>/dev/null; then
    if desktop-file-validate "$DESKTOP_FILE" 2>/dev/null; then
      pass "desktop-file-validate passed"
    else
      fail "desktop-file-validate reported errors"
    fi
  fi
else
  echo "  (Desktop entry not found — expected after package install)"
fi

echo
if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}All checks passed.${NC}"
else
  echo -e "${RED}Some checks failed. Review above.${NC}"
  exit 1
fi
