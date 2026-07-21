/**
 * Home Insights — a local, privacy-first stats card + recent-dictation timeline shown on
 * the idle home screen (Wispr-Flow-style, but 100% on-device).
 *
 * Reads ONLY the local archive via window.windyAPI.getArchiveStats() and
 * getArchiveHistory(); nothing is ever uploaded. That's the deliberate 1-up over cloud
 * dictation apps that compute your stats on their servers. Empty state (no dictations
 * yet) renders nothing, so a fresh install keeps the clean welcome/shortcuts screen.
 *
 * Self-contained + additive: injects its own CSS, mounts into #homeInsightsMount, and
 * refreshes on load + window focus. It touches none of the recording/paste flow.
 */
(function () {
  'use strict';
  const byId = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function fmtCount(n) {
    n = Number(n) || 0;
    if (n >= 1000000) return (n / 1000000).toFixed(n >= 10000000 ? 0 : 1).replace(/\.0$/, '') + 'M';
    if (n >= 10000) return (n / 1000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, '') + 'K';
    return n.toLocaleString();
  }
  function dayLabel(d) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const that = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diff = Math.round((today - that) / 86400000);
    if (diff === 0) return 'TODAY';
    if (diff === 1) return 'YESTERDAY';
    return that.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }).toUpperCase();
  }
  const timeLabel = (d) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  function preview(text, n) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    return t.length > n ? t.slice(0, n - 1) + '…' : t;
  }

  function timelineHtml(entries) {
    let html = '', lastDay = null;
    for (const e of entries) {
      const d = new Date(e.date);
      if (isNaN(d.getTime())) continue;
      const lbl = dayLabel(d);
      if (lbl !== lastDay) { html += `<div class="hi-day">${esc(lbl)}</div>`; lastDay = lbl; }
      const text = preview(e.text, 90) || '(no text)';
      html += `<div class="hi-row"><span class="hi-time">${esc(timeLabel(d))}</span>` +
        `<span class="hi-text" title="${esc(preview(e.text, 240))}">${esc(text)}</span>` +
        `<span class="hi-words">${Number(e.wordCount) || 0} words</span></div>`;
    }
    return html;
  }

  let _busy = false;
  async function render() {
    const mount = byId('homeInsightsMount');
    const api = window.windyAPI;
    if (!mount || !api || typeof api.getArchiveStats !== 'function' || _busy) return;
    _busy = true;
    try {
      const stats = await api.getArchiveStats();
      if (!stats || !(Number(stats.totalSessions) > 0)) { mount.innerHTML = ''; return; }
      let entries = [];
      if (typeof api.getArchiveHistory === 'function') {
        try { const h = await api.getArchiveHistory(); entries = Array.isArray(h) ? h : (h && h.entries) || []; } catch (_) { /* ignore */ }
      }
      const recent = entries.slice(0, 8);
      mount.innerHTML =
        `<div class="hi-card">` +
          `<div class="hi-stats">` +
            `<div class="hi-stat"><div class="hi-num">${fmtCount(stats.totalWords)}</div><div class="hi-lbl">words dictated</div></div>` +
            `<div class="hi-stat"><div class="hi-num">${Number(stats.wpm) || 0}</div><div class="hi-lbl">avg wpm</div></div>` +
            `<div class="hi-stat"><div class="hi-num">${Number(stats.streak) || 0}<span class="hi-fire">🔥</span></div><div class="hi-lbl">day streak</div></div>` +
          `</div>` +
          `<div class="hi-privacy">🔒 Computed on your machine — never uploaded</div>` +
          (recent.length ? `<div class="hi-recent">${timelineHtml(recent)}</div>` : '') +
        `</div>`;
    } catch (_) {
      // leave whatever was there
    } finally {
      _busy = false;
    }
  }

  function injectCss() {
    if (byId('homeInsightsCss')) return;
    const s = document.createElement('style');
    s.id = 'homeInsightsCss';
    s.textContent =
      '#homeInsightsMount{width:100%;max-width:560px;margin:0 auto 14px;}' +
      '.hi-card{text-align:left;}' +
      '.hi-stats{display:flex;gap:10px;justify-content:center;margin-bottom:6px;}' +
      '.hi-stat{flex:1;text-align:center;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:12px 6px;}' +
      '.hi-num{font-size:26px;font-weight:700;color:#E5E7EB;line-height:1.1;}' +
      '.hi-fire{font-size:16px;margin-left:2px;}' +
      '.hi-lbl{font-size:11px;color:#9CA3AF;margin-top:3px;}' +
      '.hi-privacy{text-align:center;font-size:11px;color:#6B7280;margin:2px 0 10px;}' +
      '.hi-recent{max-height:220px;overflow-y:auto;}' +
      '.hi-day{font-size:10px;letter-spacing:0.08em;color:#6B7280;font-weight:700;margin:10px 0 4px;}' +
      '.hi-row{display:flex;align-items:baseline;gap:8px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.04);font-size:12px;}' +
      '.hi-time{color:#9CA3AF;flex:0 0 64px;}' +
      '.hi-text{color:#D1D5DB;flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
      '.hi-words{color:#6B7280;flex:0 0 auto;font-size:11px;}';
    document.head.appendChild(s);
  }

  function init() { injectCss(); render(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  // Refresh whenever the user returns to the app window (cheap; stats are cached 30s in main).
  window.addEventListener('focus', () => render());
  window.WindyHomeInsights = { render };
})();
