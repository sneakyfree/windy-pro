/**
 * Top-level /device approval page — OAuth device-code grant operator UI.
 *
 * Mobile shows "Visit windyword.ai/device, enter code ABCD-1234". This is
 * where the user lands. The page collects the code + the user's email +
 * password (no separate login because account-server is JWT-only with no
 * cookie sessions), authenticates inline, marks the device-code row
 * approved, and then the mobile poll on /api/v1/oauth/token succeeds.
 *
 * Auth model: there is no session cookie on the account-server. Rather than
 * bolt one on for this single flow, the form posts email + password and we
 * verify bcrypt inline. If/when a cookie session is added, this route can
 * shed the password input and just check the cookie.
 */
import { Router, Request, Response } from 'express';
import express from 'express';
import bcrypt from 'bcryptjs';
import { getDb } from '../db/schema';
import { logAuditEvent } from '../identity-service';

const router = Router();

// Form posts come as application/x-www-form-urlencoded.
router.use('/device', express.urlencoded({ extended: false }));

// ─── Routes ──────────────────────────────────────────────────

router.get('/device', (req: Request, res: Response) => {
  const userCode = String(req.query.user_code || '').toUpperCase().trim();
  const error = String(req.query.error || '');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.send(renderPage({ userCode, error }));
});

router.post('/device/approve', async (req: Request, res: Response) => {
  const userCodeRaw = String(req.body?.user_code || '').trim();
  const email = String(req.body?.email || '').toLowerCase().trim();
  const password = String(req.body?.password || '');
  const action = String(req.body?.action || 'approve');

  if (!userCodeRaw) {
    return res.status(400).send(renderPage({ userCode: '', error: 'Enter the code shown on your device.' }));
  }
  const userCode = userCodeRaw.toUpperCase();

  if (!email || !password) {
    return res.status(400).send(renderPage({ userCode, error: 'Sign in with your Windy account to approve this device.' }));
  }

  const db = getDb();
  const user = db.prepare('SELECT id, password_hash, email_verified FROM users WHERE email = ?').get(email) as any;
  // Generic credential error — never disclose whether the email is registered.
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).send(renderPage({ userCode, email, error: 'Email or password is incorrect.' }));
  }

  const deviceAuth = db.prepare(
    "SELECT device_code, client_id, status, expires_at FROM oauth_device_codes WHERE user_code = ?",
  ).get(userCode) as any;

  if (!deviceAuth) {
    return res.status(404).send(renderPage({ userCode, email, error: 'That code does not exist. Check the code on your device and try again.' }));
  }
  if (new Date(deviceAuth.expires_at) < new Date()) {
    return res.status(400).send(renderPage({ userCode, email, error: 'That code has expired. Restart sign-in on your device to get a new one.' }));
  }
  if (deviceAuth.status === 'approved') {
    // Idempotent — user double-submitted.
    return res.send(renderPage({ userCode, email, success: true }));
  }
  if (deviceAuth.status !== 'pending') {
    return res.status(400).send(renderPage({ userCode, email, error: `This code is already ${deviceAuth.status}. Restart sign-in on your device.` }));
  }

  if (action === 'deny') {
    db.prepare("UPDATE oauth_device_codes SET status = 'denied' WHERE device_code = ?").run(deviceAuth.device_code);
    logAuditEvent('oauth_device_approved' as any, user.id, {
      user_code: userCode, client_id: deviceAuth.client_id, decision: 'denied',
    });
    return res.send(renderPage({ userCode, email, denied: true }));
  }

  db.prepare(
    "UPDATE oauth_device_codes SET status = 'approved', identity_id = ? WHERE device_code = ?",
  ).run(user.id, deviceAuth.device_code);

  logAuditEvent('oauth_device_approved' as any, user.id, {
    user_code: userCode, client_id: deviceAuth.client_id, decision: 'approved',
  });

  res.send(renderPage({ userCode, email, success: true }));
});

export default router;

// ─── HTML rendering ──────────────────────────────────────────

function renderPage(data: {
  userCode: string;
  email?: string;
  error?: string;
  success?: boolean;
  denied?: boolean;
}): string {
  const successBlock = data.success
    ? `<div class="banner banner-success"><div class="check">&check;</div><div><strong>Approved!</strong><br>You can close this window and return to your device.</div></div>`
    : '';
  const deniedBlock = data.denied
    ? `<div class="banner banner-error"><div><strong>Denied.</strong><br>The device will not be granted access.</div></div>`
    : '';
  const errorBlock = data.error
    ? `<div class="banner banner-error">${escapeHtml(data.error)}</div>`
    : '';
  const formHidden = data.success || data.denied;
  const formBlock = formHidden ? '' : `
    <form method="POST" action="/device/approve">
      <label>
        <span>Code from your device</span>
        <input type="text" name="user_code" value="${escapeAttr(data.userCode)}" placeholder="ABCD-1234" autocomplete="off" required maxlength="20" pattern="[A-Za-z0-9-]+" autofocus>
      </label>
      <label>
        <span>Windy email</span>
        <input type="email" name="email" value="${escapeAttr(data.email || '')}" autocomplete="email" required>
      </label>
      <label>
        <span>Password</span>
        <input type="password" name="password" autocomplete="current-password" required>
      </label>
      <div class="btn-row">
        <button type="submit" name="action" value="deny" class="btn btn-deny">Deny</button>
        <button type="submit" name="action" value="approve" class="btn btn-approve">Approve</button>
      </div>
    </form>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Device approval — Windy</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5fa;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      background: white;
      border-radius: 16px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.08);
      max-width: 420px;
      width: 100%;
      padding: 40px 32px;
    }
    .logo { font-size: 24px; font-weight: 700; color: #1a1a2e; margin-bottom: 4px; text-align: center; }
    .subtitle { font-size: 14px; color: #666; text-align: center; margin-bottom: 24px; }
    label { display: block; margin-bottom: 14px; }
    label span { display: block; font-size: 13px; font-weight: 600; color: #333; margin-bottom: 6px; }
    input { width: 100%; padding: 12px 14px; border: 1px solid #ddd; border-radius: 10px; font-size: 15px; font-family: inherit; }
    input:focus { outline: none; border-color: #4f46e5; box-shadow: 0 0 0 3px rgba(79,70,229,0.15); }
    input[name="user_code"] { font-family: ui-monospace, monospace; letter-spacing: 2px; text-transform: uppercase; }
    .btn-row { display: flex; gap: 12px; margin-top: 20px; }
    .btn { flex: 1; padding: 14px 20px; border: none; border-radius: 10px; font-size: 15px; font-weight: 600; cursor: pointer; transition: all 0.15s ease; font-family: inherit; }
    .btn-approve { background: #4f46e5; color: white; }
    .btn-approve:hover { background: #4338ca; }
    .btn-deny { background: #f0f0f5; color: #666; }
    .btn-deny:hover { background: #e5e5ea; color: #333; }
    .banner { padding: 14px 16px; border-radius: 10px; font-size: 14px; line-height: 1.5; margin-bottom: 20px; display: flex; align-items: center; gap: 12px; }
    .banner-success { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
    .banner-error { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
    .check { width: 28px; height: 28px; border-radius: 50%; background: #10b981; color: white; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 700; flex-shrink: 0; }
    .footer { margin-top: 20px; font-size: 12px; color: #aaa; text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">Windy</div>
    <div class="subtitle">Approve a sign-in from another device</div>
    ${successBlock}
    ${deniedBlock}
    ${errorBlock}
    ${formBlock}
    <div class="footer">If you didn't start this, choose Deny.</div>
  </div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
