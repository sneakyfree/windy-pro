const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('videoPreviewAPI', {
    onFrame: (cb) => ipcRenderer.on('video-frame', (_e, dataUrl) => cb(dataUrl)),
    onRecordingState: (cb) => ipcRenderer.on('recording-state', (_e, state) => cb(state)),
    onStopCamera: (cb) => ipcRenderer.on('stop-camera', () => cb()),
    closeWindow: () => ipcRenderer.send('close-video-preview'),
    resizeWindow: (w, h) => ipcRenderer.send('resize-video-preview', w, h),
    resizeAndMove: (w, h, x, y) => ipcRenderer.send('resize-move-video-preview', w, h, x, y),
    startResize: (corner, sx, sy, sw, sh, wx, wy) => ipcRenderer.send('start-resize-video', corner, sx, sy, sw, sh, wx, wy),
    stopResize: () => ipcRenderer.send('stop-resize-video'),
    onResizeFeedback: (cb) => ipcRenderer.on('resize-feedback', (_e, w, h) => cb(w, h))
});
