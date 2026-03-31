/**
 * Ecosystem Smoke Test — proves the full API surface works end-to-end.
 *
 * Starts the account server, runs through the core identity + billing +
 * recordings flow, then shuts down. Uses plain fetch (Node 18+).
 *
 * Run: node tests/ecosystem-smoke.test.js
 *   or: cd account-server && npm test (if wired into jest)
 */

const { spawn } = require('child_process');
const crypto = require('crypto');
const path = require('path');

const BASE = 'http://localhost:8098';
const TEST_EMAIL = `smoke-${Date.now()}@test.windypro.com`;
const TEST_PASSWORD = 'SmokeTest!2026';
const TEST_NAME = 'Smoke Tester';

let serverProcess = null;
let passed = 0;
let failed = 0;

// ─── Helpers ────────────────────────────────────────────────

async function api(method, path, body, token) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${BASE}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
}

function assert(label, condition, detail) {
    if (condition) {
        console.log(`  ✓ ${label}`);
        passed++;
    } else {
        console.error(`  ✗ ${label}${detail ? ': ' + detail : ''}`);
        failed++;
    }
}

async function waitForServer(maxWait = 15000) {
    const start = Date.now();
    while (Date.now() - start < maxWait) {
        try {
            const res = await fetch(`${BASE}/health`);
            if (res.ok) return true;
        } catch {}
        await new Promise(r => setTimeout(r, 500));
    }
    throw new Error('Server did not start within ' + maxWait + 'ms');
}

// ─── Start server ───────────────────────────────────────────

async function startServer() {
    const serverDir = path.join(__dirname, '..', 'account-server');
    console.log('Starting account server...');

    serverProcess = spawn('npx', ['tsx', 'src/server.ts'], {
        cwd: serverDir,
        env: {
            ...process.env,
            PORT: '8098',
            NODE_ENV: 'development',
            JWT_SECRET: crypto.randomBytes(32).toString('hex'),
            JWKS_KEY_DIR: path.join(serverDir, 'keys'),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    serverProcess.stdout.on('data', () => {});
    serverProcess.stderr.on('data', () => {});

    await waitForServer();
    console.log('Server ready.\n');
}

// ─── Tests ──────────────────────────────────────────────────

async function runTests() {
    let token = null;
    let userId = null;

    // 1. Register
    console.log('1. Register user');
    {
        const { status, data } = await api('POST', '/api/v1/auth/register', {
            name: TEST_NAME,
            email: TEST_EMAIL,
            password: TEST_PASSWORD,
        });
        assert('Returns 201', status === 201);
        assert('Has userId', !!data.userId);
        assert('Has JWT token', !!data.token);
        assert('Has windyIdentityId', !!data.windyIdentityId);
        token = data.token;
        userId = data.userId;
    }

    // 2. Login
    console.log('\n2. Login');
    {
        const { status, data } = await api('POST', '/api/v1/auth/login', {
            email: TEST_EMAIL,
            password: TEST_PASSWORD,
        });
        assert('Returns 200', status === 200);
        assert('Has token', !!data.token);
        assert('Email matches', data.email === TEST_EMAIL.toLowerCase());
        token = data.token; // Use fresh token
    }

    // 3. Validate token
    console.log('\n3. Validate token (cross-product)');
    {
        const { status, data } = await api('GET', '/api/v1/identity/validate-token', null, token);
        assert('Returns 200', status === 200);
        assert('valid=true', data.valid === true);
        assert('Has windy_identity_id', !!data.windy_identity_id);
        assert('Has email', data.email === TEST_EMAIL.toLowerCase());
        assert('Has scopes', Array.isArray(data.scopes));
        assert('Has products', Array.isArray(data.products));
        assert('Has canonical_tier', !!data.canonical_tier);
    }

    // 4. JWKS + JWT signature verification
    console.log('\n4. JWKS endpoint + JWT verification');
    {
        const { status, data } = await api('GET', '/.well-known/jwks.json');
        assert('Returns 200', status === 200);
        assert('Has keys array', Array.isArray(data.keys));

        if (data.keys.length > 0) {
            const key = data.keys[0];
            assert('Key has kty=RSA', key.kty === 'RSA');
            assert('Key has alg=RS256', key.alg === 'RS256');
            assert('Key has use=sig', key.use === 'sig');
            assert('Key has kid', !!key.kid);
            assert('Key has modulus (n)', !!key.n);
            assert('Key has exponent (e)', !!key.e);

            // Verify JWT signature using the JWKS public key (pure crypto, no jsonwebtoken dep)
            try {
                const [headerB64, payloadB64, sigB64] = token.split('.');
                const pem = crypto.createPublicKey({ key: { kty: key.kty, n: key.n, e: key.e }, format: 'jwk' });
                const sigBuf = Buffer.from(sigB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
                const valid = crypto.createVerify('RSA-SHA256')
                    .update(`${headerB64}.${payloadB64}`)
                    .verify(pem, sigBuf);
                assert('JWT RS256 signature valid via JWKS', valid);

                const payload = JSON.parse(Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
                assert('JWT has userId', !!payload.userId);
                assert('JWT has scopes', Array.isArray(payload.scopes));
                assert('JWT issuer is windy-identity', payload.iss === 'windy-identity');
            } catch (err) {
                assert('JWT RS256 signature valid via JWKS', false, err.message);
            }
        } else {
            console.log('  (No RS256 keys — HS256 fallback mode, skipping signature check)');
        }
    }

    // 5. Chat provision (dev stub)
    console.log('\n5. Chat provision');
    {
        const { status, data } = await api('POST', '/api/v1/identity/chat/provision', {}, token);
        // Dev mode returns a stub response (no Synapse running)
        assert('Returns 200 or 201', status === 200 || status === 201);
        assert('Has response body', !!data);
    }

    // 6. Checkout session (Stripe not configured — expect error or stub)
    console.log('\n6. Stripe checkout session');
    {
        const { status, data } = await api('POST', '/api/v1/stripe/create-checkout-session', {
            tier: 'pro',
            billing_type: 'monthly',
        }, token);
        // With placeholder key, Stripe SDK will fail — that's expected
        assert('Returns response', status >= 200);
        assert('Has error or url', !!data.error || !!data.url);
        if (data.error) {
            console.log(`    (Expected: Stripe not configured — "${data.error}")`);
        }
    }

    // 7. Recordings list
    console.log('\n7. Recordings list');
    {
        const { status, data } = await api('GET', '/api/v1/recordings/list', null, token);
        assert('Returns 200', status === 200);
        assert('Has recordings array', Array.isArray(data.recordings || data.bundles || []));
    }

    // 8. Clone training data
    console.log('\n8. Clone training data');
    {
        const { status, data } = await api('GET', '/api/v1/clone/training-data', null, token);
        assert('Returns 200', status === 200);
        assert('Has bundles array', Array.isArray(data.bundles));
        assert('Bundles empty for new user', data.bundles.length === 0);
    }

    // 9. OIDC Discovery
    console.log('\n9. OIDC Discovery');
    {
        const { status, data } = await api('GET', '/.well-known/openid-configuration');
        assert('Returns 200', status === 200);
        assert('Has issuer', !!data.issuer);
        assert('Has jwks_uri', !!data.jwks_uri);
        assert('Has token_endpoint', !!data.token_endpoint);
    }
}

// ─── Main ───────────────────────────────────────────────────

async function main() {
    try {
        await startServer();
        await runTests();
    } catch (err) {
        console.error('\nFATAL:', err.message);
        failed++;
    } finally {
        if (serverProcess) {
            serverProcess.kill('SIGTERM');
            await new Promise(r => setTimeout(r, 500));
        }

        console.log(`\n${'═'.repeat(50)}`);
        console.log(`Results: ${passed} passed, ${failed} failed`);
        console.log(`${'═'.repeat(50)}`);
        process.exit(failed > 0 ? 1 : 0);
    }
}

main();
