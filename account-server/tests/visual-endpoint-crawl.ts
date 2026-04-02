/**
 * Visual endpoint crawl — hits every endpoint on a running server.
 * Run with: npx tsx tests/visual-endpoint-crawl.ts
 */
import crypto from 'crypto';

const BASE = process.env.BASE_URL || 'http://localhost:8098';

interface Result {
    endpoint: string;
    status: number;
    ok: boolean;
    details?: Record<string, any>;
}

async function crawl() {
    const results: Result[] = [];
    const ts = Date.now();

    // ─── Health & Discovery ───────────────────────────
    console.log('Crawling health & discovery...');

    let r = await fetch(`${BASE}/health`);
    let body = await r.json() as any;
    results.push({ endpoint: 'GET /health', status: r.status, ok: r.ok, details: { service: body.service, users: body.users } });

    r = await fetch(`${BASE}/.well-known/openid-configuration`);
    body = await r.json() as any;
    results.push({ endpoint: 'GET /.well-known/openid-configuration', status: r.status, ok: r.ok, details: { hasJwksUri: !!body.jwks_uri, grantTypes: body.grant_types_supported?.length } });

    r = await fetch(`${BASE}/.well-known/jwks.json`);
    const jwks = await r.json() as any;
    results.push({ endpoint: 'GET /.well-known/jwks.json', status: r.status, ok: r.ok, details: { keyCount: jwks.keys?.length || 0, alg: jwks.keys?.[0]?.alg } });

    // ─── Register ─────────────────────────────────────
    console.log('Registering test user...');

    r = await fetch(`${BASE}/api/v1/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: `crawl-${ts}@test.com`, password: 'CrawlPass1!', name: 'Crawl Test' }),
    });
    const reg = await r.json() as any;
    results.push({ endpoint: 'POST /auth/register', status: r.status, ok: r.ok, details: { hasToken: !!reg.token, hasIdentityId: !!reg.windyIdentityId } });

    const token = reg.token;
    if (!token) { console.error('FATAL: No token from register'); process.exit(1); }
    const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    // ─── JWT Verification against JWKS ────────────────
    console.log('Verifying JWT against JWKS...');

    const [, payloadB64, sigB64] = token.split('.');
    const headerB64 = token.split('.')[0];
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString());
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());

    let jwtVerified = false;
    if (jwks.keys?.length > 0) {
        const matchingKey = jwks.keys.find((k: any) => k.kid === header.kid);
        if (matchingKey) {
            try {
                const pubKey = crypto.createPublicKey({ key: matchingKey, format: 'jwk' });
                const verifier = crypto.createVerify('RSA-SHA256');
                verifier.update(`${headerB64}.${payloadB64}`);
                jwtVerified = verifier.verify(pubKey, sigB64, 'base64url');
            } catch { jwtVerified = false; }
        }
    }
    results.push({ endpoint: 'JWT JWKS Verification', status: jwtVerified ? 200 : 500, ok: jwtVerified, details: { alg: header.alg, kid: header.kid, verified: jwtVerified, claims: Object.keys(payload) } });

    // ─── Authenticated GET endpoints ──────────────────
    console.log('Crawling authenticated endpoints...');

    const getEndpoints = [
        '/api/v1/auth/me',
        '/api/v1/auth/devices',
        '/api/v1/auth/billing',
        '/api/v1/identity/me',
        '/api/v1/identity/ecosystem-status',
        '/api/v1/identity/validate-token',
        '/api/v1/identity/scopes',
        '/api/v1/identity/products',
        '/api/v1/identity/chat/profile',
        '/api/v1/recordings',
        '/api/v1/recordings/list',
        '/api/v1/recordings/stats',
        '/api/v1/clone/training-data',
        '/api/v1/files',
        '/api/v1/billing/transactions',
        '/api/v1/billing/summary',
        '/api/v1/oauth/userinfo',
    ];

    for (const ep of getEndpoints) {
        r = await fetch(`${BASE}${ep}`, { headers: auth });
        const b = await r.json() as any;
        const extra: Record<string, any> = {};

        if (ep.includes('ecosystem-status')) {
            extra.products = Object.keys(b.products || {});
            extra.hasAllProducts = ['windy_word', 'windy_chat', 'windy_mail', 'windy_cloud', 'windy_fly', 'eternitas'].every(p => extra.products.includes(p));
            extra.creatorName = b.creator_name;
        }
        if (ep.includes('validate-token')) {
            extra.valid = b.valid;
            extra.scopes = b.scopes;
        }

        results.push({ endpoint: `GET ${ep}`, status: r.status, ok: r.status < 500, details: extra });
    }

    // ─── Authenticated POST endpoints ─────────────────
    console.log('Crawling POST endpoints...');

    // Chat provision
    r = await fetch(`${BASE}/api/v1/identity/chat/provision`, { method: 'POST', headers: auth, body: '{}' });
    const chatBody = await r.json() as any;
    results.push({ endpoint: 'POST /identity/chat/provision', status: r.status, ok: r.status < 500, details: { hasMatrixId: !!chatBody.matrix?.matrixUserId, creatorName: chatBody.creator_name } });

    // Login
    r = await fetch(`${BASE}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: `crawl-${ts}@test.com`, password: 'CrawlPass1!' }),
    });
    results.push({ endpoint: 'POST /auth/login', status: r.status, ok: r.ok });

    // Cloud stubs
    for (const stub of ['/api/v1/cloud/phone/provision', '/api/v1/cloud/phone/release', '/api/v1/cloud/push/send']) {
        r = await fetch(`${BASE}${stub}`, { method: 'POST', headers: auth, body: '{}' });
        results.push({ endpoint: `POST ${stub}`, status: r.status, ok: r.ok });
    }

    // Fly chat proxy
    r = await fetch(`${BASE}/api/v1/fly/chat`, { method: 'POST', headers: auth, body: JSON.stringify({ message: 'hello' }) });
    const flyBody = await r.json() as any;
    results.push({ endpoint: 'POST /fly/chat', status: r.status, ok: r.ok, details: { hasResponse: !!flyBody.response, offline: flyBody.offline } });

    // ─── Error handling ───────────────────────────────
    console.log('Checking error handling...');

    r = await fetch(`${BASE}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'nobody@test.com', password: 'wrong' }),
    });
    results.push({ endpoint: 'POST /auth/login (bad creds)', status: r.status, ok: r.status === 401 });

    r = await fetch(`${BASE}/api/v1/identity/me`, { headers: { Authorization: 'Bearer garbage' } });
    results.push({ endpoint: 'GET /identity/me (bad token)', status: r.status, ok: r.status === 401 || r.status === 403 });

    r = await fetch(`${BASE}/api/v1/identity/me`);
    results.push({ endpoint: 'GET /identity/me (no auth)', status: r.status, ok: r.status === 401 });

    // ─── GDPR Cleanup ─────────────────────────────────
    console.log('Cleaning up...');

    r = await fetch(`${BASE}/api/v1/auth/me`, { method: 'DELETE', headers: auth });
    const del = await r.json() as any;
    results.push({ endpoint: 'DELETE /auth/me (GDPR)', status: r.status, ok: r.ok, details: { deleted: del.deleted } });

    r = await fetch(`${BASE}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: `crawl-${ts}@test.com`, password: 'CrawlPass1!' }),
    });
    results.push({ endpoint: 'POST /auth/login (after delete)', status: r.status, ok: r.status === 401 });

    // ─── Print Results ────────────────────────────────
    console.log('\n══════════════════════════════════════════════');
    console.log('  WINDY PRO — VISUAL ENDPOINT CRAWL RESULTS');
    console.log('══════════════════════════════════════════════\n');

    let passed = 0, failed = 0;
    for (const result of results) {
        const icon = result.ok ? 'PASS' : 'FAIL';
        if (result.ok) passed++; else failed++;
        console.log(`  ${icon}: ${result.endpoint} [${result.status}]`);
        if (result.details && Object.keys(result.details).length > 0) {
            for (const [k, v] of Object.entries(result.details)) {
                const val = Array.isArray(v) ? v.join(', ') : v;
                console.log(`        ${k}: ${val}`);
            }
        }
    }

    console.log(`\n  Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
    if (failed > 0) process.exit(1);
}

crawl().catch(e => { console.error('CRAWL FAILED:', e); process.exit(1); });
