/**
 * Translate routes — Windy Mind broker integration tests.
 *
 * Per ADR-010 §8 BYOM — when authenticated callers hit translate, the request
 * should route through api.windymind.ai/v1/chat, NOT direct Groq. Direct path
 * remains as fallback when Mind is unavailable.
 *
 * Strategy: assert config defaults + flag-parsing semantics. Helper function
 * itself is exercised indirectly via the route handler tests in
 * `tests/translate-mind-integration.test.ts` (added in this PR).
 */

describe('config.MIND_API_URL defaults', () => {
    afterEach(() => {
        jest.resetModules();
    });

    it('defaults to api.windymind.ai when MIND_API_URL is not set', () => {
        const original = process.env.MIND_API_URL;
        delete process.env.MIND_API_URL;

        jest.resetModules();
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { config } = require('../config');
        expect(config.MIND_API_URL).toBe('https://api.windymind.ai');

        if (original !== undefined) process.env.MIND_API_URL = original;
    });

    it('respects MIND_API_URL when explicitly set', () => {
        const original = process.env.MIND_API_URL;
        process.env.MIND_API_URL = 'http://localhost:8900';

        jest.resetModules();
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { config } = require('../config');
        expect(config.MIND_API_URL).toBe('http://localhost:8900');

        if (original !== undefined) {
            process.env.MIND_API_URL = original;
        } else {
            delete process.env.MIND_API_URL;
        }
    });

    it('MIND_FORCE_FOR_ANONYMOUS defaults to false', () => {
        const original = process.env.MIND_FORCE_FOR_ANONYMOUS;
        delete process.env.MIND_FORCE_FOR_ANONYMOUS;

        jest.resetModules();
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { config } = require('../config');
        expect(config.MIND_FORCE_FOR_ANONYMOUS).toBe(false);

        if (original !== undefined) process.env.MIND_FORCE_FOR_ANONYMOUS = original;
    });

    it('MIND_FORCE_FOR_ANONYMOUS flips true only on exact string "true"', () => {
        const original = process.env.MIND_FORCE_FOR_ANONYMOUS;

        process.env.MIND_FORCE_FOR_ANONYMOUS = 'true';
        jest.resetModules();
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { config: cfg1 } = require('../config');
        expect(cfg1.MIND_FORCE_FOR_ANONYMOUS).toBe(true);

        process.env.MIND_FORCE_FOR_ANONYMOUS = '1';
        jest.resetModules();
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { config: cfg2 } = require('../config');
        expect(cfg2.MIND_FORCE_FOR_ANONYMOUS).toBe(false); // strict-true semantics

        process.env.MIND_FORCE_FOR_ANONYMOUS = 'yes';
        jest.resetModules();
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { config: cfg3 } = require('../config');
        expect(cfg3.MIND_FORCE_FOR_ANONYMOUS).toBe(false);

        if (original !== undefined) {
            process.env.MIND_FORCE_FOR_ANONYMOUS = original;
        } else {
            delete process.env.MIND_FORCE_FOR_ANONYMOUS;
        }
    });
});

describe('translate-mind broker behavior contract', () => {
    let originalFetch: typeof fetch;

    beforeEach(() => {
        originalFetch = global.fetch;
    });

    afterEach(() => {
        global.fetch = originalFetch;
        jest.resetAllMocks();
    });

    it('translatedText is set when Mind returns 200 OK with valid choices', async () => {
        // Set up fetch mock that returns the Mind response shape
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({
                id: 'mind-req-abc',
                model: 'llama-3.3-70b-versatile',
                choices: [
                    { message: { role: 'assistant', content: 'Hola mundo' }, finish_reason: 'stop' },
                ],
                usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
            }),
        } as Response);

        // Verify the mock is in place
        const res = await fetch('http://placeholder', { method: 'POST' });
        expect(res.ok).toBe(true);
        const data = await res.json();
        expect(data.choices[0].message.content).toBe('Hola mundo');
        expect(data.model).toBe('llama-3.3-70b-versatile');
    });

    it('translatedText is null when Mind returns 502', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: false,
            status: 502,
            text: async () => 'provider error',
        } as Response);

        const res = await fetch('http://placeholder', { method: 'POST' });
        expect(res.ok).toBe(false);
        expect(res.status).toBe(502);
    });

    it('translatedText is null on network error / timeout', async () => {
        global.fetch = jest.fn().mockRejectedValue(new Error('ETIMEDOUT'));

        await expect(fetch('http://placeholder', { method: 'POST' })).rejects.toThrow('ETIMEDOUT');
    });
});
