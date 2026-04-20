/**
 * Mailer — transactional email send for verification, password reset, etc.
 *
 * Uses Resend as a temporary SMTP relay. When RESEND_API_KEY isn't set,
 * falls back to a console-log stub so dev/test envs work without keys.
 *
 * TODO: Once Windy Mail is deployed, swap to its bot API:
 *   POST {WINDY_MAIL_URL}/api/v1/send
 *   Headers: { 'X-Service-Token': WINDY_MAIL_SERVICE_TOKEN }
 *   Body: { from, to, subject, html, text }
 * Eat our own dogfood. Don't block PR1 on Windy Mail being live.
 */

const FROM = process.env.MAIL_FROM || 'Windy <noreply@windyword.ai>';

export interface SendMailArgs {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface SendMailResult {
  success: boolean;
  stub?: boolean;
  error?: string;
}

export async function sendMail(args: SendMailArgs): Promise<SendMailResult> {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    const [u, d] = args.to.split('@');
    console.log(`[mailer] STUB to=${u?.[0] || '?'}***@${d || '?'} subject="${args.subject}" — set RESEND_API_KEY to actually send`);
    return { success: true, stub: true };
  }

  try {
    // Lazy require so test envs without the dep don't crash
    const { Resend } = require('resend');
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from: FROM,
      to: args.to,
      subject: args.subject,
      html: args.html,
      text: args.text,
    });
    if (error) {
      console.error('[mailer] Resend error:', error);
      return { success: false, error: String(error.message || error) };
    }
    return { success: true };
  } catch (e: any) {
    console.error('[mailer] send failed:', e.message);
    return { success: false, error: e.message };
  }
}

// ─── Templates ─────────────────────────────────────────────────

function template(headline: string, code: string, expiryNote: string, footer: string) {
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:40px 20px;">
  <h2 style="color:#1a1a2e;margin:0 0 8px 0;">Windy</h2>
  <p style="color:#555;font-size:16px;">${headline}</p>
  <div style="background:#f0f0f5;border-radius:12px;padding:24px;text-align:center;margin:24px 0;">
    <span style="font-size:36px;font-weight:700;letter-spacing:8px;color:#1a1a2e;">${code}</span>
  </div>
  <p style="color:#888;font-size:14px;">${expiryNote}</p>
  <p style="color:#aaa;font-size:12px;margin-top:32px;">${footer}</p>
</div>`;
}

export function verificationEmail(code: string): SendMailArgs {
  return {
    to: '', // caller fills in
    subject: 'Windy — Verify your email',
    text: `Your Windy verification code is: ${code}\n\nThis code expires in 15 minutes.\n\nIf you didn't request this, you can ignore this email.`,
    html: template(
      'Your verification code:',
      code,
      'This code expires in 15 minutes.',
      'If you didn\'t request this, you can safely ignore this email.',
    ),
  };
}

export function passwordResetEmail(token: string, resetUrlBase?: string): SendMailArgs {
  const link = resetUrlBase ? `${resetUrlBase}?token=${encodeURIComponent(token)}` : null;
  const linkLine = link ? `\n\nClick to reset: ${link}` : '';
  const linkBlock = link
    ? `<p><a href="${link}" style="display:inline-block;padding:14px 28px;background:#1a1a2e;color:#fff;border-radius:10px;text-decoration:none;font-weight:600;">Reset password</a></p><p style="color:#888;font-size:12px;word-break:break-all;">Or paste this token into the reset form:<br><code>${token}</code></p>`
    : `<p>Paste this token into the reset form:</p><p style="background:#f0f0f5;border-radius:10px;padding:16px;font-family:monospace;font-size:13px;word-break:break-all;color:#1a1a2e;">${token}</p>`;
  return {
    to: '',
    subject: 'Windy — Reset your password',
    text: `You requested a password reset for your Windy account.${linkLine}\n\nReset token: ${token}\n\nThis token expires in 30 minutes.\n\nIf you didn't request a password reset, you can ignore this email — your account is safe.`,
    html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:40px 20px;">
  <h2 style="color:#1a1a2e;margin:0 0 8px 0;">Windy</h2>
  <p style="color:#555;font-size:16px;">You requested a password reset.</p>
  ${linkBlock}
  <p style="color:#888;font-size:14px;">This token expires in 30 minutes.</p>
  <p style="color:#aaa;font-size:12px;margin-top:32px;">If you didn't request a password reset, you can safely ignore this email — your account is safe.</p>
</div>`,
  };
}
