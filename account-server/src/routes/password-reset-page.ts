/**
 * P1-14 — /reset-password web page.
 *
 * The password-reset email sends a link like
 *   https://windyword.ai/reset-password?token=XYZ
 * When the user clicks it their browser lands on the account-server.
 * Before this route existed, express.static served the SPA's index.html
 * and React Router matched the wildcard → rendered <NotFound/>. Users
 * who clicked a legitimate reset email saw a 404 and had no way to
 * actually reset their password in a browser.
 *
 * This is the minimal server-rendered stub described in the gap
 * analysis (P1-14, 15-min option): a single HTML form that POSTs to
 * /api/v1/auth/reset-password. No SPA changes, no client-side router.
 *
 * The wider /login /register /forgot-password /verify-email React pages
 * are still called out in the gap analysis as a multi-day piece of
 * work; this PR only plugs the email-link dead-end that's visible to
 * any user who triggers forgot-password.
 */
import { Router, Request, Response } from 'express';
import express from 'express';

const router = Router();

// Form posts come as application/x-www-form-urlencoded. Scope this
// middleware to our two paths so we don't conflict with the global
// express.urlencoded() cap or the Stripe raw-body route.
router.use('/reset-password', express.urlencoded({ extended: false }));

// ─── GET /reset-password ──────────────────────────────────────

router.get('/reset-password', (req: Request, res: Response) => {
  const token = String(req.query.token || '').trim();
  const error = String(req.query.error || '');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.send(renderPage({ token, error }));
});

// ─── POST /reset-password ─────────────────────────────────────
//
// Thin proxy to /api/v1/auth/reset-password. Keeping the actual
// policy (token validity, password strength, consume-once semantics)
// in the API handler means we don't duplicate checks here.
router.post('/reset-password', async (req: Request, res: Response) => {
  const token = String(req.body?.token || '').trim();
  const password = String(req.body?.password || '');
  const confirm = String(req.body?.confirm || '');

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (!token) {
    return res.status(400).send(renderPage({ token, error: 'Missing reset token. Use the link from your email.' }));
  }
  if (!password || password.length < 8) {
    return res.status(400).send(renderPage({ token, error: 'Password must be at least 8 characters.' }));
  }
  if (password !== confirm) {
    return res.status(400).send(renderPage({ token, error: 'Passwords do not match.' }));
  }

  try {
    const base = `${req.protocol}://${req.get('host')}`;
    const apiRes = await fetch(`${base}/api/v1/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // API contract: newPassword (not password). Both lived in different
      // schemas historically; the reset endpoint uses newPassword.
      body: JSON.stringify({ token, newPassword: password }),
    });
    if (apiRes.status === 200) {
      return res.send(renderPage({ token: '', success: true }));
    }
    const body = await apiRes.json().catch(() => ({} as any));
    const message = typeof body.error === 'string'
      ? body.error
      : 'That reset link is no longer valid. Request a new one from the app.';
    return res.status(apiRes.status).send(renderPage({ token, error: message }));
  } catch (_err) {
    return res.status(502).send(renderPage({ token, error: 'Reset service unreachable. Try again in a moment.' }));
  }
});

export default router;

// ─── HTML rendering ──────────────────────────────────────────

function renderPage(data: { token: string; error?: string; success?: boolean }): string {
  const successBlock = data.success
    ? `<div class="banner banner-success"><div class="check">&check;</div><div><strong>Password reset.</strong><br>You can now sign in with your new password.</div></div>`
    : '';
  const errorBlock = data.error
    ? `<div class="banner banner-error">${escapeHtml(data.error)}</div>`
    : '';
  const formBlock = data.success ? '' : `
    <form method="POST" action="/reset-password">
      <input type="hidden" name="token" value="${escapeAttr(data.token)}">
      <label>
        <span>New password</span>
        <input type="password" name="password" autocomplete="new-password" minlength="8" required autofocus>
      </label>
      <label>
        <span>Confirm password</span>
        <input type="password" name="confirm" autocomplete="new-password" minlength="8" required>
      </label>
      <div class="btn-row">
        <button type="submit" class="btn btn-approve">Reset password</button>
      </div>
    </form>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Reset password — Windy</title>
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
    .btn-row { display: flex; gap: 12px; margin-top: 20px; }
    .btn { flex: 1; padding: 14px 20px; border: none; border-radius: 10px; font-size: 15px; font-weight: 600; cursor: pointer; transition: all 0.15s ease; font-family: inherit; }
    .btn-approve { background: #4f46e5; color: white; }
    .btn-approve:hover { background: #4338ca; }
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
    <div class="subtitle">Reset your password</div>
    ${successBlock}
    ${errorBlock}
    ${formBlock}
    <div class="footer">If you didn't request a password reset, you can ignore this page.</div>
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
