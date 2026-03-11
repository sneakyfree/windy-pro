/**
 * Windy Chat — Matrix SDK Client Wrapper
 * 
 * Handles Matrix homeserver connection, authentication, room management,
 * message sending/receiving, and presence. All messages pass through
 * the translation middleware before delivery.
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

    // Default homeserver — will be configurable
    this.homeserverUrl = store.get('chat.homeserver', 'https://chat.windypro.com');
  }

  /**
   * Lazy-load the Matrix SDK (ESM module)
   */
  async _getSDK() {
    if (!_matrixSdk) {
      _matrixSdk = await import('matrix-js-sdk');
    }
    return _matrixSdk;
  }

  /**
   * Initialize Matrix client and log in
   * Uses stored credentials or creates new account
   */
  async login(userId, password) {
    try {
      const sdk = await this._getSDK();
      const hostname = require('os').hostname();

      this.client = sdk.createClient({
        baseUrl: this.homeserverUrl,
        userId: userId,
        deviceId: `windy-pro-${hostname}`
      });

      // Try login
      const loginResponse = await this.client.login('m.login.password', {
        user: userId,
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
        deviceId: loginResponse.device_id
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
        deviceId: deviceId
      });

      await this._startSync();
      return { success: true, userId: userId };
    } catch (err) {
      console.error('[WindyChat] Session resume failed:', err.message);
      // Clear stale credentials
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
      const loginResult = await this.login(`@${username}:${new URL(this.homeserverUrl).hostname}`, password);

      if (loginResult.success && displayName) {
        await this.client.setDisplayName(displayName);
      }

      return loginResult;
    } catch (err) {
      // If registration requires more auth flows, handle gracefully
      if (err.data && err.data.session) {
        console.log('[WindyChat] Registration requires additional auth:', err.data.flows);
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

    // Listen for incoming messages
    this.client.on('Room.timeline', (event, room, toStartOfTimeline) => {
      if (toStartOfTimeline) return; // Skip backfill
      if (event.getType() !== 'm.room.message') return;
      if (event.getSender() === this.client.getUserId()) return; // Skip own messages

      const content = event.getContent();
      const senderId = event.getSender();
      const roomId = room.roomId;
      const timestamp = event.getTs();

      // Extract translation metadata if present
      const originalText = content['windy.original_text'] || null;
      const sourceLanguage = content['windy.source_language'] || null;

      this.emit('message', {
        roomId,
        senderId,
        body: content.body,
        originalText,
        sourceLanguage,
        timestamp,
        eventId: event.getId()
      });
    });

    // Listen for presence changes
    this.client.on('User.presence', (event, user) => {
      this.emit('presence', {
        userId: user.userId,
        presence: user.presence, // 'online', 'offline', 'unavailable'
        lastActive: user.lastActiveAgo
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
   * Send a message (with auto-translation)
   * @param {string} roomId - Matrix room ID
   * @param {string} text - Message text in sender's language
   * @param {string} senderLang - Sender's language code (e.g., 'en')
   * @param {string} recipientLang - Recipient's language code (e.g., 'es')
   */
  async sendMessage(roomId, text, senderLang, recipientLang) {
    if (!this.client) throw new Error('Not connected');

    let translatedText = text;
    let wasTranslated = false;

    // Auto-translate if languages differ and translate function is available
    if (this.translateFn && senderLang && recipientLang && senderLang !== recipientLang) {
      try {
        translatedText = await this.translateFn(text, senderLang, recipientLang);
        wasTranslated = true;
      } catch (err) {
        console.warn('[WindyChat] Translation failed, sending original:', err.message);
        translatedText = text; // Fallback to original
      }
    }

    // Build message content with Windy metadata
    const content = {
      msgtype: 'm.text',
      body: translatedText,
      format: 'org.matrix.custom.html',
      // Windy-specific metadata for the recipient to show original + translated
      'windy.original_text': text,
      'windy.source_language': senderLang,
      'windy.target_language': recipientLang,
      'windy.translated': wasTranslated
    };

    const result = await this.client.sendEvent(roomId, 'm.room.message', content);
    return {
      eventId: result.event_id,
      translated: wasTranslated,
      translatedText
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

    // Create new DM room
    const room = await this.client.createRoom({
      is_direct: true,
      invite: [userId],
      preset: 'trusted_private_chat',
      visibility: 'private'
    });

    return { roomId: room.room_id, existing: false };
  }

  /**
   * Find an existing DM room with a user
   */
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
   * Get all DM rooms (contacts)
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
          contacts.push({
            roomId: room.roomId,
            userId: other.userId,
            displayName: other.name || other.userId,
            avatarUrl: other.getAvatarUrl(this.homeserverUrl, 48, 48, 'crop'),
            lastMessage: lastEvent ? lastEvent.getContent().body : '',
            lastTimestamp: lastEvent ? lastEvent.getTs() : 0,
            unreadCount: room.getUnreadNotificationCount('total') || 0
          });
        }
      }
    }

    // Sort by most recent message
    contacts.sort((a, b) => b.lastTimestamp - a.lastTimestamp);
    return contacts;
  }

  /**
   * Get message history for a room
   */
  getMessages(roomId, limit = 50) {
    if (!this.client) return [];
    const room = this.client.getRoom(roomId);
    if (!room) return [];

    const myUserId = this.client.getUserId();
    return room.timeline
      .filter(event => event.getType() === 'm.room.message')
      .slice(-limit)
      .map(event => ({
        eventId: event.getId(),
        senderId: event.getSender(),
        body: event.getContent().body,
        originalText: event.getContent()['windy.original_text'] || null,
        sourceLanguage: event.getContent()['windy.source_language'] || null,
        targetLanguage: event.getContent()['windy.target_language'] || null,
        wasTranslated: event.getContent()['windy.translated'] || false,
        timestamp: event.getTs(),
        isOwn: event.getSender() === myUserId
      }));
  }

  /**
   * Set user presence
   */
  async setPresence(status) {
    if (!this.client) return;
    await this.client.setPresence({ presence: status }); // 'online', 'offline', 'unavailable'
  }

  /**
   * Set display name and avatar
   */
  async setProfile(displayName, avatarUrl) {
    if (!this.client) return;
    if (displayName) await this.client.setDisplayName(displayName);
    // Avatar upload would require file handling — Phase 2
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
}

module.exports = { WindyChatClient };
