#!/usr/bin/env node
/**
 * Rewrite src/client/desktop/telemetry.generated.json at PACKAGE time from:
 *   WINDY_ADMIN_INGEST_URL
 *   WINDY_ADMIN_INGEST_TOKEN__WINDY_WORD_DESKTOP
 *
 * The committed file is INERT ({"ingest_url":"","ingest_token":""}) so a
 * source build emits nothing. Release builds bake the desktop service token
 * in so the packaged app needs no env vars.
 *
 * IMPORTANT (see RELEASE.md): after packaging, restore the inert file with
 *   git checkout -- src/client/desktop/telemetry.generated.json
 * so a real token is NEVER committed. This script refuses to run if either
 * env var is missing (prints a notice and leaves the file untouched) so the
 * normal dev `npm run build` flow stays inert.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'src', 'client', 'desktop', 'telemetry.generated.json');
const url = process.env.WINDY_ADMIN_INGEST_URL || '';
const token = process.env.WINDY_ADMIN_INGEST_TOKEN__WINDY_WORD_DESKTOP || '';

if (!url || !token) {
  console.log('[gen-telemetry-config] env not set — leaving telemetry.generated.json inert');
  process.exit(0);
}

fs.writeFileSync(target, JSON.stringify({ ingest_url: url, ingest_token: token }, null, 2) + '\n');
console.log(`[gen-telemetry-config] wrote ingest config for ${url} (token: ${token.slice(0, 6)}…)`);
console.log('[gen-telemetry-config] REMEMBER: git checkout -- src/client/desktop/telemetry.generated.json after packaging');
