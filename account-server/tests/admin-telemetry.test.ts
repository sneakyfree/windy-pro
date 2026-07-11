/**
 * Windy Admin intel emitter (CONTRACT §8): the account/license/wallet spine.
 * Unit-covers the transport invariants (inert-unless-configured, envelope
 * shape, fire-and-forget) and the os-enum normalizer. Route-level emits are
 * exercised by the api suite; here we pin the emitter contract itself.
 */
import { emitAdminEvent, normalizeOs } from '../src/services/admin-telemetry';

describe('normalizeOs (closed enum, off-values dropped)', () => {
  it('maps common platform strings to the ingest os enum', () => {
    expect(normalizeOs('darwin')).toBe('macos');
    expect(normalizeOs('macOS 14')).toBe('macos');
    expect(normalizeOs('Windows 11')).toBe('windows');
    expect(normalizeOs('linux')).toBe('linux');
    expect(normalizeOs('iPhone')).toBe('ios');
    expect(normalizeOs('android 14')).toBe('android');
    expect(normalizeOs('web')).toBe('web');
  });

  it('drops unrecognized values (undefined, never off-enum → would 422)', () => {
    expect(normalizeOs('freebsd')).toBeUndefined();
    expect(normalizeOs('')).toBeUndefined();
    expect(normalizeOs(undefined)).toBeUndefined();
    expect(normalizeOs(null)).toBeUndefined();
  });
});

describe('emitAdminEvent', () => {
  const OLD = { url: process.env.WINDY_ADMIN_INGEST_URL, token: process.env.WINDY_ADMIN_INGEST_TOKEN };
  afterEach(() => {
    process.env.WINDY_ADMIN_INGEST_URL = OLD.url;
    process.env.WINDY_ADMIN_INGEST_TOKEN = OLD.token;
    jest.restoreAllMocks();
  });

  it('is inert (no fetch) unless both env vars are set', async () => {
    delete process.env.WINDY_ADMIN_INGEST_URL;
    delete process.env.WINDY_ADMIN_INGEST_TOKEN;
    const spy = jest.spyOn(global, 'fetch' as any);
    const r = await emitAdminEvent({ event_type: 'account.login', actor_type: 'system' });
    expect(r).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('posts a well-formed windy-pro envelope when configured', async () => {
    process.env.WINDY_ADMIN_INGEST_URL = 'https://admin.example';
    process.env.WINDY_ADMIN_INGEST_TOKEN = 'tok';
    let captured: any = null;
    jest.spyOn(global, 'fetch' as any).mockImplementation((async (_url: string, opts: any) => {
      captured = { url: _url, body: JSON.parse(opts.body) };
      return { status: 202 } as any;
    }) as any);

    const status = await emitAdminEvent({
      event_type: 'account.login', actor_type: 'human', actor_id: 'wid-1',
      metadata: { ok: false, method: 'password', reason: 'bad_credentials' },
    });

    expect(status).toBe(202);
    expect(captured.url).toBe('https://admin.example/v1/events');
    const ev = captured.body.events[0];
    expect(ev.platform).toBe('windy-pro');
    expect(ev.service).toBe('account-server');
    expect(ev.event_type).toBe('account.login');
    expect(ev.metadata.reason).toBe('bad_credentials');
    expect(typeof ev.ts).toBe('string');
  });

  it('swallows transport errors (never throws, returns null)', async () => {
    process.env.WINDY_ADMIN_INGEST_URL = 'https://admin.example';
    process.env.WINDY_ADMIN_INGEST_TOKEN = 'tok';
    jest.spyOn(global, 'fetch' as any).mockImplementation((() =>
      Promise.reject(new Error('network down'))) as any);
    await expect(
      emitAdminEvent({ event_type: 'license.heartbeat_denied', actor_type: 'human',
        metadata: { reason: 'revoked' } }),
    ).resolves.toBeNull();
  });
});
