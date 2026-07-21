#!/usr/bin/env node
/**
 * Stamp the book-launch EDITION into the bundle at build time.
 *
 * edition.js resolves at app RUNTIME, where the end user's shell env is empty — so the
 * chosen edition must be persisted into a file the packaged app reads. This writes
 * edition.generated.json next to BOTH edition.js modules (desktop + installer).
 *
 * If the file is ever missing, edition.js falls back to the WINDY_EDITION env var, then
 * to 'reader' — so a plain `electron-builder` build is always a valid Reader edition.
 *
 *   WINDY_EDITION=lite   node scripts/stamp-edition.cjs   -> Lite (2 engines)
 *   WINDY_EDITION=reader node scripts/stamp-edition.cjs   -> Reader (7 engines, default)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const edition = (process.env.WINDY_EDITION || 'reader').toLowerCase() === 'lite' ? 'lite' : 'reader';
const payload = JSON.stringify({ edition }) + '\n';

const targets = [
  'src/client/desktop/edition.generated.json',
  'installer-v2/core/edition.generated.json',
];
for (const rel of targets) {
  fs.writeFileSync(path.join(__dirname, '..', rel), payload);
  console.log('[stamp-edition]', rel, '->', edition);
}
