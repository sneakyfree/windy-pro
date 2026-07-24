/**
 * Windy Word — WiFi Phone Companion (main process)
 *
 * Turns any phone (iPhone/Android, no app install) into a wireless mic/camera:
 * serves a LAN-only HTTPS page + WebSocket signaling on PORT; the phone scans
 * a QR code, opens the page, and streams mic/camera to the desktop renderer
 * over WebRTC (host candidates only — same LAN, no STUN/TURN, no internet).
 *
 * Main process is the signaling relay: phone <-WSS-> main <-IPC-> renderer.
 * The renderer never touches the self-signed cert.
 *
 * Security model (local-only by doctrine — no cloud relay):
 *  - requests from non-private addresses are rejected outright
 *  - the page and the phone WS join require the pairing token from the QR URL
 *    (single-use, 5-minute expiry)
 *  - a joined phone gets a resume key so screen-lock/WiFi blips can reconnect
 *    within RESUME_GRACE_MS without a new QR scan
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const PORT = 9878; // 9876 engine WS, 9877 engine health, 18765 control server — all taken
const TOKEN_TTL_MS = 5 * 60 * 1000;
const RESUME_GRACE_MS = 60 * 1000;
const CERT_FILE = 'phone-companion-cert.json';

function isPrivateAddress(addr) {
  if (!addr) return false;
  const a = addr.replace(/^::ffff:/, '');
  if (a === '127.0.0.1' || a === '::1') return true;
  if (/^10\./.test(a)) return true;
  if (/^192\.168\./.test(a)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(a)) return true;
  if (/^169\.254\./.test(a)) return true; // link-local (direct cable / hotspot)
  if (/^fe80:/i.test(a) || /^fd/i.test(a)) return true;
  return false;
}

function lanAddress() {
  const ifaces = os.networkInterfaces();
  const candidates = [];
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const info of addrs || []) {
      if (info.family === 'IPv4' && !info.internal && isPrivateAddress(info.address)) {
        candidates.push({ name, address: info.address });
      }
    }
  }
  // Prefer the classic primary interfaces (en0 mac, eth0/wlan0 linux) over
  // virtual ones (utun, docker, vbox) which the phone can't reach.
  candidates.sort((x, y) => {
    const rank = (n) => (/^(en0|eth0|wlan0|wlp)/.test(n) ? 0 : /^(en|eth|wl)/.test(n) ? 1 : 2);
    return rank(x.name) - rank(y.name);
  });
  return candidates[0]?.address || null;
}

class PhoneCompanion extends EventEmitter {
  constructor({ userDataDir, deviceLabel, port } = {}) {
    super();
    this.userDataDir = userDataDir;
    this._port = port || PORT; // override for tests
    this.deviceLabel = deviceLabel || os.hostname().replace(/\.local$/i, '');
    this.server = null;
    this.wss = null;
    this.tokens = new Map();   // token -> expiresAt
    this.session = null;       // single active phone session
    this.pageHtml = null;
  }

  /** One-line event log (userData/phone-companion.log) — packaged apps have no
   *  visible console, and field-debugging "connected but black" without this
   *  meant pure archaeology (7-23). Content-free: event names + labels only. */
  _log(line) {
    try {
      fs.appendFileSync(
        path.join(this.userDataDir, 'phone-companion.log'),
        `${new Date().toISOString()} ${line}\n`
      );
    } catch { /* logging must never break pairing */ }
  }

  async _loadCert() {
    const certPath = path.join(this.userDataDir, CERT_FILE);
    try {
      const saved = JSON.parse(fs.readFileSync(certPath, 'utf8'));
      if (saved.cert && saved.key) return saved;
    } catch { /* no cached cert yet */ }
    const selfsigned = require('selfsigned');
    const pems = await selfsigned.generate(
      [{ name: 'commonName', value: 'Windy Word Phone Companion' }],
      {
        days: 3650,
        keySize: 2048,
        extensions: [{
          name: 'subjectAltName',
          altNames: [
            { type: 2, value: 'windy-word.local' },
            ...(lanAddress() ? [{ type: 7, ip: lanAddress() }] : []),
          ],
        }],
      }
    );
    const out = { cert: pems.cert, key: pems.private };
    try {
      fs.mkdirSync(this.userDataDir, { recursive: true });
      fs.writeFileSync(certPath, JSON.stringify(out), { mode: 0o600 });
    } catch { /* cert cache is best-effort; regenerating next run is fine */ }
    return out;
  }

  async start() {
    if (this.server) return this.port();
    const { cert, key } = await this._loadCert();
    this.pageHtml = fs.readFileSync(path.join(__dirname, 'phone-companion-page.html'), 'utf8');

    this.server = https.createServer({ cert, key }, (req, res) => this._onRequest(req, res));
    const { WebSocketServer } = require('ws');
    this.wss = new WebSocketServer({ noServer: true });
    this.server.on('upgrade', (req, socket, head) => this._onUpgrade(req, socket, head));

    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this._port, '0.0.0.0', resolve);
    });
    return this._port;
  }

  port() { return this._port; }

  stop() {
    try { this.session?.phoneWs?.close(); } catch { /* already gone */ }
    this.session = null;
    this.tokens.clear();
    try { this.wss?.close(); } catch { /* noop */ }
    try { this.server?.close(); } catch { /* noop */ }
    this.server = null;
    this.wss = null;
  }

  /** New pairing token + the URL/QR the renderer shows.
   *  opts.wantVideo pre-enables "Also share camera" on the phone page. */
  createPairingSession(opts = {}) {
    // prune expired
    const now = Date.now();
    for (const [t, exp] of this.tokens) if (exp < now) this.tokens.delete(t);

    const token = crypto.randomBytes(16).toString('hex');
    this.tokens.set(token, now + TOKEN_TTL_MS);

    const ip = lanAddress();
    if (!ip) return { error: 'no-lan', message: 'No WiFi/LAN network detected on this computer.' };
    const url = `https://${ip}:${this._port}/?t=${token}${opts.wantVideo ? '&video=1' : ''}`;
    this._log(`pairing session created (video=${opts.wantVideo ? 1 : 0})`);

    const qrgen = require('qrcode-generator');
    const qr = qrgen(0, 'M');
    qr.addData(url);
    qr.make();
    const qrSvg = qr.createSvgTag({ cellSize: 6, margin: 3, scalable: true });

    return { url, qrSvg, expiresInMs: TOKEN_TTL_MS, host: this.deviceLabel };
  }

  _consumeToken(token) {
    const exp = token && this.tokens.get(token);
    if (!exp || exp < Date.now()) return false;
    this.tokens.delete(token); // single-use
    return true;
  }

  _peekToken(token) {
    const exp = token && this.tokens.get(token);
    return !!exp && exp >= Date.now();
  }

  _onRequest(req, res) {
    // Every request outcome is logged: the 7-23 hand test failed with "phone
    // opened a page but never connected" and the log couldn't even say whether
    // the phone reached this server (TLS interstitial? wrong network? WS?).
    if (!isPrivateAddress(req.socket.remoteAddress)) {
      this._log(`http reject non-LAN ${req.socket.remoteAddress}`);
      res.writeHead(403); res.end('LAN only'); return;
    }
    const url = new URL(req.url, 'https://x');
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, app: 'windy-word-phone-companion' }));
      return;
    }
    if (url.pathname === '/') {
      // Page requires a live token (peek, not consume — the WS join consumes it,
      // and the phone may reload the page once before joining).
      if (!this._peekToken(url.searchParams.get('t'))) {
        this._log(`page refused (expired/bad token) from ${req.socket.remoteAddress}`);
        res.writeHead(403, { 'Content-Type': 'text/html' });
        res.end('<html><body style="font-family:sans-serif;background:#111;color:#eee;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center"><div><h2>⏱️ Code expired</h2><p>Open Windy Word on your computer and scan a fresh QR code.</p></div></body></html>');
        return;
      }
      this._log(`page served to ${req.socket.remoteAddress}`);
      // Tell the desktop overlay the phone got through TLS + token — the two
      // silent failure modes. From here any stall is the page's WS/WebRTC.
      this.emit('page-loaded', { remote: req.socket.remoteAddress });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(this.pageHtml.replace(/__WINDY_HOSTNAME__/g, this.deviceLabel));
      return;
    }
    this._log(`http 404 ${url.pathname} from ${req.socket.remoteAddress}`);
    res.writeHead(404); res.end();
  }

  _onUpgrade(req, socket, head) {
    if (!isPrivateAddress(req.socket.remoteAddress)) { socket.destroy(); return; }
    const url = new URL(req.url, 'https://x');
    if (url.pathname !== '/ws') { socket.destroy(); return; }

    const token = url.searchParams.get('t');
    const resume = url.searchParams.get('resume');

    let mode = null;
    if (resume && this.session && !this.session.closedForever) {
      const [sid, key] = resume.split(':');
      if (sid === this.session.id &&
          key === this.session.resumeKey &&
          (this.session.phoneWs === null || this.session.phoneWs.readyState >= 2) &&
          Date.now() - (this.session.lastSeen || 0) < RESUME_GRACE_MS) {
        mode = 'resume';
      }
    }
    if (!mode && this._consumeToken(token)) mode = 'join';
    if (!mode) { socket.destroy(); return; }

    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this._log(`ws ${mode} from ${req.socket.remoteAddress}`);
      if (mode === 'join') {
        // A new join replaces any prior session (one phone at a time).
        try { this.session?.phoneWs?.close(); } catch { /* noop */ }
        this.session = {
          id: crypto.randomBytes(8).toString('hex'),
          resumeKey: crypto.randomBytes(16).toString('hex'),
          phoneWs: ws,
          label: 'Phone',
          lastSeen: Date.now(),
          closedForever: false,
        };
        ws.send(JSON.stringify({ type: 'joined', sessionId: this.session.id, resumeKey: this.session.resumeKey }));
      } else {
        this.session.phoneWs = ws;
        this.session.lastSeen = Date.now();
        ws.send(JSON.stringify({ type: 'resumed' }));
        this.emit('phone-resumed', { label: this.session.label });
      }
      this._wirePhoneSocket(ws);
    });
  }

  _wirePhoneSocket(ws) {
    ws.on('message', (buf) => {
      if (!this.session || this.session.phoneWs !== ws) return;
      this.session.lastSeen = Date.now();
      let msg;
      try { msg = JSON.parse(buf.toString()); } catch { return; }
      if (msg.type === 'hello') {
        this.session.label = String(msg.label || 'Phone').slice(0, 40);
        this._log(`hello label="${this.session.label}" hasVideo=${!!msg.hasVideo}`);
        this.emit('phone-connected', { label: this.session.label });
      } else if (msg.type !== 'ice' && msg.type !== 'level') {
        this._log(`phone -> desktop: ${msg.type}`);
      }
      // Signaling (offer/ice/bye/level) is relayed verbatim to the renderer.
      this.emit('from-phone', msg);
    });
    ws.on('close', () => {
      if (!this.session || this.session.phoneWs !== ws) return;
      this.session.phoneWs = null;
      this.session.lastSeen = Date.now();
      this._log('phone socket closed (grace window open)');
      this.emit('phone-socket-closed', { label: this.session.label });
      // If it doesn't resume within the grace window, it's a real disconnect.
      setTimeout(() => {
        if (this.session && this.session.phoneWs === null &&
            Date.now() - this.session.lastSeen >= RESUME_GRACE_MS - 1000) {
          this.session.closedForever = true;
          this._log('phone disconnected (grace expired)');
          this.emit('phone-disconnected', { label: this.session.label });
        }
      }, RESUME_GRACE_MS);
    });
    ws.on('error', () => { /* close handler covers it */ });
  }

  /** Renderer -> phone (answer/ice/bye). */
  sendToPhone(msg) {
    const ws = this.session?.phoneWs;
    if (!ws || ws.readyState !== 1) return false;
    if (msg.type !== 'ice') this._log(`desktop -> phone: ${msg.type}`);
    try { ws.send(JSON.stringify(msg)); return true; } catch { return false; }
  }

  endSession() {
    if (!this.session) return;
    this.sendToPhone({ type: 'bye' });
    try { this.session.phoneWs?.close(); } catch { /* noop */ }
    this.session.closedForever = true;
    const label = this.session.label;
    this.session = null;
    this.emit('phone-disconnected', { label });
  }
}

module.exports = { PhoneCompanion, isPrivateAddress, lanAddress, PORT };
