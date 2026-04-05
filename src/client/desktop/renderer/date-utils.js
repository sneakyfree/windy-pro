/**
 * Windy Pro — Centralized Date/Time Utilities
 *
 * All user-visible timestamps should use these helpers so the
 * user's timezone preference is respected everywhere.
 *
 * Preference key: localStorage 'windy_timezone'
 *   - 'auto' or absent → system timezone (Intl default)
 *   - Any IANA string   → that timezone  (e.g. 'America/New_York')
 *
 * Architecture: Uses Intl.DateTimeFormat.formatToParts() for
 * bulletproof timezone conversion — one formatter call extracts
 * all parts (month, day, year, hour, minute, AM/PM, timezone)
 * in a single pass. This avoids Chromium bugs where individual
 * toLocaleString() calls with partial options ignore timeZone.
 */

const WindyDateUtils = (() => {

  /** Return the IANA timezone to use for formatting. */
  function getTimezone() {
    const saved = localStorage.getItem('windy_timezone');
    if (saved && saved !== 'auto') return saved;
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  /** Return the detected system timezone (always auto). */
  function getSystemTimezone() {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  /**
   * Extract named parts from a Date via Intl.DateTimeFormat.formatToParts.
   * This is the ONLY correct way to get timezone-adjusted components.
   */
  function _parts(date, options) {
    const d = date instanceof Date ? date : new Date(date);
    const tz = getTimezone();
    const fmt = new Intl.DateTimeFormat('en-US', { ...options, timeZone: tz });
    const parts = fmt.formatToParts(d);
    const result = {};
    for (const p of parts) {
      result[p.type] = p.value;
    }
    return result;
  }

  /**
   * Short date+time:  "Mar 25, 2026 9:51 PM EDT"
   */
  function formatShortDate(date) {
    const p = _parts(date, {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
      timeZoneName: 'short'
    });
    return `${p.month} ${p.day}, ${p.year} ${p.hour}:${p.minute} ${p.dayPeriod} ${p.timeZoneName}`;
  }

  /**
   * Long date+time:  "March 25, 2026 9:51 PM EDT"
   */
  function formatLongDate(date) {
    const p = _parts(date, {
      month: 'long', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
      timeZoneName: 'short'
    });
    return `${p.month} ${p.day}, ${p.year} ${p.hour}:${p.minute} ${p.dayPeriod} ${p.timeZoneName}`;
  }

  /**
   * Time only:  "9:51:30 PM"
   */
  function formatTime(date) {
    const d = date instanceof Date ? date : new Date(date);
    const tz = getTimezone();
    return d.toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: true, timeZone: tz
    });
  }

  /**
   * Full date+time string (for exports, headers):
   *   "3/25/2026, 9:51:30 PM EDT"
   */
  function formatFull(date) {
    const d = date instanceof Date ? date : new Date(date);
    const tz = getTimezone();
    return d.toLocaleString('en-US', { timeZone: tz, timeZoneName: 'short' });
  }

  /**
   * Date-only string:  "Mar 25, 2026"
   */
  function formatDateOnly(date) {
    const d = date instanceof Date ? date : new Date(date);
    const tz = getTimezone();
    return d.toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', timeZone: tz
    });
  }

  /**
   * Timezone-aware date key for grouping (Today / Yesterday / date).
   * Returns comparable "MM/DD/YYYY" in user's timezone.
   */
  function toDateString(date) {
    const d = date instanceof Date ? date : new Date(date);
    const tz = getTimezone();
    return d.toLocaleDateString('en-US', {
      year: 'numeric', month: '2-digit', day: '2-digit', timeZone: tz
    });
  }

  // ─── Public API ─────────────────────────────────
  return {
    getTimezone,
    getSystemTimezone,
    formatShortDate,
    formatLongDate,
    formatTime,
    formatFull,
    formatDateOnly,
    toDateString,
  };

})();

// Make available globally (renderer scripts are loaded via <script> tags)
window.WindyDateUtils = WindyDateUtils;

