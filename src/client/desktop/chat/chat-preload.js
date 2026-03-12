/**
 * Windy Chat — Preload Bridge
 * 
 * Exposes chat API to the renderer process via contextBridge.
 * Follows the same security pattern as the main preload.js.
 * 
 * Hardened: added connection status, crypto status, cached messages
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('windyChat', {
  // ═══ Authentication ═══
  login: (userId, password) => ipcRenderer.invoke('chat-login', userId, password),
  register: (username, password, displayName) => ipcRenderer.invoke('chat-register', username, password, displayName),
  logout: () => ipcRenderer.invoke('chat-logout'),
  getSession: () => ipcRenderer.invoke('chat-get-session'),

  // ═══ Messaging ═══
  sendMessage: (roomId, text) => ipcRenderer.invoke('chat-send-message', roomId, text),
  getMessages: (roomId, limit) => ipcRenderer.invoke('chat-get-messages', roomId, limit),
  getCachedMessages: (roomId) => ipcRenderer.invoke('chat-get-cached-messages', roomId),
  sendTyping: (roomId, isTyping) => ipcRenderer.invoke('chat-send-typing', roomId, isTyping),

  // ═══ Contacts & Rooms ═══
  getContacts: () => ipcRenderer.invoke('chat-get-contacts'),
  createDM: (userId) => ipcRenderer.invoke('chat-create-dm', userId),
  acceptInvite: (roomId) => ipcRenderer.invoke('chat-accept-invite', roomId),
  declineInvite: (roomId) => ipcRenderer.invoke('chat-decline-invite', roomId),

  // ═══ Profile ═══
  setDisplayName: (displayName) => ipcRenderer.invoke('chat-set-display-name', displayName),
  setPresence: (status) => ipcRenderer.invoke('chat-set-presence', status),
  getUserProfile: (userId) => ipcRenderer.invoke('chat-get-user-profile', userId),
  getTotalUnread: () => ipcRenderer.invoke('chat-get-total-unread'),

  // ═══ Encryption ═══
  getCryptoStatus: () => ipcRenderer.invoke('chat-get-crypto-status'),

  // ═══ Settings ═══
  getChatSettings: () => ipcRenderer.invoke('chat-get-settings'),
  setChatSettings: (settings) => ipcRenderer.invoke('chat-set-settings', settings),

  // ═══ Events (renderer listens) ═══
  onMessage: (callback) => {
    // P2-M3: Remove prior listener to prevent accumulation on re-init
    ipcRenderer.removeAllListeners('chat-new-message');
    ipcRenderer.on('chat-new-message', (event, msg) => callback(msg));
  },
  onPresence: (callback) => {
    ipcRenderer.removeAllListeners('chat-presence-update');
    ipcRenderer.on('chat-presence-update', (event, data) => callback(data));
  },
  onTyping: (callback) => {
    ipcRenderer.removeAllListeners('chat-typing');
    ipcRenderer.on('chat-typing', (event, data) => callback(data));
  },
  onInvite: (callback) => {
    ipcRenderer.removeAllListeners('chat-invite');
    ipcRenderer.on('chat-invite', (event, data) => callback(data));
  },
  onConnected: (callback) => {
    ipcRenderer.removeAllListeners('chat-connected');
    ipcRenderer.on('chat-connected', () => callback());
  },
  onDisconnected: (callback) => {
    ipcRenderer.removeAllListeners('chat-disconnected');
    ipcRenderer.on('chat-disconnected', () => callback());
  },
  onConnectionStatus: (callback) => {
    ipcRenderer.removeAllListeners('chat-connection-status');
    ipcRenderer.on('chat-connection-status', (event, data) => callback(data));
  },
  onUnreadUpdate: (callback) => {
    ipcRenderer.removeAllListeners('chat-unread-update');
    ipcRenderer.on('chat-unread-update', (event, count) => callback(count));
  },

  // ═══ Utilities ═══
  getUserLanguage: () => ipcRenderer.invoke('chat-get-user-language'),
  getTranslation: (text, srcLang, tgtLang) => ipcRenderer.invoke('chat-translate-text', text, srcLang, tgtLang)
});
