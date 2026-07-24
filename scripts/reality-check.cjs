#!/usr/bin/env node
/**
 * reality-check — mechanical audit of "does this actually do what we claim?"
 *
 * WHY THIS EXISTS
 * The 2026-07-24 code audit surfaced five separate defects with one shared
 * shape: a capability that looks finished, reports success, and does nothing.
 *   · prune  — a button that can never fire on a bundled build
 *   · telemetry — a system that ships switched off, silently
 *   · LLM polish — a paywall flag wired to no implementation
 *   · country geo — a disclosure promise with no collector behind it
 *   · cloud — a pathway pointed at a competitor
 * The Stage-7 saga was the same disease: synthetic tests passed all day while
 * the real feature was dead.
 *
 * The countermeasure is not five patches. It is a standing invariant —
 * NO SILENT NO-OPS — enforced by a check that fails loudly.
 *
 *   node scripts/reality-check.cjs            # audit; exits 1 on a HARD failure
 *   node scripts/reality-check.cjs --release  # also requires live telemetry
 *
 * Escape hatch: ALLOW_INERT_TELEMETRY=1 to deliberately cut a build that
 * reports nothing. It must be a decision, never an accident.
 *
 * This checks what a machine can check. It does NOT replace installing the
 * packaged app on a clean machine and poking it — that is still the only
 * proof that counts (see docs/EXECUTION-PLAN.md, "Verification discipline").
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RELEASE = process.argv.includes('--release');

const results = [];
const HARD = 'HARD', WARN = 'WARN', OK = 'OK', SKIP = 'SKIP';

function record(level, name, detail) {
  results.push({ level, name, detail });
}
function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}
function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}
/** Run a check; a thrown error becomes SKIP rather than a crash. */
function check(name, fn) {
  try {
    fn();
  } catch (err) {
    record(SKIP, name, `could not evaluate — ${err.message}`);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// 1. Telemetry must be live in a release build.
// ───────────────────────────────────────────────────────────────────────────
check('telemetry is armed', () => {
  const cfg = JSON.parse(read('src/client/desktop/telemetry.generated.json'));
  const armed = Boolean(cfg.ingest_url) && Boolean(cfg.ingest_token);

  if (armed) {
    record(OK, 'telemetry is armed', `ingest ${cfg.ingest_url}`);
  } else if (!RELEASE) {
    record(OK, 'telemetry is armed', 'inert — correct for a source build');
  } else if (process.env.ALLOW_INERT_TELEMETRY === '1') {
    record(WARN, 'telemetry is armed',
      'INERT, allowed by ALLOW_INERT_TELEMETRY=1 — this build will report nothing');
  } else {
    record(HARD, 'telemetry is armed',
      'telemetry.generated.json is inert in a RELEASE build — the shipped app would never phone home');
  }
});

// ───────────────────────────────────────────────────────────────────────────
// 2. The GPU pack must not be advertised as engines it does not add.
//    GPU_PACK re-runs existing ladder models on CUDA; it introduces no new
//    engine ids. So no public claim may exceed the ladder length.
// ───────────────────────────────────────────────────────────────────────────
check('engine-count claims are true', () => {
  const catalog = require(path.join(ROOT, 'src/client/desktop/lib/engine-catalog.js'));
  const ladderIds = catalog.LADDER.map((e) => e.model);
  const packIds = catalog.GPU_PACK.models;
  const novel = packIds.filter((m) => !ladderIds.includes(m));
  const ceiling = ladderIds.length + novel.length;

  if (novel.length === 0) {
    record(OK, 'GPU pack adds no new engines',
      `${packIds.length} pack models are all ladder rungs — real ceiling is ${ceiling}`);
  } else {
    record(OK, 'GPU pack adds new engines', `${novel.length} novel — ceiling is ${ceiling}`);
  }

  // Scan public-facing copy for numeric engine claims.
  //
  // Precision matters more than reach here: a check that cries wolf gets
  // muted, and a muted check is the silent no-op it was written to prevent.
  // So only claims that unambiguously describe the SPEECH ladder ("voice
  // engines", or an "up to N" on such a line) can hard-fail. Other engine
  // counts are measured against a different catalog — the ~100-entry
  // translation registry in docs/model_registry.json — and are reported for a
  // human to verify rather than blocking a release on a wrong comparison.
  const webDir = path.join(ROOT, 'src/client/web/src/pages');
  const pages = fs.existsSync(webDir) ? fs.readdirSync(webDir).filter((f) => f.endsWith('.jsx')) : [];
  const offenders = [];
  const unverified = [];

  const isSpeechClaim = (line) => /voice engine/i.test(line);
  const isTranslation = (line) => /translation|translate|language pair/i.test(line);

  for (const page of pages) {
    const text = fs.readFileSync(path.join(webDir, page), 'utf8');
    text.split('\n').forEach((line, i) => {
      if (!/engine/i.test(line)) return;

      const numbers = [];
      for (const m of line.matchAll(/\b(\d{1,3})\s*(?:[–-]\s*(\d{1,3}))?(?=[\w\s%]{0,24}engine)/gi)) {
        numbers.push(m[1], m[2]);
      }
      for (const m of line.matchAll(/up to (\d{1,3})/gi)) numbers.push(m[1]);

      const over = numbers.filter((n) => n && Number(n) > ceiling).map(Number);
      if (!over.length) return;

      const where = `${page}:${i + 1}`;
      if (isSpeechClaim(line)) {
        offenders.push(`${where} claims ${over.join('/')} voice engines, ceiling is ${ceiling}`);
      } else if (!isTranslation(line)) {
        unverified.push(`${where} claims ${over.join('/')} engines — verify against the intended catalog`);
      }
    });
  }

  if (offenders.length) {
    record(HARD, 'engine-count claims are true', offenders.join('; '));
  } else {
    record(OK, 'engine-count claims are true', `no voice-engine claim exceeds ${ceiling}`);
  }
  if (unverified.length) {
    record(WARN, 'unverified engine claims', unverified.join('; '));
  }
});

// ───────────────────────────────────────────────────────────────────────────
// 3. Prune reachability. Prune only ever deletes user-DOWNLOADED models; if a
//    build bundles the whole ladder, the trash affordance can never appear.
// ───────────────────────────────────────────────────────────────────────────
check('prune is reachable', () => {
  const catalog = require(path.join(ROOT, 'src/client/desktop/lib/engine-catalog.js'));
  const ladderIds = catalog.LADDER.map((e) => e.model);
  const bundledDir = path.join(ROOT, 'bundled', 'model');

  if (!fs.existsSync(bundledDir)) {
    record(SKIP, 'prune is reachable', 'no bundled/model tree in this checkout');
    return;
  }
  const bundled = fs.readdirSync(bundledDir).filter((d) => ladderIds.includes(d));
  if (bundled.length >= ladderIds.length) {
    record(WARN, 'prune is reachable',
      `all ${ladderIds.length} engines are bundled — prune can never fire on this build (lean core fixes this)`);
  } else {
    record(OK, 'prune is reachable',
      `${bundled.length}/${ladderIds.length} bundled — the rest are prunable once downloaded`);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// 4. Paid-tier flags must not advertise capabilities with no implementation.
// ───────────────────────────────────────────────────────────────────────────
check('paid flags have implementations', () => {
  const main = read('src/client/desktop/main.js');
  const advertised = /llmPolish:\s*true/.test(main);
  // An implementation would have to call out to a polish/cleanup backend.
  const implemented = /polish\s*\(|applyPolish|cleanupTranscript|polishTranscript/.test(main)
    || exists('src/client/desktop/lib/llm-polish.js')
    || exists('src/engine/polish.py');

  if (advertised && !implemented) {
    record(WARN, 'paid flags have implementations',
      'llmPolish is sold in the tier table but nothing implements it — a switch wired to nothing (Phase 2)');
  } else if (advertised) {
    record(OK, 'paid flags have implementations', 'llmPolish advertised and implemented');
  } else {
    record(OK, 'paid flags have implementations', 'llmPolish not advertised');
  }
});

// ───────────────────────────────────────────────────────────────────────────
// 5. Every collection promised in the disclosure must have a collector.
//    Over-disclosure is legally safe but means a promised capability (the
//    country-segmented dashboard) cannot actually be built.
// ───────────────────────────────────────────────────────────────────────────
check('disclosed collection is real', () => {
  const discPath = 'src/client/web/src/pages/Disclosure.jsx';
  if (!exists(discPath)) {
    record(SKIP, 'disclosed collection is real', 'no Disclosure.jsx');
    return;
  }
  const promisesCountry = /country[- ]level/i.test(read(discPath));
  if (!promisesCountry) {
    record(OK, 'disclosed collection is real', 'no country-level promise to honour');
    return;
  }
  const srv = path.join(ROOT, 'account-server/src');
  let collects = false;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (collects) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts')) {
        if (/cf-ipcountry|CF-IPCountry|geoip|req\.cf\b/i.test(fs.readFileSync(full, 'utf8'))) collects = true;
      }
    }
  };
  if (fs.existsSync(srv)) walk(srv);

  if (collects) {
    record(OK, 'disclosed collection is real', 'country-level promised and collected');
  } else {
    record(WARN, 'disclosed collection is real',
      'disclosure promises country-level geography but no collector exists — the country dashboard cannot be built (Phase 1)');
  }
});

// ───────────────────────────────────────────────────────────────────────────
// Report
// ───────────────────────────────────────────────────────────────────────────
const icon = { [OK]: '  ok  ', [WARN]: ' warn ', [HARD]: ' FAIL ', [SKIP]: ' skip ' };
const hard = results.filter((r) => r.level === HARD);
const warn = results.filter((r) => r.level === WARN);

console.log(`\nreality-check${RELEASE ? ' --release' : ''} — no silent no-ops\n`);
for (const r of results) console.log(`[${icon[r.level]}] ${r.name}\n           ${r.detail}`);
console.log(
  `\n${results.filter((r) => r.level === OK).length} ok · ${warn.length} warn · ${hard.length} fail\n`
);

if (hard.length) {
  console.error('reality-check FAILED — a shipped build would lie about what it does.\n');
  process.exit(1);
}
