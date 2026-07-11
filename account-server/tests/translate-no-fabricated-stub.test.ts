/**
 * G14 integrity regression — Translate must NEVER fabricate output at HTTP 200.
 *
 * The 2026-05-08 + 2026-07-10 incidents: when no real engine answered, the
 * /translate/text route returned `"[es] <English>"` with a fabricated
 * confidence at HTTP 200, indistinguishable from a real translation. This test
 * forces the no-engine path (anonymous caller so Mind is skipped; GROQ/OPENAI
 * keys unset so the direct provider is skipped) and asserts the route fails
 * honestly with 503 instead of returning a bracketed echo.
 */
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-jest';
// Force the no-engine path: no direct provider keys. (Anonymous request also
// skips the Mind broker, which requires a user JWT.)
delete process.env.GROQ_API_KEY;
delete process.env.OPENAI_API_KEY;

import { app } from '../src/server';

describe('G14 — Translate never fabricates output at 200', () => {
    it('POST /api/v1/translate/text with no engine → 503, no bracketed echo', async () => {
        const res = await request(app)
            .post('/api/v1/translate/text')
            .send({ text: 'hello world', sourceLang: 'en', targetLang: 'es' });

        expect(res.status).toBe(503);
        expect(res.body.error).toBe('translation_unavailable');
        // The fabricated echo must never appear.
        expect(JSON.stringify(res.body)).not.toContain('[es]');
        expect(res.body.engine).toBeUndefined();
        expect(res.body.confidence).toBeUndefined();
    });
});
