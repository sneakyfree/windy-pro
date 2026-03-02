/**
 * Windy Pro - Mini Translate Preload
 * Exposes close() and translate() IPC bridges for the floating quick-translate window.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('miniTranslateAPI', {
    close: () => ipcRenderer.send('mini-translate-close'),
    translate: (text, sourceLang, targetLang) =>
        ipcRenderer.invoke('mini-translate-text', text, sourceLang, targetLang),
});
