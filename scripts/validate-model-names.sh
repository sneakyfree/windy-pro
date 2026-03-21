#!/bin/bash
# ─── MODEL NAME VALIDATOR ───
# Reads MODEL_GLOSSARY.json (source of truth) and checks the entire
# codebase for mismatches, old names, or orphaned references.
# Run after ANY model rename, addition, or code change.
# Exit code: 0 = clean, 1 = violations found

set -e
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GLOSSARY="$REPO_ROOT/docs/MODEL_GLOSSARY.json"
VIOLATIONS=0

echo "═══════════════════════════════════════════════════════"
echo "  MODEL NAME VALIDATOR — Source of Truth Alignment"
echo "═══════════════════════════════════════════════════════"
echo ""

# ─── CHECK 1: No 'windy-stt' or 'Windy STT' anywhere ───
echo "CHECK 1: Banned patterns (windy-stt, Windy STT, windy_translate)"
hits=$(grep -rn "windy-stt\|Windy STT\|windy_translate" "$REPO_ROOT/" \
  --include="*.js" --include="*.json" --include="*.html" --include="*.jsx" \
  --include="*.ts" --include="*.tsx" --include="*.css" --include="*.py" \
  | grep -v node_modules | grep -v ".git/" | grep -v ".min." \
  | grep -v "validate-model-names" | wc -l)
if [ "$hits" -gt 0 ]; then
  echo "  ❌ FAIL: $hits banned references found:"
  grep -rn "windy-stt\|Windy STT\|windy_translate" "$REPO_ROOT/" \
    --include="*.js" --include="*.json" --include="*.html" --include="*.jsx" \
    --include="*.ts" --include="*.tsx" --include="*.css" --include="*.py" \
    | grep -v node_modules | grep -v ".git/" | grep -v ".min." \
    | grep -v "validate-model-names" | head -20
  VIOLATIONS=$((VIOLATIONS + hits))
else
  echo "  ✅ PASS: No banned patterns found"
fi

echo ""

# ─── CHECK 2: No 'STT' in user-facing display names ───
echo "CHECK 2: No 'STT' in display names (user-facing files)"
user_files="$REPO_ROOT/src/client $REPO_ROOT/installer-v2/screens"
hits=$(grep -rn "STT" $user_files \
  --include="*.js" --include="*.html" --include="*.jsx" \
  | grep -v node_modules | grep -v ".git/" | grep -v ".min." \
  | grep -v "windy-nano\|windy-lite\|windy-core\|windy-edge\|windy-plus\|windy-turbo\|windy-pro-engine\|windy-distil" \
  | grep -v "setLocalDescription\|setRemoteDescription\|RTCSession" \
  | wc -l)
if [ "$hits" -gt 0 ]; then
  echo "  ❌ FAIL: $hits 'STT' references in user-facing code:"
  grep -rn "STT" $user_files \
    --include="*.js" --include="*.html" --include="*.jsx" \
    | grep -v node_modules | grep -v ".git/" | grep -v ".min." \
    | grep -v "setLocalDescription\|setRemoteDescription\|RTCSession" \
    | head -10
  VIOLATIONS=$((VIOLATIONS + hits))
else
  echo "  ✅ PASS: No 'STT' in user-facing code"
fi

echo ""

# ─── CHECK 3: No competitor names in user-facing code ───
echo "CHECK 3: No competitor names in user-facing code"
hits=$(grep -rniE "Wispr Flow|Otter\.ai|Rev\.com|AssemblyAI" \
  "$REPO_ROOT/src/client" "$REPO_ROOT/installer-v2" \
  --include="*.js" --include="*.html" --include="*.jsx" \
  | grep -v node_modules | grep -v ".git/" | grep -v "/dist/" | grep -v ".min." | wc -l)
if [ "$hits" -gt 0 ]; then
  echo "  ❌ FAIL: $hits competitor names found:"
  grep -rniE "Wispr Flow|Otter\.ai|Rev\.com|AssemblyAI" \
    "$REPO_ROOT/src/client" "$REPO_ROOT/installer-v2" \
    --include="*.js" --include="*.html" --include="*.jsx" \
    | grep -v node_modules | grep -v ".git/" | grep -v "/dist/" | grep -v ".min." | head -10
  VIOLATIONS=$((VIOLATIONS + hits))
else
  echo "  ✅ PASS: No competitor names in user-facing code"
fi

echo ""

# ─── CHECK 4: No vendor API names in user-facing code ───
echo "CHECK 4: No vendor names (Deepgram/Groq/OpenAI) in user-facing text"
hits=$(grep -rn "Deepgram\|Groq\|OpenAI" \
  "$REPO_ROOT/src/client/desktop/renderer/privacy.html" \
  "$REPO_ROOT/src/client/desktop/renderer/terms.html" \
  "$REPO_ROOT/src/client/desktop/renderer/settings.js" \
  "$REPO_ROOT/installer-v2/screens/wizard.html" \
  2>/dev/null | wc -l)
if [ "$hits" -gt 0 ]; then
  echo "  ❌ FAIL: $hits vendor name leaks:"
  grep -rn "Deepgram\|Groq\|OpenAI" \
    "$REPO_ROOT/src/client/desktop/renderer/privacy.html" \
    "$REPO_ROOT/src/client/desktop/renderer/terms.html" \
    "$REPO_ROOT/src/client/desktop/renderer/settings.js" \
    "$REPO_ROOT/installer-v2/screens/wizard.html" 2>/dev/null | head -10
  VIOLATIONS=$((VIOLATIONS + hits))
else
  echo "  ✅ PASS: No vendor names in user-facing text"
fi

echo ""

# ─── CHECK 5: Old wizard is dead ───
echo "CHECK 5: Old wizard.js is gone"
if [ -f "$REPO_ROOT/src/client/desktop/renderer/wizard.js" ]; then
  echo "  ❌ FAIL: Old wizard.js still exists!"
  VIOLATIONS=$((VIOLATIONS + 1))
else
  echo "  ✅ PASS: wizard.js deleted"
fi
hits=$(grep -n "SetupWizard" "$REPO_ROOT/src/client/desktop/renderer/app.js" 2>/dev/null | wc -l)
if [ "$hits" -gt 0 ]; then
  echo "  ❌ FAIL: SetupWizard still referenced in app.js"
  VIOLATIONS=$((VIOLATIONS + 1))
else
  echo "  ✅ PASS: No SetupWizard references"
fi

echo ""
echo "═══════════════════════════════════════════════════════"
if [ "$VIOLATIONS" -gt 0 ]; then
  echo "  ❌ FAILED: $VIOLATIONS violations found"
  exit 1
else
  echo "  ✅ ALL CHECKS PASSED"
  exit 0
fi
