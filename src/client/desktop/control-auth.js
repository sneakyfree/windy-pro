// control-auth.js — per-install bearer token for the agent-control server
// (127.0.0.1:18765). Third leg of the security wall alongside the existing
// Origin-reject and loopback-Host checks in main.js.
//
// Why the token is load-bearing even behind those checks: the legacy GNOME
// action routes (/toggle-recording, /paste-transcript, …) execute on a bare
// GET, and a browser fires <img src="http://127.0.0.1:18765/..."> GETs with
// NO Origin header and a loopback Host — sailing through both existing
// guards. The token closes that hole. Same wall as windytalk's
// control.mcp.v1 `security` block: per-install token, constant-time compare,
// no CORS, no bypass env var.
//
// Token location is the well-known path ~/.windy-word/control.token (0600,
// dir 0700) so local same-user agent clients (windy-word-mcp, Windy Fly)
// can read it without any handshake. A same-user process that can read the
// file could also drive the app directly — local same-user access is
// conceded, exactly as in windytalk's contract. The token defends against
// browser pages and other-user/sandboxed processes, which cannot.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const TOKEN_DIR = path.join(os.homedir(), '.windy-word');
const TOKEN_PATH = path.join(TOKEN_DIR, 'control.token');
const TOKEN_BYTES = 32; // 64 hex chars

// Legacy GNOME-keybinding action routes may carry the token as ?t=<token>
// instead of an Authorization header. GNOME custom keybindings are parsed
// by g_shell_parse_argv, and the project rule (see CLAUDE.md / the Wayland
// guide's dead-ends) is "plain curl, no nested quotes" — a quote-free URL
// with ?t= keeps the gsettings command identical in shape to what has
// proven to survive on Wayland. Query tokens are accepted ONLY for these
// side-effect actions, never for data-returning endpoints.
const QUERY_TOKEN_ACTIONS = new Set([
  'toggle-recording',
  'paste-transcript',
  'show-hide',
  'quick-translate',
]);

// Routes that answer WITHOUT a token. /control/info is deliberate: it is
// the discovery/doctor hook — an agent that 401s anywhere can GET this to
// learn what this surface is and where the token lives. Metadata only.
const TOKENLESS_ROUTES = new Set(['/control/info']);

function generateToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('hex');
}

function looksValid(token) {
  return typeof token === 'string' && /^[0-9a-f]{64}$/.test(token);
}

// Create-or-read the per-install token. Idempotent; regenerates when the
// file is missing, empty, or corrupt. Throws only when the filesystem
// refuses both read and write (caller decides the degraded mode).
function ensureControlToken() {
  let token = null;
  try {
    token = fs.readFileSync(TOKEN_PATH, 'utf8').trim();
  } catch (_) { /* absent — generate below */ }

  if (!looksValid(token)) {
    token = generateToken();
    fs.mkdirSync(TOKEN_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(TOKEN_PATH, token + '\n', { mode: 0o600 });
    try { fs.chmodSync(TOKEN_PATH, 0o600); } catch (_) { /* best effort on exotic fs */ }
  }
  return { token, tokenPath: TOKEN_PATH };
}

// Constant-time equality that never leaks length: compare SHA-256 digests.
function tokenEquals(presented, expected) {
  if (typeof presented !== 'string' || typeof expected !== 'string') return false;
  const a = crypto.createHash('sha256').update(presented).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

function extractBearer(req) {
  const h = req.headers['authorization'];
  if (typeof h !== 'string') return null;
  const m = h.match(/^Bearer\s+(\S+)\s*$/i);
  return m ? m[1] : null;
}

// The agent-readable 401 body: tells the caller exactly where the wrench
// is. Disclosing the path is safe — browsers cannot read local files, and
// a local same-user process could locate it regardless.
function unauthorizedBody() {
  return {
    ok: false,
    error: 'unauthorized',
    detail:
      'This control surface requires a per-install bearer token. ' +
      `Read it from ${TOKEN_PATH} on this machine and retry with the header ` +
      "'Authorization: Bearer <token>'. If that file does not exist, the " +
      'Windy Word app on this machine predates token auth or is not running ' +
      '— start/update Windy Word, then retry. If your MCP client is old, ' +
      'update it: npx windy-word-mcp@latest.',
    token_path: TOKEN_PATH,
  };
}

// Verify a request against the install token. Returns { ok: true } or
// { ok: false, status, body }. `pathname` must already be URL-parsed;
// `query` is a URLSearchParams. Order of acceptance: tokenless route →
// Authorization header → ?t= (legacy actions only).
function verifyControlAuth(req, pathname, query, expectedToken) {
  if (TOKENLESS_ROUTES.has(pathname)) return { ok: true };

  const bearer = extractBearer(req);
  if (bearer !== null && tokenEquals(bearer, expectedToken)) return { ok: true };

  const action = pathname.replace(/^\//, '');
  if (QUERY_TOKEN_ACTIONS.has(action)) {
    const qt = query.get('t');
    if (qt && tokenEquals(qt, expectedToken)) return { ok: true };
  }

  return { ok: false, status: 401, body: unauthorizedBody() };
}

module.exports = {
  ensureControlToken,
  verifyControlAuth,
  unauthorizedBody,
  generateToken,
  tokenEquals,
  TOKEN_PATH,
  QUERY_TOKEN_ACTIONS,
  TOKENLESS_ROUTES,
};
