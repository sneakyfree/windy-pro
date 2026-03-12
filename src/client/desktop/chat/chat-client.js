/**
 * Windy Chat — Matrix SDK Client Wrapper
 * 
 * Handles Matrix homeserver connection, authentication, room management,
 * message sending/receiving, and presence. All messages pass through
 * the translation middleware before delivery.
 * 
 * Translation metadata format (cross-platform standard):
 * { "body": "translated text", "windy_original": "original text", "windy_lang": "es" }
 * 
 * Hardened: security, error handling, E2E encryption, offline resilience, reconnection
 * 
 * License: Proprietary (Windy Pro)
 * Matrix JS SDK: Apache 2.0
 */

// matrix-js-sdk is ESM-only — use dynamic import(), cached after first load
let _matrixSdk = null;

const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');

class WindyChatClient extends EventEmitter {
  constructor(store) {
    super();
    this.store = store;
    this.client = null;
    this.isConnected = false;
    this.translateFn = null; // Set externally by chat-translate.js
    this.presenceMap = new Map(); // userId → { presence, lastActive }
    this._offlineQueue = []; // Messages pending send when reconnected
    this._cryptoEnabled = false;
    this._syncState = null;

    // Default homeserver — configurable in settings
    this.homeserverUrl = store.get('chat.homeserver', 'https://matrix.org');
  }

  // ═══════════════════════════════════════════════
  // Security: Homeserver URL Validation
  // ═══════════════════════════════════════════════

  /**
   * Validate homeserver URL — must be HTTPS (or localhost for dev)
   */
  _validateHomeserver(url) {
    if (!url || typeof url !== 'string') {
      throw new Error('Homeserver URL is required');
    }
    try {
      const parsed = new URL(url);
      const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
      if (parsed.protocol !== 'https:' && !isLocalhost) {
        throw new Error('Homeserver must use HTTPS (except localhost for development)');
      }
      if (['javascript:', 'data:', 'file:'].includes(parsed.protocol)) {
        throw new Error('Invalid homeserver protocol');
      }
      return parsed.origin;
    } catch (err) {
      if (err.message.includes('Homeserver') || err.message.includes('Invalid')) throw err;
      throw new Error(`Invalid homeserver URL: ${url}`);
    }
  }

  /**
   * Lazy-load the Matrix SDK (ESM module)
   * matrix-js-sdk v31+ is ESM-only, so we must use dynamic import()
   */
  async _getSDK() {
    if (!_matrixSdk) {
      try {
        _matrixSdk = await import('matrix-js-sdk');
      } catch (err) {
        // Fallback: try require for older CJS builds bundled with the app
        try {
          _matrixSdk = require('matrix-js-sdk');
        } catch (e2) {
          throw new Error(
            'Chat requires matrix-js-sdk. Please install it: npm install matrix-js-sdk'
          );
        }
      }
    }
    return _matrixSdk;
  }

  // ═══════════════════════════════════════════════
  // E2E Encryption: Initialize Crypto Module
  // ═══════════════════════════════════════════════

  /**
   * Initialize Olm/Megolm E2E encryption (best-effort)
   */
  async _initCrypto() {
    if (!this.client) return;
    try {
      // Check if Olm is available
      const Olm = require('@matrix-org/olm');
      if (typeof global !== 'undefined') global.Olm = Olm;

      await this.client.initCrypto();
      // Don't block sends on unverified devices — auto-accept
      this.client.setGlobalErrorOnUnknownDevices(false);
      this._cryptoEnabled = true;
      console.debug('[WindyChat] E2E encryption initialized ✅');
    } catch (err) {
      // Olm not installed — chat still works, just without E2E
      this._cryptoEnabled = false;
      console.warn('[WindyChat] E2E encryption unavailable (install @matrix-org/olm for E2E):', err.message);
    }
  }

  // ═══════════════════════════════════════════════
  // Authentication
  // ═══════════════════════════════════════════════

  /**
   * Initialize Matrix client and log in
   */
  async login(userId, password) {
    try {
      // Validate homeserver URL
      const validatedUrl = this._validateHomeserver(this.homeserverUrl);

      const sdk = await this._getSDK();
      const hostname = require('os').hostname();

      // Support both @user:server and plain username formats
      let fullUserId = userId;
      if (!userId.startsWith('@')) {
        const domain = new URL(this.homeserverUrl).hostname;
        fullUserId = `@${userId}:${domain}`;
      }

      this.client = sdk.createClient({
        baseUrl: validatedUrl,
        deviceId: `windy-pro-${hostname}`
      });

      // Try login
      const loginResponse = await this.client.login('m.login.password', {
        user: fullUserId,
        password: password,
        device_id: `windy-pro-${hostname}`,
        initial_device_display_name: 'Windy Pro Desktop'
      });

      // SEC-04: Encrypt access token with safeStorage before storing
      const { safeStorage } = require('electron');
      if (safeStorage.isEncryptionAvailable()) {
        const encrypted = safeStorage.encryptString(loginResponse.access_token);
        this.store.set('chat.accessTokenEncrypted', encrypted.toString('base64'));
      } else {
        this.store.set('chat.accessToken', loginResponse.access_token);
      }
      this.store.delete('chat.accessToken'); // Remove any old plaintext token
      this.store.set('chat.userId', loginResponse.user_id);
      this.store.set('chat.deviceId', loginResponse.device_id);

      // Reinitialize with access token
      this.client = sdk.createClient({
        baseUrl: validatedUrl,
        accessToken: loginResponse.access_token,
        userId: loginResponse.user_id,
        deviceId: loginResponse.device_id,
        timelineSupport: true
      });

      // Initialize E2E encryption (best-effort)
      await this._initCrypto();

      await this._startSync();
      return { success: true, userId: loginResponse.user_id };
    } catch (err) {
      console.error('[WindyChat] Login failed:', err.message);
      return { success: false, error: this._classifyLoginError(err) };
    }
  }

  /**
   * Classify login error into user-friendly messages
   */
  _classifyLoginError(err) {
    const code = err.errcode || err.data?.errcode || '';
    const status = err.httpStatus || 0;

    if (code === 'M_FORBIDDEN' || status === 403) {
      return 'Invalid username or password. Please check your credentials.';
    }
    if (code === 'M_LIMIT_EXCEEDED') {
      const retryMs = err.data?.retry_after_ms || 30000;
      return `Too many attempts. Please wait ${Math.ceil(retryMs / 1000)} seconds and try again.`;
    }
    if (code === 'M_USER_DEACTIVATED') {
      return 'This account has been deactivated. Contact your server administrator.';
    }
    if (code === 'M_UNKNOWN_TOKEN' || code === 'M_MISSING_TOKEN') {
      return 'Session expired. Please log in again.';
    }
    if (err.message?.includes('ECONNREFUSED') || err.message?.includes('ENOTFOUND')) {
      return 'Cannot reach the chat server. Please check your internet connection and homeserver URL.';
    }
    if (err.message?.includes('ETIMEDOUT') || err.message?.includes('timeout')) {
      return 'Connection timed out. The server may be temporarily unavailable.';
    }
    if (err.message?.includes('Homeserver') || err.message?.includes('Invalid homeserver')) {
      return err.message;
    }
    return `Login failed: ${err.message || 'Unknown error'}`;
  }

  /**
   * Resume session from stored access token
   */
  async resumeSession() {
    // SEC-04: Decrypt access token from safeStorage
    let accessToken = null;
    try {
      const { safeStorage } = require('electron');
      const encB64 = this.store.get('chat.accessTokenEncrypted', '');
      if (encB64 && safeStorage.isEncryptionAvailable()) {
        accessToken = safeStorage.decryptString(Buffer.from(encB64, 'base64'));
      }
    } catch (e) {
      console.warn('[WindyChat] safeStorage decryption failed:', e.message);
    }
    // Fallback: try old plaintext token for migration
    if (!accessToken) accessToken = this.store.get('chat.accessToken', null);
    const userId = this.store.get('chat.userId');
    const deviceId = this.store.get('chat.deviceId');

    if (!accessToken || !userId) {
      return { success: false, error: 'No stored session' };
    }

    try {
      const validatedUrl = this._validateHomeserver(this.homeserverUrl);
      const sdk = await this._getSDK();
      this.client = sdk.createClient({
        baseUrl: validatedUrl,
        accessToken: accessToken,
        userId: userId,
        deviceId: deviceId,
        timelineSupport: true
      });

      // Initialize E2E encryption (best-effort)
      await this._initCrypto();

      await this._startSync();
      return { success: true, userId: userId };
    } catch (err) {
      console.error('[WindyChat] Session resume failed:', err.message);
      this.store.delete('chat.accessToken');
      return { success: false, error: this._classifyLoginError(err) };
    }
  }

  /**
   * Register a new Matrix account
   */
  async register(username, password, displayName) {
    try {
      const validatedUrl = this._validateHomeserver(this.homeserverUrl);
      const sdk = await this._getSDK();
      const tempClient = sdk.createClient({ baseUrl: validatedUrl });

      // P2-C4: Use registerRequest instead of deprecated register()
      await tempClient.registerRequest({
        username,
        password,
        auth: { type: 'm.login.dummy' },
        initial_device_display_name: 'Windy Pro Desktop'
      });

      // Now login with the new account
      const domain = new URL(this.homeserverUrl).hostname;
      const loginResult = await this.login(`@${username}:${domain}`, password);

      if (loginResult.success && displayName) {
        await this.client.setDisplayName(displayName);
      }

      return loginResult;
    } catch (err) {
      if (err.data && err.data.session) {
        console.debug('[WindyChat] Registration requires additional auth:', err.data.flows);
        return { success: false, error: 'Registration requires CAPTCHA or email verification. Please register at ' + this.homeserverUrl };
      }
      if (err.errcode === 'M_USER_IN_USE') {
        return { success: false, error: 'This username is already taken. Please choose a different one.' };
      }
      if (err.errcode === 'M_INVALID_USERNAME') {
        return { success: false, error: 'Invalid username. Use only lowercase letters, numbers, and underscores.' };
      }
      if (err.httpStatus === 429) {
        return { success: false, error: 'Too many requests. Please wait and try again.' };
      }
      console.error('[WindyChat] Registration failed:', err.message);
      return { success: false, error: this._classifyLoginError(err) };
    }
  }

  // ═══════════════════════════════════════════════
  // Sync + Reconnection
  // ═══════════════════════════════════════════════

  /**
   * Start the Matrix sync loop (listens for incoming messages)
   */
  async _startSync() {
    if (!this.client) return;

    const userLang = this._getUserLanguage();

    // P1-C1: Remove any prior listeners from a previous sync to prevent double-registration
    this.client.removeAllListeners('sync');
    this.client.removeAllListeners('Room.timeline');
    this.client.removeAllListeners('User.presence');
    this.client.removeAllListeners('RoomMember.typing');
    this.client.removeAllListeners('Room.myMembership');

    // Listen for sync state changes (reconnection, errors)
    this.client.on('sync', (state, prevState) => {
      this._syncState = state;
      if (state === 'PREPARED' || state === 'SYNCING') {
        if (!this.isConnected) {
          this.isConnected = true;
          this.emit('connected');
          // Flush offline queue on reconnect
          this._flushOfflineQueue();
          // Re-establish presence
          this.setPresence('online').catch(() => {});
        }
        this.emit('connection-status', { state: 'connected' });
      } else if (state === 'ERROR') {
        this.isConnected = false;
        this.emit('connection-status', { state: 'ERROR' });
        console.warn('[WindyChat] Sync error — will auto-retry');
      } else if (state === 'RECONNECTING') {
        this.emit('connection-status', { state: 'RECONNECTING' });
      }
    });

    // Listen for incoming messages
    this.client.on('Room.timeline', async (event, room, toStartOfTimeline) => {
      if (toStartOfTimeline) return;
      if (event.getType() !== 'm.room.message') return;
      if (event.getSender() === this.client.getUserId()) return;

      const content = event.getContent();
      const senderId = event.getSender();
      const roomId = room.roomId;
      const timestamp = event.getTs();

      // Extract standard Windy translation metadata
      const windyOriginal = content.windy_original || null;
      const windyLang = content.windy_lang || null;

      let displayText = content.body || '';
      let translatedText = null;
      let translationUnavailable = false;

      // Auto-translate if message is in a foreign language
      if (this.translateFn && windyLang && windyLang !== userLang) {
        try {
          // Translate the original text (not the already-translated body)
          const sourceText = windyOriginal || content.body;
          translatedText = await this.translateFn(sourceText, windyLang, userLang);
          displayText = translatedText;
        } catch (e) {
          console.warn('[WindyChat] Auto-translate failed:', e.message);
          translationUnavailable = true;
          // Show original text with unavailable indicator
          displayText = windyOriginal || content.body;
        }
      }

      this.emit('message', {
        roomId,
        senderId,
        senderName: room.getMember(senderId)?.name || senderId,
        body: displayText,
        originalText: windyOriginal || (translatedText ? content.body : null),
        originalLang: windyLang || null,
        translationUnavailable,
        timestamp,
        eventId: event.getId()
      });

      // Cache messages locally for offline access
      this._cacheRoomMessages(roomId);
    });

    // Listen for presence changes
    this.client.on('User.presence', (event, user) => {
      const presence = user.presence; // 'online', 'offline', 'unavailable'
      this.presenceMap.set(user.userId, {
        presence,
        lastActive: user.lastActiveAgo
      });
      this.emit('presence', {
        userId: user.userId,
        presence: presence,
        lastActive: user.lastActiveAgo
      });
    });

    // Listen for typing indicators
    this.client.on('RoomMember.typing', (event, member) => {
      if (member.userId === this.client.getUserId()) return;
      this.emit('typing', {
        roomId: member.roomId,
        userId: member.userId,
        displayName: member.name || member.userId,
        typing: member.typing
      });
    });

    // Listen for room invites
    this.client.on('Room.myMembership', (room, membership) => {
      if (membership === 'invite') {
        this.emit('invite', {
          roomId: room.roomId,
          roomName: room.name,
          inviterId: room.getDMInviter()
        });
      }
    });

    // Start syncing with auto-reconnect
    await this.client.startClient({ initialSyncLimit: 20 });
    console.debug('[WindyChat] Connected and syncing');
  }

  // ═══════════════════════════════════════════════
  // Offline Queue
  // ═══════════════════════════════════════════════

  /**
   * Flush queued offline messages on reconnect
   */
  async _flushOfflineQueue() {
    if (this._offlineQueue.length === 0) return;
    console.debug(`[WindyChat] Flushing ${this._offlineQueue.length} queued messages`);
    const queue = [...this._offlineQueue];
    this._offlineQueue = [];
    for (const item of queue) {
      try {
        await this.sendMessage(item.roomId, item.text);
      } catch (e) {
        console.warn('[WindyChat] Offline queue send failed, re-queuing:', e.message);
        this._offlineQueue.push(item);
      }
    }
  }

  /**
   * Cache last N messages per room for offline access
   */
  _cacheRoomMessages(roomId) {
    try {
      const messages = this.getMessages(roomId, 30);
      this.store.set(`chat.cache.${roomId.replace(/[^a-zA-Z0-9]/g, '_')}`, messages);
    } catch (e) {
      console.debug('[WindyChat] Message cache write failed:', e.message);
    }
  }

  /**
   * Load cached messages for offline use
   */
  getCachedMessages(roomId) {
    try {
      return this.store.get(`chat.cache.${roomId.replace(/[^a-zA-Z0-9]/g, '_')}`, []);
    } catch (e) {
      return [];
    }
  }

  // ═══════════════════════════════════════════════
  // Messaging
  // ═══════════════════════════════════════════════

  /**
   * Send a message with Windy translation metadata
   * Standard format: { body, windy_original, windy_lang }
   */
  async sendMessage(roomId, text) {
    if (!this.client) throw new Error('Not connected');

    const userLang = this._getUserLanguage();

    // Build message with standard Windy metadata
    const content = {
      msgtype: 'm.text',
      body: typeof text === 'string' ? text.slice(0, 65535) : String(text).slice(0, 65535),
      windy_original: typeof text === 'string' ? text.slice(0, 65535) : String(text).slice(0, 65535),
      windy_lang: userLang
    };

    try {
      const result = await this.client.sendEvent(roomId, 'm.room.message', content);
      // Cache updated messages
      this._cacheRoomMessages(roomId);
      return {
        eventId: result.event_id,
        body: text,
        originalText: text,
        originalLang: userLang
      };
    } catch (err) {
      console.error('[WindyChat] Send failed:', err.message);
      // If offline, queue the message
      if (!this.isConnected || err.message?.includes('ECONNREFUSED') || err.message?.includes('timeout')) {
        this._offlineQueue.push({ roomId, text });
        return { eventId: null, queued: true, body: text };
      }
      throw err; // Re-throw so UI can show error
    }
  }

  /**
   * Create a direct message room with another user
   */
  async createDM(userId) {
    if (!this.client) throw new Error('Not connected');

    // Validate user ID format
    if (!userId || !userId.match(/^@[a-zA-Z0-9._=-]+:[a-zA-Z0-9.-]+$/)) {
      return { roomId: null, error: 'Invalid user ID format. Use @username:server.org' };
    }

    // Check if DM already exists
    const existingRoom = this._findExistingDM(userId);
    if (existingRoom) {
      return { roomId: existingRoom.roomId, existing: true };
    }

    try {
      // P1-C7: Do NOT set room encryption until Olm/Vodozemac is properly configured
      // Setting m.room.encryption without proper crypto causes messages to fail
      const room = await this.client.createRoom({
        is_direct: true,
        invite: [userId],
        preset: 'trusted_private_chat',
        visibility: 'private'
      });

      // P2-C3: Update m.direct account data so DM detection works
      try {
        const directEvent = this.client.getAccountData('m.direct');
        const directMap = directEvent ? { ...directEvent.getContent() } : {};
        if (!directMap[userId]) directMap[userId] = [];
        directMap[userId].push(room.room_id);
        await this.client.setAccountData('m.direct', directMap);
      } catch (e) {
        console.warn('[WindyChat] Failed to update m.direct:', e.message);
      }

      return { roomId: room.room_id, existing: false };
    } catch (err) {
      console.error('[WindyChat] createDM failed:', err.message);
      if (err.errcode === 'M_NOT_FOUND') {
        return { roomId: null, error: `User "${userId}" was not found on the server.` };
      }
      if (err.errcode === 'M_FORBIDDEN') {
        return { roomId: null, error: `Cannot message "${userId}" — they may have restricted who can contact them.` };
      }
      return { roomId: null, error: `Could not start conversation: ${err.message}` };
    }
  }

  // P2-C2: Use Matrix m.direct account data for DM detection (spec-compliant)
  _findExistingDM(userId) {
    if (!this.client) return null;

    // First try m.direct account data (proper Matrix spec way)
    try {
      const directEvent = this.client.getAccountData('m.direct');
      if (directEvent) {
        const directMap = directEvent.getContent(); // { userId: [roomId, ...] }
        const dmRoomIds = directMap[userId] || [];
        for (const roomId of dmRoomIds) {
          const room = this.client.getRoom(roomId);
          if (room) return room;
        }
      }
    } catch (e) {
      console.debug('[WindyChat] m.direct lookup failed:', e.message);
    }

    // Fallback to member-count heuristic
    const rooms = this.client.getRooms();
    for (const room of rooms) {
      const members = room.getJoinedMembers();
      if (members.length === 2 && members.some(m => m.userId === userId)) {
        return room;
      }
    }
    return null;
  }

  /**
   * Get all DM rooms (contacts) with presence info
   */
  getContacts() {
    if (!this.client) return [];
    const myUserId = this.client.getUserId();
    const rooms = this.client.getRooms();
    const contacts = [];

    for (const room of rooms) {
      const members = room.getJoinedMembers();
      if (members.length <= 2) {
        const other = members.find(m => m.userId !== myUserId);
        if (other) {
          const lastEvent = room.timeline[room.timeline.length - 1];
          const presenceInfo = this.presenceMap.get(other.userId);

          contacts.push({
            roomId: room.roomId,
            userId: other.userId,
            displayName: other.name || other.userId,
            avatarUrl: other.getAvatarUrl(this.homeserverUrl, 48, 48, 'crop'),
            lastMessage: lastEvent ? lastEvent.getContent().body : '',
            lastTimestamp: lastEvent ? lastEvent.getTs() : 0,
            unreadCount: room.getUnreadNotificationCount('total') || 0,
            presence: presenceInfo?.presence || 'offline',
            lastActive: presenceInfo?.lastActive || null
          });
        }
      }
    }

    contacts.sort((a, b) => b.lastTimestamp - a.lastTimestamp);
    return contacts;
  }

  /**
   * Get total unread count across all rooms
   */
  getTotalUnread() {
    if (!this.client) return 0;
    let total = 0;
    for (const room of this.client.getRooms()) {
      total += room.getUnreadNotificationCount('total') || 0;
    }
    return total;
  }

  /**
   * Get message history for a room with translation metadata
   * Falls back to cached messages if offline
   */
  getMessages(roomId, limit = 50) {
    if (!this.client) {
      // Offline — return cached messages
      return this.getCachedMessages(roomId);
    }
    const room = this.client.getRoom(roomId);
    if (!room) {
      return this.getCachedMessages(roomId);
    }

    const myUserId = this.client.getUserId();
    return room.timeline
      .filter(event => event.getType() === 'm.room.message')
      .slice(-limit)
      .map(event => {
        const content = event.getContent();
        return {
          eventId: event.getId(),
          senderId: event.getSender(),
          senderName: room.getMember(event.getSender())?.name || event.getSender(),
          body: content.body,
          originalText: content.windy_original || null,
          originalLang: content.windy_lang || null,
          timestamp: event.getTs(),
          isOwn: event.getSender() === myUserId
        };
      });
  }

  /**
   * Get user profile info
   */
  async getUserProfile(userId) {
    if (!this.client) return null;
    try {
      const profile = await this.client.getProfileInfo(userId);
      const presenceInfo = this.presenceMap.get(userId);
      return {
        userId,
        displayName: profile.displayname || userId,
        avatarUrl: profile.avatar_url ?
          this.client.mxcUrlToHttp(profile.avatar_url, 96, 96, 'crop') : null,
        presence: presenceInfo?.presence || 'offline',
        lastActive: presenceInfo?.lastActive || null
      };
    } catch (e) {
      console.warn('[WindyChat] getUserProfile failed:', e.message);
      return { userId, displayName: userId, avatarUrl: null, presence: 'offline' };
    }
  }

  /**
   * Set user presence
   */
  async setPresence(status) {
    if (!this.client) return;
    try {
      // P2-C6: Use direct string arg — object form deprecated in SDK v31+
      await this.client.setPresence(status); // 'online', 'offline', 'unavailable'
    } catch (err) {
      console.warn('[WindyChat] setPresence failed:', err.message);
    }
  }

  /**
   * Set display name
   */
  async setDisplayName(displayName) {
    if (!this.client) return;
    try {
      await this.client.setDisplayName(displayName);
      this.store.set('chat.displayName', displayName);
    } catch (err) {
      console.warn('[WindyChat] setDisplayName failed:', err.message);
    }
  }

  /**
   * Upload avatar and set it
   */
  async setAvatar(buffer, mimeType) {
    if (!this.client) return;
    try {
      const uploadResponse = await this.client.uploadContent(buffer, {
        type: mimeType,
        name: 'avatar'
      });
      await this.client.setAvatarUrl(uploadResponse.content_uri);
    } catch (err) {
      console.error('[WindyChat] setAvatar failed:', err.message);
      throw err;
    }
  }

  /**
   * Accept a room invite
   */
  async acceptInvite(roomId) {
    if (!this.client) return { success: false, error: 'Not connected' };
    try {
      await this.client.joinRoom(roomId);
      return { success: true };
    } catch (err) {
      console.warn('[WindyChat] acceptInvite failed:', err.message);
      if (err.errcode === 'M_FORBIDDEN') {
        return { success: false, error: 'You are not allowed to join this room.' };
      }
      return { success: false, error: `Failed to join room: ${err.message}` };
    }
  }

  /**
   * Decline a room invite
   */
  async declineInvite(roomId) {
    if (!this.client) return;
    try {
      await this.client.leave(roomId);
    } catch (err) {
      console.warn('[WindyChat] declineInvite failed:', err.message);
    }
  }

  /**
   * Send typing indicator
   */
  async sendTyping(roomId, isTyping) {
    if (!this.client) return;
    try {
      await this.client.sendTyping(roomId, isTyping, isTyping ? 5000 : undefined);
    } catch (err) {
      // Typing indicators are best-effort — don't crash on failure
      console.debug('[WindyChat] sendTyping failed:', err.message);
    }
  }

  /**
   * Get E2E encryption status
   */
  getCryptoStatus() {
    return {
      enabled: this._cryptoEnabled,
      deviceId: this.client ? this.store.get('chat.deviceId', null) : null,
      syncState: this._syncState
    };
  }

  /**
   * Logout and clear session
   */
  async logout() {
    if (this.client) {
      try {
        // P1-M1: Clean up ALL event listeners to prevent memory leaks
        this.client.removeAllListeners();
        this.client.stopClient();
        await this.client.logout();
      } catch (err) {
        console.warn('[WindyChat] Logout error:', err.message);
      }
      this.client = null;
    }
    this.isConnected = false;
    this._cryptoEnabled = false;
    this._syncState = null;
    this._offlineQueue = [];
    this.presenceMap.clear();
    this.store.delete('chat.accessToken');
    this.store.delete('chat.accessTokenEncrypted');
    this.store.delete('chat.userId');
    this.store.delete('chat.deviceId');
    this.emit('disconnected');
  }

  /**
   * Get current user ID
   */
  getUserId() {
    return this.client ? this.client.getUserId() : null;
  }

  /**
   * Get user's preferred language
   */
  _getUserLanguage() {
    const languages = this.store.get('wizard.userLanguages', []);
    if (languages.length > 0) {
      // Spread to avoid mutating the stored array reference
      return [...languages].sort((a, b) => (b.weight || 0) - (a.weight || 0))[0].code;
    }
    return this.store.get('chat.language', 'en');
  }
}

module.exports = { WindyChatClient };
