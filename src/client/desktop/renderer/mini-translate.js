/**
 * Mini Translate – external script (required for CSP: script-src 'self')
 */
const { ipcRenderer } = require('electron');

function closeWindow() {
    ipcRenderer.send('mini-translate-close');
}

document.getElementById('closeBtn').addEventListener('click', closeWindow);

// Close on Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeWindow();
});

document.getElementById('swapBtn').addEventListener('click', () => {
    const s = document.getElementById('sourceLang');
    const t = document.getElementById('targetLang');
    if (s.value !== 'auto') {
        const tmp = s.value;
        s.value = t.value;
        t.value = tmp;
    }
});

async function doTranslate() {
    const text = document.getElementById('textInput').value.trim();
    if (!text) return;

    const sourceLang = document.getElementById('sourceLang').value;
    const targetLang = document.getElementById('targetLang').value;
    const resultArea = document.getElementById('resultArea');
    const sourceEl = document.getElementById('sourceText');
    const transEl = document.getElementById('translationText');
    const confEl = document.getElementById('confidenceBadge');

    sourceEl.textContent = text;
    transEl.textContent = 'Translating…';
    confEl.textContent = '';
    resultArea.classList.add('visible');

    try {
        const result = await ipcRenderer.invoke('mini-translate-text', text, sourceLang, targetLang);
        transEl.textContent = result.translatedText || '';
        const conf = result.confidence || 0;
        if (conf > 0) {
            const pct = Math.round(conf * 100);
            let bg = 'rgba(34,197,94,0.15)'; let fg = '#22C55E';
            if (conf < 0.7) { bg = 'rgba(239,68,68,0.15)'; fg = '#EF4444'; }
            else if (conf < 0.9) { bg = 'rgba(234,179,8,0.15)'; fg = '#EAB308'; }
            confEl.style.background = bg;
            confEl.style.color = fg;
            confEl.textContent = `${pct}%`;
        }
    } catch (err) {
        transEl.textContent = `⚠️ ${err.message}`;
    }
}

document.getElementById('translateBtn').addEventListener('click', doTranslate);
document.getElementById('textInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doTranslate(); }
});
