#!/usr/bin/env node
/**
 * Stamp the EDITION into the bundle at build time.
 *
 * edition.js resolves at app RUNTIME, where the end user's shell env is empty — so the
 * chosen edition must be persisted into a file the packaged app reads. This writes
 * edition.generated.json next to BOTH edition.js modules (desktop + installer).
 *
 * If the file is ever missing, edition.js resolves to 'standard' anyway — the stamp
 * now exists for build provenance, not for branching.
 *
 *   node scripts/stamp-edition.cjs   -> standard (7 engines — the only edition)
 */
'use strict';
const fs = require('fs');
const path = require('path');

// Consolidation 2026-07-21: one flagship edition. Legacy WINDY_EDITION values
// ('reader', 'lite') from old build scripts/CI all normalize to 'standard'.
const edition = 'standard';
void (process.env.WINDY_EDITION); // accepted for back-compat, no longer branches
const payload = JSON.stringify({ edition }) + '\n';

const targets = [
  'src/client/desktop/edition.generated.json',
  'installer-v2/core/edition.generated.json',
];
for (const rel of targets) {
  fs.writeFileSync(path.join(__dirname, '..', rel), payload);
  console.log('[stamp-edition]', rel, '->', edition);
}
