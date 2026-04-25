#!/usr/bin/env bash
# CI guard: refuse if anyone re-introduces the legacy
# extraResources/venv directory or references to it.
#
# Background: a previous build pipeline shipped a pre-built Python
# venv inside extraResources/. Its pyvenv.cfg contained
# `home = /Users/thewindstorm/windy-pro/extraResources/python/bin` —
# Grant's laptop path. On every other machine, the venv was dead on
# arrival. The bulletproof installer now creates the venv at
# install time from bundled wheels (see installer-v2/core/
# bundled-assets.js installVenvFromWheels). The legacy approach
# must never come back.
#
# This script fails when:
#   1. extraResources/venv exists in the working tree (ignoring
#      .gitignored copies — those don't ship)
#   2. Any tracked source file references `extraResources/venv` or
#      `bundled/venv` paths
#
# Exits 0 when clean, 1 with a descriptive error otherwise.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

EXIT=0

# 1. Tracked legacy venv directory
if git ls-files --error-unmatch extraResources/venv >/dev/null 2>&1; then
  echo "✗ extraResources/venv is tracked. Delete it — the wizard's"
  echo "  fast path creates the venv at install time from bundled wheels."
  EXIT=1
fi

# 2. Source-code references to legacy venv layout (excluding this
#    guard script and SESSION-NOTES which mentions it as history).
HITS=$(grep -RIn --include='*.js' --include='*.ts' --include='*.json' --include='*.yml' --include='*.html' \
  -e 'extraResources/venv' -e 'bundled/venv' -e 'extraResources\\\\venv' \
  -- ':!node_modules' ':!dist*' ':!docs/SECURITY-AUDIT*' ':!SESSION-NOTES.md' ':!scripts/ci/check-no-legacy-venv.sh' 2>/dev/null \
  || true)
if [ -n "$HITS" ]; then
  echo "✗ Source references the legacy venv path:"
  echo "$HITS"
  echo
  echo "  The wizard's bundled-assets.js fast-path creates the venv"
  echo "  on the user's machine — the legacy pre-built venv has"
  echo "  hardcoded absolute paths that break on every other machine."
  EXIT=1
fi

if [ $EXIT -eq 0 ]; then
  echo "✓ No legacy extraResources/venv references found."
fi
exit $EXIT
