/**
 * WiFi Phone Companion — end-to-end loopback proof (no physical phone needed).
 *
 * Run: node e2e/phone-companion-loopback.js
 *
 * What it does, with REAL components (only the phone hardware is simulated):
 *   1. Starts the real PhoneCompanion HTTPS/WSS server (phone-companion.js).
 *   2. "Phone" = a Chromium page with a FAKE MIC + FAKE CAMERA
 *      (--use-fake-device-for-media-stream) that loads the real
 *      phone-companion-page.html over HTTPS, taps Start, and streams WebRTC.
 *   3. "Desktop" = a second page running the REAL renderer client
 *      (phone-companion-client.js) with windyAPI.phoneCompanion shimmed onto
 *      the real server instance — exactly the renderer↔main IPC contract.
 *   4. Records the received remote stream with MediaRecorder for ~3s and
 *      asserts the blob has real bytes (the archive-pipeline input).
 *   5. Kills the phone's WebSocket mid-stream and proves the session RESUMES
 *      without a new QR (screen-lock / WiFi-blip survival).
 *   6. Confirms an expired token is rejected.
 *   7. Saves screenshots of both sides.
 *
 * This is the automatable half of the verification standard; the remaining
 * hand-tests (real iPhone Safari / Android Chrome on real WiFi) are listed in
 * the PR.
 */

const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { PhoneCompanion } = require('../src/client/desktop/phone-companion');

const TEST_PORT = 19879;
const SHOT_DIR = process.env.SHOT_DIR || path.join(__dirname, '..', 'e2e-results', 'phone-companion');

const ok = (label) => console.log('  ✅', label);
const step = (label) => console.log('\n▶', label);

(async () => {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'windy-pcw-e2e-'));

  step('1. Start the real companion server');
  const server = new PhoneCompanion({ userDataDir: tmpDir, deviceLabel: 'OC5-iMac', port: TEST_PORT });
  await server.start();
  ok(`HTTPS+WSS listening on :${TEST_PORT}`);

  const browser = await chromium.launch({
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      '--allow-insecure-localhost',
    ],
  });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });

  // ── Desktop side: REAL renderer client over a shimmed windyAPI ──────────
  step('2. Boot the real renderer client (desktop side)');
  const desktop = await ctx.newPage();
  await desktop.setContent('<html><body style="background:#111;color:#eee;font-family:sans-serif"><h3>Windy Word desktop (test harness)</h3><div id="log"></div></body></html>');
  await desktop.exposeFunction('__createSession', () => server.createPairingSession());
  await desktop.exposeFunction('__toPhone', (json) => server.sendToPhone(JSON.parse(json)));
  await desktop.exposeFunction('__endSession', () => server.endSession());
  await desktop.evaluate(() => {
    window.__pendingEvents = [];
    window.windyAPI = {
      phoneCompanion: {
        createSession: () => window.__createSession(),
        toPhone: (msg) => window.__toPhone(JSON.stringify(msg)),
        endSession: () => window.__endSession(),
        onEvent: (cb) => { window.__eventCb = cb; window.__pendingEvents.forEach(cb); window.__pendingEvents = []; },
      },
    };
    window.__pushEvent = (payload) => {
      if (window.__eventCb) window.__eventCb(payload); else window.__pendingEvents.push(payload);
    };
  });
  // main→renderer event bridge (the safeSend('phone-companion:event') contract)
  const forward = (kind) => (payload) => {
    desktop.evaluate((p) => window.__pushEvent(p), { kind, ...(payload || {}) }).catch(() => {});
  };
  server.on('from-phone', (msg) => forward('from-phone')({ msg }));
  server.on('phone-connected', forward('connected'));
  server.on('phone-disconnected', forward('disconnected'));
  server.on('phone-resumed', forward('resumed'));
  server.on('phone-socket-closed', forward('socket-closed'));
  await desktop.addScriptTag({ path: path.join(__dirname, '..', 'src', 'client', 'desktop', 'renderer', 'phone-companion-client.js') });
  const clientBooted = await desktop.evaluate(() => !!window.phoneCompanion);
  if (!clientBooted) throw new Error('renderer client failed to boot');
  ok('phone-companion-client.js booted against the shimmed IPC contract');

  // ── Phone side: fake-device Chromium on the real HTTPS page ─────────────
  step('3. "Phone" scans the QR (opens the pairing URL) and starts streaming');
  const session = server.createPairingSession();
  if (session.error) throw new Error('createPairingSession: ' + session.message);
  if (!/^<svg/.test(session.qrSvg.trim())) throw new Error('QR svg missing');
  ok('pairing session created (URL in QR: ' + session.url + ')');

  const token = new URL(session.url).searchParams.get('t');
  const phone = await ctx.newPage();
  await phone.goto(`https://127.0.0.1:${TEST_PORT}/?t=${token}`);
  if (!(await phone.title()).includes('Windy Word')) throw new Error('phone page did not load');
  ok('phone page served over HTTPS (self-signed accepted)');

  await phone.check('#shareCam');            // camera too — fake video device
  await phone.click('#startBtn');            // the user gesture
  await desktop.waitForFunction(() => window.phoneCompanion.connected, null, { timeout: 15000 });
  const clientState = await desktop.evaluate(() => ({
    label: window.phoneCompanion.label,
    hasVideo: window.phoneCompanion.hasVideo,
    audioTracks: window.phoneCompanion.stream.getAudioTracks().length,
    videoTracks: window.phoneCompanion.stream.getVideoTracks().length,
  }));
  if (clientState.audioTracks < 1) throw new Error('no audio track received');
  if (clientState.videoTracks < 1) throw new Error('no video track received');
  ok(`WebRTC connected — label="${clientState.label}", audio+video tracks live (host candidates only)`);

  step('4. Record the phone stream with MediaRecorder (the archive-pipeline input)');
  const recorded = await desktop.evaluate(() => new Promise((resolve, reject) => {
    const stream = window.phoneCompanion.stream;
    const chunks = [];
    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus') ? 'video/webm;codecs=vp8,opus' : 'video/webm';
    const rec = new MediaRecorder(new MediaStream([...stream.getVideoTracks().map(t => t.clone()), ...stream.getAudioTracks().map(t => t.clone())]), { mimeType: mime });
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onerror = (e) => reject(new Error('recorder: ' + e.error));
    rec.onstop = () => resolve({ bytes: chunks.reduce((n, c) => n + c.size, 0), chunks: chunks.length, mime });
    rec.start(500);
    setTimeout(() => rec.stop(), 3000);
  }));
  if (recorded.bytes < 10000) throw new Error(`recording too small: ${recorded.bytes} bytes`);
  ok(`3s recording captured: ${(recorded.bytes / 1024).toFixed(1)} KB in ${recorded.chunks} chunks (${recorded.mime})`);

  await phone.screenshot({ path: path.join(SHOT_DIR, 'phone-streaming.png') });
  await desktop.screenshot({ path: path.join(SHOT_DIR, 'desktop-connected.png') });

  step('5. Kill the connection mid-stream — must RESUME without a new QR');
  const resumed = new Promise((resolve) => server.once('phone-resumed', resolve));
  server.session.phoneWs.terminate();        // simulates WiFi drop / screen lock
  await phone.evaluate(() => new Promise((r) => setTimeout(r, 100))); // let the phone notice
  await resumed;
  await desktop.waitForFunction(() => window.phoneCompanion.connected, null, { timeout: 15000 });
  const stillLive = await desktop.evaluate(() => window.phoneCompanion.stream.getAudioTracks()[0]?.readyState);
  if (stillLive !== 'live') throw new Error('stream did not survive the reconnect');
  ok('socket killed mid-stream → phone auto-resumed with its resume key, stream live again');

  step('6. Expired token must be rejected');
  const expiredSession = server.createPairingSession();
  const expiredToken = new URL(expiredSession.url).searchParams.get('t');
  server.tokens.set(expiredToken, Date.now() - 1);
  const rejected = await phone.evaluate(async (url) => {
    const res = await fetch(url);
    return res.status;
  }, `https://127.0.0.1:${TEST_PORT}/?t=${expiredToken}`);
  if (rejected !== 403) throw new Error('expired token was served: ' + rejected);
  ok('expired token → 403 Code expired');

  await browser.close();
  server.stop();
  console.log('\n🏁 ALL LOOPBACK CHECKS PASSED — screenshots in ' + SHOT_DIR);
  process.exit(0);
})().catch((err) => {
  console.error('\n❌ LOOPBACK FAILED:', err);
  process.exit(1);
});
