/**
 * @jest-environment node
 *
 * WiFi Phone Companion server (src/client/desktop/phone-companion.js):
 * LAN-only guard, single-use + expiring pairing tokens, WS join/resume,
 * signaling relay, cert caching. Runs the real HTTPS server on a test port.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const WebSocket = require('ws');

const { PhoneCompanion, isPrivateAddress, PORT } = require('../src/client/desktop/phone-companion');

const TEST_PORT = 19878;

function get(pathname, port = TEST_PORT) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { host: '127.0.0.1', port, path: pathname, rejectUnauthorized: false },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function wsConnect(query, port = TEST_PORT) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://127.0.0.1:${port}/ws?${query}`, { rejectUnauthorized: false });
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function nextMessage(ws) {
  return new Promise((resolve) => ws.once('message', (b) => resolve(JSON.parse(b.toString()))));
}

describe('isPrivateAddress', () => {
  test('accepts loopback, RFC1918, link-local, IPv6-mapped', () => {
    for (const a of ['127.0.0.1', '::1', '10.0.0.5', '192.168.1.10', '172.16.9.9', '172.31.255.1', '169.254.1.1', '::ffff:192.168.0.2', 'fe80::1', 'fd00::5']) {
      expect(isPrivateAddress(a)).toBe(true);
    }
  });
  test('rejects public and garbage addresses', () => {
    for (const a of ['8.8.8.8', '172.32.0.1', '1.2.3.4', '::ffff:8.8.4.4', '2001:4860::1', '', null, undefined]) {
      expect(isPrivateAddress(a)).toBe(false);
    }
  });
});

describe('PhoneCompanion server', () => {
  let pc;
  let tmpDir;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'windy-pcw-test-'));
    pc = new PhoneCompanion({ userDataDir: tmpDir, deviceLabel: 'TestMac', port: TEST_PORT });
    await pc.start();
  }, 30000);

  afterAll(() => {
    pc.stop();
  });

  test('default port stays off the taken list (9876/9877/18765)', () => {
    expect([9876, 9877, 18765]).not.toContain(PORT);
    expect(PORT).toBe(9878);
  });

  test('health endpoint responds', async () => {
    const res = await get('/health');
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).ok).toBe(true);
  });

  test('page without a token is refused', async () => {
    const res = await get('/');
    expect(res.status).toBe(403);
  });

  test('page with a garbage token is refused', async () => {
    const res = await get('/?t=deadbeef');
    expect(res.status).toBe(403);
    expect(res.body).toContain('Code expired');
  });

  test('pairing session yields URL + QR svg, and the page serves with the token', async () => {
    const session = pc.createPairingSession();
    expect(session.error).toBeUndefined();
    expect(session.url).toMatch(/^https:\/\/\d+\.\d+\.\d+\.\d+:19878\/\?t=[0-9a-f]{32}$/);
    expect(session.qrSvg).toContain('<svg');
    expect(session.host).toBe('TestMac');

    const token = new URL(session.url).searchParams.get('t');
    const res = await get(`/?t=${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toContain('TestMac');           // hostname injected
    expect(res.body).not.toContain('__WINDY_HOSTNAME__');
  });

  test('expired token is refused', async () => {
    const session = pc.createPairingSession();
    const token = new URL(session.url).searchParams.get('t');
    pc.tokens.set(token, Date.now() - 1); // force-expire
    const res = await get(`/?t=${token}`);
    expect(res.status).toBe(403);
  });

  test('WS join consumes the token (single-use) and relays signaling both ways', async () => {
    const session = pc.createPairingSession();
    const token = new URL(session.url).searchParams.get('t');

    const connected = new Promise((r) => pc.once('phone-connected', r));
    const fromPhone = new Promise((r) => pc.once('from-phone', r));

    const ws = await wsConnect(`t=${token}`);
    const joined = await nextMessage(ws);
    expect(joined.type).toBe('joined');
    expect(joined.sessionId).toMatch(/^[0-9a-f]{16}$/);
    expect(joined.resumeKey).toMatch(/^[0-9a-f]{32}$/);

    // token is consumed — a second join with the same token must be refused
    await expect(wsConnect(`t=${token}`)).rejects.toBeTruthy();

    // phone -> desktop relay
    ws.send(JSON.stringify({ type: 'hello', label: "Grant's iPhone", hasVideo: true }));
    expect((await connected).label).toBe("Grant's iPhone");
    expect((await fromPhone).type).toBe('hello');

    // desktop -> phone relay
    const answerReceived = nextMessage(ws);
    expect(pc.sendToPhone({ type: 'answer', sdp: 'fake-sdp' })).toBe(true);
    expect((await answerReceived).sdp).toBe('fake-sdp');

    // resume after a drop (screen lock / WiFi blip) without a new token
    const socketClosed = new Promise((r) => pc.once('phone-socket-closed', r));
    ws.close();
    await socketClosed;
    const ws2 = await wsConnect(`resume=${joined.sessionId}:${joined.resumeKey}`);
    const resumed = await nextMessage(ws2);
    expect(resumed.type).toBe('resumed');

    // resume with a WRONG key is refused
    await expect(wsConnect(`resume=${joined.sessionId}:0000000000000000000000000000000000`)).rejects.toBeTruthy();

    ws2.close();
  }, 20000);

  test('endSession tears down and emits disconnected', async () => {
    const session = pc.createPairingSession();
    const token = new URL(session.url).searchParams.get('t');
    const ws = await wsConnect(`t=${token}`);
    await nextMessage(ws); // joined
    const disconnected = new Promise((r) => pc.once('phone-disconnected', r));
    pc.endSession();
    await disconnected;
    expect(pc.session).toBeNull();
  });

  test('self-signed cert is cached and reused across instances', async () => {
    const certPath = path.join(tmpDir, 'phone-companion-cert.json');
    expect(fs.existsSync(certPath)).toBe(true);
    const first = JSON.parse(fs.readFileSync(certPath, 'utf8')).cert;
    const pc2 = new PhoneCompanion({ userDataDir: tmpDir, deviceLabel: 'TestMac', port: TEST_PORT + 1 });
    await pc2.start();
    pc2.stop();
    const second = JSON.parse(fs.readFileSync(certPath, 'utf8')).cert;
    expect(second).toBe(first); // no regeneration — phone trust survives restarts
  }, 30000);
});
