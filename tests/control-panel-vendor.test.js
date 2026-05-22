/**
 * @jest-environment node
 *
 * WD-31 M-G — sanity tests for the vendored Control Panel runtime
 * shipped under src/client/desktop/control-panel/.
 *
 * The canonical packages have their own deep test suites in
 * sneakyfree/windy-control-panel (106 tests across 4 packages); here we
 * just smoke-check the in-repo vendored copies against accidental
 * drift from the upstream wire contracts. The renderer-side ESM
 * modules (vendor/host-web/* + vendor/protocols/*) are tested upstream
 * in the canonical package — see packages/host-web/tests/.
 */

'use strict';

const path = require('path');
const fs = require('fs');

const VENDOR_DIR = path.join(
  __dirname, '..', 'src', 'client', 'desktop', 'control-panel', 'vendor',
);

describe('vendored collect.cjs (Vitals v1 collector, main-process side)', () => {
  const { collect, VITALS_V1_SCHEMA_ID } = require(path.join(VENDOR_DIR, 'collect.cjs'));

  test('exports collect() + VITALS_V1_SCHEMA_ID', () => {
    expect(typeof collect).toBe('function');
    expect(VITALS_V1_SCHEMA_ID).toBe('windy.vitals.v1');
  });

  test('collect() returns a Vitals v1-shaped payload', async () => {
    const v = await collect();
    expect(v.schema).toBe('windy.vitals.v1');
    expect(v.source).toBe('electron-local');
    expect(typeof v.sampled_at).toBe('string');
    expect(v.host).toBeDefined();
    expect(typeof v.host.hostname).toBe('string');
    expect(v.host.location).toBeNull();
    expect(v.cpu).toBeDefined();
    expect(typeof v.cpu.avg_utilization_pct).toBe('number');
    expect(Array.isArray(v.cpu.core_utilization_pct)).toBe(true);
    expect(v.cpu.temperature_c).toBeNull();
    expect(v.gpu).toBeNull();
    expect(v.memory.total_bytes).toBeGreaterThan(0);
    expect(Number.isInteger(v.disk.total_bytes)).toBe(true);
    expect(v.network.total_tx_bytes_per_sec).toBe(0);
    expect(v.load).toHaveLength(3);
    expect(Number.isInteger(v.processes.all)).toBe(true);
    expect(v.processes.running).toBeNull();
    expect(v.processes.sleeping).toBeNull();
    expect(v.thermal).toBeNull();
  });

  test('platform is constrained to the HOST_PLATFORMS enum', async () => {
    const v = await collect();
    expect(['darwin', 'linux', 'win32', 'ios', 'android', 'unknown']).toContain(v.host.platform);
  });
});

describe('vendor file layout matches the bundle URL convention', () => {
  test('drops/echo-hq/0.1.0/ contains the required template files', () => {
    const base = path.join(
      __dirname, '..', 'src', 'client', 'desktop', 'control-panel', 'drops', 'echo-hq', '0.1.0',
    );
    for (const f of ['SKILL.md', 'render.html', 'render.js', 'styles.css']) {
      expect(fs.existsSync(path.join(base, f))).toBe(true);
    }
  });

  test('vendor/host-web/ + vendor/protocols/ are ESM modules (renderer-loadable)', () => {
    const hostJs = fs.readFileSync(path.join(VENDOR_DIR, 'host-web', 'host.js'), 'utf8');
    const protoJs = fs.readFileSync(path.join(VENDOR_DIR, 'host-web', 'protocol.js'), 'utf8');
    const protocolsJs = fs.readFileSync(path.join(VENDOR_DIR, 'protocols', 'index.js'), 'utf8');
    // No bare specifiers — they'd fail to resolve in a vanilla browser/Electron renderer.
    expect(hostJs).not.toMatch(/from\s+["']@windy\//);
    expect(protoJs).not.toMatch(/from\s+["']@windy\//);
    expect(protocolsJs).not.toMatch(/from\s+["']@windy\//);
    // The renderer-side vendored copies must be Zod-free (no bundler).
    expect(protoJs).not.toMatch(/from\s+["']zod["']/);
    expect(protocolsJs).not.toMatch(/from\s+["']zod["']/);
  });

  test('drop bundle render.html has the locked sandbox-protocol script', () => {
    const html = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'client', 'desktop', 'control-panel',
        'drops', 'echo-hq', '0.1.0', 'render.html'),
      'utf8',
    );
    expect(html).toMatch(/<div id="root">/);
    expect(html).toMatch(/import\s+{\s*render\s*}\s+from\s+"\.\/render\.js"/);
    expect(html).toMatch(/"data-update"/);
    expect(html).toMatch(/"mock-data"/);
    expect(html).toMatch(/"ready"/);
    expect(html).toMatch(/"rendered"/);
    expect(html).toMatch(/parent\.postMessage\([^,]+,\s*"\*"\)/);
  });
});
