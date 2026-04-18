#!/usr/bin/env bash
# CI ratchet: the count of raw `throw new Error(...)` calls in the
# install path MUST NOT INCREASE.
#
# Background: P7 introduced installer-v2/core/errors.js — the
# WINDY-NNN code registry. Going forward, user-facing throws should
# use `WindyError.from('WINDY-NNN', detail)`. There's a ~30-throw
# legacy backlog that gets upgraded transparently via
# friendlyError()'s codeFromMessage() matchers. We don't refactor
# all of them in one PR; instead this guard keeps the count from
# growing.
#
# When you legitimately need to add a new throw:
#   - Use WindyError.from() — and the count won't change here.
#   - If you absolutely must use raw Error, also reduce the count
#     somewhere else (refactor an existing throw to WindyError).
#
# The baseline number lives in BASELINE below. Update with intent.

set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

# Lock as of P7 commit. To shrink: refactor a raw throw → WindyError,
# then drop this number by the same amount in the same PR.
BASELINE=40

# Count throw-new-Error in the install path (installer-v2/) and
# main.js. Excludes comments by checking the line doesn't start
# with whitespace-then-// or contain " * ".
COUNT=$(grep -RIn 'throw new Error' --include='*.js' \
  installer-v2/ src/client/desktop/main.js 2>/dev/null \
  | grep -vE 'errors\.js:[0-9]+:[ ]*[^t]' \
  | wc -l \
  | tr -d ' ')

echo "throw-new-Error count: $COUNT (baseline: $BASELINE)"

if [ "$COUNT" -gt "$BASELINE" ]; then
  echo "✗ raw 'throw new Error' count grew above the baseline."
  echo "  Use WindyError.from('WINDY-NNN', detail) for new errors —"
  echo "  see installer-v2/core/errors.js + docs/ERRORS.md."
  echo
  echo "  If you intentionally added a raw throw and have a reason,"
  echo "  bump BASELINE in scripts/ci/check-error-codes.sh and explain"
  echo "  in your PR description."
  exit 1
fi

if [ "$COUNT" -lt "$BASELINE" ]; then
  echo "✓ Count went DOWN (great — but bump BASELINE down too in this PR"
  echo "  so it can't drift back up silently)."
  exit 0
fi

echo "✓ Count unchanged."
