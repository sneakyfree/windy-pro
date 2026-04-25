#!/usr/bin/env bash
# Wave 13 Phase 1 — render the cloud-init user-data template.
#
# Reads deploy/wave13/user-data.sh.tmpl and writes to stdout with
# placeholders replaced. Inputs come from env vars (never argv) so
# secrets don't show up in the process listing or shell history.
#
# Required env:
#   RDS_ENDPOINT    e.g. windy-pro-identity.xxxxx.us-east-1.rds.amazonaws.com
#   RDS_PASSWORD    32-char plaintext (kept in memory; never file-logged)
#   REPO_REF        git ref to deploy. Default: main
#
# Usage (at FIRE 2):
#   export RDS_ENDPOINT='<from FIRE 1 output>'
#   export RDS_PASSWORD='<from FIRE 1 output>'
#   export REPO_REF='wave13/phase1-aws-deploy'   # or 'main' post-merge
#   aws ec2 run-instances ... \
#       --user-data "$(scripts/wave13-render-user-data.sh)"
#
# The script fails fast if any required var is missing so we never
# launch an instance with half-rendered placeholders.

set -euo pipefail

: "${RDS_ENDPOINT:?RDS_ENDPOINT is required}"
: "${RDS_PASSWORD:?RDS_PASSWORD is required}"
REPO_REF="${REPO_REF:-main}"

TMPL="$(dirname "$0")/../deploy/wave13/user-data.sh.tmpl"
[ -f "$TMPL" ] || { echo "template not found: $TMPL" >&2; exit 1; }

# Use awk instead of sed so a password containing regex-active
# characters (/, &, .) renders literally without escaping gymnastics.
awk -v rep_endpoint="$RDS_ENDPOINT" \
    -v rep_password="$RDS_PASSWORD" \
    -v rep_ref="$REPO_REF" \
    '{
        gsub(/__RDS_ENDPOINT__/, rep_endpoint);
        gsub(/__RDS_PASSWORD__/, rep_password);
        gsub(/__REPO_REF__/, rep_ref);
        print;
    }' "$TMPL"
