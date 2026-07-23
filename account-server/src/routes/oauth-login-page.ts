/**
 * OAuth login page — the browser-facing half of "Sign in with Windy".
 *
 * When a user lands on GET /api/v1/oauth/authorize with no token (the normal
 * case for a full-page redirect from an ecosystem app like Windy Chat), we
 * render this page instead of a raw 401. It POSTs email + password (and a
 * TOTP/backup code when the account has MFA enabled) to
 * POST /api/v1/oauth/login along with the original OAuth params as hidden
 * fields, so a single submit completes login + authorization + redirect.
 *
 * Pure render functions only — no routes here. Styling mirrors the consent
 * page card in routes/oauth.ts.
 */

export interface OAuthLoginPageData {
  /** Display name of the OAuth client the user is signing in to. */
  clientName: string;
  /** Original authorize params, round-tripped as hidden form fields. */
  params: {
    client_id: string;
    redirect_uri: string;
    response_type: string;
    scope: string;
    state: string;
    code_challenge: string;
    code_challenge_method: string;
  };
  /** Pre-fill for the email input (after a failed attempt). Never the password. */
  email?: string;
  /** Error message to show above the form. */
  error?: string;
  /** Show the MFA code input (account has TOTP enabled). */
  showMfa?: boolean;
}

const SHARED_STYLES = `
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
    .logo {
      font-size: 24px;
      font-weight: 700;
      color: #1a1a2e;
      margin-bottom: 8px;
      text-align: center;
    }
    .subtitle {
      font-size: 15px;
      color: #666;
      text-align: center;
      margin-bottom: 28px;
    }
    .subtitle strong { color: #1a1a2e; }
    .error-box {
      background: #fef2f2;
      border: 1px solid #fecaca;
      color: #b91c1c;
      border-radius: 10px;
      padding: 12px 14px;
      font-size: 14px;
      margin-bottom: 20px;
    }
    .info-box {
      background: #eef2ff;
      border: 1px solid #c7d2fe;
      color: #3730a3;
      border-radius: 10px;
      padding: 12px 14px;
      font-size: 14px;
      margin-bottom: 20px;
    }
    label {
      display: block;
      font-size: 14px;
      font-weight: 600;
      color: #1a1a2e;
      margin-bottom: 6px;
    }
    input[type="email"], input[type="password"], input[type="text"] {
      width: 100%;
      padding: 13px 14px;
      border: 1px solid #d5d5e0;
      border-radius: 10px;
      font-size: 16px;
      margin-bottom: 18px;
      background: #fff;
      color: #1a1a2e;
    }
    input:focus {
      outline: none;
      border-color: #4f46e5;
      box-shadow: 0 0 0 3px rgba(79,70,229,0.12);
    }
    .btn {
      width: 100%;
      padding: 14px 24px;
      border: none;
      border-radius: 10px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      background: #4f46e5;
      color: white;
      transition: background 0.15s ease;
    }
    .btn:hover { background: #4338ca; }
    .footer {
      margin-top: 20px;
      font-size: 13px;
      color: #888;
      text-align: center;
      line-height: 1.6;
    }
    .footer a { color: #4f46e5; text-decoration: none; font-weight: 600; }
    .footer a:hover { text-decoration: underline; }
`;

/**
 * Render the "Sign in with Windy" login page.
 */
export function renderOAuthLoginPage(data: OAuthLoginPageData): string {
  const hiddenFields = (Object.entries(data.params) as [string, string][])
    .filter(([, v]) => typeof v === 'string' && v.length > 0)
    .map(([k, v]) => `<input type="hidden" name="${escapeAttr(k)}" value="${escapeAttr(v)}">`)
    .join('\n      ');

  const mfaBlock = data.showMfa ? `
      <div class="info-box">This account has two-step verification turned on. Enter the 6-digit code from your authenticator app (or one of your backup codes).</div>
      <label for="mfaCode">Verification code</label>
      <input type="text" id="mfaCode" name="mfaCode" inputmode="numeric" autocomplete="one-time-code" placeholder="123456" autofocus>
  ` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sign in with Windy</title>
  <style>${SHARED_STYLES}</style>
</head>
<body>
  <div class="card">
    <div class="logo">Windy</div>
    <div class="subtitle">Sign in to continue to <strong>${escapeHtml(data.clientName)}</strong></div>

    ${data.error ? `<div class="error-box">${escapeHtml(data.error)}</div>` : ''}

    <form method="POST" action="/api/v1/oauth/login">
      ${hiddenFields}

      <label for="email">Email</label>
      <input type="email" id="email" name="email" autocomplete="username" required
             value="${escapeAttr(data.email || '')}" ${data.showMfa ? '' : 'autofocus'}>

      <label for="password">Password</label>
      <input type="password" id="password" name="password" autocomplete="current-password" required>
      ${mfaBlock}
      <button type="submit" class="btn">Sign in</button>
    </form>

    <div class="footer">
      You'll go straight back to ${escapeHtml(data.clientName)} after you sign in.<br>
      New to Windy? <a href="https://windyword.ai">Create your free account</a>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Render a friendly error page for invalid authorize links (unknown client,
 * unregistered redirect_uri, malformed params). Shown only to browsers —
 * API clients keep getting JSON.
 */
export function renderOAuthErrorPage(message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sign-in link problem — Windy</title>
  <style>${SHARED_STYLES}</style>
</head>
<body>
  <div class="card">
    <div class="logo">Windy</div>
    <div class="subtitle">We couldn't start this sign-in</div>
    <div class="error-box">${escapeHtml(message)}</div>
    <div class="footer">
      Please go back to the app you came from and try again.<br>
      If it keeps happening, the app's sign-in link is misconfigured.
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
