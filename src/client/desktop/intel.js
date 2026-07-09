/**
 * Windy Word desktop — Intel V2 telemetry core (INTEL-CONTRACT-V2).
 *
 * Supersedes the two legacy admin-telemetry.js desktop.* call sites.
 * One emit path: every event is validated (lib/intel-validate), buffered in
 * the offline JSONL journal (lib/intel-journal, contract §2), and flushed to
 * POST {url}/v1/journal on launch, every 60s, and best-effort at quit.
 *
 * HARD LINES (ADR-WA-001 / contract §0):
 *  - Fire-and-forget: ≤3s timeouts, every error swallowed. A dead ingest
 *    never affects the product.
 *  - HARD-INERT unless configured: env WINDY_ADMIN_INGEST_URL +
 *    WINDY_ADMIN_INGEST_TOKEN take precedence; otherwise the packaged
 *    telemetry.generated.json (committed inert with empty strings, rewritten
 *    at package time by scripts/gen-telemetry-config.cjs). A normal consumer
 *    source build emits NOTHING.
 *  - NO content / PII / free text / paths / geo in any event — enforced
 *    structurally by the per-family key whitelist in lib/intel-validate.js.
 *
 * Also owns the /v1/client/config fetch (contract §3): on launch + every 6h
 * with ±15min jitter, cached last-good to userData/intel/config-cache.json,
 * fail-quiet offline.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const {
  validateEvent, mapOs, compareSemver, RENDERER_ALLOWED_TYPES,
} = require('./lib/intel-validate');
const { IntelJournal } = require('./lib/intel-journal');
const { pickMessage, recordImpression } = require('./lib/frequency-cap');

const FLUSH_INTERVAL_MS = 60 * 1000;
const CONFIG_INTERVAL_MS = 6 * 60 * 60 * 1000;   // 6h
const CONFIG_JITTER_MS = 15 * 60 * 1000;         // ±15min
const HTTP_TIMEOUT_MS = 3000;
const MAX_BATCH = 500;

let _app = null;
let _store = null;
let _cfg = null;              // { url, token } or null (inert)
let _journal = null;
let _installId = null;
let _sessionId = null;
let _sessionStart = 0;
let _flushTimer = null;
let _configTimer = null;
let _flushing = false;
let _configCache = null;
let _onConfigCbs = [];
let _lastErrorCode = null;
let _overflowEmitted = false;
let _initialized = false;

// ── config resolution ────────────────────────────────────────────

function _resolveIngestConfig() {
  try {
    const envUrl = process.env.WINDY_ADMIN_INGEST_URL;
    const envTok = process.env.WINDY_ADMIN_INGEST_TOKEN;
    if (envUrl && envTok) return { url: envUrl.replace(/\/$/, ''), token: envTok };
    const genPath = path.join(__dirname, 'telemetry.generated.json');
    const gen = JSON.parse(fs.readFileSync(genPath, 'utf8'));
    if (gen && gen.ingest_url && gen.ingest_token) {
      return { url: String(gen.ingest_url).replace(/\/$/, ''), token: String(gen.ingest_token) };
    }
  } catch (_) { /* missing/corrupt file → inert */ }
  return null;
}

function isConfigured() { return _cfg != null; }

// ── actor resolution ─────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function _accountJwt() {
  try {
    return _store.get('auth.token', '') || _store.get('auth.storageToken', '') || null;
  } catch (_) { return null; }
}

/** If a signed-in windy_identity_id (JWT `sub` uuid) is available → human. */
function _actor() {
  try {
    const token = _accountJwt();
    if (token && token.split('.').length === 3) {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
      const sub = payload.windy_identity_id || payload.sub;
      if (typeof sub === 'string' && UUID_RE.test(sub)) {
        return { actor_type: 'human', actor_id: sub };
      }
    }
  } catch (_) { /* anonymous */ }
  return { actor_type: 'system', actor_id: null };
}

// ── core emit ────────────────────────────────────────────────────

/**
 * Build, validate and journal one event. Fire-and-forget; never throws.
 * opts: { durationMs } — metadata is the §1 family key set only.
 */
function emit(eventType, metadata = {}, opts = {}) {
  try {
    if (!_initialized || !_cfg || !_journal) return;
    const envelope = {
      ts: new Date().toISOString(),
      platform: 'windy-word',
      service: 'desktop',
      event_type: eventType,
      ..._actor(),
      session_id: _sessionId,
      metadata,
    };
    if (Number.isInteger(opts.durationMs) && opts.durationMs >= 0) {
      envelope.duration_ms = opts.durationMs;
    }
    const check = validateEvent(envelope);
    if (!check.ok) {
      console.warn(`[Intel] dropped off-contract event ${eventType}: ${check.reason}`);
      return;
    }
    if (eventType === 'client.error') _lastErrorCode = metadata.code;
    const { dropped } = _journal.append(envelope);
    if (dropped > 0 && !_overflowEmitted) {
      _overflowEmitted = true;
      emit('client.error', {
        code: 'journal_overflow',
        surface: 'intel_journal',
        app_version: _app.getVersion(),
        os: mapOs(process.platform),
        recoverable: true,
      });
    }
  } catch (_) { /* never throw into app code */ }
}

// ── convenience emitters (fill contract-required envelope metadata) ──

function emitSessionStart() {
  const firstLaunch = !_store.get('intel.notFirstLaunch', false);
  if (firstLaunch) { try { _store.set('intel.notFirstLaunch', true); } catch (_) { } }
  emit('session.start', {
    app_version: _app.getVersion(),
    os: mapOs(process.platform),
    os_version: os.release(),
    locale: (() => { try { return _app.getLocale() || 'en-US'; } catch (_) { return 'en-US'; } })(),
    install_id: _installId,
    ...(firstLaunch ? { first_launch: true } : {}),
  });
}

function emitSessionEnd(reason = 'quit') {
  emit('session.end', { install_id: _installId, reason },
    { durationMs: _sessionStart ? Date.now() - _sessionStart : 0 });
}

function noteClientError(code, surface, extra = {}) {
  emit('client.error', {
    code,
    surface: String(surface || 'unknown').slice(0, 64),
    app_version: _app ? _app.getVersion() : '0.0.0',
    os: mapOs(process.platform),
    ...extra,
  });
}

function emitWallHit(wall, tier, extra = {}) {
  emit('wall.hit', {
    wall,
    tier: String(tier || 'free'),
    app_version: _app ? _app.getVersion() : undefined,
    ...extra,
  });
}

/** Onboarding funnel step — each step emitted once per install, ever. */
function emitFirstRunStep(step, ok) {
  try {
    const key = `intel.firstRunSteps.${step}`;
    if (_store.get(key, false)) return;
    _store.set(key, true);
  } catch (_) { }
  emit('install.first_run.step', {
    install_id: _installId,
    step,
    os: mapOs(process.platform),
    app_version: _app.getVersion(),
    ...(typeof ok === 'boolean' ? { ok } : {}),
  });
}

function emitUpdateFailed(fromVersion, toVersion, code) {
  emit('update.failed', {
    from_version: String(fromVersion || '0.0.0'),
    to_version: String(toVersion || 'unknown'),
    code: String(code || 'updater_error').slice(0, 64),
    os: mapOs(process.platform),
  });
}

function getLastErrorCode() { return _lastErrorCode; }

// ── renderer IPC surface ('intel:emit') ──────────────────────────

/**
 * Validate + journal an event coming from the renderer. Only the
 * RENDERER_ALLOWED_TYPES families are accepted; the full envelope
 * validation then enforces the per-family key whitelist, so a compromised
 * renderer still cannot push content/PII through this channel.
 */
function handleRendererEmit(eventType, metadata) {
  try {
    if (!RENDERER_ALLOWED_TYPES.includes(eventType)) return { ok: false };
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return { ok: false };
    let md = { ...metadata };
    // Main-side enrichment: the renderer never supplies ids/versions itself.
    if (eventType === 'install.first_run.step') {
      md = {
        step: md.step, ...(typeof md.ok === 'boolean' ? { ok: md.ok } : {}),
        install_id: _installId, os: mapOs(process.platform), app_version: _app.getVersion(),
      };
      // dedupe once-per-install like main-side steps
      try {
        const key = `intel.firstRunSteps.${md.step}`;
        if (_store.get(key, false)) return { ok: true };
        _store.set(key, true);
      } catch (_) { }
    }
    if (eventType === 'client.error') {
      md.app_version = _app.getVersion();
      md.os = mapOs(process.platform);
    }
    if (eventType === 'marketing.impression') {
      md.surface = 'desktop';
      _markImpression(md.message_id);
    }
    emit(eventType, md);
    if (eventType === 'feature.usage.dictation') _noteFirstDictation();
    return { ok: true };
  } catch (_) { return { ok: false }; }
}

/** first_dictation = first successful transcription ever (electron-store flag). */
function _noteFirstDictation() {
  try {
    if (_store.get('intel.firstDictationDone', false)) return;
    _store.set('intel.firstDictationDone', true);
  } catch (_) { return; }
  emitFirstRunStep('first_dictation', true);
}

// ── journal flush (contract §2) ──────────────────────────────────

async function flush() {
  if (!_initialized || !_cfg || !_journal || _flushing) return;
  _flushing = true;
  try {
    for (let i = 0; i < 10; i++) {
      const batch = _journal.takeBatch(MAX_BATCH);
      if (!batch) break;
      let res;
      try {
        res = await fetch(`${_cfg.url}/v1/journal`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${_cfg.token}`,
          },
          body: JSON.stringify(batch),
          signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
        });
      } catch (_) {
        break; // offline — inflight batch stays on disk, retried next cycle
      }
      if (res.status === 202 || res.status === 200) {
        _journal.ack();
      } else if (res.status === 422 || res.status === 409) {
        // Permanently rejected (off-contract or tamper-guard) — do not wedge.
        console.warn(`[Intel] journal batch rejected (${res.status}) — discarding batch`);
        _journal.discardInflight();
      } else {
        break; // 5xx etc. — retry later
      }
    }
  } catch (_) { /* swallow */ } finally {
    _flushing = false;
  }
}

// ── /v1/client/config (contract §3) ──────────────────────────────

function _configCachePath() {
  return path.join(_app.getPath('userData'), 'intel', 'config-cache.json');
}

function _loadConfigCache() {
  try { _configCache = JSON.parse(fs.readFileSync(_configCachePath(), 'utf8')); } catch (_) { }
}

async function fetchClientConfig() {
  if (!_initialized || !_cfg) return null;
  try {
    const params = new URLSearchParams({
      platform: 'windy-word',
      service: 'desktop',
      app_version: _app.getVersion(),
      os: mapOs(process.platform),
      channel: 'stable',
      locale: (() => { try { return _app.getLocale() || 'en-US'; } catch (_) { return 'en-US'; } })(),
      tier: (() => { try { return _store.get('license.tier', 'free'); } catch (_) { return 'free'; } })(),
      install_id: _installId,
    });
    const headers = {};
    const jwt = _accountJwt();
    if (jwt) headers.Authorization = `Bearer ${jwt}`; // unlocks do-not-market targeting
    const res = await fetch(`${_cfg.url}/v1/client/config?${params}`, {
      headers,
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`http_${res.status}`);
    const cfg = await res.json();
    _configCache = cfg;
    try {
      fs.mkdirSync(path.dirname(_configCachePath()), { recursive: true });
      fs.writeFileSync(_configCachePath(), JSON.stringify(cfg));
    } catch (_) { }
    emit('update.check', {
      current_version: _app.getVersion(),
      channel: 'stable',
      update_available: !!(cfg.latest_version
        && compareSemver(cfg.latest_version, _app.getVersion()) > 0),
    });
    _notifyConfig(cfg);
    return cfg;
  } catch (_) {
    // offline/error → last-good cache, fail quiet
    if (!_configCache) _loadConfigCache();
    if (_configCache) _notifyConfig(_configCache);
    return _configCache;
  }
}

function _notifyConfig(cfg) {
  for (const cb of _onConfigCbs) {
    try { cb(cfg); } catch (_) { }
  }
}

/** Register a callback for each (fetched or cached) client config. */
function onConfig(cb) { _onConfigCbs.push(cb); }

function getConfigCache() { return _configCache; }

// ── message frequency caps (persisted in electron-store) ─────────

function _messageRecords() {
  try { return _store.get('intel.messageHistory', {}); } catch (_) { return {}; }
}

function _markImpression(messageId) {
  if (!messageId) return;
  try {
    const records = _messageRecords();
    records[messageId] = recordImpression(records[messageId], Date.now());
    _store.set('intel.messageHistory', records);
  } catch (_) { }
}

/** Pick the highest-priority in-window, cap-allowed message (or null). */
function pickEligibleMessage(messages) {
  try { return pickMessage(messages, _messageRecords(), Date.now()); } catch (_) { return null; }
}

// ── init / shutdown ──────────────────────────────────────────────

/**
 * Initialize. Call once from app.whenReady() BEFORE the install wizard so
 * the onboarding funnel is captured. Never throws.
 *
 * opts: { app, store, ipcMain, pendingCrashPath }
 */
function init(opts) {
  try {
    if (_initialized) return;
    _app = opts.app;
    _store = opts.store;
    _cfg = _resolveIngestConfig();
    _sessionId = crypto.randomUUID();
    _sessionStart = Date.now();

    // Stable anonymous install id (uuid, generated once, contract §1.1/§1.7)
    _installId = _store.get('intel.installId', null);
    if (!_installId || !UUID_RE.test(_installId)) {
      _installId = crypto.randomUUID();
      _store.set('intel.installId', _installId);
    }

    // Renderer emit channel — registered even when inert so invokes never throw.
    if (opts.ipcMain) {
      opts.ipcMain.handle('intel:emit', (_e, eventType, metadata) =>
        handleRendererEmit(eventType, metadata));
    }

    if (!_cfg) { _initialized = true; return; } // hard-inert: no journal, no fetches

    _journal = new IntelJournal({
      dir: path.join(_app.getPath('userData'), 'intel'),
    }).load();
    _initialized = true;

    // update.applied — version changed since last run (electron-store marker)
    try {
      const lastRun = _store.get('intel.lastRunVersion', null);
      const cur = _app.getVersion();
      if (lastRun && lastRun !== cur) {
        emit('update.applied', {
          from_version: lastRun, to_version: cur, os: mapOs(process.platform),
        });
      }
      if (lastRun !== cur) _store.set('intel.lastRunVersion', cur);
    } catch (_) { }

    // client.crash — pending record persisted by the crash handlers last run
    try {
      if (opts.pendingCrashPath && fs.existsSync(opts.pendingCrashPath)) {
        const rec = JSON.parse(fs.readFileSync(opts.pendingCrashPath, 'utf8'));
        fs.unlinkSync(opts.pendingCrashPath);
        if (rec && typeof rec.signature === 'string' && rec.signature) {
          emit('client.crash', {
            signature: rec.signature,
            app_version: rec.app_version || _app.getVersion(),
            os: mapOs(process.platform),
            os_version: os.release(),
            install_id: _installId,
            fatal: true,
          });
        }
      }
    } catch (_) { }

    _loadConfigCache();

    // Flush loop: on launch, every 60s, best-effort at quit (main.js calls flush()).
    setTimeout(() => { flush(); }, 3000);
    _flushTimer = setInterval(() => { flush(); }, FLUSH_INTERVAL_MS);
    if (_flushTimer.unref) _flushTimer.unref();

    // Config fetch: on launch + every 6h ± 15min jitter.
    setTimeout(() => { fetchClientConfig(); }, 5000);
    const scheduleNext = () => {
      const jitter = (Math.random() * 2 - 1) * CONFIG_JITTER_MS;
      _configTimer = setTimeout(() => {
        fetchClientConfig().finally(scheduleNext);
      }, CONFIG_INTERVAL_MS + jitter);
      if (_configTimer.unref) _configTimer.unref();
    };
    scheduleNext();
  } catch (e) {
    try { console.warn('[Intel] init failed (telemetry disabled):', e.message); } catch (_) { }
  }
}

module.exports = {
  init,
  isConfigured,
  emit,
  emitSessionStart,
  emitSessionEnd,
  noteClientError,
  emitWallHit,
  emitFirstRunStep,
  emitUpdateFailed,
  getLastErrorCode,
  flush,
  fetchClientConfig,
  onConfig,
  getConfigCache,
  pickEligibleMessage,
  handleRendererEmit,
};
