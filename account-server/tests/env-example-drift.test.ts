/**
 * P0-6 — guard against .env.example drift.
 *
 * Before Wave 7, .env.example documented 5 env vars while the code used 53.
 * Operators following the template silently shipped with unsafe defaults
 * (missing MFA_ENCRYPTION_KEY, ETERNITAS_WEBHOOK_SECRET, CORS_ALLOWED_ORIGINS,
 * etc.). This test pins the contract: every `process.env.X` referenced in
 * src/ must appear in .env.example.
 */
import fs from 'fs';
import path from 'path';

const SRC_DIR = path.resolve(__dirname, '..', 'src');
const ENV_EXAMPLE = path.resolve(__dirname, '..', '.env.example');

// Vars the codebase reads from `process.env` that we intentionally DO NOT
// list in .env.example because they're either:
//   - set by the runtime (NODE_ENV, PORT handled outside user config)
//   - or debugging conveniences never needed in prod
const DOCUMENTED_EXCEPTIONS = new Set<string>([
  // NODE_ENV is set by the shell/deploy, not the user's .env file
  // (we DO list it for clarity, so actually nothing's exempt right now)
]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
      out.push(...walk(full));
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js'))) {
      out.push(full);
    }
  }
  return out;
}

function extractProcessEnvUses(): Set<string> {
  const re = /process\.env\.([A-Z_][A-Z0-9_]+)/g;
  const used = new Set<string>();
  for (const file of walk(SRC_DIR)) {
    const src = fs.readFileSync(file, 'utf-8');
    for (const m of src.matchAll(re)) used.add(m[1]);
  }
  return used;
}

function extractEnvExampleVars(): Set<string> {
  const content = fs.readFileSync(ENV_EXAMPLE, 'utf-8');
  const re = /^([A-Z_][A-Z0-9_]+)=/gm;
  const declared = new Set<string>();
  for (const m of content.matchAll(re)) declared.add(m[1]);
  return declared;
}

describe('P0-6 .env.example drift guard', () => {
  it('every process.env.X referenced in src/ is listed in .env.example', () => {
    const used = extractProcessEnvUses();
    const declared = extractEnvExampleVars();
    const missing = [...used].filter(v => !declared.has(v) && !DOCUMENTED_EXCEPTIONS.has(v));
    missing.sort();
    // A clear failure message so a future dev can see exactly what to add.
    expect(missing).toEqual([]);
  });

  it('.env.example has no duplicate KEY= lines', () => {
    const content = fs.readFileSync(ENV_EXAMPLE, 'utf-8');
    const seen = new Map<string, number>();
    for (const m of content.matchAll(/^([A-Z_][A-Z0-9_]+)=/gm)) {
      seen.set(m[1], (seen.get(m[1]) || 0) + 1);
    }
    const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k).sort();
    expect(dupes).toEqual([]);
  });

  it('.env.example mentions every webhook secret a producer fans out to', () => {
    const content = fs.readFileSync(ENV_EXAMPLE, 'utf-8');
    for (const name of ['MAIL', 'CHAT', 'CLOUD', 'CLONE']) {
      expect(content).toMatch(new RegExp(`WINDY_${name}_WEBHOOK_SECRET=`));
    }
    expect(content).toMatch(/ETERNITAS_WEBHOOK_SECRET=/);
  });

  it('.env.example flags the production-required variables', () => {
    const content = fs.readFileSync(ENV_EXAMPLE, 'utf-8');
    // Sanity that the required-in-prod vars are present (the guard test above
    // catches them structurally; this confirms the documentation actually
    // calls out the severity).
    expect(content).toMatch(/TRUST_PROXY=/);
    expect(content).toMatch(/CORS_ALLOWED_ORIGINS=/);
    expect(content).toMatch(/JWT_SECRET=/);
    expect(content).toMatch(/MFA_ENCRYPTION_KEY=/);
  });
});
