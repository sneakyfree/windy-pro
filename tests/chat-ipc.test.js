/**
 * @jest-environment node
 *
 * Unit tests for src/client/desktop/chat/ipc.js (CR-009).
 *
 * Verifies:
 *  - registerChatIpc registers EXACTLY the channels in
 *    CHAT_IPC_CHANNELS (no drift).
 *  - Each handler delegates to the right deps method.
 *  - withTimeout-wrapped handlers surface { timedOut: true } on
 *    timeout failure.
 *  - dep validation throws on missing required keys.
 */

'use strict';

const { registerChatIpc, CHAT_IPC_CHANNELS } = require('../src/client/desktop/chat/ipc');

function mockIpcMain() {
  const handlers = new Map();
  return {
    handle(channel, fn) { handlers.set(channel, fn); },
    on(channel, fn) { handlers.set(channel, fn); },
    handlers,
    invoke(channel, ...args) {
      const h = handlers.get(channel);
      if (!h) throw new Error(`no handler for ${channel}`);
      return h({}, ...args);
    },
  };
}

function makeDeps(overrides = {}) {
  const fakeClient = {
    login: jest.fn(async () => ({ success: true })),
    register: jest.fn(async () => ({ success: true })),
    logout: jest.fn(async () => ({ success: true })),
    resumeSession: jest.fn(async () => ({ success: true })),
    sendMessage: jest.fn(async () => ({ ok: true })),
    getMessages: jest.fn(async () => []),
    sendTyping: jest.fn(async () => ({ ok: true })),
    getCachedMessages: jest.fn(async () => []),
    getContacts: jest.fn(async () => []),
    createDM: jest.fn(async () => ({ roomId: '!r:s' })),
    acceptInvite: jest.fn(async () => ({ ok: true })),
    declineInvite: jest.fn(async () => ({ ok: true })),
    getCryptoStatus: jest.fn(async () => ({ enabled: true })),
    setDisplayName: jest.fn(async () => ({ ok: true })),
    setPresence: jest.fn(async () => ({ ok: true })),
    getUserProfile: jest.fn(async () => ({})),
    getTotalUnread: jest.fn(async () => 0),
  };
  const storeMap = new Map([
    ['chat.homeserver', 'https://matrix.org'],
    ['chat.displayName', 'Tester'],
    ['chat.language', 'en'],
    ['chat.userId', '@u:s'],
  ]);
  const store = {
    get: (k, d) => storeMap.has(k) ? storeMap.get(k) : d,
    set: (k, v) => storeMap.set(k, v),
  };
  return Object.assign({
    ipcMain: mockIpcMain(),
    getChatClient: () => fakeClient,
    getChatClientUnsafe: () => fakeClient,
    setupChatForwarding: jest.fn(),
    withTimeout: (p) => p,                       // no timeout in tests
    store,
    ChatTranslator: class { translate() { return { ok: true }; } getUserLanguage() { return 'en'; } },
    translatorRef: { current: null },
    _fake: { client: fakeClient, store: storeMap },
  }, overrides);
}

describe('registerChatIpc', () => {
  test('registers exactly the CHAT_IPC_CHANNELS set', () => {
    const deps = makeDeps();
    registerChatIpc(deps);
    const registered = [...deps.ipcMain.handlers.keys()].sort();
    expect(registered).toEqual([...CHAT_IPC_CHANNELS].sort());
  });

  test('throws when ipcMain missing', () => {
    const d = makeDeps({ ipcMain: undefined });
    expect(() => registerChatIpc(d)).toThrow(/missing required deps/);
  });

  test('throws when getChatClient missing', () => {
    const d = makeDeps({ getChatClient: undefined });
    expect(() => registerChatIpc(d)).toThrow(/missing required deps/);
  });
});

describe('chat-login handler', () => {
  test('delegates to client.login + sets up forwarding on success', async () => {
    const deps = makeDeps();
    registerChatIpc(deps);
    const r = await deps.ipcMain.invoke('chat-login', '@u:s', 'pw');
    expect(deps._fake.client.login).toHaveBeenCalledWith('@u:s', 'pw');
    expect(deps.setupChatForwarding).toHaveBeenCalled();
    expect(r).toEqual({ success: true });
  });

  test('returns { error, timedOut: true } when withTimeout fires', async () => {
    const deps = makeDeps({
      withTimeout: () => Promise.reject(Object.assign(new Error('hung'), { timedOut: true })),
    });
    registerChatIpc(deps);
    const r = await deps.ipcMain.invoke('chat-login', '@u:s', 'pw');
    expect(r.error).toBe('hung');
    expect(r.timedOut).toBe(true);
  });
});

describe('chat-send-message handler', () => {
  test('rejects empty text', async () => {
    const deps = makeDeps();
    registerChatIpc(deps);
    expect(await deps.ipcMain.invoke('chat-send-message', '!r:s', '')).toEqual({ error: 'Message too long or empty' });
  });

  test('rejects oversized text', async () => {
    const deps = makeDeps();
    registerChatIpc(deps);
    expect(await deps.ipcMain.invoke('chat-send-message', '!r:s', 'x'.repeat(70000))).toEqual({ error: 'Message too long or empty' });
  });

  test('rejects bad room id', async () => {
    const deps = makeDeps();
    registerChatIpc(deps);
    expect(await deps.ipcMain.invoke('chat-send-message', null, 'hello')).toEqual({ error: 'Invalid room ID' });
  });

  test('forwards to client on valid input', async () => {
    const deps = makeDeps();
    registerChatIpc(deps);
    const r = await deps.ipcMain.invoke('chat-send-message', '!r:s', 'hi');
    expect(deps._fake.client.sendMessage).toHaveBeenCalledWith('!r:s', 'hi');
    expect(r).toEqual({ ok: true });
  });
});

describe('chat-set-settings homeserver validation', () => {
  test('rejects http:// non-localhost', async () => {
    const deps = makeDeps();
    registerChatIpc(deps);
    const r = await deps.ipcMain.invoke('chat-set-settings', { homeserver: 'http://evil.example' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/HTTPS/);
  });

  test('accepts http://localhost for development', async () => {
    const deps = makeDeps();
    registerChatIpc(deps);
    const r = await deps.ipcMain.invoke('chat-set-settings', { homeserver: 'http://localhost:8008' });
    expect(r.ok).toBe(true);
  });

  test('accepts https://anything', async () => {
    const deps = makeDeps();
    registerChatIpc(deps);
    const r = await deps.ipcMain.invoke('chat-set-settings', { homeserver: 'https://matrix.org' });
    expect(r.ok).toBe(true);
  });

  test('rejects malformed URL', async () => {
    const deps = makeDeps();
    registerChatIpc(deps);
    const r = await deps.ipcMain.invoke('chat-set-settings', { homeserver: 'not a url' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Invalid homeserver URL/);
  });
});

describe('chat-translate-text lazy instantiation', () => {
  test('creates ChatTranslator on first call and reuses it', async () => {
    let constructed = 0;
    class FakeTranslator {
      constructor() { constructed++; }
      translate() { return { ok: true }; }
      getUserLanguage() { return 'en'; }
    }
    const deps = makeDeps({ ChatTranslator: FakeTranslator });
    registerChatIpc(deps);
    await deps.ipcMain.invoke('chat-translate-text', 'hi', 'en', 'es');
    await deps.ipcMain.invoke('chat-translate-text', 'bye', 'en', 'fr');
    expect(constructed).toBe(1);
  });
});
