#!/usr/bin/env bash
# Shared helpers for scripts/release/*. Source, don't execute.

set -euo pipefail

# Colourised status output. Falls back to plain text when stdout isn't
# a TTY (CI logs, redirection).
if [ -t 1 ]; then
  C_OK="\033[32m"; C_WARN="\033[33m"; C_ERR="\033[31m"; C_DIM="\033[2m"; C_END="\033[0m"
else
  C_OK=""; C_WARN=""; C_ERR=""; C_DIM=""; C_END=""
fi

log()   { printf "%b▸%b %s\n" "$C_DIM" "$C_END" "$*"; }
ok()    { printf "%b✓%b %s\n" "$C_OK"  "$C_END" "$*"; }
warn()  { printf "%b⚠%b %s\n" "$C_WARN" "$C_END" "$*" 1>&2; }
fail()  { printf "%b✗%b %s\n" "$C_ERR" "$C_END" "$*" 1>&2; exit 1; }

# REPO_ROOT is the absolute path to the windy-pro checkout.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

# Parse --help and --dry-run flags up-front so every script honours
# them consistently. Consumers use $DRY_RUN (0 or 1) to gate side
# effects. $HELP_REQUESTED is set by the caller after handling --help.
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
  esac
done

# Run a command, or log it when dry-run is set. Use for every
# side-effecting step — file writes, git operations, network calls.
run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    log "(dry-run) $*"
  else
    log "+ $*"
    "$@"
  fi
}

# Same but captures output. Returns the output on stdout.
run_capture() {
  if [ "$DRY_RUN" -eq 1 ]; then
    log "(dry-run) $*" 1>&2
    echo ""
  else
    "$@"
  fi
}

# Read version from package.json
pkg_version() {
  node -p "require('$REPO_ROOT/package.json').version"
}

# Detect host target for build-portable-bundle.js
detect_host_target() {
  case "$(uname -s)-$(uname -m)" in
    Darwin-arm64)        echo "mac-arm64" ;;
    Darwin-x86_64)       echo "mac-x64" ;;
    Linux-x86_64)        echo "linux-x64" ;;
    MINGW*-x86_64|MSYS*-x86_64|CYGWIN*-x86_64) echo "win-x64" ;;
    *) fail "unsupported host: $(uname -s)-$(uname -m)" ;;
  esac
}
