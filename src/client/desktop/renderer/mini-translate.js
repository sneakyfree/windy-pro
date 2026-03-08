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
const chunkSlider = document.getElementById('chunkSlider');
const chunkDurationLabel = document.getElementById('chunkDurationLabel');
// Cockpit elements
const audioStrobe = document.getElementById('audioStrobe');
const windyTuneToggle = document.getElementById('windyTuneToggle');
const manualLabel = document.getElementById('manualLabel');
const windyTuneLabel = document.getElementById('windyTuneLabel');
const modelSelectRow = document.getElementById('modelSelectRow');
const modelSelect = document.getElementById('modelSelect');
const listeningValue = document.getElementById('listeningValue');
const translatingValue = document.getElementById('translatingValue');

// Tab buttons
const tabText = document.getElementById('tabText');
const tabListen = document.getElementById('tabListen');

// ── State ──
let isListening = false;
let mediaStream = null;
let mediaRecorder = null;
let chunks = [];
let chunkTimer = null;
let chunkDurationMs = 10000; // default 10 seconds

// Chunk duration slider
chunkSlider.addEventListener('input', () => {
    const val = parseInt(chunkSlider.value, 10);
    chunkDurationMs = val * 1000;
    chunkDurationLabel.textContent = `${val}s`;
});

const LANG_NAMES = {
    auto: 'Auto', af: 'Afrikaans', sq: 'Albanian', am: 'Amharic', ar: 'Arabic',
    hy: 'Armenian', az: 'Azerbaijani', eu: 'Basque', be: 'Belarusian', bn: 'Bengali',
    bs: 'Bosnian', bg: 'Bulgarian', my: 'Burmese', ca: 'Catalan', zh: 'Chinese',
    hr: 'Croatian', cs: 'Czech', da: 'Danish', nl: 'Dutch', en: 'English',
    et: 'Estonian', fi: 'Finnish', fr: 'French', gl: 'Galician', ka: 'Georgian',
    de: 'German', el: 'Greek', gu: 'Gujarati', ht: 'Haitian Creole', ha: 'Hausa',
    he: 'Hebrew', hi: 'Hindi', hu: 'Hungarian', is: 'Icelandic', id: 'Indonesian',
    ga: 'Irish', it: 'Italian', ja: 'Japanese', jv: 'Javanese', kn: 'Kannada',
    kk: 'Kazakh', km: 'Khmer', ko: 'Korean', lo: 'Lao', la: 'Latin', lv: 'Latvian',
    ln: 'Lingala', lt: 'Lithuanian', lb: 'Luxembourgish', mk: 'Macedonian',
    mg: 'Malagasy', ms: 'Malay', ml: 'Malayalam', mt: 'Maltese', mi: 'Maori',
    mr: 'Marathi', mn: 'Mongolian', ne: 'Nepali', no: 'Norwegian', nn: 'Nynorsk',
    oc: 'Occitan', ps: 'Pashto', fa: 'Persian', pl: 'Polish', pt: 'Portuguese',
    pa: 'Punjabi', ro: 'Romanian', ru: 'Russian', sa: 'Sanskrit', sr: 'Serbian',
    sn: 'Shona', sd: 'Sindhi', si: 'Sinhala', sk: 'Slovak', sl: 'Slovenian',
    so: 'Somali', es: 'Spanish', su: 'Sundanese', sw: 'Swahili', sv: 'Swedish',
    tl: 'Tagalog', tg: 'Tajik', ta: 'Tamil', tt: 'Tatar', te: 'Telugu',
    th: 'Thai', bo: 'Tibetan', tk: 'Turkmen', tr: 'Turkish', uk: 'Ukrainian',
    ur: 'Urdu', uz: 'Uzbek', vi: 'Vietnamese', cy: 'Welsh', yi: 'Yiddish', yo: 'Yoruba'
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

// ── WindyTune / Manual toggle ──
let isWindyTune = true;
windyTuneToggle.addEventListener('click', () => {
    isWindyTune = !isWindyTune;
    windyTuneToggle.classList.toggle('on', isWindyTune);
    manualLabel.classList.toggle('active', !isWindyTune);
    windyTuneLabel.classList.toggle('active', isWindyTune);
    modelSelectRow.style.display = isWindyTune ? 'none' : 'flex';
    // Update cockpit display
    if (isWindyTune) {
        listeningValue.textContent = '🌪️ WindyTune — auto';
        listeningValue.className = 'cockpit-value';
        translatingValue.textContent = '🌪️ WindyTune — auto';
        translatingValue.className = 'cockpit-value';
    } else {
        const sel = modelSelect.options[modelSelect.selectedIndex];
        listeningValue.textContent = `🏠 ${sel.text}`;
        listeningValue.className = 'cockpit-value local';
        translatingValue.textContent = `🏠 ${sel.text}`;
        translatingValue.className = 'cockpit-value local';
    }
});

modelSelect.addEventListener('change', () => {
    if (!isWindyTune) {
        const sel = modelSelect.options[modelSelect.selectedIndex];
        listeningValue.textContent = `🏠 ${sel.text}`;
        listeningValue.className = 'cockpit-value local';
        translatingValue.textContent = `🏠 ${sel.text}`;
        translatingValue.className = 'cockpit-value local';
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
    audioStrobe.classList.add('active');
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

    // Stop after configured duration to process
    chunkTimer = setTimeout(() => {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
        }
    }, chunkDurationMs);
}

let chunkCount = 0;

async function processChunk(audioBlob) {
    chunkCount++;
    const chunkNum = chunkCount;
    const sizeKB = Math.round(audioBlob.size / 1024);
    const durSec = Math.round(chunkDurationMs / 1000);
    appendChunk(`⏳ Processing chunk #${chunkNum} (${sizeKB} KB · ${durSec}s)…`, 'info');

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

            // Update cockpit — listening role
            if (result.engine) {
                const isCloud = result.engine === 'groq' || result.engine === 'openai';
                if (isCloud) {
                    listeningValue.textContent = '☁️ Windy Cloud';
                    listeningValue.className = 'cockpit-value cloud';
                } else {
                    const localLabel = result.modelInfo?.model || 'Local';
                    const sizeStr = result.modelInfo?.size ? ` · ${result.modelInfo.size}` : '';
                    listeningValue.textContent = `🏠 ${localLabel}${sizeStr}`;
                    listeningValue.className = 'cockpit-value local';
                }
            }

            // Update cockpit — translating role
            if (result.modelInfo) {
                const mi = result.modelInfo;
                const isCloud = result.engine === 'groq' || result.engine === 'openai';
                if (isCloud) {
                    const specStr = mi.specialty ? ` — ${mi.specialty}` : '';
                    translatingValue.textContent = `☁️ Windy Cloud LLM${specStr}`;
                    translatingValue.className = 'cockpit-value cloud';
                } else {
                    const sizeStr = mi.size ? ` · ${mi.size}` : '';
                    const specStr = mi.specialty ? ` — ${mi.specialty}` : '';
                    translatingValue.textContent = `🏠 ${mi.model}${sizeStr}${specStr}`;
                    translatingValue.className = 'cockpit-value local';
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
    audioStrobe.classList.remove('active');
    appendChunk('⏹ Stopped listening', 'info');
}
