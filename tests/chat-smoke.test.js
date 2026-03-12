/**
 * Windy Chat — Desktop Smoke Tests
 *
 * Tests the core chat client logic with mocked Matrix SDK.
 * Covers: login, login failure, send message, receive message,
 * translation toggle, and logout.
 *
 * Run: npx jest tests/chat-smoke.test.js
 */

'use strict';

// ── Mock electron (required by chat-client.js) ──
jest.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s) => Buffer.from(s),
    decryptString: (b) => b.toString(),
  },
}), { virtual: true });

// ── Mock @matrix-org/olm (optional dep) ──
jest.mock('@matrix-org/olm', () => ({}), { virtual: true });

// ── Helpers ──

/** Create a minimal in-memory store that mimics electron-store */
function createMockStore(initial = {}) {
  const data = { ...initial };
  return {
    get: (key, fallback) => {
      const parts = key.split('.');
      let val = data;
      for (const p of parts) {
        if (val == null || typeof val !== 'object') return fallback;
        val = val[p];
      }
      return val !== undefined ? val : fallback;
    },
    set: (key, value) => {
      const parts = key.split('.');
      let obj = data;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!(parts[i] in obj)) obj[parts[i]] = {};
        obj = obj[parts[i]];
      }
      obj[parts[parts.length - 1]] = value;
    },
    delete: (key) => {
      const parts = key.split('.');
      let obj = data;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!(parts[i] in obj)) return;
        obj = obj[parts[i]];
      }
      delete obj[parts[parts.length - 1]];
    },
    _data: data,
  };
}

/** Build a mock Matrix SDK that simulates login, sync, send, receive */
function createMockMatrixSDK({ loginShouldFail = false } = {}) {
  // Fake room with timeline
  const fakeRoom = {
    roomId: '!room1:matrix.org',
    name: 'Test Room',
    timeline: [],
    getJoinedMembers: () => [
      { userId: '@me:matrix.org', name: 'Me' },
      { userId: '@partner:matrix.org', name: 'Partner' },
    ],
    getMember: (id) => ({ name: id === '@me:matrix.org' ? 'Me' : 'Partner' }),
    getUnreadNotificationCount: () => 0,
    getDMInviter: () => null,
  };

  // Listeners registered via client.on()
  const listeners = {};

  const mockClient = {
    _rooms: [fakeRoom],
    _fakeRoom: fakeRoom,

    // Auth
    login: jest.fn().mockImplementation(async (type, params) => {
      if (loginShouldFail) {
        const err = new Error('Invalid credentials');
        err.errcode = 'M_FORBIDDEN';
        err.httpStatus = 403;
        throw err;
      }
      return {
        access_token: 'tok_test_12345',
        user_id: params.user,
        device_id: params.device_id || 'device1',
      };
    }),

    // Registration
    registerRequest: jest.fn().mockResolvedValue({ user_id: '@newuser:matrix.org' }),

    // Client methods
    startClient: jest.fn().mockResolvedValue(undefined),
    stopClient: jest.fn(),
    logout: jest.fn().mockResolvedValue(undefined),
    getUserId: jest.fn(() => '@me:matrix.org'),
    getRooms: jest.fn(() => mockClient._rooms),
    getRoom: jest.fn((id) => mockClient._rooms.find(r => r.roomId === id) || null),

    // Messaging
    sendEvent: jest.fn().mockImplementation(async (roomId, type, content) => {
      const fakeEvent = {
        event_id: `$evt_${Date.now()}`,
        getType: () => type,
        getSender: () => '@me:matrix.org',
        getContent: () => content,
        getId: () => `$evt_${Date.now()}`,
        getTs: () => Date.now(),
      };
      fakeRoom.timeline.push(fakeEvent);
      return { event_id: fakeEvent.event_id };
    }),

    // DM creation
    createRoom: jest.fn().mockResolvedValue({ room_id: '!newroom:matrix.org' }),

    // Invites
    joinRoom: jest.fn().mockResolvedValue(undefined),
    leave: jest.fn().mockResolvedValue(undefined),

    // Profile
    setDisplayName: jest.fn().mockResolvedValue(undefined),
    setPresence: jest.fn().mockResolvedValue(undefined),
    getProfileInfo: jest.fn().mockResolvedValue({ displayname: 'TestUser', avatar_url: null }),
    setAvatarUrl: jest.fn().mockResolvedValue(undefined),
    uploadContent: jest.fn().mockResolvedValue({ content_uri: 'mxc://test/avatar' }),

    // Account data (DM tracking)
    getAccountData: jest.fn(() => null),
    setAccountData: jest.fn().mockResolvedValue(undefined),

    // Typing
    sendTyping: jest.fn().mockResolvedValue(undefined),

    // Crypto (stub)
    initCrypto: jest.fn().mockRejectedValue(new Error('No Olm')),
    setGlobalErrorOnUnknownDevices: jest.fn(),

    // Event emitter
    on: jest.fn((event, fn) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(fn);
    }),
    removeAllListeners: jest.fn((event) => {
      if (event) {
        delete listeners[event];
      } else {
        Object.keys(listeners).forEach(k => delete listeners[k]);
      }
    }),

    // Simulate incoming events for testing
    _emit: (event, ...args) => {
      (listeners[event] || []).forEach(fn => fn(...args));
    },
  };

  const sdk = {
    createClient: jest.fn(() => mockClient),
  };

  return { sdk, mockClient, fakeRoom };
}

// ═══════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════

describe('Windy Chat — Desktop Smoke Tests', () => {
  let WindyChatClient;

  beforeAll(() => {
    // Load the real module (it will use our mocked electron)
    ({ WindyChatClient } = require('../src/client/desktop/chat/chat-client'));
  });

  // ── Test 1: Login with valid credentials succeeds ──
  describe('Login', () => {
    test('valid credentials → success', async () => {
      const { sdk, mockClient } = createMockMatrixSDK();
      const store = createMockStore({ chat: { homeserver: 'https://matrix.org' } });
      const client = new WindyChatClient(store);

      // Inject mock SDK
      client._getSDK = jest.fn().mockResolvedValue(sdk);

      const result = await client.login('@alice:matrix.org', 'correctpassword');

      expect(result.success).toBe(true);
      expect(result.userId).toBe('@alice:matrix.org');
      expect(mockClient.login).toHaveBeenCalledTimes(1);
      expect(mockClient.startClient).toHaveBeenCalled();
    });

    // ── Test 2: Login with invalid credentials shows error ──
    test('invalid credentials → friendly error', async () => {
      const { sdk } = createMockMatrixSDK({ loginShouldFail: true });
      const store = createMockStore({ chat: { homeserver: 'https://matrix.org' } });
      const client = new WindyChatClient(store);

      client._getSDK = jest.fn().mockResolvedValue(sdk);

      const result = await client.login('@alice:matrix.org', 'wrongpassword');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Invalid username or password/i);
    });

    test('connection refused → network error message', async () => {
      const { sdk, mockClient } = createMockMatrixSDK();
      mockClient.login.mockRejectedValue(Object.assign(
        new Error('connect ECONNREFUSED 127.0.0.1:8448'), { code: 'ECONNREFUSED' }
      ));
      const store = createMockStore({ chat: { homeserver: 'https://matrix.org' } });
      const client = new WindyChatClient(store);
      client._getSDK = jest.fn().mockResolvedValue(sdk);

      const result = await client.login('@alice:matrix.org', 'pass');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/cannot reach|internet connection/i);
    });
  });

  // ── Test 3: Send text message → appears in conversation ──
  describe('Send Message', () => {
    test('sends message with Windy translation metadata', async () => {
      const { sdk, mockClient, fakeRoom } = createMockMatrixSDK();
      const store = createMockStore({
        chat: { homeserver: 'https://matrix.org', language: 'en' },
      });
      const client = new WindyChatClient(store);
      client._getSDK = jest.fn().mockResolvedValue(sdk);

      await client.login('@me:matrix.org', 'pass');
      const result = await client.sendMessage('!room1:matrix.org', 'Hello world');

      expect(result.eventId).toBeTruthy();
      expect(result.body).toBe('Hello world');

      // Verify metadata sent to Matrix
      const sentContent = mockClient.sendEvent.mock.calls[0][2];
      expect(sentContent.msgtype).toBe('m.text');
      expect(sentContent.body).toBe('Hello world');
      expect(sentContent.windy_original).toBe('Hello world');
      expect(sentContent.windy_lang).toBe('en');
    });

    test('queues message when offline', async () => {
      const { sdk, mockClient } = createMockMatrixSDK();
      mockClient.sendEvent.mockRejectedValue(
        new Error('connect ECONNREFUSED')
      );
      const store = createMockStore({
        chat: { homeserver: 'https://matrix.org', language: 'en' },
      });
      const client = new WindyChatClient(store);
      client._getSDK = jest.fn().mockResolvedValue(sdk);

      await client.login('@me:matrix.org', 'pass');
      client.isConnected = false;

      const result = await client.sendMessage('!room1:matrix.org', 'offline msg');

      expect(result.queued).toBe(true);
      expect(client._offlineQueue).toHaveLength(1);
      expect(client._offlineQueue[0].text).toBe('offline msg');
    });

    test('rejects messages over 65535 characters', async () => {
      const { sdk, mockClient } = createMockMatrixSDK();
      const store = createMockStore({
        chat: { homeserver: 'https://matrix.org', language: 'en' },
      });
      const client = new WindyChatClient(store);
      client._getSDK = jest.fn().mockResolvedValue(sdk);

      await client.login('@me:matrix.org', 'pass');
      const longText = 'x'.repeat(70000);
      await client.sendMessage('!room1:matrix.org', longText);

      const sentContent = mockClient.sendEvent.mock.calls[0][2];
      expect(sentContent.body.length).toBeLessThanOrEqual(65535);
    });
  });

  // ── Test 4: Receive message → appears in conversation ──
  describe('Receive Message', () => {
    test('emits "message" on incoming Room.timeline event', async () => {
      const { sdk, mockClient, fakeRoom } = createMockMatrixSDK();
      const store = createMockStore({
        chat: { homeserver: 'https://matrix.org', language: 'en' },
      });
      const client = new WindyChatClient(store);
      client._getSDK = jest.fn().mockResolvedValue(sdk);

      await client.login('@me:matrix.org', 'pass');

      // Capture emitted messages
      const received = [];
      client.on('message', (msg) => received.push(msg));

      // Simulate incoming Matrix event
      const incomingEvent = {
        getType: () => 'm.room.message',
        getSender: () => '@partner:matrix.org',
        getContent: () => ({
          body: 'Hola amigo',
          windy_original: 'Hola amigo',
          windy_lang: 'es',
        }),
        getId: () => '$incoming1',
        getTs: () => Date.now(),
      };

      // Trigger the Room.timeline handler
      mockClient._emit('Room.timeline', incomingEvent, fakeRoom, false);

      // Wait for async translation attempt
      await new Promise(r => setTimeout(r, 50));

      expect(received).toHaveLength(1);
      expect(received[0].senderId).toBe('@partner:matrix.org');
      expect(received[0].roomId).toBe('!room1:matrix.org');
      expect(received[0].originalLang).toBe('es');
    });

    test('ignores own messages', async () => {
      const { sdk, mockClient, fakeRoom } = createMockMatrixSDK();
      const store = createMockStore({
        chat: { homeserver: 'https://matrix.org', language: 'en' },
      });
      const client = new WindyChatClient(store);
      client._getSDK = jest.fn().mockResolvedValue(sdk);
      await client.login('@me:matrix.org', 'pass');

      const received = [];
      client.on('message', (msg) => received.push(msg));

      const ownEvent = {
        getType: () => 'm.room.message',
        getSender: () => '@me:matrix.org', // Own message
        getContent: () => ({ body: 'My own message' }),
        getId: () => '$own1',
        getTs: () => Date.now(),
      };

      mockClient._emit('Room.timeline', ownEvent, fakeRoom, false);
      await new Promise(r => setTimeout(r, 50));

      expect(received).toHaveLength(0);
    });
  });

  // ── Test 5: Translation toggle works ──
  describe('Translation', () => {
    test('auto-translates foreign messages when translateFn is set', async () => {
      const { sdk, mockClient, fakeRoom } = createMockMatrixSDK();
      const store = createMockStore({
        chat: { homeserver: 'https://matrix.org', language: 'en' },
      });
      const client = new WindyChatClient(store);
      client._getSDK = jest.fn().mockResolvedValue(sdk);

      // Set up translation function
      client.translateFn = jest.fn().mockResolvedValue('Hello friend');

      await client.login('@me:matrix.org', 'pass');

      const received = [];
      client.on('message', (msg) => received.push(msg));

      const foreignEvent = {
        getType: () => 'm.room.message',
        getSender: () => '@partner:matrix.org',
        getContent: () => ({
          body: 'Hola amigo',
          windy_original: 'Hola amigo',
          windy_lang: 'es',
        }),
        getId: () => '$foreign1',
        getTs: () => Date.now(),
      };

      mockClient._emit('Room.timeline', foreignEvent, fakeRoom, false);
      await new Promise(r => setTimeout(r, 100));

      expect(client.translateFn).toHaveBeenCalledWith('Hola amigo', 'es', 'en');
      expect(received).toHaveLength(1);
      expect(received[0].body).toBe('Hello friend');
      expect(received[0].originalText).toBe('Hola amigo');
    });

    test('shows original text when translateFn is null (disabled)', async () => {
      const { sdk, mockClient, fakeRoom } = createMockMatrixSDK();
      const store = createMockStore({
        chat: { homeserver: 'https://matrix.org', language: 'en' },
      });
      const client = new WindyChatClient(store);
      client._getSDK = jest.fn().mockResolvedValue(sdk);
      client.translateFn = null; // Translation disabled

      await client.login('@me:matrix.org', 'pass');

      const received = [];
      client.on('message', (msg) => received.push(msg));

      const foreignEvent = {
        getType: () => 'm.room.message',
        getSender: () => '@partner:matrix.org',
        getContent: () => ({
          body: 'Bonjour',
          windy_original: 'Bonjour',
          windy_lang: 'fr',
        }),
        getId: () => '$fr1',
        getTs: () => Date.now(),
      };

      mockClient._emit('Room.timeline', foreignEvent, fakeRoom, false);
      await new Promise(r => setTimeout(r, 50));

      expect(received).toHaveLength(1);
      // Should show raw body since no translation function is set
      expect(received[0].body).toBe('Bonjour');
    });

    test('gracefully handles translation failure', async () => {
      const { sdk, mockClient, fakeRoom } = createMockMatrixSDK();
      const store = createMockStore({
        chat: { homeserver: 'https://matrix.org', language: 'en' },
      });
      const client = new WindyChatClient(store);
      client._getSDK = jest.fn().mockResolvedValue(sdk);
      client.translateFn = jest.fn().mockRejectedValue(new Error('Engine offline'));

      await client.login('@me:matrix.org', 'pass');

      const received = [];
      client.on('message', (msg) => received.push(msg));

      const foreignEvent = {
        getType: () => 'm.room.message',
        getSender: () => '@partner:matrix.org',
        getContent: () => ({
          body: 'Hallo',
          windy_original: 'Hallo',
          windy_lang: 'de',
        }),
        getId: () => '$de1',
        getTs: () => Date.now(),
      };

      mockClient._emit('Room.timeline', foreignEvent, fakeRoom, false);
      await new Promise(r => setTimeout(r, 100));

      expect(received).toHaveLength(1);
      expect(received[0].translationUnavailable).toBe(true);
      expect(received[0].body).toBe('Hallo'); // Falls back to original
    });
  });

  // ── Test 6: Logout clears state ──
  describe('Logout', () => {
    test('clears all session state and emits disconnected', async () => {
      const { sdk, mockClient } = createMockMatrixSDK();
      const store = createMockStore({
        chat: { homeserver: 'https://matrix.org' },
      });
      const client = new WindyChatClient(store);
      client._getSDK = jest.fn().mockResolvedValue(sdk);

      await client.login('@me:matrix.org', 'pass');
      expect(client.client).not.toBeNull();
      expect(client.isConnected).toBe(false); // Not synced yet

      // Simulate connected state
      client.isConnected = true;
      client.presenceMap.set('@partner:matrix.org', { presence: 'online' });
      client._offlineQueue.push({ roomId: '!room1:matrix.org', text: 'queued' });

      const disconnectedEvents = [];
      client.on('disconnected', () => disconnectedEvents.push(true));

      await client.logout();

      // Session state cleared
      expect(client.client).toBeNull();
      expect(client.isConnected).toBe(false);
      expect(client._cryptoEnabled).toBe(false);
      expect(client._syncState).toBeNull();
      expect(client._offlineQueue).toHaveLength(0);
      expect(client.presenceMap.size).toBe(0);

      // Store credentials cleared
      expect(store.get('chat.accessToken')).toBeUndefined();
      expect(store.get('chat.userId')).toBeUndefined();
      expect(store.get('chat.deviceId')).toBeUndefined();

      // Disconnected event emitted
      expect(disconnectedEvents).toHaveLength(1);

      // Matrix client methods called
      expect(mockClient.removeAllListeners).toHaveBeenCalled();
      expect(mockClient.stopClient).toHaveBeenCalled();
      expect(mockClient.logout).toHaveBeenCalled();
    });

    test('handles logout when not connected', async () => {
      const store = createMockStore({ chat: { homeserver: 'https://matrix.org' } });
      const client = new WindyChatClient(store);

      // Should not throw when client is null
      await expect(client.logout()).resolves.not.toThrow();
    });
  });

  // ── Edge Cases ──
  describe('Edge Cases', () => {
    test('homeserver validation rejects non-HTTPS', () => {
      const store = createMockStore({ chat: { homeserver: 'http://evil.com' } });
      const client = new WindyChatClient(store);

      expect(() => client._validateHomeserver('http://evil.com')).toThrow(/HTTPS/);
    });

    test('homeserver validation allows localhost', () => {
      const store = createMockStore({});
      const client = new WindyChatClient(store);

      expect(client._validateHomeserver('http://localhost:8008')).toBe('http://localhost:8008');
    });

    test('homeserver validation rejects javascript: protocol', () => {
      const store = createMockStore({});
      const client = new WindyChatClient(store);

      expect(() => client._validateHomeserver('javascript:alert(1)')).toThrow();
    });

    test('getContacts returns empty array when not connected', () => {
      const store = createMockStore({});
      const client = new WindyChatClient(store);

      expect(client.getContacts()).toEqual([]);
    });

    test('getTotalUnread returns 0 when not connected', () => {
      const store = createMockStore({});
      const client = new WindyChatClient(store);

      expect(client.getTotalUnread()).toBe(0);
    });

    test('_getUserLanguage does not mutate stored array', () => {
      const languages = [
        { code: 'en', weight: 5 },
        { code: 'es', weight: 10 },
        { code: 'fr', weight: 1 },
      ];
      const store = createMockStore({ wizard: { userLanguages: languages } });
      const client = new WindyChatClient(store);

      const first = client._getUserLanguage();
      const second = client._getUserLanguage();

      expect(first).toBe('es'); // Highest weight
      expect(second).toBe('es');
      // Original array order should be preserved
      expect(languages[0].code).toBe('en');
      expect(languages[1].code).toBe('es');
    });
  });
});
