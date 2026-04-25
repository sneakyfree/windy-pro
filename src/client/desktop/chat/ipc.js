/**
 * Chat IPC handlers — extracted from main.js (CR-009 start).
 *
 * Registers all `chat-*` ipcMain.handle / on calls. Takes a `deps`
 * object so the module is self-contained and unit-testable without
 * spinning up the full main.js cold path.
 *
 * Why a single registrar function instead of side-effect-on-import:
 *   - Lets tests stub deps and verify the handler shapes
 *   - Keeps registration deterministic (called once from main.js
 *     after `app.whenReady`)
 *   - No accidental coupling to main.js module-load order
 *
 * Future cleanup: the chat-set-display-name handler currently
 * triggers an unconfirmed identity change — see SEC-MAIN-2 in
 * docs/SECURITY-AUDIT-2026-04.md. Add a confirm dialog in a
 * follow-up PR.
 */

'use strict';

/**
 * @param {object} deps
 * @param {object} deps.ipcMain
 * @param {() => object} deps.getChatClient   — builds/returns the cached Matrix client
 * @param {() => object|null} deps.getChatClientUnsafe  — return cached or null without building
 * @param {(client) => void} deps.setupChatForwarding   — wire Matrix events → BrowserWindow
 * @param {<T>(p: Promise<T>, ms: number, label: string) => Promise<T>} deps.withTimeout
 * @param {object} deps.store          — electron-store instance
 * @param {Function} deps.ChatTranslator — chat translator class (lazy-instantiated)
 * @param {object} deps.translatorRef  — { current: ChatTranslator|null } so we can lazy-init
 *                                        within the registrar without exporting another setter
 */
function registerChatIpc(deps) {
  const {
    ipcMain, getChatClient, getChatClientUnsafe, setupChatForwarding,
    withTimeout, store, ChatTranslator, translatorRef,
  } = deps;

  if (!ipcMain || !getChatClient || !setupChatForwarding) {
    throw new Error('[chat-ipc] missing required deps');
  }

  // ── Authentication ────────────────────────────────────────────
  ipcMain.handle('chat-login', async (event, userId, password) => {
    try {
      const client = getChatClient();
      // CR-003: 30s bound for login — Matrix auth can hang on a dead
      // homeserver or slow TLS handshake.
      const result = await withTimeout(client.login(userId, password), 30_000, 'chat-login');
      if (result.success) setupChatForwarding(client);
      return result;
    } catch (err) {
      console.error('[chat-login] Error:', err.message);
      return { error: err.message, timedOut: !!err.timedOut };
    }
  });

  ipcMain.handle('chat-register', async (event, username, password, displayName) => {
    try {
      const client = getChatClient();
      const result = await withTimeout(
        client.register(username, password, displayName), 30_000, 'chat-register');
      if (result.success) setupChatForwarding(client);
      return result;
    } catch (err) {
      console.error('[chat-register] Error:', err.message);
      return { error: err.message, timedOut: !!err.timedOut };
    }
  });

  ipcMain.handle('chat-logout', async () => {
    try {
      const c = getChatClientUnsafe();
      if (c) return await c.logout();
      return { success: true };
    } catch (err) {
      console.error('[chat-logout] Error:', err.message);
      return { error: err.message };
    }
  });

  ipcMain.handle('chat-get-session', async () => {
    try {
      const client = getChatClient();
      const result = await client.resumeSession();
      if (result.success) setupChatForwarding(client);
      return result;
    } catch (err) {
      console.error('[chat-get-session] Error:', err.message);
      return { error: err.message };
    }
  });

  // ── Messaging ─────────────────────────────────────────────────
  ipcMain.handle('chat-send-message', async (event, roomId, text) => {
    try {
      if (typeof roomId !== 'string' || roomId.length > 500) return { error: 'Invalid room ID' };
      if (typeof text !== 'string' || text.length === 0 || text.length > 65535) return { error: 'Message too long or empty' };
      return await withTimeout(
        getChatClient().sendMessage(roomId, text), 20_000, 'chat-send-message');
    } catch (err) {
      console.error('[chat-send-message] Error:', err.message);
      return { error: err.message, timedOut: !!err.timedOut };
    }
  });

  ipcMain.handle('chat-get-messages', async (event, roomId, limit) => {
    try {
      return await withTimeout(
        getChatClient().getMessages(roomId, limit || 50), 15_000, 'chat-get-messages');
    } catch (err) {
      console.error('[chat-get-messages] Error:', err.message);
      return { error: err.message, timedOut: !!err.timedOut };
    }
  });

  ipcMain.handle('chat-send-typing', async (event, roomId, isTyping) => {
    try { return await getChatClient().sendTyping(roomId, isTyping); }
    catch (err) { console.error('[chat-send-typing] Error:', err.message); return { error: err.message }; }
  });

  ipcMain.handle('chat-get-cached-messages', async (event, roomId) => {
    try { return await getChatClient().getCachedMessages(roomId); }
    catch (err) { console.error('[chat-get-cached-messages] Error:', err.message); return { error: err.message }; }
  });

  // ── Contacts & Rooms ──────────────────────────────────────────
  ipcMain.handle('chat-get-contacts', async () => {
    try { return await getChatClient().getContacts(); }
    catch (err) { console.error('[chat-get-contacts] Error:', err.message); return { error: err.message }; }
  });

  ipcMain.handle('chat-create-dm', async (event, userId) => {
    try { return await getChatClient().createDM(userId); }
    catch (err) { console.error('[chat-create-dm] Error:', err.message); return { error: err.message }; }
  });

  ipcMain.handle('chat-accept-invite', async (event, roomId) => {
    try { return await getChatClient().acceptInvite(roomId); }
    catch (err) { console.error('[chat-accept-invite] Error:', err.message); return { error: err.message }; }
  });

  ipcMain.handle('chat-decline-invite', async (event, roomId) => {
    try { return await getChatClient().declineInvite(roomId); }
    catch (err) { console.error('[chat-decline-invite] Error:', err.message); return { error: err.message }; }
  });

  // ── Encryption ────────────────────────────────────────────────
  ipcMain.handle('chat-get-crypto-status', async () => {
    try {
      const c = getChatClientUnsafe();
      return c ? await c.getCryptoStatus() : { enabled: false, deviceId: null, syncState: null };
    } catch (err) {
      console.error('[chat-get-crypto-status] Error:', err.message);
      return { error: err.message };
    }
  });

  // ── Profile & Presence ────────────────────────────────────────
  ipcMain.handle('chat-set-display-name', async (event, displayName) => {
    try { return await getChatClient().setDisplayName(displayName); }
    catch (err) { console.error('[chat-set-display-name] Error:', err.message); return { error: err.message }; }
  });

  ipcMain.handle('chat-set-presence', async (event, status) => {
    try { return await getChatClient().setPresence(status); }
    catch (err) { console.error('[chat-set-presence] Error:', err.message); return { error: err.message }; }
  });

  ipcMain.handle('chat-get-user-profile', async (event, userId) => {
    try { return await getChatClient().getUserProfile(userId); }
    catch (err) { console.error('[chat-get-user-profile] Error:', err.message); return { error: err.message }; }
  });

  ipcMain.handle('chat-get-total-unread', async () => {
    try { return await getChatClient().getTotalUnread(); }
    catch (err) { console.error('[chat-get-total-unread] Error:', err.message); return { error: err.message }; }
  });

  // ── Settings ──────────────────────────────────────────────────
  ipcMain.handle('chat-get-settings', async () => {
    try {
      return {
        homeserver: store.get('chat.homeserver', 'https://matrix.org'),
        displayName: store.get('chat.displayName', ''),
        language: store.get('chat.language', 'en'),
        userId: store.get('chat.userId', ''),
      };
    } catch (err) {
      console.error('[chat-get-settings] Error:', err.message);
      return { error: err.message };
    }
  });

  ipcMain.handle('chat-set-settings', async (event, settings) => {
    try {
      if (settings.homeserver) {
        try {
          const parsed = new URL(settings.homeserver);
          const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
          if (parsed.protocol !== 'https:' && !isLocalhost) {
            return { ok: false, error: 'Homeserver must use HTTPS (except localhost for development)' };
          }
        } catch (e) {
          return { ok: false, error: 'Invalid homeserver URL' };
        }
        store.set('chat.homeserver', settings.homeserver);
      }
      if (settings.displayName) {
        store.set('chat.displayName', settings.displayName);
        try { getChatClient().setDisplayName(settings.displayName); }
        catch (e) { console.debug('[Chat] setDisplayName failed:', e.message); }
      }
      if (settings.language) store.set('chat.language', settings.language);
      return { ok: true };
    } catch (err) {
      console.error('[chat-set-settings] Error:', err.message);
      return { error: err.message };
    }
  });

  // ── Translation utilities ─────────────────────────────────────
  ipcMain.handle('chat-get-user-language', async () => {
    try {
      return translatorRef.current
        ? translatorRef.current.getUserLanguage()
        : store.get('chat.language', 'en');
    } catch (err) {
      console.error('[chat-get-user-language] Error:', err.message);
      return { error: err.message };
    }
  });

  ipcMain.handle('chat-translate-text', async (event, text, srcLang, tgtLang) => {
    try {
      if (!translatorRef.current) translatorRef.current = new ChatTranslator(store);
      return await translatorRef.current.translate(text, srcLang, tgtLang);
    } catch (err) {
      console.error('[chat-translate-text] Error:', err.message);
      return { error: err.message };
    }
  });
}

// Ordered list of every channel this module registers — used by the
// E2E preload-contract test and by future migration helpers.
const CHAT_IPC_CHANNELS = Object.freeze([
  'chat-login', 'chat-register', 'chat-logout', 'chat-get-session',
  'chat-send-message', 'chat-get-messages', 'chat-send-typing',
  'chat-get-cached-messages',
  'chat-get-contacts', 'chat-create-dm',
  'chat-accept-invite', 'chat-decline-invite',
  'chat-get-crypto-status',
  'chat-set-display-name', 'chat-set-presence',
  'chat-get-user-profile', 'chat-get-total-unread',
  'chat-get-settings', 'chat-set-settings',
  'chat-get-user-language', 'chat-translate-text',
]);

module.exports = { registerChatIpc, CHAT_IPC_CHANNELS };
