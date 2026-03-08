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

// Listen mode
const listenMode = document.getElementById('listenMode');
const listenBtn = document.getElementById('listenBtn');
const unifiedTranscript = document.getElementById('unifiedTranscript');
const detectedLangBadge = document.getElementById('detectedLangBadge');
const chunkSlider = document.getElementById('chunkSlider');
const chunkDurationLabel = document.getElementById('chunkDurationLabel');
// Cockpit elements
const audioStrobe = document.getElementById('audioStrobe');
const windyTuneToggle = document.getElementById('windyTuneToggle');
const manualLabel = document.getElementById('manualLabel');
const windyTuneLabel = document.getElementById('windyTuneLabel');
const modelSelectRow = document.getElementById('modelSelectRow');
const listenModelSelect = document.getElementById('listenModelSelect');
const translateModelSelect = document.getElementById('translateModelSelect');
const translateModelRow = document.getElementById('translateModelRow');
const listeningValue = document.getElementById('listeningValue');
const translatingValue = document.getElementById('translatingValue');
const localOnlyRow = document.getElementById('localOnlyRow');
const localOnlyCheckbox = document.getElementById('localOnlyCheckbox');

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

// Processing queue — buffer all chunks, never drop (delayed > missing)
const MAX_CONCURRENT = 3;
let activeProcessing = 0;
const processingQueue = [];

// Chunk duration slider — restart recorder on change
chunkSlider.addEventListener('input', () => {
    const val = parseInt(chunkSlider.value, 10);
    chunkDurationMs = val * 1000;
    chunkDurationLabel.textContent = `${val}s`;
    // If recording, restart the current chunk with new duration
    if (isListening && mediaRecorder && mediaRecorder.state === 'recording') {
        clearTimeout(chunkTimer);
        mediaRecorder.stop(); // triggers onstop → enqueue + startNextChunk
    }
});

// Font size slider
const fontSlider = document.getElementById('fontSlider');
const fontSizeLabel = document.getElementById('fontSizeLabel');
fontSlider.addEventListener('input', () => {
    const px = fontSlider.value;
    fontSizeLabel.textContent = px;
    unifiedTranscript.style.fontSize = `${px}px`;
});

// UI scale slider — scales control panel elements only (NOT transcript)
const uiScaleSlider = document.getElementById('uiScaleSlider');
const controlPanel = document.getElementById('controlPanel');
uiScaleSlider.addEventListener('input', () => {
    const scale = uiScaleSlider.value / 10; // 0.8x to 1.6x
    controlPanel.style.zoom = scale;
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
let isLocalOnly = false;

windyTuneToggle.addEventListener('click', () => {
    isWindyTune = !isWindyTune;
    windyTuneToggle.classList.toggle('on', isWindyTune);
    manualLabel.classList.toggle('active', !isWindyTune);
    windyTuneLabel.classList.toggle('active', isWindyTune);
    // Show/hide model selects
    const showModels = isWindyTune ? 'none' : 'flex';
    modelSelectRow.style.display = showModels;
    translateModelRow.style.display = showModels;
    // Show Local Only only in WindyTune mode
    localOnlyRow.style.display = isWindyTune ? 'flex' : 'none';
    // Update cockpit display
    if (isWindyTune) {
        const suffix = isLocalOnly ? 'local only' : 'auto';
        listeningValue.textContent = `🌪️ WindyTune — ${suffix}`;
        listeningValue.className = 'cockpit-value';
        translatingValue.textContent = `🌪️ WindyTune — ${suffix}`;
        translatingValue.className = 'cockpit-value';
    } else {
        updateCockpitFromSelects();
    }
});

function updateCockpitFromSelects() {
    const lSel = listenModelSelect.options[listenModelSelect.selectedIndex];
    const tSel = translateModelSelect.options[translateModelSelect.selectedIndex];
    const isCloudL = listenModelSelect.value === 'cloud';
    const isCloudT = translateModelSelect.value === 'cloud';
    listeningValue.textContent = isCloudL ? '☁️ Windy Cloud' : `🏠 ${lSel.text}`;
    listeningValue.className = isCloudL ? 'cockpit-value cloud' : 'cockpit-value local';
    translatingValue.textContent = isCloudT ? '☁️ Windy Cloud' : `🏠 ${tSel.text}`;
    translatingValue.className = isCloudT ? 'cockpit-value cloud' : 'cockpit-value local';
}

localOnlyCheckbox.addEventListener('change', () => {
    isLocalOnly = localOnlyCheckbox.checked;
    localOnlyRow.classList.toggle('active', isLocalOnly);
    // Disable cloud options when Local Only is checked
    const cloudOpts = [...listenModelSelect.querySelectorAll('option[value="cloud"]'),
    ...translateModelSelect.querySelectorAll('option[value="cloud"]')];
    cloudOpts.forEach(opt => { opt.disabled = isLocalOnly; });
    // If cloud was selected, switch to default local
    if (isLocalOnly) {
        if (listenModelSelect.value === 'cloud') listenModelSelect.value = 'core-standard';
        if (translateModelSelect.value === 'cloud') translateModelSelect.value = 'core-standard';
    }
    if (isWindyTune) {
        const suffix = isLocalOnly ? 'local only' : 'auto';
        listeningValue.textContent = `🌪️ WindyTune — ${suffix}`;
        translatingValue.textContent = `🌪️ WindyTune — ${suffix}`;
    }
});

listenModelSelect.addEventListener('change', () => {
    if (!isWindyTune) updateCockpitFromSelects();
});
translateModelSelect.addEventListener('change', () => {
    if (!isWindyTune) updateCockpitFromSelects();
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

    const srcName = LANG_NAMES[sourceLang.value] || sourceLang.value;
    const tgtName = LANG_NAMES[targetLang.value] || targetLang.value;
    appendChunk(`⌨️ [${srcName} → ${tgtName}]  ${text}`, 'info');
    textInput.value = '';

    try {
        const result = await ipcRenderer.invoke('mini-translate-text', text, sourceLang.value, targetLang.value);
        if (result.translatedText) {
            appendChunk(`${result.translatedText}`);
        } else {
            appendChunk('⚠️ No translation returned', 'error');
        }
    } catch (err) {
        appendChunk(`⚠️ ${err.message}`, 'error');
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
    appendChunk('🎤 Listening… speak now', 'info');

    // Start recording in 5-second chunks
    startNextChunk();
}

function startNextChunk() {
    if (!isListening || !mediaStream) return;

    const OVERLAP_MS = 500; // 500ms overlap captures boundary words

    // Each recorder gets its own closure-scoped chunks array — no shared state
    const localChunks = [];
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus' : 'audio/webm';

    const recorder = new MediaRecorder(mediaStream, { mimeType });
    mediaRecorder = recorder; // Update global ref for stop button
    let stoppedByTimer = false; // Track if timer handled the restart

    recorder.ondataavailable = (e) => {
        if (e.data.size > 0) localChunks.push(e.data);
    };
    recorder.onstop = () => {
        // Enqueue for processing — queue limits concurrency to avoid overwhelming server
        if (localChunks.length > 0) {
            const audioBlob = new Blob(localChunks, { type: mimeType });
            enqueueChunk(audioBlob);
        }
        // If stopped externally (slider change, stop button) and not by the timer,
        // restart recording with the new settings
        if (!stoppedByTimer && isListening) {
            startNextChunk();
        }
    };

    recorder.start();

    // Start next recorder BEFORE stopping this one (creates overlap)
    chunkTimer = setTimeout(() => {
        stoppedByTimer = true;
        if (isListening) startNextChunk(); // New recorder starts NOW
        // Stop this recorder after overlap window
        setTimeout(() => {
            if (recorder.state === 'recording') {
                recorder.stop();
            }
        }, OVERLAP_MS);
    }, chunkDurationMs);
}

let chunkCount = 0;

function enqueueChunk(audioBlob) {
    processingQueue.push(audioBlob);
    // Show queue depth if backing up
    const pending = processingQueue.length + activeProcessing;
    if (pending > 3) {
        appendChunk(`⏳ Queue: ${pending} chunks pending — catching up…`, 'info');
    }
    drainQueue();
}

function drainQueue() {
    while (activeProcessing < MAX_CONCURRENT && processingQueue.length > 0) {
        const blob = processingQueue.shift();
        activeProcessing++;
        processChunk(blob)
            .catch(err => appendChunk(`⚠️ ${err.message}`, 'error'))
            .finally(() => {
                activeProcessing--;
                drainQueue(); // process next in queue
            });
    }
}

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
            apiKeys,
            {
                localOnly: isLocalOnly,
                listeningModel: isWindyTune ? 'windytune' : listenModelSelect.value,
                translatingModel: isWindyTune ? 'windytune' : translateModelSelect.value
            }
        );

        if (result.error) {
            appendChunk(`⚠️ ${result.error}`, 'error');
            return;
        }

        if (result.text && result.text.trim()) {
            // Build metadata for this chunk
            const meta = { duration: durSec };
            // Listening engine — from backend result
            if (result.engine) {
                const isCloudListen = result.engine === 'groq' || result.engine === 'openai';
                meta.listening = isCloudListen ? '☁️ Windy Cloud' : ('🏠 ' + (result.modelInfo?.model || 'Local'));
            }
            // Translating engine — from the user's dropdown selection (Manual)
            // or from back-end result (WindyTune)
            if (isWindyTune) {
                const isCloudTranslate = result.engine === 'groq' || result.engine === 'openai';
                meta.translating = isCloudTranslate ? '☁️ Windy Cloud' : ('🏠 ' + (result.modelInfo?.model || 'Local'));
            } else {
                const tVal = translateModelSelect.value;
                if (tVal === 'cloud') {
                    meta.translating = '☁️ Windy Cloud';
                } else {
                    const tSel = translateModelSelect.options[translateModelSelect.selectedIndex];
                    meta.translating = '🏠 ' + tSel.text;
                }
            }
            appendChunk(result.text, 'normal', meta);

            // Update detected language badge
            if (result.detectedLang) {
                const langName = LANG_NAMES[result.detectedLang] || result.detectedLang;
                detectedLangBadge.textContent = `🔍 ${langName}`;
                detectedLangBadge.style.display = '';
            }

            // Only update cockpit engine values in WindyTune mode
            // In Manual mode, the user's selection is locked
            if (isWindyTune) {
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
                        translatingValue.textContent = '☁️ Windy Cloud';
                        translatingValue.className = 'cockpit-value cloud';
                    } else {
                        const sizeStr = mi.size ? ` · ${mi.size}` : '';
                        translatingValue.textContent = `🏠 ${mi.model}${sizeStr}`;
                        translatingValue.className = 'cockpit-value local';
                    }
                }
            }
        } else {
            appendChunk(`🔇 Chunk #${chunkNum}: no speech detected`, 'info');
        }
    } catch (err) {
        appendChunk(`⚠️ Chunk #${chunkNum}: ${err.message}`, 'error');
    }
}

function appendChunk(text, type = 'normal', meta = null) {
    // Remove placeholder if present
    const placeholder = unifiedTranscript.querySelector('.placeholder-text');
    if (placeholder) placeholder.remove();

    const div = document.createElement('div');
    div.className = 'chunk';

    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const timeDiv = document.createElement('div');
    timeDiv.className = 'chunk-time';
    timeDiv.textContent = time;
    div.appendChild(timeDiv);

    // Engine metadata line
    if (meta) {
        const metaDiv = document.createElement('div');
        metaDiv.className = 'chunk-meta';
        const parts = [];
        if (meta.listening) parts.push('🎤 ' + meta.listening);
        if (meta.translating) parts.push('📝 ' + meta.translating);
        if (meta.duration) parts.push(meta.duration + 's');
        metaDiv.textContent = parts.join('  ·  ');
        div.appendChild(metaDiv);
    }

    const textDiv = document.createElement('div');
    textDiv.textContent = text;
    if (type === 'error') textDiv.style.color = '#EF4444';
    if (type === 'info') textDiv.style.color = '#6B7280';
    div.appendChild(textDiv);

    unifiedTranscript.appendChild(div);
    unifiedTranscript.scrollTop = unifiedTranscript.scrollHeight;
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

// ════════════════════════════════════════════
// TOOLTIP SYSTEM — event delegation, viewport-clamped
// ════════════════════════════════════════════
(function initTooltips() {
    const tip = document.getElementById('tooltip');
    if (!tip) {
        console.warn('[Tooltip] #tooltip element not found');
        return;
    }
    let timer = null;
    let activeEl = null;

    document.addEventListener('mouseover', function (e) {
        const el = e.target.closest('[data-tooltip]');
        if (!el) return;
        if (el === activeEl) return;
        activeEl = el;
        clearTimeout(timer);
        timer = setTimeout(function () {
            const text = el.getAttribute('data-tooltip');
            if (!text) return;
            tip.textContent = text;
            tip.style.display = 'block';

            // Measure after display:block
            const rect = el.getBoundingClientRect();
            const tw = tip.offsetWidth;
            const th = tip.offsetHeight;
            const ww = window.innerWidth;
            const wh = window.innerHeight;

            // Position below element, centered
            let x = rect.left + (rect.width / 2) - (tw / 2);
            let y = rect.bottom + 8;

            // Clamp to viewport
            if (x + tw > ww - 10) x = ww - tw - 10;
            if (x < 10) x = 10;
            if (y + th > wh - 10) y = rect.top - th - 8;
            if (y < 10) y = 10;

            tip.style.left = x + 'px';
            tip.style.top = y + 'px';
        }, 300);
    }, true);

    document.addEventListener('mouseout', function (e) {
        const el = e.target.closest('[data-tooltip]');
        if (el) {
            clearTimeout(timer);
            activeEl = null;
            tip.style.display = 'none';
        }
    }, true);

    console.log('[Tooltip] Initialized — found', document.querySelectorAll('[data-tooltip]').length, 'elements');
})();
