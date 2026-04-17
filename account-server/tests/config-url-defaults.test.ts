/**
 * P1-3 — ecosystem URL defaults in config.ts must not point at the
 * account-server's own port and must not collide with each other.
 *
 * Before Wave 7:
 *   WINDY_CLOUD_URL default = http://localhost:8098  (account-server's OWN port)
 *   ETERNITAS_URL   default = http://localhost:8200  (same as WINDY_MAIL_URL)
 * Health checks that used these defaults were bogus in dev.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-jest';

import { config } from '../src/config';

describe('P1-3 config URL defaults', () => {
  const DEFAULT_ACCOUNT_SERVER_PORT = config.PORT;

  it('WINDY_CLOUD_URL does not point at the account-server port', () => {
    expect(config.WINDY_CLOUD_URL).not.toMatch(new RegExp(`:${DEFAULT_ACCOUNT_SERVER_PORT}\\b`));
  });

  it('ETERNITAS_URL does not collide with WINDY_MAIL_URL', () => {
    expect(config.ETERNITAS_URL).not.toBe(config.WINDY_MAIL_URL);
  });

  it('no two non-empty ecosystem URL defaults share the same port', () => {
    const urls = [
      config.WINDY_CHAT_URL,
      config.WINDY_MAIL_URL,
      config.WINDY_CLOUD_URL,
      config.ETERNITAS_URL,
    ].filter(Boolean);
    // Extract ports
    const ports = urls
      .map(u => { try { return new URL(u).port; } catch { return ''; } })
      .filter(Boolean);
    const counts = new Map<string, number>();
    for (const p of ports) counts.set(p, (counts.get(p) || 0) + 1);
    const dupes = [...counts.entries()].filter(([, n]) => n > 1).map(([p]) => p);
    expect(dupes).toEqual([]);
  });
});
