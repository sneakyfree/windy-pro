/**
 * Windy Pro - Installer Preload Script
 * Exposes safe APIs for the installer wizard renderer.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('installerAPI', {
    scanHardware: () => ipcRenderer.invoke('installer-scan-hardware'),
    selectModel: (model) => ipcRenderer.invoke('installer-select-model', model),
    selectModels: (models) => ipcRenderer.invoke('installer-select-models', models),
    install: () => ipcRenderer.invoke('installer-install'),
    checkPermissions: () => ipcRenderer.invoke('installer-check-permissions'),
    complete: () => ipcRenderer.invoke('installer-complete'),
    getModelCatalog: () => ipcRenderer.invoke('get-model-catalog'),

    onProgress: (callback) => {
        ipcRenderer.on('installer-progress', (event, data) => callback(data));
    }
});
