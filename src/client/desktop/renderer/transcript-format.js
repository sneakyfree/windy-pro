// Pure transcript format helpers — txt, md, srt — extracted from
// app.js so they can be unit-tested without spinning up the renderer.
//
// Pure functions with NO DOM, NO window, NO IPC. Behavior identical
// to the original inline implementations in
// app.js _exportTranscript(); refactor that to call these helpers.
//
// Dual-export pattern (window global + CommonJS) mirrors
// signup-banner.js so the same source loads in both Electron renderer
// and jest jsdom env.

(function (root) {
  'use strict';

  /**
   * Format seconds to SRT timestamp (HH:MM:SS,mmm). Always emits
   * three-digit milliseconds (",000" placeholder — original code
   * never tracked sub-second timing for the bulk export path).
   */
  function formatSrtTime(secs) {
    if (typeof secs !== 'number' || !Number.isFinite(secs) || secs < 0) secs = 0;
    const h = String(Math.floor(secs / 3600)).padStart(2, '0');
    const m = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
    const s = String(Math.floor(secs % 60)).padStart(2, '0');
    return `${h}:${m}:${s},000`;
  }

  /**
   * Plain-text export — the user's transcript verbatim.
   */
  function toTxt(text) {
    return typeof text === 'string' ? text : '';
  }

  /**
   * Markdown export — H1 header with timestamp, paragraphs separated
   * by blank lines.
   *
   * @param {string} text
   * @param {Date} [now]   inject for testability; defaults to new Date()
   */
  function toMd(text, now) {
    const safeText = typeof text === 'string' ? text : '';
    const stamp = (now instanceof Date && !isNaN(now.getTime()))
      ? now.toLocaleString()
      : new Date().toLocaleString();
    const paragraphs = safeText.split(/\n+/).filter(p => p.trim());
    return `# Transcript — ${stamp}\n\n${paragraphs.map(p => p.trim()).join('\n\n')}\n`;
  }

  /**
   * SRT export — chunks the text at ~15 words/cue, assigning a
   * synthetic 2.5 words/sec rate so a 60-word transcript spans ~24s.
   * Same behaviour as the original inline implementation.
   *
   * Returns an empty string if the transcript is empty.
   */
  function toSrt(text) {
    if (typeof text !== 'string' || !text.trim()) return '';
    const words = text.split(/\s+/).filter(Boolean);
    const CHUNK = 15;
    const RATE = 2.5; // words per second
    let srt = '';
    for (let i = 0, idx = 1; i < words.length; i += CHUNK, idx++) {
      const chunk = words.slice(i, i + CHUNK).join(' ');
      const startSec = Math.floor(i / RATE);
      const endSec = Math.floor(Math.min(i + CHUNK, words.length) / RATE);
      srt += `${idx}\n${formatSrtTime(startSec)} --> ${formatSrtTime(endSec)}\n${chunk}\n\n`;
    }
    return srt.trim();
  }

  /**
   * Build a default filename for the given format with an
   * ISO-like timestamp slug.
   */
  function defaultFilenameFor(format, now) {
    const d = (now instanceof Date && !isNaN(now.getTime())) ? now : new Date();
    const stamp = d.toISOString().slice(0, 19).replace(/:/g, '-');
    const ext = (format === 'md' || format === 'srt' || format === 'txt') ? format : 'txt';
    return `transcript-${stamp}.${ext}`;
  }

  const api = { formatSrtTime, toTxt, toMd, toSrt, defaultFilenameFor };

  root.WindyTranscriptFormat = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
}(typeof window !== 'undefined' ? window : globalThis));
