#!/usr/bin/env bash
#
# CI guard for wizard i18n coverage.
#
# Runs two checks:
#   1. Every data-i18n="foo.bar" attribute in wizard.html must have a
#      matching key in wizard-i18n.json (at least for the 'en' locale).
#      Catches typos + additions that forgot to register a key.
#
#   2. Every non-en locale must have the SAME set of keys as 'en'.
#      Missing keys in es/fr/etc. become visible as "fell back to
#      English" strings that confuse users mid-wizard.
#
# Usage:
#   ./scripts/ci/check-i18n-coverage.sh
#
# Exit code 0 when clean, 1 when gaps.

set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

WIZARD_HTML="installer-v2/screens/wizard.html"
I18N="installer-v2/screens/wizard-i18n.json"

[ -f "$WIZARD_HTML" ] || { echo "✗ $WIZARD_HTML not found"; exit 1; }
[ -f "$I18N" ]       || { echo "✗ $I18N not found"; exit 1; }

python3 - <<'PY'
import json
import re
import sys
from pathlib import Path

root = Path.cwd()
wizard = (root / 'installer-v2/screens/wizard.html').read_text()
i18n = json.loads((root / 'installer-v2/screens/wizard-i18n.json').read_text())

# Collect keys referenced in the HTML via data-i18n and data-i18n-placeholder
attrs = re.findall(r'data-i18n(?:-placeholder)?="([^"]+)"', wizard)
referenced = set(attrs)

# Baseline: 'en' must have every referenced key
en_keys = set(i18n.get('en', {}).keys())
missing_in_en = sorted(referenced - en_keys)

# Every other locale must match en
other_missing = {}
for lang, vals in i18n.items():
    if lang == 'en':
        continue
    diff = sorted(set(en_keys) - set(vals.keys()))
    if diff:
        other_missing[lang] = diff

exit_code = 0

if missing_in_en:
    print('✗ Referenced data-i18n keys NOT in en locale:')
    for k in missing_in_en:
        print(f'  {k}')
    exit_code = 1

if other_missing:
    print()
    print('✗ Non-en locales missing keys that exist in en:')
    for lang, keys in other_missing.items():
        print(f'  {lang}: missing {len(keys)} key(s)')
        for k in keys[:10]:
            print(f'    - {k}')
        if len(keys) > 10:
            print(f'    - (and {len(keys) - 10} more)')
    exit_code = 1

if exit_code == 0:
    print(f'✓ wizard i18n coverage clean ({len(en_keys)} keys × {len(i18n)} locales).')

sys.exit(exit_code)
PY
