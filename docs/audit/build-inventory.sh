#!/bin/bash
# Build endpoint inventory from src/routes/*.ts and src/server.ts mounts.
set -e
cd /Users/thewindstorm/windy-pro/account-server

OUT=/Users/thewindstorm/windy-pro/docs/audit/endpoint-inventory.txt

{
  echo "# Endpoint inventory — account-server (generated $(date -u +%FT%TZ))"
  echo ""
  echo "## Mount map (from src/server.ts)"
  echo
  grep -nE "^app\.use\(" src/server.ts
  echo ""
  echo "## Routes (method, path, flags, handler:line)"
  echo ""
  for f in src/routes/*.ts; do
    echo ""
    echo "### $f"
    grep -nE "^router\.(get|post|put|patch|delete)\(" "$f" | while IFS= read -r line; do
      num=${line%%:*}
      rest=${line#*:}
      method=$(echo "$rest" | grep -oE "router\.\w+" | head -1 | sed "s/router\.//")
      path=$(echo "$rest" | grep -oE "'[^']+'" | head -1 | tr -d "'")
      flags=""
      echo "$rest" | grep -q "authenticateToken" && flags="$flags [auth]"
      echo "$rest" | grep -q "adminOnly"          && flags="$flags [admin]"
      echo "$rest" | grep -q "Limiter"            && flags="$flags [rate]"
      echo "$rest" | grep -q "validate("          && flags="$flags [zod]"
      printf "  %-6s %-40s %s  (L%s)\n" \
        "$(echo $method | tr a-z A-Z)" "$path" "$flags" "$num"
    done
  done
} > "$OUT"
wc -l "$OUT"
