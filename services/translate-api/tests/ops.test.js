/**
 * Windy Translate ops-baseline tests (ADR-060 gap-closing):
 * /version (MF1), /ops/logs (content-free ring), /ops/selftest (canary
 * stages), and the opt-in WINDY_TRANSLATE_TOKEN bearer wall.
 *
 * node:test, no new deps. The NLLB worker is never spawned (require.main
 * guard); the selftest pipeline is exercised via the test indirection.
 *
 * Run: node --test tests/
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// Isolate the SQLite cache — never touch the real cache.db.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'windy-translate-test-'));
process.env.DB_PATH = path.join(tmpDir, 'cache.db');
delete process.env.WINDY_TRANSLATE_TOKEN;

const { app, _internals } = require('../server');

let server;
let baseURL;

before(async () => {
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    baseURL = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
    if (server) server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('GET /version — MF1 canonical shape, no auth, no worker', async () => {
    const res = await fetch(`${baseURL}/version`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.service, 'windy-translate');
    assert.ok(body.version, 'has version');
    for (const key of ['commit_sha', 'commit_sha_short', 'build_timestamp', 'started_at', 'environment']) {
        assert.ok(key in body, `has ${key}`);
    }
});

test('GET /health — unchanged, reports worker loading', async () => {
    const res = await fetch(`${baseURL}/health`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.status, 'ok');
    assert.strictEqual(body.worker, 'loading');
});

test('GET /ops/logs — fixed-vocabulary entries only, no free text', async () => {
    _internals.opsLog('info', 'worker_ready');
    _internals.opsLog('error', 'translation_error', 'timeout');
    const res = await fetch(`${baseURL}/ops/logs`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.service, 'windy-translate');
    assert.ok(body.entries.length >= 2);
    for (const entry of body.entries) {
        assert.deepStrictEqual(
            Object.keys(entry).sort().filter(k => k !== 'code'),
            ['event', 'level', 'ts'],
            'entry has only ts/level/event(+code)'
        );
    }
});

test('ops log ring is bounded at 500', async () => {
    for (let i = 0; i < 600; i++) _internals.opsLog('info', 'worker_ready');
    const res = await fetch(`${baseURL}/ops/logs`);
    const body = await res.json();
    assert.strictEqual(body.entries.length, 500);
    assert.strictEqual(body.max, 500);
});

test('POST /ops/selftest — worker not ready ⇒ honest per-stage failure', async () => {
    _internals.setWorkerReady(false);
    const res = await fetch(`${baseURL}/ops/selftest`, { method: 'POST' });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.passed, false);
    assert.ok(!('ok' in body), 'top-level ok reserved for the invoke envelope');
    const byName = Object.fromEntries(body.stages.map(s => [s.name, s]));
    assert.strictEqual(byName.worker.ok, false);
    assert.strictEqual(byName.translate.ok, false);
    assert.strictEqual(byName.cache.ok, true, 'cache stage passes independently');
});

test('POST /ops/selftest — full pass through stubbed pipeline', async () => {
    _internals.setWorkerReady(true);
    _internals.setTranslate(async () => ({ translated: 'hola mundo' }));
    try {
        const res = await fetch(`${baseURL}/ops/selftest`, { method: 'POST' });
        const body = await res.json();
        assert.strictEqual(body.passed, true);
        assert.deepStrictEqual(body.stages.map(s => s.ok), [true, true, true]);
        assert.match(body.stages[1].detail, /hola mundo/);
    } finally {
        _internals.setTranslate(null);
        _internals.setWorkerReady(false);
    }
});

test('token wall: enforced when WINDY_TRANSLATE_TOKEN is set; /health + /version exempt', async () => {
    process.env.WINDY_TRANSLATE_TOKEN = 'test-token-xyz';
    try {
        // Gated route without auth → structured 401 naming the remediation
        let res = await fetch(`${baseURL}/languages`);
        assert.strictEqual(res.status, 401);
        let body = await res.json();
        assert.strictEqual(body.error, 'missing_authorization');
        assert.match(body.remediation, /WINDY_TRANSLATE_TOKEN/);

        // Wrong token → 401 invalid_token
        res = await fetch(`${baseURL}/languages`, { headers: { authorization: 'Bearer wrong' } });
        assert.strictEqual(res.status, 401);
        body = await res.json();
        assert.strictEqual(body.error, 'invalid_token');

        // Right token → 200
        res = await fetch(`${baseURL}/languages`, { headers: { authorization: 'Bearer test-token-xyz' } });
        assert.strictEqual(res.status, 200);

        // /health and /version stay tokenless (probes + MF1)
        assert.strictEqual((await fetch(`${baseURL}/health`)).status, 200);
        assert.strictEqual((await fetch(`${baseURL}/version`)).status, 200);
    } finally {
        delete process.env.WINDY_TRANSLATE_TOKEN;
    }
});

test('token wall off (env unset) — routes stay open (compat)', async () => {
    const res = await fetch(`${baseURL}/languages`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(body.total > 90, 'language map intact');
});
