/**
 * Mini Translate – external script (required for CSP: script-src 'self')
 * Supports two modes: Text translation + Live Listen (continuous voice translation)
 */
const { ipcRenderer } = require('electron');

// ── DOM refs ──
const closeBtn = document.getElementById('closeBtn');
const swapBtn = document.getElementById('swapBtn');
const sourceLang = document.getElementById('sourceLang');
const targetLang = document.getElementById('targetLang');

// Text mode
const textMode = document.getElementById('textMode');
const textInput = document.getElementById('textInput');
const translateBtn = document.getElementById('translateBtn');
const resultArea = document.getElementById('resultArea');
const sourceText = document.getElementById('sourceText');
const translationText = document.getElementById('translationText');
const confidenceBadge = document.getElementById('confidenceBadge');

// Listen mode
const listenMode = document.getElementById('listenMode');
const listenBtn = document.getElementById('listenBtn');
const liveTranscript = document.getElementById('liveTranscript');
const detectedLangBadge = document.getElementById('detectedLangBadge');
const engineBadge = document.getElementById('engineBadge');
const modelInfoBar = document.getElementById('modelInfoBar');
const windytuneBadge = document.getElementById('windytuneBadge');
const modelBadge = document.getElementById('modelBadge');

// Tab buttons
const tabText = document.getElementById('tabText');
const tabListen = document.getElementById('tabListen');

// ── State ──
let isListening = false;
let mediaStream = null;
let mediaRecorder = null;
let chunks = [];
let chunkTimer = null;

const LANG_NAMES = {
    en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian',
    pt: 'Portuguese', zh: 'Chinese', ja: 'Japanese', ko: 'Korean', ar: 'Arabic',
    ru: 'Russian', pl: 'Polish', nl: 'Dutch', sv: 'Swedish', hi: 'Hindi',
    uk: 'Ukrainian', th: 'Thai', vi: 'Vietnamese', tr: 'Turkish', auto: 'Auto'
};

// ── Close ──
function closeWindow() {
    stopListening();
    ipcRenderer.send('mini-translate-close');
}
closeBtn.addEventListener('click', closeWindow);
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeWindow();
});

// ── Swap languages ──
swapBtn.addEventListener('click', () => {
    if (sourceLang.value !== 'auto') {
        const tmp = sourceLang.value;
        sourceLang.value = targetLang.value;
        targetLang.value = tmp;
    }
});

// ── Mode tabs ──
tabText.addEventListener('click', () => switchMode('text'));
tabListen.addEventListener('click', () => switchMode('listen'));

function switchMode(mode) {
    if (mode === 'text') {
        tabText.classList.add('active');
        tabListen.classList.remove('active');
        textMode.style.display = 'flex';
        listenMode.classList.remove('active');
        stopListening();
    } else {
        tabListen.classList.add('active');
        tabText.classList.remove('active');
        textMode.style.display = 'none';
        listenMode.classList.add('active');
    }
}

// ═══════════════════════════════
//  TEXT TRANSLATION (existing)
// ═══════════════════════════════
async function doTranslate() {
    const text = textInput.value.trim();
    if (!text) return;

    sourceText.textContent = text;
    translationText.textContent = 'Translating…';
    confidenceBadge.textContent = '';
    resultArea.classList.add('visible');

    try {
        const result = await ipcRenderer.invoke('mini-translate-text', text, sourceLang.value, targetLang.value);
        translationText.textContent = result.translatedText || '';
        const conf = result.confidence || 0;
        if (conf > 0) {
            const pct = Math.round(conf * 100);
            let bg = 'rgba(34,197,94,0.15)', fg = '#22C55E';
            if (conf < 0.7) { bg = 'rgba(239,68,68,0.15)'; fg = '#EF4444'; }
            else if (conf < 0.9) { bg = 'rgba(234,179,8,0.15)'; fg = '#EAB308'; }
            confidenceBadge.style.background = bg;
            confidenceBadge.style.color = fg;
            confidenceBadge.textContent = `${pct}%`;
        }
    } catch (err) {
        translationText.textContent = `⚠️ ${err.message}`;
    }
}

translateBtn.addEventListener('click', doTranslate);
textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doTranslate(); }
});

// ═══════════════════════════════
//  LIVE LISTEN (new)
// ═══════════════════════════════

listenBtn.addEventListener('click', () => {
    if (isListening) {
        stopListening();
    } else {
        startListening();
    }
});

async function startListening() {
    if (isListening) return;

    try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: { channelCount: 1, sampleRate: 16000, echoCancellation: false, noiseSuppression: false, autoGainControl: true }
        });
    } catch (err) {
        appendChunk(`⚠️ Microphone access denied: ${err.message}`, 'error');
        return;
    }

    isListening = true;
    chunkCount = 0;
    listenBtn.textContent = '⏹ Stop Listening';
    listenBtn.classList.add('recording');
    liveTranscript.innerHTML = '';
    appendChunk('🎤 Listening… speak now', 'info');

    // Start recording in 5-second chunks
    startNextChunk();
}

function startNextChunk() {
    if (!isListening || !mediaStream) return;

    chunks = [];
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus' : 'audio/webm';

    mediaRecorder = new MediaRecorder(mediaStream, { mimeType });
    mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
    };
    mediaRecorder.onstop = async () => {
        if (chunks.length > 0 && isListening) {
            const audioBlob = new Blob(chunks, { type: mimeType });
            await processChunk(audioBlob);
        }
        // Start next chunk if still listening
        if (isListening) startNextChunk();
    };

    mediaRecorder.start();

    // Stop after 5 seconds to process
    chunkTimer = setTimeout(() => {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
        }
    }, 5000);
}

let chunkCount = 0;

async function processChunk(audioBlob) {
    chunkCount++;
    const chunkNum = chunkCount;
    const sizeKB = Math.round(audioBlob.size / 1024);
    appendChunk(`⏳ Processing chunk #${chunkNum} (${sizeKB} KB)…`, 'info');

    try {
        const arrayBuf = await audioBlob.arrayBuffer();
        // Pass API keys from localStorage (renderer storage) since main process
        // uses electron-store which may not have them
        const apiKeys = {
            groq: localStorage.getItem('windy_groqApiKey') || '',
            openai: localStorage.getItem('windy_openaiApiKey') || ''
        };
        const result = await ipcRenderer.invoke('mini-translate-speech',
            Array.from(new Uint8Array(arrayBuf)),
            sourceLang.value,
            targetLang.value,
            apiKeys
        );

        if (result.error) {
            appendChunk(`⚠️ ${result.error}`, 'error');
            return;
        }

        if (result.text && result.text.trim()) {
            appendChunk(result.text);

            // Update detected language badge
            if (result.detectedLang) {
                const langName = LANG_NAMES[result.detectedLang] || result.detectedLang;
                detectedLangBadge.textContent = `🔍 ${langName}`;
                detectedLangBadge.style.display = '';
            }

            // Update engine badge
            if (result.engine) {
                const isCloud = result.engine === 'groq' || result.engine === 'openai';
                if (isCloud) {
                    const cloudModel = result.engine === 'groq' ? 'whisper-large-v3' : 'whisper-1';
                    engineBadge.textContent = `☁️ ${result.engine.toUpperCase()} · ${cloudModel}`;
                    engineBadge.className = 'badge badge-engine cloud';
                } else {
                    engineBadge.textContent = '🏠 Local Whisper';
                    engineBadge.className = 'badge badge-engine';
                }
                engineBadge.style.display = '';
            }

            // Update model info bar
            if (result.modelInfo) {
                modelInfoBar.style.display = 'flex';
                const mi = result.modelInfo;

                // WindyTune badge
                if (mi.windyTune) {
                    windytuneBadge.textContent = '⚡ WindyTune Auto';
                    windytuneBadge.style.display = '';
                } else {
                    windytuneBadge.style.display = 'none';
                }

                // Model name + size badge
                if (mi.model) {
                    const sizeStr = mi.size ? ` · ${mi.size}` : '';
                    modelBadge.textContent = `🧠 ${mi.model}${sizeStr}`;
                    modelBadge.style.display = '';
                }
            }
        } else {
            appendChunk(`🔇 Chunk #${chunkNum}: no speech detected`, 'info');
        }
    } catch (err) {
        appendChunk(`⚠️ Chunk #${chunkNum}: ${err.message}`, 'error');
    }
}

function appendChunk(text, type = 'normal') {
    // Remove placeholder if present
    const placeholder = liveTranscript.querySelector('.placeholder-text');
    if (placeholder) placeholder.remove();

    const div = document.createElement('div');
    div.className = 'chunk';

    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const timeDiv = document.createElement('div');
    timeDiv.className = 'chunk-time';
    timeDiv.textContent = time;
    div.appendChild(timeDiv);

    const textDiv = document.createElement('div');
    textDiv.textContent = text;
    if (type === 'error') textDiv.style.color = '#EF4444';
    if (type === 'info') textDiv.style.color = '#6B7280';
    div.appendChild(textDiv);

    liveTranscript.appendChild(div);
    liveTranscript.scrollTop = liveTranscript.scrollHeight;
}

function stopListening() {
    if (!isListening) return;
    isListening = false;

    if (chunkTimer) { clearTimeout(chunkTimer); chunkTimer = null; }
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
    }
    if (mediaStream) {
        mediaStream.getTracks().forEach(t => t.stop());
        mediaStream = null;
    }

    listenBtn.textContent = '🎤 Start Listening';
    listenBtn.classList.remove('recording');
    appendChunk('⏹ Stopped listening', 'info');
}
