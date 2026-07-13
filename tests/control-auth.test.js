/**
 * @jest-environment node
 *
 * Token wall for the agent-control server (127.0.0.1:18765) — unit tests
 * for src/client/desktop/control-auth.js plus an http-level regression
 * test proving the <img>-GET drive-by hole is closed: a browser GET with
 * NO Origin header and a loopback Host used to sail through the
 * Origin/Host guards and execute legacy side-effect actions.
 *
 * ensureControlToken() writes to the real ~/.windy-word/control.token, so
 * these tests exercise the pure verify/generate helpers plus a temp-dir
 * fake of the ensure flow, never the live token file.
 */

'use strict';

const http = require('http');
const path = require('path');

const controlAuth = require(path.join(
  __dirname, '..', 'src', 'client', 'desktop', 'control-auth.js',
));

const TOKEN = controlAuth.generateToken();
const WRONG = controlAuth.generateToken();

function makeReq(headers = {}) {
  return { headers };
}

function verify(pathname, { headers = {}, query = '' } = {}) {
  return controlAuth.verifyControlAuth(
    makeReq(headers), pathname, new URLSearchParams(query), TOKEN,
  );
}

describe('generateToken', () => {
  test('64 lowercase hex chars, unique per call', () => {
    expect(TOKEN).toMatch(/^[0-9a-f]{64}$/);
    expect(controlAuth.generateToken()).not.toBe(TOKEN);
  });
});

describe('tokenEquals', () => {
  test('accepts equal, rejects different / non-string / empty', () => {
    expect(controlAuth.tokenEquals(TOKEN, TOKEN)).toBe(true);
    expect(controlAuth.tokenEquals(WRONG, TOKEN)).toBe(false);
    expect(controlAuth.tokenEquals('', TOKEN)).toBe(false);
    expect(controlAuth.tokenEquals(null, TOKEN)).toBe(false);
    expect(controlAuth.tokenEquals(TOKEN, undefined)).toBe(false);
  });

  test('length mismatch never throws (digest compare)', () => {
    expect(controlAuth.tokenEquals('short', TOKEN)).toBe(false);
    expect(controlAuth.tokenEquals(TOKEN + 'aa', TOKEN)).toBe(false);
  });
});

describe('verifyControlAuth — header path', () => {
  test('valid Bearer header passes on any route', () => {
    for (const p of ['/config', '/paste/select', '/toggle-recording']) {
      expect(verify(p, { headers: { authorization: `Bearer ${TOKEN}` } }).ok).toBe(true);
    }
  });

  test('case-insensitive scheme, surrounding whitespace tolerated', () => {
    expect(verify('/config', { headers: { authorization: `bearer ${TOKEN}` } }).ok).toBe(true);
    expect(verify('/config', { headers: { authorization: `Bearer  ${TOKEN} ` } }).ok).toBe(true);
  });

  test('missing / wrong / malformed header → 401 with agent-readable body', () => {
    for (const headers of [
      {},
      { authorization: `Bearer ${WRONG}` },
      { authorization: TOKEN },              // no scheme
      { authorization: 'Basic abc' },
    ]) {
      const r = verify('/config', { headers });
      expect(r.ok).toBe(false);
      expect(r.status).toBe(401);
      expect(r.body.error).toBe('unauthorized');
      expect(r.body.token_path).toContain('control.token');
      expect(r.body.detail).toContain('Authorization: Bearer');
    }
  });
});

describe('verifyControlAuth — query token (legacy GNOME actions only)', () => {
  test('?t= accepted on legacy action routes', () => {
    for (const action of controlAuth.QUERY_TOKEN_ACTIONS) {
      expect(verify(`/${action}`, { query: `t=${TOKEN}` }).ok).toBe(true);
    }
  });

  test('?t= REJECTED on data-returning routes', () => {
    for (const p of ['/config', '/paste/strategies', '/settings/list']) {
      expect(verify(p, { query: `t=${TOKEN}` }).ok).toBe(false);
    }
  });

  test('wrong ?t= rejected on legacy routes', () => {
    expect(verify('/toggle-recording', { query: `t=${WRONG}` }).ok).toBe(false);
  });
});

describe('verifyControlAuth — tokenless discovery route', () => {
  test('/control/info answers without a token', () => {
    expect(verify('/control/info').ok).toBe(true);
  });
});

describe('drive-by regression — the wall at http level', () => {
  // Replicates main.js guard ORDER: loopback → Origin-reject → Host check →
  // token. Asserts the <img>-style GET (no Origin, loopback Host, no token)
  // that previously executed side effects now dies with 401.
  let server; let port; let executed;

  beforeAll((done) => {
    executed = [];
    server = http.createServer((req, res) => {
      if (req.headers['origin']) { res.writeHead(403); res.end(); return; }
      const host = String(req.headers['host'] || '').replace(/:\d+$/, '');
      if (host && host !== '127.0.0.1' && host !== 'localhost') {
        res.writeHead(403); res.end(); return;
      }
      const urlObj = new URL(req.url, 'http://localhost');
      const auth = controlAuth.verifyControlAuth(
        req, urlObj.pathname, urlObj.searchParams, TOKEN,
      );
      if (!auth.ok) {
        res.writeHead(auth.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(auth.body));
        return;
      }
      executed.push(urlObj.pathname);
      res.writeHead(200); res.end('OK');
    });
    server.listen(0, '127.0.0.1', () => { port = server.address().port; done(); });
  });

  afterAll(() => new Promise((resolve) => {
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    server.close(() => resolve());
  }));

  function get(pathAndQuery, headers = {}) {
    return new Promise((resolve, reject) => {
      const req = http.get(
        { host: '127.0.0.1', port, path: pathAndQuery, headers },
        (res) => {
          let body = '';
          res.on('data', (c) => { body += c; });
          res.on('end', () => resolve({ status: res.statusCode, body }));
        },
      );
      req.on('error', reject);
    });
  }

  test('img-style GET (no Origin, loopback Host, no token) → 401, no side effect', async () => {
    const r = await get('/paste-transcript');
    expect(r.status).toBe(401);
    expect(executed).toHaveLength(0);
    expect(JSON.parse(r.body).error).toBe('unauthorized');
  });

  test('cross-origin request still dies at the Origin guard first', async () => {
    const r = await get('/paste-transcript', { origin: 'https://evil.example' });
    expect(r.status).toBe(403);
    expect(executed).toHaveLength(0);
  });

  test('GNOME keybinding shape (?t=) executes', async () => {
    const r = await get(`/toggle-recording?t=${TOKEN}`);
    expect(r.status).toBe(200);
    expect(executed).toEqual(['/toggle-recording']);
  });

  test('agent shape (Bearer header) executes on data routes', async () => {
    const r = await get('/config', { authorization: `Bearer ${TOKEN}` });
    expect(r.status).toBe(200);
    expect(executed).toContain('/config');
  });
});
