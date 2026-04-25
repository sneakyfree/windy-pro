#!/usr/bin/env bash
#
# Promote / demote a release on GitHub Releases.
#
# Stable / beta / alpha is indicated by GH Release tag metadata:
#   - "Latest"       = stable (exactly one release at a time)
#   - "Prerelease"   = beta (1+ allowed)
#   - Otherwise      = alpha or historical
#
# Usage:
#   ./scripts/release/promote.sh stable v1.7.0           # mark v1.7.0 stable
#   ./scripts/release/promote.sh beta v1.8.0-beta.2      # mark as prerelease
#   ./scripts/release/promote.sh rollback v1.6.5         # make prior the latest
#   ./scripts/release/promote.sh [--dry-run] …
#
# Prints the auto-updater's latest-mac.yml URL so you can verify the
# feed after promoting.
#
# Exits 0 on success, 1 on missing tag or gh failure.

# shellcheck source=_common.sh
source "$(dirname "$0")/_common.sh"

if [[ " $* " == *" --help "* ]]; then
  sed -n '2,20p' "$0"
  exit 0
fi

ACTION="${1-}"
TAG="${2-}"

case "$ACTION" in
  stable|beta|rollback) ;;
  *) fail "usage: $0 <stable|beta|rollback> <tag> [--dry-run]" ;;
esac
if [ -z "$TAG" ]; then fail "tag required. e.g. $0 $ACTION v1.7.0"; fi

command -v gh >/dev/null 2>&1 || fail "gh CLI not installed"

# Confirm the tag exists on GitHub
if ! gh release view "$TAG" >/dev/null 2>&1; then
  fail "release tag '$TAG' not found on GitHub. List with: gh release list"
fi

case "$ACTION" in
  stable)
    log "promoting $TAG to stable (mark as Latest)"
    run gh release edit "$TAG" --latest --prerelease=false
    ok "$TAG is now the default download"
    ;;
  beta)
    log "marking $TAG as beta (prerelease)"
    # Explicitly DON'T mark latest; prerelease releases aren't surfaced
    # as the default download.
    run gh release edit "$TAG" --prerelease=true --latest=false
    ok "$TAG is marked prerelease — opt-in via Settings → Update Channel → Beta"
    ;;
  rollback)
    log "rolling back: making $TAG the current Latest"
    CURRENT_LATEST="$(gh release view --json tagName --jq .tagName 2>/dev/null || echo "")"
    if [ -n "$CURRENT_LATEST" ] && [ "$CURRENT_LATEST" != "$TAG" ]; then
      log "demoting previous latest: $CURRENT_LATEST"
      run gh release edit "$CURRENT_LATEST" --prerelease=true --latest=false
    fi
    run gh release edit "$TAG" --latest --prerelease=false
    warn "users who already updated to $CURRENT_LATEST will NOT auto-downgrade."
    warn "They'll need to manually download $TAG from the releases page."
    ok "$TAG is now Latest; $CURRENT_LATEST is demoted to prerelease"
    ;;
esac

# Show the updater feed URL so the caller can verify the YAML points
# at the expected version.
case "$(uname -s)" in
  Darwin) FEED="latest-mac.yml" ;;
  Linux)  FEED="latest-linux.yml" ;;
  *)      FEED="latest.yml" ;;
esac
REPO="$(git config --get remote.origin.url | sed -E 's#.*[:/]([^/]+/[^/.]+)(\.git)?$#\1#')"
log "auto-updater feed URL:"
log "  https://github.com/$REPO/releases/latest/download/$FEED"

ok "promote action '$ACTION' complete"
