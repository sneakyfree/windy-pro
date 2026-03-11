/**
 * Windy Chat — Preload Bridge
 * 
 * Exposes chat API to the renderer process via contextBridge.
 * Follows the same security pattern as the main preload.js.
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
  sendTyping: (roomId, isTyping) => ipcRenderer.invoke('chat-send-typing', roomId, isTyping),

  // ═══ Contacts & Rooms ═══
  getContacts: () => ipcRenderer.invoke('chat-get-contacts'),
  createDM: (userId) => ipcRenderer.invoke('chat-create-dm', userId),
  acceptInvite: (roomId) => ipcRenderer.invoke('chat-accept-invite', roomId),
  declineInvite: (roomId) => ipcRenderer.invoke('chat-decline-invite', roomId),

  // ═══ Profile ═══
  setProfile: (displayName, avatarUrl) => ipcRenderer.invoke('chat-set-profile', displayName, avatarUrl),
  setPresence: (status) => ipcRenderer.invoke('chat-set-presence', status),

  // ═══ Events (renderer listens) ═══
  onMessage: (callback) => {
    ipcRenderer.on('chat-new-message', (event, msg) => callback(msg));
  },
  onPresence: (callback) => {
    ipcRenderer.on('chat-presence-update', (event, data) => callback(data));
  },
  onInvite: (callback) => {
    ipcRenderer.on('chat-invite', (event, data) => callback(data));
  },
  onConnected: (callback) => {
    ipcRenderer.on('chat-connected', () => callback());
  },
  onDisconnected: (callback) => {
    ipcRenderer.on('chat-disconnected', () => callback());
  },

  // ═══ Utilities ═══
  getUserLanguage: () => ipcRenderer.invoke('chat-get-user-language'),
  getTranslation: (text, srcLang, tgtLang) => ipcRenderer.invoke('chat-translate-text', text, srcLang, tgtLang)
});
