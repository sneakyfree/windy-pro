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
 * License: Proprietary (Windy Pro)
 * Matrix JS SDK: Apache 2.0
 */

// matrix-js-sdk is ESM-only — use dynamic import(), cached after first load
let _matrixSdk = null;

const { EventEmitter } = require('events');

class WindyChatClient extends EventEmitter {
  constructor(store) {
    super();
    this.store = store;
    this.client = null;
    this.isConnected = false;
    this.translateFn = null; // Set externally by chat-translate.js
    this.presenceMap = new Map(); // userId → { presence, lastActive }

    // Default homeserver — configurable in settings
    this.homeserverUrl = store.get('chat.homeserver', 'https://matrix.org');
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
          throw new Error(`Cannot load matrix-js-sdk: ${err.message}. Fallback: ${e2.message}`);
        }
      }
    }
    return _matrixSdk;
  }

  /**
   * Initialize Matrix client and log in
   */
  async login(userId, password) {
    try {
      const sdk = await this._getSDK();
      const hostname = require('os').hostname();

      // Support both @user:server and plain username formats
      let fullUserId = userId;
      if (!userId.startsWith('@')) {
        const domain = new URL(this.homeserverUrl).hostname;
        fullUserId = `@${userId}:${domain}`;
      }

      this.client = sdk.createClient({
        baseUrl: this.homeserverUrl,
        deviceId: `windy-pro-${hostname}`
      });

      // Try login
      const loginResponse = await this.client.login('m.login.password', {
        user: fullUserId,
        password: password,
        device_id: `windy-pro-${hostname}`,
        initial_device_display_name: 'Windy Pro Desktop'
      });

      // Store access token
      this.store.set('chat.accessToken', loginResponse.access_token);
      this.store.set('chat.userId', loginResponse.user_id);
      this.store.set('chat.deviceId', loginResponse.device_id);

      // Reinitialize with access token
      this.client = sdk.createClient({
        baseUrl: this.homeserverUrl,
        accessToken: loginResponse.access_token,
        userId: loginResponse.user_id,
        deviceId: loginResponse.device_id,
        timelineSupport: true
      });

      await this._startSync();
      return { success: true, userId: loginResponse.user_id };
    } catch (err) {
      console.error('[WindyChat] Login failed:', err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Resume session from stored access token
   */
  async resumeSession() {
    const accessToken = this.store.get('chat.accessToken');
    const userId = this.store.get('chat.userId');
    const deviceId = this.store.get('chat.deviceId');

    if (!accessToken || !userId) {
      return { success: false, error: 'No stored session' };
    }

    try {
      const sdk = await this._getSDK();
      this.client = sdk.createClient({
        baseUrl: this.homeserverUrl,
        accessToken: accessToken,
        userId: userId,
        deviceId: deviceId,
        timelineSupport: true
      });

      await this._startSync();
      return { success: true, userId: userId };
    } catch (err) {
      console.error('[WindyChat] Session resume failed:', err.message);
      this.store.delete('chat.accessToken');
      return { success: false, error: err.message };
    }
  }

  /**
   * Register a new Matrix account
   */
  async register(username, password, displayName) {
    try {
      const sdk = await this._getSDK();
      const tempClient = sdk.createClient({ baseUrl: this.homeserverUrl });

      const regResponse = await tempClient.register(username, password, null, {
        type: 'm.login.dummy'
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
        console.log('[WindyChat] Registration requires additional auth:', err.data.flows);
        return { success: false, error: 'Registration requires CAPTCHA or email verification. Please register at ' + this.homeserverUrl };
      }
      console.error('[WindyChat] Registration failed:', err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Start the Matrix sync loop (listens for incoming messages)
   */
  async _startSync() {
    if (!this.client) return;

    const userLang = this._getUserLanguage();

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

      // Auto-translate if message is in a foreign language
      if (this.translateFn && windyLang && windyLang !== userLang) {
        try {
          // Translate the original text (not the already-translated body)
          const sourceText = windyOriginal || content.body;
          translatedText = await this.translateFn(sourceText, windyLang, userLang);
          displayText = translatedText;
        } catch (e) {
          console.warn('[WindyChat] Auto-translate failed:', e.message);
        }
      } else if (!windyLang && this.translateFn) {
        // Unknown language — body is the only text, try detect + translate
        // For now just show as-is; future: add language detection
      }

      this.emit('message', {
        roomId,
        senderId,
        senderName: room.getMember(senderId)?.name || senderId,
        body: displayText,
        originalText: windyOriginal || (translatedText ? content.body : null),
        originalLang: windyLang || null,
        timestamp,
        eventId: event.getId()
      });
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

    // Start syncing
    await this.client.startClient({ initialSyncLimit: 20 });
    this.isConnected = true;
    this.emit('connected');
    console.log('[WindyChat] Connected and syncing');
  }

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
      body: text,
      windy_original: text,
      windy_lang: userLang
    };

    const result = await this.client.sendEvent(roomId, 'm.room.message', content);
    return {
      eventId: result.event_id,
      body: text,
      originalText: text,
      originalLang: userLang
    };
  }

  /**
   * Create a direct message room with another user
   */
  async createDM(userId) {
    if (!this.client) throw new Error('Not connected');

    // Check if DM already exists
    const existingRoom = this._findExistingDM(userId);
    if (existingRoom) {
      return { roomId: existingRoom.roomId, existing: true };
    }

    // Create new DM room with encryption
    const room = await this.client.createRoom({
      is_direct: true,
      invite: [userId],
      preset: 'trusted_private_chat',
      visibility: 'private',
      initial_state: [{
        type: 'm.room.encryption',
        state_key: '',
        content: { algorithm: 'm.megolm.v1.aes-sha2' }
      }]
    });

    return { roomId: room.room_id, existing: false };
  }

  _findExistingDM(userId) {
    if (!this.client) return null;
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
   */
  getMessages(roomId, limit = 50) {
    if (!this.client) return [];
    const room = this.client.getRoom(roomId);
    if (!room) return [];

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
      return { userId, displayName: userId, avatarUrl: null, presence: 'offline' };
    }
  }

  /**
   * Set user presence
   */
  async setPresence(status) {
    if (!this.client) return;
    await this.client.setPresence({ presence: status });
  }

  /**
   * Set display name
   */
  async setDisplayName(displayName) {
    if (!this.client) return;
    await this.client.setDisplayName(displayName);
    this.store.set('chat.displayName', displayName);
  }

  /**
   * Upload avatar and set it
   */
  async setAvatar(buffer, mimeType) {
    if (!this.client) return;
    const uploadResponse = await this.client.uploadContent(buffer, {
      type: mimeType,
      name: 'avatar'
    });
    await this.client.setAvatarUrl(uploadResponse.content_uri);
  }

  /**
   * Accept a room invite
   */
  async acceptInvite(roomId) {
    if (!this.client) return;
    await this.client.joinRoom(roomId);
  }

  /**
   * Decline a room invite
   */
  async declineInvite(roomId) {
    if (!this.client) return;
    await this.client.leave(roomId);
  }

  /**
   * Send typing indicator
   */
  async sendTyping(roomId, isTyping) {
    if (!this.client) return;
    await this.client.sendTyping(roomId, isTyping, isTyping ? 5000 : undefined);
  }

  /**
   * Logout and clear session
   */
  async logout() {
    if (this.client) {
      try {
        this.client.stopClient();
        await this.client.logout();
      } catch (err) {
        console.warn('[WindyChat] Logout error:', err.message);
      }
      this.client = null;
    }
    this.isConnected = false;
    this.presenceMap.clear();
    this.store.delete('chat.accessToken');
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
      return languages.sort((a, b) => (b.weight || 0) - (a.weight || 0))[0].code;
    }
    return this.store.get('chat.language', 'en');
  }
}

module.exports = { WindyChatClient };
