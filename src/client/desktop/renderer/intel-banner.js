/**
 * Intel V2 — gentle in-app message + update-nudge banners
 * (INTEL-CONTRACT-V2 §1.8 / §3).
 *
 * Renders the message-bus payloads pushed by the main process on
 * 'intel:message' and 'intel:update-nudge'. Hard UX lines:
 *  - dismissible in ONE tap, gentle (small bottom toast, no modal)
 *  - NEVER shown while dictation/recording is active — queued until idle
 *  - emits marketing.impression when actually SHOWN, marketing.click with
 *    action cta|dismiss|snooze on interaction (via windyAPI.intel.emit,
 *    validated main-side). The update nudge only emits marketing.* when it
 *    was carried by a real message (has message_id).
 *
 * Frequency caps are enforced in the MAIN process before a message is ever
 * pushed here; this module just renders + reports.
 */
(function () {
  'use strict';

  const QUEUE = [];
  let visible = false;
  let pollTimer = null;

  function isBusy() {
    try {
      const a = window.app;
      if (!a) return false;
      if (a.isRecording) return true;
      return ['listening', 'buffering', 'injecting'].includes(a.currentState);
    } catch (_) { return false; }
  }

  function emitIntel(type, metadata) {
    try { window.windyAPI?.intel?.emit(type, metadata); } catch (_) { }
  }

  function schedule() {
    if (visible || QUEUE.length === 0) return;
    if (isBusy()) {
      if (!pollTimer) {
        pollTimer = setInterval(() => {
          if (!isBusy() && QUEUE.length > 0) {
            clearInterval(pollTimer);
            pollTimer = null;
            showNext();
          }
        }, 5000);
      }
      return;
    }
    showNext();
  }

  function baseToast(maintenance) {
    const el = document.createElement('div');
    el.className = 'intel-banner';
    el.style.cssText = [
      'position:fixed', 'bottom:16px', 'left:50%', 'transform:translateX(-50%)',
      'max-width:92%', 'min-width:260px', 'z-index:9500',
      `background:${maintenance ? '#78350f' : 'var(--bg-secondary,#1a1f26)'}`,
      `border:1px solid ${maintenance ? '#f59e0b' : 'var(--bg-tertiary,#30363d)'}`,
      'border-radius:10px', 'padding:12px 14px', 'color:var(--text-primary,#e6edf3)',
      'font-size:13px', 'box-shadow:0 8px 24px rgba(0,0,0,0.45)',
      'display:flex', 'flex-direction:column', 'gap:8px',
    ].join(';');
    return el;
  }

  function btn(label, primary) {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = primary
      ? 'background:var(--color-primary,#7C3AED);color:#fff;border:none;padding:6px 14px;border-radius:6px;font-size:12px;cursor:pointer;font-weight:600;'
      : 'background:none;color:var(--text-secondary,#8b949e);border:1px solid var(--bg-tertiary,#30363d);padding:6px 12px;border-radius:6px;font-size:12px;cursor:pointer;';
    return b;
  }

  function showNext() {
    const item = QUEUE.shift();
    if (!item) return;
    visible = true;

    const isNudge = item.kind === 'nudge';
    const msg = item.message || null; // message-bus payload (may be null for plain nudge)
    const maintenance = !!(msg && msg.type === 'maintenance');

    const el = baseToast(maintenance);

    const title = document.createElement('div');
    title.style.cssText = 'font-weight:600;font-size:13px;display:flex;justify-content:space-between;gap:12px;align-items:center;';
    const titleText = document.createElement('span');
    titleText.textContent = isNudge
      ? 'A free update is available'
      : String((msg && msg.title) || 'Windy Word');
    title.appendChild(titleText);

    // one-tap dismiss (always present)
    const x = document.createElement('button');
    x.textContent = '✕';
    x.setAttribute('aria-label', 'Dismiss');
    x.style.cssText = 'background:none;border:none;color:var(--text-secondary,#8b949e);cursor:pointer;font-size:13px;padding:0 2px;';
    title.appendChild(x);
    el.appendChild(title);

    const bodyText = isNudge
      ? (msg && msg.body) || `Windy Word ${item.latest_version} is ready to download.`
      : (msg && msg.body) || '';
    if (bodyText) {
      const body = document.createElement('div');
      body.style.cssText = 'color:var(--text-secondary,#9aa4b2);font-size:12px;line-height:1.45;';
      body.textContent = String(bodyText);
      el.appendChild(body);
    }

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';

    const hasMarketing = !!(msg && msg.message_id);
    const marketingMeta = hasMarketing
      ? { message_id: msg.message_id, ...(msg.campaign_id ? { campaign_id: msg.campaign_id } : {}) }
      : null;

    const close = (action) => {
      if (hasMarketing && action) emitIntel('marketing.click', { ...marketingMeta, action });
      try { el.remove(); } catch (_) { }
      visible = false;
      setTimeout(schedule, 500);
    };

    // CTA
    const ctaLabel = isNudge ? ((msg && msg.cta_label) || 'Download') : (msg && msg.cta_label);
    const ctaUrl = isNudge ? item.update_url : (msg && msg.cta_url);
    if (ctaLabel && ctaUrl) {
      const cta = btn(ctaLabel, true);
      cta.addEventListener('click', () => {
        try { window.windyAPI?.openExternalUrl(ctaUrl); } catch (_) { }
        close('cta');
      });
      row.appendChild(cta);
    }

    // Snooze (nudges + capped messages): just closes now; the frequency_cap
    // cooldown (enforced main-side) governs when it may reappear.
    const snooze = btn('Later', false);
    snooze.addEventListener('click', () => close('snooze'));
    row.appendChild(snooze);

    x.addEventListener('click', () => close('dismiss'));

    el.appendChild(row);
    document.body.appendChild(el);

    if (hasMarketing) {
      emitIntel('marketing.impression', {
        ...marketingMeta,
        message_type: msg.type || 'promo',
      });
    }
  }

  function queueMessage(msg) {
    if (!msg) return;
    QUEUE.push({ kind: 'message', message: msg });
    schedule();
  }

  function queueNudge(payload) {
    if (!payload) return;
    QUEUE.push({
      kind: 'nudge',
      latest_version: payload.latest_version,
      update_url: payload.update_url,
      message: payload.message || null,
    });
    schedule();
  }

  function initWhenReady() {
    if (!window.windyAPI || !window.windyAPI.intel) return;
    window.windyAPI.intel.onMessage(queueMessage);
    window.windyAPI.intel.onUpdateNudge(queueNudge);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWhenReady);
  } else {
    initWhenReady();
  }
})();
