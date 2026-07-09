/**
 * Intel V2 — client-side event validation (INTEL-CONTRACT-V2 §1).
 *
 * The ingest 422s any off-contract event AND rejects a whole journal batch
 * if one event inside is bad (§2 rule 3), so the client validates every
 * event BEFORE buffering it. This module is pure Node (no electron) so it
 * is unit-testable with plain jest.
 *
 * Privacy hard line: metadata is a closed per-family key set — counts,
 * durations, codes, ids, enums, flags. No content, no PII, no free text,
 * no paths, no geo. client.error `code` comes from the finite ERROR_CODES
 * set below — never exception text.
 */
'use strict';

const crypto = require('crypto');

const OS_ENUM = ['macos', 'windows', 'linux', 'ios', 'android', 'web'];
const ENGINE_TIERS = ['ultralight', 'light', 'standard', 'pro', 'cloud'];

/** STABLE error-code slugs (client.error `code`). Finite set — add here, never inline. */
const ERROR_CODES = [
  'journal_overflow',
  'error_dialog_shown',
  'transcribe_failed',
  'cloud_transcribe_failed',
  'mic_permission_denied',
  'paste_injection_failed',
  'export_failed',
  'updater_error',
  'deb_install_failed',
  'uncaught_exception_recovered',
];

// event_type → { keys: {name: validator}, required: [names] }
const str = (v) => typeof v === 'string' && v.length > 0 && v.length <= 128;
const bool = (v) => typeof v === 'boolean';
const int = (v) => Number.isInteger(v) && v >= 0;
const oneOf = (list) => (v) => list.includes(v);

const FAMILIES = {
  'session.start': {
    keys: {
      app_version: str, os: oneOf(OS_ENUM), os_version: str, locale: str,
      install_id: str, first_launch: bool,
    },
    required: ['app_version', 'os', 'install_id'],
  },
  'session.end': {
    keys: { install_id: str, reason: oneOf(['background', 'quit', 'timeout', 'crash']) },
    required: ['install_id'],
  },
  'feature.usage.dictation': {
    keys: {
      seconds: int, language: str, engine_tier: oneOf(ENGINE_TIERS),
      word_count: int, on_device: bool,
    },
    required: ['seconds', 'language', 'engine_tier', 'on_device'],
  },
  'feature.usage.export': {
    keys: {
      format: oneOf(['txt', 'md', 'docx', 'pdf', 'srt', 'json']),
      destination: oneOf(['clipboard', 'file', 'share']),
    },
    required: ['format', 'destination'],
  },
  'feature.usage.translate': {
    keys: {
      source_lang: str, target_lang: str, char_count: int,
      engine_tier: oneOf(ENGINE_TIERS),
    },
    required: ['source_lang', 'target_lang', 'char_count'],
  },
  'feature.usage.feedback': {
    keys: { count: int },
    required: ['count'],
  },
  'client.error': {
    keys: {
      code: oneOf(ERROR_CODES), surface: str, app_version: str,
      os: oneOf(OS_ENUM), recoverable: bool, http_status: int,
    },
    required: ['code', 'surface', 'app_version', 'os'],
  },
  'client.crash': {
    keys: {
      signature: str, app_version: str, os: oneOf(OS_ENUM),
      os_version: str, install_id: str, fatal: bool,
    },
    required: ['signature', 'app_version', 'os', 'install_id'],
  },
  'wall.hit': {
    keys: {
      wall: oneOf(['dictation_minutes', 'cloud_storage', 'translate_chars',
        'agent_quota', 'search_budget', 'export_format', 'device_limit',
        'seats', 'feature_locked']),
      tier: str, app_version: str, surface: str, limit: int, used: int,
    },
    required: ['wall', 'tier'],
  },
  'update.check': {
    keys: { current_version: str, channel: oneOf(['stable', 'beta']), update_available: bool },
    required: ['current_version', 'update_available'],
  },
  'update.applied': {
    keys: { from_version: str, to_version: str, os: oneOf(OS_ENUM) },
    required: ['from_version', 'to_version', 'os'],
  },
  'update.failed': {
    keys: { from_version: str, to_version: str, code: str, os: oneOf(OS_ENUM) },
    required: ['from_version', 'to_version', 'code', 'os'],
  },
  'install.first_run.step': {
    keys: {
      install_id: str,
      step: oneOf(['launched', 'permissions', 'engine_download', 'engine_ready',
        'account_linked', 'first_dictation', 'done']),
      os: oneOf(OS_ENUM), app_version: str, ok: bool,
    },
    required: ['install_id', 'step', 'os', 'app_version'],
  },
  'marketing.impression': {
    keys: {
      message_id: str, campaign_id: str,
      surface: oneOf(['desktop', 'mobile', 'web']),
      message_type: oneOf(['update', 'promo', 'survey', 'maintenance']),
    },
    required: ['message_id', 'surface', 'message_type'],
  },
  'marketing.click': {
    keys: { message_id: str, campaign_id: str, action: oneOf(['cta', 'dismiss', 'snooze']) },
    required: ['message_id', 'action'],
  },
};

/** Event types the renderer may emit over the 'intel:emit' IPC channel. */
const RENDERER_ALLOWED_TYPES = [
  'feature.usage.dictation',
  'feature.usage.export',
  'feature.usage.translate',
  'client.error',
  'marketing.impression',
  'marketing.click',
  'install.first_run.step',
];

/**
 * Validate a full base envelope against the contract. Returns
 * { ok: true } or { ok: false, reason }.
 */
function validateEvent(envelope) {
  if (!envelope || typeof envelope !== 'object') return { ok: false, reason: 'not_object' };
  const fam = FAMILIES[envelope.event_type];
  if (!fam) return { ok: false, reason: `unknown_event_type:${envelope.event_type}` };
  if (typeof envelope.ts !== 'string' || !envelope.ts) return { ok: false, reason: 'bad_ts' };
  if (envelope.platform !== 'windy-word') return { ok: false, reason: 'bad_platform' };
  if (envelope.service !== 'desktop') return { ok: false, reason: 'bad_service' };
  if (!['human', 'agent', 'system'].includes(envelope.actor_type)) {
    return { ok: false, reason: 'bad_actor_type' };
  }
  if (envelope.actor_type === 'system' && envelope.actor_id != null) {
    return { ok: false, reason: 'system_actor_with_id' };
  }
  const md = envelope.metadata;
  if (!md || typeof md !== 'object' || Array.isArray(md)) return { ok: false, reason: 'bad_metadata' };
  for (const key of Object.keys(md)) {
    const check = fam.keys[key];
    if (!check) return { ok: false, reason: `unknown_key:${key}` };
    if (!check(md[key])) return { ok: false, reason: `bad_value:${key}` };
  }
  for (const req of fam.required) {
    if (!(req in md)) return { ok: false, reason: `missing_key:${req}` };
  }
  if ('duration_ms' in envelope && envelope.duration_ms != null
    && !(Number.isInteger(envelope.duration_ms) && envelope.duration_ms >= 0)) {
    return { ok: false, reason: 'bad_duration_ms' };
  }
  return { ok: true };
}

/** Map process.platform → contract os enum. */
function mapOs(platform) {
  if (platform === 'darwin') return 'macos';
  if (platform === 'win32') return 'windows';
  return 'linux';
}

/**
 * Crash signature per §1.4: hex(sha256(top ≤5 stack frames))[:16].
 * File paths are stripped to basenames BEFORE hashing so the signature is
 * stable across install locations and never encodes a user path.
 */
function crashSignatureFromError(err) {
  try {
    const stack = (err && typeof err.stack === 'string') ? err.stack : '';
    const frames = stack.split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('at '))
      .slice(0, 5)
      .map((l) => l.replace(/([A-Za-z]:)?[\\/][^\s():]*[\\/]/g, '')); // strip dirs → basename
    const basis = frames.length
      ? frames.join('|')
      : `${(err && err.name) || 'Error'}|${(err && err.code) || 'no_stack'}`;
    return crypto.createHash('sha256').update(basis).digest('hex').slice(0, 16);
  } catch (_) {
    return 'ffffffffffffffff';
  }
}

/** Loose semver compare: returns 1 if a > b, -1 if a < b, 0 if equal. */
function compareSemver(a, b) {
  const parse = (v) => String(v || '').replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const [a1, a2, a3] = parse(a);
  const [b1, b2, b3] = parse(b);
  if (a1 !== b1) return a1 > b1 ? 1 : -1;
  if (a2 !== b2) return a2 > b2 ? 1 : -1;
  if (a3 !== b3) return a3 > b3 ? 1 : -1;
  return 0;
}

module.exports = {
  FAMILIES,
  ERROR_CODES,
  OS_ENUM,
  ENGINE_TIERS,
  RENDERER_ALLOWED_TYPES,
  validateEvent,
  mapOs,
  crashSignatureFromError,
  compareSemver,
};
