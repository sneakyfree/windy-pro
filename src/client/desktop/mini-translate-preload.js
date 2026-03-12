/**
 * Windy Pro - Mini Translate Preload
 * Exposes close() and translate() IPC bridges for the floating quick-translate window.
 * SEC-01 fix: replaces nodeIntegration:true with safe contextBridge API.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('miniTranslateAPI', {
    close: () => ipcRenderer.send('mini-translate-close'),
    translate: (text, sourceLang, targetLang) =>
        ipcRenderer.invoke('mini-translate-text', text, sourceLang, targetLang),
    translateSpeech: (audioArray, sourceLang, targetLang, apiKeys, options) =>
        ipcRenderer.invoke('mini-translate-speech', audioArray, sourceLang, targetLang, apiKeys, options),
});
