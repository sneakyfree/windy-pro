/**
 * Windy Voice Input — Reusable voice-to-text component for any text input.
 *
 * Usage:
 *   addVoiceInput(document.getElementById('my-input'), { autoSend: false });
 *
 * Adds a mic icon to the input. Click to record → transcribe → insert text.
 * Works with <input>, <textarea>, and contenteditable elements.
 */

/* global windyAPI */

/**
 * Transcribe an audio blob to text using available engines.
 * Tries: IPC to main process → WebSocket to local Python engine → cloud API
 */
async function _windyTranscribeBlob(blob) {
  // 1. Try IPC to main process (batch transcribe)
  try {
    if (window.windyAPI && window.windyAPI.batchTranscribeLocal) {
      const arrayBuffer = await blob.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
      const result = await window.windyAPI.batchTranscribeLocal(base64);
      if (result && result.text) return result.text;
      if (result && result.segments && result.segments.length > 0) {
        return result.segments.map(s => s.text).join(' ');
      }
    }
  } catch (_) { /* fall through */ }

  // 2. Try WebSocket to Python engine (port 9876)
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Transcription timeout')), 15000);
    try {
      const ws = new WebSocket('ws://127.0.0.1:9876');
      ws.onopen = () => {
        blob.arrayBuffer().then(buf => {
          ws.send(JSON.stringify({ type: 'transcribe', format: 'webm' }));
          ws.send(buf);
        });
      };
      ws.onmessage = (e) => {
        clearTimeout(timeout);
        try {
          const data = JSON.parse(e.data);
          ws.close();
          resolve(data.text || (data.segments || []).map(s => s.text).join(' '));
        } catch { resolve(e.data); }
      };
      ws.onerror = () => { clearTimeout(timeout); reject(new Error('Engine unavailable')); };
    } catch (err) { clearTimeout(timeout); reject(err); }
  });
}

/**
 * Show a brief toast notification.
 */
function _windyVoiceToast(message, isError = false) {
  const toast = document.createElement('div');
  toast.style.cssText = `position:fixed; bottom:80px; left:50%; transform:translateX(-50%);
    background:${isError ? '#dc2626' : '#1e293b'}; color:#fff; padding:8px 16px;
    border-radius:8px; font-size:12px; font-weight:600; z-index:9999;
    box-shadow:0 4px 12px rgba(0,0,0,0.3);`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

/**
 * Add a voice input mic icon to any text input element.
 *
 * @param {HTMLElement} inputElement - Input, textarea, or contenteditable element
 * @param {Object} options
 * @param {boolean} options.autoSend - Auto-submit after transcription
 * @param {Function} options.onTranscribe - Callback with transcribed text
 * @param {number} options.maxDuration - Max recording duration in ms (default 30000)
 * @returns {HTMLElement} The mic button element
 */
function addVoiceInput(inputElement, options = {}) {
  const { autoSend = false, onTranscribe = null, maxDuration = 30000 } = options;

  // Ensure parent has relative positioning for icon placement
  const wrapper = inputElement.parentElement;
  if (wrapper) wrapper.style.position = 'relative';

  // Adjust input padding for the icon
  const isTextarea = inputElement.tagName === 'TEXTAREA';
  inputElement.style.paddingRight = '32px';

  // Create mic button
  const micIcon = document.createElement('button');
  micIcon.type = 'button';
  micIcon.textContent = '\u{1F399}\uFE0F'; // 🎙️
  micIcon.title = 'Voice input (Windy Word)';
  micIcon.style.cssText = `position:absolute; right:8px; ${isTextarea ? 'bottom:8px' : 'top:50%; transform:translateY(-50%)'};
    background:none; border:none; font-size:14px; cursor:pointer; opacity:0.5;
    transition:opacity 0.15s; padding:2px 4px; border-radius:4px;`;

  micIcon.addEventListener('mouseenter', () => { if (!recorder) micIcon.style.opacity = '1'; });
  micIcon.addEventListener('mouseleave', () => { if (!recorder) micIcon.style.opacity = '0.5'; });

  let recorder = null;

  micIcon.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (recorder && recorder.isRecording) {
      // Stop recording
      clearTimeout(recorder.autoStopTimer);
      recorder.mediaRecorder.onstop = async () => {
        const blob = new Blob(recorder.chunks, { type: 'audio/webm;codecs=opus' });
        recorder.stream.getTracks().forEach(t => t.stop());
        recorder = null;
        micIcon.textContent = '\u{1F399}\uFE0F';
        micIcon.style.opacity = '0.5';
        micIcon.style.animation = '';

        try {
          const text = await _windyTranscribeBlob(blob);
          if (text && text.trim()) {
            // Insert text into the input
            if (inputElement.isContentEditable) {
              inputElement.textContent = (inputElement.textContent || '') + text.trim();
            } else {
              inputElement.value = (inputElement.value ? inputElement.value + ' ' : '') + text.trim();
            }
            inputElement.dispatchEvent(new Event('input', { bubbles: true }));
            if (onTranscribe) onTranscribe(text.trim());
            if (autoSend) {
              inputElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            }
          } else {
            _windyVoiceToast('No speech detected', true);
          }
        } catch (_) {
          _windyVoiceToast('Voice capture failed', true);
        }
      };
      recorder.mediaRecorder.stop();
    } else {
      // Start recording
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true }
        });
        const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
        const chunks = [];
        mediaRecorder.ondataavailable = (ev) => { if (ev.data.size > 0) chunks.push(ev.data); };
        mediaRecorder.start(100);

        recorder = {
          mediaRecorder, stream, chunks, isRecording: true,
          autoStopTimer: setTimeout(() => micIcon.click(), maxDuration),
        };

        micIcon.textContent = '\u23F9\uFE0F'; // ⏹️
        micIcon.style.opacity = '1';
        micIcon.style.animation = 'mic-pulse 1s ease-in-out infinite';
      } catch (_) {
        _windyVoiceToast('Microphone access denied', true);
      }
    }
  });

  if (wrapper) wrapper.appendChild(micIcon);

  return micIcon;
}

// Add CSS animation if not already present
if (!document.getElementById('windy-voice-input-styles')) {
  const style = document.createElement('style');
  style.id = 'windy-voice-input-styles';
  style.textContent = `
    @keyframes mic-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
  `;
  document.head.appendChild(style);
}
