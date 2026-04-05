/**
 * Windy Pro — Video Preview Preload Script
 * Bridges IPC between main process and the video preview window.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('videoPreviewAPI', {
  // Receive video frames from main renderer (relayed via main process)
  onFrame: (callback) => {
    ipcRenderer.on('video-frame', (_event, data) => callback(data));
  },

  // Receive recording state changes (recording / standby)
  onRecordingState: (callback) => {
    ipcRenderer.on('recording-state', (_event, state) => callback(state));
  },

  // Receive stop-camera signal (clears the preview)
  onStopCamera: (callback) => {
    ipcRenderer.on('stop-camera', () => callback());
  },

  // Close the video preview window
  closeWindow: () => {
    ipcRenderer.send('close-video-preview');
  },

  // Resize the video preview window
  resizeWindow: (w, h) => {
    ipcRenderer.send('resize-video-preview', w, h);
  },

  // Start main-process-driven resize (for corner handles)
  startResize: (corner, screenX, screenY, startW, startH, winX, winY) => {
    ipcRenderer.send('start-resize-video', corner, screenX, screenY, startW, startH, winX, winY);
  },

  // Stop main-process-driven resize
  stopResize: () => {
    ipcRenderer.send('stop-resize-video');
  },

  // Receive resize feedback (width, height) for size label
  onResizeFeedback: (callback) => {
    ipcRenderer.on('resize-feedback', (_event, w, h) => callback(w, h));
  },

  // Minimize the video preview window
  minimizeWindow: () => {
    ipcRenderer.send('minimize-video-preview');
  },

  // Toggle always-on-top (send to back / bring to front)
  toggleAlwaysOnTop: () => {
    return ipcRenderer.invoke('toggle-video-always-on-top');
  },
});
