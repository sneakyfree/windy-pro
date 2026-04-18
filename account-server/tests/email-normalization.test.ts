/**
 * P1-12 — email normalization in forgot-password rate-limit key and
 * handler lookup must agree, so case/whitespace variants collapse onto
 * the same bucket + user.
 *
 * Without consistent normalization, an attacker could cycle
 * "Alice@Foo.com" / "  alice@foo.com " / "alice@FOO.com" and reset the
 * rate-limit counter each time, blasting the per-email 3/hr cap.
 */
import fs from 'fs';
import path from 'path';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-jest';

import { app } from '../src/server';
import { getDb } from '../src/db/schema';

jest.setTimeout(15000);

function uniqueEmail(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

describe('P1-12 forgot-password email normalization', () => {
  it('treats "Alice@Foo.com", " alice@foo.com ", "ALICE@FOO.COM" as same user', async () => {
    // Seed a user with a lowercased email (how register stores them)
    const base = uniqueEmail('norm');
    const reg = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Norm', email: base, password: 'GoodPass1A' });
    expect(reg.status).toBe(201);

    // Each of these variants should hit the SAME rate-limit bucket
    // AND find the same user row.
    const variants = [base, base.toUpperCase(), `  ${base}  `, ` ${base.toUpperCase()} `];
    const results = [] as Array<{ variant: string; status: number; devToken?: string }>;
    for (const v of variants) {
      const r = await request(app).post('/api/v1/auth/forgot-password').send({ email: v });
      results.push({ variant: v, status: r.status, devToken: r.body._devToken });
    }

    // Every variant returns 200 (forgot-password always does — no email oracle)
    for (const r of results) expect(r.status).toBe(200);

    // Every variant that hits the *known-user* branch should have issued a dev
    // token — if normalization is inconsistent, some variants will miss the
    // user and return 200 without a token.
    const withTokens = results.filter(r => r.devToken);
    expect(withTokens.length).toBe(variants.length);
  });

  it('source invariant: handler uses normalizeEmail() (not inline toLowerCase)', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'routes', 'auth.ts'),
      'utf-8',
    );
    const block = src.split("router.post('/forgot-password'")[1] ?? '';
    const handler = block.split('router.')[0];
    // Use the shared helper, not a one-off toLowerCase/trim chain
    expect(handler).toMatch(/normalizeEmail\(/);
    // And no stale inline chain that would drift from the limiter keyGen
    expect(handler).not.toMatch(/req\.body\.email.*toLowerCase\(\)\.trim\(\)/);
  });

  it('source invariant: limiter keyGenerator uses normalizeEmail() too', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'routes', 'auth.ts'),
      'utf-8',
    );
    const block = src.split('const forgotPasswordLimiter')[1] ?? '';
    const rateLimitCtor = block.split('});')[0];
    expect(rateLimitCtor).toMatch(/normalizeEmail\(/);
  });
});
