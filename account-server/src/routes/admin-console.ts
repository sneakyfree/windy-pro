/**
 * Admin Console — Server-rendered HTML admin pages.
 *
 * Phase 7B-1: Lightweight admin console served directly by the account server.
 * No React, no build step. Server-rendered HTML with inline styles.
 * Follows the same pattern as the OAuth consent screen in oauth.ts.
 *
 * All pages require admin JWT (Bearer token passed via cookie or query param).
 */
import { Router, Request, Response } from 'express';
import { getDb } from '../db/schema';
import { authenticateToken, adminOnly, AuthRequest } from '../middleware/auth';

const router = Router();

// ─── Auth: extract token from cookie or ?token= query param ──────
// Admin console is rendered HTML, so we can't use Authorization header from a browser.
// We accept the JWT from a `windy_admin_token` cookie or `?token=` query param
// and inject it into the Authorization header before the standard middleware runs.

function injectTokenFromCookieOrQuery(req: Request, _res: Response, next: Function): void {
  if (!req.headers['authorization']) {
    // Try cookie first
    const cookieHeader = req.headers['cookie'] || '';
    const match = cookieHeader.match(/windy_admin_token=([^;]+)/);
    if (match) {
      req.headers['authorization'] = `Bearer ${match[1]}`;
    }
    // Fall back to query param
    else if (req.query.token) {
      req.headers['authorization'] = `Bearer ${req.query.token}`;
    }
  }
  next();
}

// Apply to all routes
router.use(injectTokenFromCookieOrQuery, authenticateToken, adminOnly);

// ─── HTML Helpers ────────────────────────────────────────────────

function escapeHtml(str: string | null | undefined): string {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDate(d: string | null | undefined): string {
  if (!d) return '-';
  try {
    return new Date(d).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return d;
  }
}

function layout(title: string, content: string, activeTab: string = ''): string {
  const tabs = [
    { href: '/admin/', label: 'Dashboard', key: 'dashboard' },
    { href: '/admin/users', label: 'Users', key: 'users' },
    { href: '/admin/bots', label: 'Bots', key: 'bots' },
    { href: '/admin/oauth-clients', label: 'OAuth Clients', key: 'oauth-clients' },
    { href: '/admin/audit', label: 'Audit Log', key: 'audit' },
  ];

  const navHtml = tabs.map(t =>
    `<a href="${t.href}" style="padding:8px 16px;border-radius:6px;text-decoration:none;font-weight:${activeTab === t.key ? '700' : '400'};color:${activeTab === t.key ? '#fff' : '#cbd5e1'};background:${activeTab === t.key ? '#4f46e5' : 'transparent'};font-size:14px;">${t.label}</a>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} - Windy Admin</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace; background: #0f172a; color: #e2e8f0; min-height: 100vh; }
    a { color: #818cf8; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; padding: 10px 12px; background: #1e293b; color: #94a3b8; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 2px solid #334155; }
    td { padding: 10px 12px; border-bottom: 1px solid #1e293b; }
    tr:nth-child(even) td { background: rgba(30,41,59,0.4); }
    tr:hover td { background: rgba(79,70,229,0.1); }
    .card { background: #1e293b; border-radius: 10px; padding: 20px; margin-bottom: 16px; }
    .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .stat { background: #1e293b; border-radius: 10px; padding: 20px; }
    .stat-value { font-size: 28px; font-weight: 700; color: #f8fafc; }
    .stat-label { font-size: 12px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 4px; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
    .badge-green { background: #065f46; color: #6ee7b7; }
    .badge-red { background: #7f1d1d; color: #fca5a5; }
    .badge-blue { background: #1e3a5f; color: #93c5fd; }
    .badge-yellow { background: #713f12; color: #fde68a; }
    .badge-gray { background: #374151; color: #9ca3af; }
    .btn { display: inline-block; padding: 6px 14px; border-radius: 6px; font-size: 13px; font-weight: 600; text-decoration: none; cursor: pointer; border: none; }
    .btn-primary { background: #4f46e5; color: #fff; }
    .btn-danger { background: #991b1b; color: #fca5a5; }
    .btn-sm { padding: 4px 10px; font-size: 12px; }
    input[type=text], input[type=search], select { background: #0f172a; border: 1px solid #334155; color: #e2e8f0; padding: 8px 12px; border-radius: 6px; font-size: 13px; }
    .pagination { display: flex; gap: 8px; margin-top: 16px; align-items: center; font-size: 13px; }
    .pagination a { padding: 6px 12px; background: #1e293b; border-radius: 6px; text-decoration: none; color: #818cf8; }
    pre { background: #0f172a; padding: 8px; border-radius: 4px; font-size: 12px; overflow-x: auto; max-width: 400px; white-space: pre-wrap; word-break: break-all; }
  </style>
</head>
<body>
  <nav style="background:#1e293b;border-bottom:2px solid #334155;padding:12px 24px;display:flex;align-items:center;gap:16px;flex-wrap:wrap;">
    <span style="font-weight:700;font-size:16px;color:#f8fafc;margin-right:16px;">Windy Admin</span>
    ${navHtml}
  </nav>
  <main style="max-width:1200px;margin:24px auto;padding:0 24px;">
    <h1 style="font-size:22px;font-weight:700;margin-bottom:20px;color:#f8fafc;">${escapeHtml(title)}</h1>
    ${content}
  </main>
</body>
</html>`;
}

// ─── GET /admin/ — Dashboard ─────────────────────────────────────

router.get('/', (_req: Request, res: Response) => {
  try {
    const db = getDb();

    const totalUsers = (db.prepare("SELECT COUNT(*) as c FROM users WHERE identity_type = 'human' OR identity_type IS NULL").get() as any).c;
    const totalBots = (db.prepare("SELECT COUNT(*) as c FROM users WHERE identity_type = 'bot'").get() as any).c;

    let activeSessions = 0;
    try {
      activeSessions = (db.prepare("SELECT COUNT(*) as c FROM refresh_tokens WHERE expires_at > datetime('now')").get() as any).c;
    } catch { /* table may not exist */ }

    // Registrations
    const regToday = (db.prepare("SELECT COUNT(*) as c FROM users WHERE created_at >= date('now')").get() as any).c;
    const regWeek = (db.prepare("SELECT COUNT(*) as c FROM users WHERE created_at >= date('now', '-7 days')").get() as any).c;
    const regMonth = (db.prepare("SELECT COUNT(*) as c FROM users WHERE created_at >= date('now', '-30 days')").get() as any).c;

    // Product distribution
    let productDist: any[] = [];
    try {
      productDist = db.prepare("SELECT product, COUNT(*) as c FROM product_accounts GROUP BY product ORDER BY c DESC").all() as any[];
    } catch { /* table may not exist */ }

    // Tier distribution
    const tierDist = db.prepare("SELECT COALESCE(tier, 'free') as tier, COUNT(*) as c FROM users GROUP BY tier ORDER BY c DESC").all() as any[];

    // Recent audit log
    let auditEntries: any[] = [];
    try {
      auditEntries = db.prepare("SELECT * FROM identity_audit_log ORDER BY created_at DESC LIMIT 20").all() as any[];
    } catch { /* table may not exist */ }

    const productHtml = productDist.length > 0
      ? productDist.map(p => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #334155;"><span>${escapeHtml(p.product)}</span><span style="font-weight:700;">${p.c}</span></div>`).join('')
      : '<div style="color:#64748b;">No product accounts yet</div>';

    const tierHtml = tierDist.map(t => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #334155;"><span>${escapeHtml(t.tier)}</span><span style="font-weight:700;">${t.c}</span></div>`).join('');

    const auditHtml = auditEntries.length > 0
      ? `<table>
          <tr><th>Time</th><th>Event</th><th>Identity</th><th>Details</th></tr>
          ${auditEntries.map(e => `<tr>
            <td style="white-space:nowrap;">${formatDate(e.created_at)}</td>
            <td><span class="badge badge-blue">${escapeHtml(e.event)}</span></td>
            <td>${e.identity_id ? `<a href="/admin/users/${escapeHtml(e.identity_id)}">${escapeHtml(e.identity_id.slice(0, 8))}...</a>` : '-'}</td>
            <td><pre>${escapeHtml(e.details?.slice(0, 200))}</pre></td>
          </tr>`).join('')}
        </table>`
      : '<div style="color:#64748b;">No audit entries yet</div>';

    const content = `
      <div class="stat-grid">
        <div class="stat"><div class="stat-value">${totalUsers}</div><div class="stat-label">Total Users</div></div>
        <div class="stat"><div class="stat-value">${totalBots}</div><div class="stat-label">Total Bots</div></div>
        <div class="stat"><div class="stat-value">${activeSessions}</div><div class="stat-label">Active Sessions</div></div>
        <div class="stat"><div class="stat-value">${regToday}</div><div class="stat-label">Registrations Today</div></div>
        <div class="stat"><div class="stat-value">${regWeek}</div><div class="stat-label">This Week</div></div>
        <div class="stat"><div class="stat-value">${regMonth}</div><div class="stat-label">This Month</div></div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px;">
        <div class="card">
          <h3 style="font-size:14px;font-weight:700;margin-bottom:12px;color:#94a3b8;">Product Distribution</h3>
          ${productHtml}
        </div>
        <div class="card">
          <h3 style="font-size:14px;font-weight:700;margin-bottom:12px;color:#94a3b8;">Tier Distribution</h3>
          ${tierHtml}
        </div>
      </div>

      <div class="card">
        <h3 style="font-size:14px;font-weight:700;margin-bottom:12px;color:#94a3b8;">Recent Audit Log</h3>
        ${auditHtml}
      </div>
    `;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(layout('Dashboard', content, 'dashboard'));
  } catch (err: any) {
    res.status(500).send(layout('Error', `<div class="card" style="color:#fca5a5;">Error loading dashboard: ${escapeHtml(err.message)}</div>`));
  }
});

// ─── GET /admin/users — User List ────────────────────────────────

router.get('/users', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const page = parseInt(req.query.page as string) || 1;
    const limit = 30;
    const offset = (page - 1) * limit;
    const search = (req.query.search as string) || '';

    let users: any[];
    let total: number;

    if (search) {
      const like = `%${search}%`;
      users = db.prepare(`
        SELECT id, name, email, tier, identity_type, created_at, last_login_at
        FROM users WHERE name LIKE ? OR email LIKE ? OR id LIKE ?
        ORDER BY created_at DESC LIMIT ? OFFSET ?
      `).all(like, like, like, limit, offset) as any[];
      total = (db.prepare("SELECT COUNT(*) as c FROM users WHERE name LIKE ? OR email LIKE ? OR id LIKE ?").get(like, like, like) as any).c;
    } else {
      users = db.prepare("SELECT id, name, email, tier, identity_type, created_at, last_login_at FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?")
        .all(limit, offset) as any[];
      total = (db.prepare("SELECT COUNT(*) as c FROM users").get() as any).c;
    }

    // Fetch product counts for each user
    let productStmt: any;
    try {
      productStmt = db.prepare("SELECT GROUP_CONCAT(product) as products FROM product_accounts WHERE identity_id = ?");
    } catch { /* table may not exist */ }

    const totalPages = Math.ceil(total / limit);

    const rowsHtml = users.map(u => {
      let products = '';
      if (productStmt) {
        try { products = (productStmt.get(u.id) as any)?.products || ''; } catch {}
      }
      const typeBadge = u.identity_type === 'bot'
        ? '<span class="badge badge-yellow">bot</span>'
        : '<span class="badge badge-green">human</span>';
      const productBadges = products ? products.split(',').map((p: string) => `<span class="badge badge-gray">${escapeHtml(p)}</span>`).join(' ') : '-';

      return `<tr>
        <td><a href="/admin/users/${escapeHtml(u.id)}">${escapeHtml(u.name)}</a></td>
        <td>${escapeHtml(u.email)}</td>
        <td><span class="badge badge-blue">${escapeHtml(u.tier || 'free')}</span></td>
        <td>${typeBadge}</td>
        <td>${productBadges}</td>
        <td style="white-space:nowrap;">${formatDate(u.created_at)}</td>
        <td style="white-space:nowrap;">${formatDate(u.last_login_at)}</td>
      </tr>`;
    }).join('');

    let paginationHtml = '';
    if (totalPages > 1) {
      const searchParam = search ? `&search=${encodeURIComponent(search)}` : '';
      paginationHtml = `<div class="pagination">`;
      if (page > 1) paginationHtml += `<a href="/admin/users?page=${page - 1}${searchParam}">Prev</a>`;
      paginationHtml += `<span style="color:#94a3b8;">Page ${page} of ${totalPages} (${total} total)</span>`;
      if (page < totalPages) paginationHtml += `<a href="/admin/users?page=${page + 1}${searchParam}">Next</a>`;
      paginationHtml += `</div>`;
    }

    const content = `
      <form method="GET" action="/admin/users" style="margin-bottom:16px;display:flex;gap:8px;">
        <input type="search" name="search" value="${escapeHtml(search)}" placeholder="Search by email, name, or identity ID..." style="flex:1;max-width:400px;">
        <button type="submit" class="btn btn-primary">Search</button>
        ${search ? '<a href="/admin/users" class="btn" style="background:#334155;color:#e2e8f0;">Clear</a>' : ''}
      </form>
      <div class="card" style="overflow-x:auto;">
        <table>
          <tr><th>Name</th><th>Email</th><th>Tier</th><th>Type</th><th>Products</th><th>Created</th><th>Last Login</th></tr>
          ${rowsHtml}
        </table>
        ${paginationHtml}
      </div>
    `;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(layout('Users', content, 'users'));
  } catch (err: any) {
    res.status(500).send(layout('Error', `<div class="card" style="color:#fca5a5;">Error: ${escapeHtml(err.message)}</div>`));
  }
});

// ─── GET /admin/users/:id — User Detail ──────────────────────────

router.get('/users/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id) as any;

    if (!user) {
      res.status(404).send(layout('Not Found', '<div class="card">User not found.</div>'));
      return;
    }

    // Product accounts
    let products: any[] = [];
    try { products = db.prepare("SELECT * FROM product_accounts WHERE identity_id = ?").all(user.id) as any[]; } catch {}

    // Scopes
    let scopes: any[] = [];
    try { scopes = db.prepare("SELECT * FROM identity_scopes WHERE identity_id = ?").all(user.id) as any[]; } catch {}

    // Devices
    let devices: any[] = [];
    try { devices = db.prepare("SELECT * FROM devices WHERE user_id = ?").all(user.id) as any[]; } catch {}

    // Audit log (last 30)
    let audit: any[] = [];
    try { audit = db.prepare("SELECT * FROM identity_audit_log WHERE identity_id = ? ORDER BY created_at DESC LIMIT 30").all(user.id) as any[]; } catch {}

    // Eternitas passport
    let passport: any = null;
    try { passport = db.prepare("SELECT * FROM eternitas_passports WHERE identity_id = ?").get(user.id) as any; } catch {}

    const frozenBadge = user.frozen ? '<span class="badge badge-red">FROZEN</span>' : '<span class="badge badge-green">Active</span>';
    const typeBadge = user.identity_type === 'bot' ? '<span class="badge badge-yellow">bot</span>' : '<span class="badge badge-green">human</span>';

    const infoRows = [
      ['Identity ID', user.id],
      ['Email', user.email],
      ['Name', user.name],
      ['Display Name', user.display_name || '-'],
      ['Type', null, typeBadge],
      ['Tier', user.tier || 'free'],
      ['Role', user.role || 'user'],
      ['Status', null, frozenBadge],
      ['Phone', user.phone || '-'],
      ['Email Verified', user.email_verified ? 'Yes' : 'No'],
      ['Phone Verified', user.phone_verified ? 'Yes' : 'No'],
      ['Passport ID', user.passport_id || '-'],
      ['Preferred Language', user.preferred_lang || 'en'],
      ['Storage Used', user.storage_used ? `${Math.round(user.storage_used / 1024 / 1024)} MB` : '0 MB'],
      ['Storage Limit', user.storage_limit ? `${Math.round(user.storage_limit / 1024 / 1024)} MB` : '-'],
      ['Created', formatDate(user.created_at)],
      ['Last Login', formatDate(user.last_login_at)],
      ['Updated', formatDate(user.updated_at)],
    ];

    const infoHtml = infoRows.map(r => `<tr><td style="color:#94a3b8;width:180px;">${r[0]}</td><td>${r[2] || escapeHtml(r[1] as string)}</td></tr>`).join('');

    const productsHtml = products.length > 0
      ? `<table><tr><th>Product</th><th>Status</th><th>External ID</th><th>Provisioned</th></tr>
         ${products.map(p => {
           const statusBadge = p.status === 'active' ? 'badge-green' : p.status === 'suspended' ? 'badge-red' : 'badge-gray';
           return `<tr><td>${escapeHtml(p.product)}</td><td><span class="badge ${statusBadge}">${escapeHtml(p.status)}</span></td><td>${escapeHtml(p.external_id || '-')}</td><td>${formatDate(p.provisioned_at)}</td></tr>`;
         }).join('')}
         </table>`
      : '<div style="color:#64748b;">No product accounts</div>';

    const scopesHtml = scopes.length > 0
      ? scopes.map(s => `<span class="badge badge-blue" style="margin:2px;">${escapeHtml(s.scope)}</span>`).join(' ')
      : '<span style="color:#64748b;">No scopes</span>';

    const devicesHtml = devices.length > 0
      ? `<table><tr><th>Name</th><th>Platform</th><th>Last Seen</th></tr>
         ${devices.map(d => `<tr><td>${escapeHtml(d.name)}</td><td>${escapeHtml(d.platform)}</td><td>${formatDate(d.last_seen)}</td></tr>`).join('')}
         </table>`
      : '<div style="color:#64748b;">No devices</div>';

    const auditHtml = audit.length > 0
      ? `<table><tr><th>Time</th><th>Event</th><th>IP</th><th>Details</th></tr>
         ${audit.map(e => `<tr>
           <td style="white-space:nowrap;">${formatDate(e.created_at)}</td>
           <td><span class="badge badge-blue">${escapeHtml(e.event)}</span></td>
           <td>${escapeHtml(e.ip_address || '-')}</td>
           <td><pre>${escapeHtml(e.details?.slice(0, 300))}</pre></td>
         </tr>`).join('')}
         </table>`
      : '<div style="color:#64748b;">No audit entries</div>';

    const passportHtml = passport
      ? `<table>
          <tr><td style="color:#94a3b8;">Passport Number</td><td>${escapeHtml(passport.passport_number)}</td></tr>
          <tr><td style="color:#94a3b8;">Status</td><td><span class="badge ${passport.status === 'active' ? 'badge-green' : 'badge-red'}">${escapeHtml(passport.status)}</span></td></tr>
          <tr><td style="color:#94a3b8;">Trust Score</td><td>${passport.trust_score}</td></tr>
          <tr><td style="color:#94a3b8;">Operator</td><td>${passport.operator_identity_id ? `<a href="/admin/users/${escapeHtml(passport.operator_identity_id)}">${escapeHtml(passport.operator_identity_id.slice(0, 8))}...</a>` : '-'}</td></tr>
          <tr><td style="color:#94a3b8;">Registered</td><td>${formatDate(passport.registered_at)}</td></tr>
          <tr><td style="color:#94a3b8;">Last Verified</td><td>${formatDate(passport.last_verified_at)}</td></tr>
         </table>`
      : '';

    // Action forms (freeze/unfreeze, change tier)
    const actionsHtml = `
      <div style="display:flex;gap:12px;flex-wrap:wrap;">
        <form method="POST" action="/admin/users/${escapeHtml(user.id)}/freeze" style="display:inline;">
          <button type="submit" class="btn ${user.frozen ? 'btn-primary' : 'btn-danger'}">${user.frozen ? 'Unfreeze Account' : 'Freeze Account'}</button>
        </form>
        <form method="POST" action="/admin/users/${escapeHtml(user.id)}/tier" style="display:inline-flex;gap:8px;align-items:center;">
          <select name="tier">
            ${['free', 'pro', 'translate', 'translate-pro'].map(t => `<option value="${t}" ${user.tier === t ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
          <button type="submit" class="btn btn-primary btn-sm">Change Tier</button>
        </form>
      </div>
    `;

    const content = `
      <a href="/admin/users" style="font-size:13px;color:#818cf8;margin-bottom:12px;display:inline-block;">&larr; Back to Users</a>

      <div class="card">
        <h3 style="font-size:14px;font-weight:700;margin-bottom:12px;color:#94a3b8;">Identity Info</h3>
        <table>${infoHtml}</table>
      </div>

      <div class="card">
        <h3 style="font-size:14px;font-weight:700;margin-bottom:12px;color:#94a3b8;">Actions</h3>
        ${actionsHtml}
      </div>

      ${passport ? `<div class="card"><h3 style="font-size:14px;font-weight:700;margin-bottom:12px;color:#94a3b8;">Eternitas Passport</h3>${passportHtml}</div>` : ''}

      <div class="card">
        <h3 style="font-size:14px;font-weight:700;margin-bottom:12px;color:#94a3b8;">Product Accounts</h3>
        ${productsHtml}
      </div>

      <div class="card">
        <h3 style="font-size:14px;font-weight:700;margin-bottom:12px;color:#94a3b8;">Scopes</h3>
        ${scopesHtml}
      </div>

      <div class="card">
        <h3 style="font-size:14px;font-weight:700;margin-bottom:12px;color:#94a3b8;">Devices</h3>
        ${devicesHtml}
      </div>

      <div class="card">
        <h3 style="font-size:14px;font-weight:700;margin-bottom:12px;color:#94a3b8;">Audit Log (Last 30)</h3>
        ${auditHtml}
      </div>
    `;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(layout(`User: ${user.name}`, content, 'users'));
  } catch (err: any) {
    res.status(500).send(layout('Error', `<div class="card" style="color:#fca5a5;">Error: ${escapeHtml(err.message)}</div>`));
  }
});

// ─── POST /admin/users/:id/freeze — Toggle freeze ───────────────

router.post('/users/:id/freeze', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = db.prepare("SELECT id, frozen FROM users WHERE id = ?").get(req.params.id) as any;
    if (!user) { res.redirect('/admin/users'); return; }

    const newFrozen = user.frozen ? 0 : 1;
    db.prepare("UPDATE users SET frozen = ? WHERE id = ?").run(newFrozen, user.id);

    res.redirect(`/admin/users/${user.id}`);
  } catch (err: any) {
    res.status(500).send(layout('Error', `<div class="card" style="color:#fca5a5;">Error: ${escapeHtml(err.message)}</div>`));
  }
});

// ─── POST /admin/users/:id/tier — Change tier ───────────────────

router.post('/users/:id/tier', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const tier = req.body.tier;
    if (!tier) { res.redirect(`/admin/users/${req.params.id}`); return; }

    const tierLimits: Record<string, number> = {
      free: 500 * 1024 * 1024,
      pro: 5 * 1024 * 1024 * 1024,
      translate: 10 * 1024 * 1024 * 1024,
      'translate-pro': 50 * 1024 * 1024 * 1024,
    };

    const newLimit = tierLimits[tier] || tierLimits.free;
    db.prepare("UPDATE users SET tier = ?, storage_limit = ? WHERE id = ?").run(tier, newLimit, req.params.id);

    res.redirect(`/admin/users/${req.params.id}`);
  } catch (err: any) {
    res.status(500).send(layout('Error', `<div class="card" style="color:#fca5a5;">Error: ${escapeHtml(err.message)}</div>`));
  }
});

// ─── GET /admin/oauth-clients — OAuth Client List ────────────────

router.get('/oauth-clients', (_req: Request, res: Response) => {
  try {
    const db = getDb();
    let clients: any[] = [];
    try {
      clients = db.prepare("SELECT * FROM oauth_clients ORDER BY created_at DESC").all() as any[];
    } catch { /* table may not exist */ }

    const rowsHtml = clients.map(c => {
      const redirectUris = JSON.parse(c.redirect_uris || '[]');
      return `<tr>
        <td style="font-weight:600;">${escapeHtml(c.name)}</td>
        <td><code style="font-size:11px;background:#0f172a;padding:2px 6px;border-radius:3px;">${escapeHtml(c.client_id)}</code></td>
        <td>${c.is_first_party ? '<span class="badge badge-green">Yes</span>' : '<span class="badge badge-gray">No</span>'}</td>
        <td>${c.is_public ? '<span class="badge badge-yellow">Public</span>' : '<span class="badge badge-blue">Confidential</span>'}</td>
        <td style="font-size:12px;">${redirectUris.map((u: string) => escapeHtml(u)).join('<br>')}</td>
        <td style="white-space:nowrap;">${formatDate(c.created_at)}</td>
      </tr>`;
    }).join('');

    const content = `
      <div class="card" style="overflow-x:auto;">
        <table>
          <tr><th>Name</th><th>Client ID</th><th>First Party</th><th>Type</th><th>Redirect URIs</th><th>Created</th></tr>
          ${rowsHtml || '<tr><td colspan="6" style="color:#64748b;">No OAuth clients registered</td></tr>'}
        </table>
      </div>
      <p style="font-size:13px;color:#64748b;margin-top:8px;">Register new clients via <code>POST /api/v1/oauth/clients</code> (admin JWT required).</p>
    `;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(layout('OAuth Clients', content, 'oauth-clients'));
  } catch (err: any) {
    res.status(500).send(layout('Error', `<div class="card" style="color:#fca5a5;">Error: ${escapeHtml(err.message)}</div>`));
  }
});

// ─── GET /admin/audit — Audit Log ────────────────────────────────

router.get('/audit', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const page = parseInt(req.query.page as string) || 1;
    const limit = 50;
    const offset = (page - 1) * limit;
    const eventFilter = (req.query.event as string) || '';
    const identityFilter = (req.query.identity_id as string) || '';
    const dateFrom = (req.query.date_from as string) || '';
    const dateTo = (req.query.date_to as string) || '';

    let where = 'WHERE 1=1';
    const params: any[] = [];

    if (eventFilter) { where += ' AND event = ?'; params.push(eventFilter); }
    if (identityFilter) { where += ' AND identity_id = ?'; params.push(identityFilter); }
    if (dateFrom) { where += ' AND created_at >= ?'; params.push(dateFrom); }
    if (dateTo) { where += " AND created_at <= ? || ' 23:59:59'"; params.push(dateTo); }

    let entries: any[] = [];
    let total = 0;

    try {
      total = (db.prepare(`SELECT COUNT(*) as c FROM identity_audit_log ${where}`).get(...params) as any).c;
      entries = db.prepare(`SELECT * FROM identity_audit_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
        .all(...params, limit, offset) as any[];
    } catch { /* table may not exist */ }

    // Get distinct event types for filter dropdown
    let eventTypes: string[] = [];
    try {
      eventTypes = (db.prepare("SELECT DISTINCT event FROM identity_audit_log ORDER BY event").all() as any[]).map(r => r.event);
    } catch {}

    const totalPages = Math.ceil(total / limit);

    const rowsHtml = entries.map(e => `<tr>
      <td style="white-space:nowrap;">${formatDate(e.created_at)}</td>
      <td><span class="badge badge-blue">${escapeHtml(e.event)}</span></td>
      <td>${e.identity_id ? `<a href="/admin/users/${escapeHtml(e.identity_id)}">${escapeHtml(e.identity_id.slice(0, 8))}...</a>` : '-'}</td>
      <td style="font-size:12px;">${escapeHtml(e.ip_address || '-')}</td>
      <td style="font-size:12px;max-width:200px;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(e.user_agent?.slice(0, 60) || '-')}</td>
      <td><pre>${escapeHtml(e.details?.slice(0, 200))}</pre></td>
    </tr>`).join('');

    const eventOptions = eventTypes.map(t => `<option value="${escapeHtml(t)}" ${eventFilter === t ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('');

    let paginationHtml = '';
    if (totalPages > 1) {
      const qp = new URLSearchParams();
      if (eventFilter) qp.set('event', eventFilter);
      if (identityFilter) qp.set('identity_id', identityFilter);
      if (dateFrom) qp.set('date_from', dateFrom);
      if (dateTo) qp.set('date_to', dateTo);
      const qs = qp.toString() ? `&${qp.toString()}` : '';

      paginationHtml = `<div class="pagination">`;
      if (page > 1) paginationHtml += `<a href="/admin/audit?page=${page - 1}${qs}">Prev</a>`;
      paginationHtml += `<span style="color:#94a3b8;">Page ${page} of ${totalPages} (${total} total)</span>`;
      if (page < totalPages) paginationHtml += `<a href="/admin/audit?page=${page + 1}${qs}">Next</a>`;
      paginationHtml += `</div>`;
    }

    const content = `
      <form method="GET" action="/admin/audit" style="margin-bottom:16px;display:flex;gap:8px;flex-wrap:wrap;align-items:end;">
        <div>
          <label style="font-size:11px;color:#94a3b8;display:block;margin-bottom:2px;">Event Type</label>
          <select name="event"><option value="">All Events</option>${eventOptions}</select>
        </div>
        <div>
          <label style="font-size:11px;color:#94a3b8;display:block;margin-bottom:2px;">Identity ID</label>
          <input type="text" name="identity_id" value="${escapeHtml(identityFilter)}" placeholder="Identity ID...">
        </div>
        <div>
          <label style="font-size:11px;color:#94a3b8;display:block;margin-bottom:2px;">From</label>
          <input type="text" name="date_from" value="${escapeHtml(dateFrom)}" placeholder="YYYY-MM-DD">
        </div>
        <div>
          <label style="font-size:11px;color:#94a3b8;display:block;margin-bottom:2px;">To</label>
          <input type="text" name="date_to" value="${escapeHtml(dateTo)}" placeholder="YYYY-MM-DD">
        </div>
        <button type="submit" class="btn btn-primary">Filter</button>
        <a href="/admin/audit" class="btn" style="background:#334155;color:#e2e8f0;">Clear</a>
      </form>

      <div class="card" style="overflow-x:auto;">
        <table>
          <tr><th>Time</th><th>Event</th><th>Identity</th><th>IP</th><th>User Agent</th><th>Details</th></tr>
          ${rowsHtml || '<tr><td colspan="6" style="color:#64748b;">No audit entries</td></tr>'}
        </table>
        ${paginationHtml}
      </div>
    `;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(layout('Audit Log', content, 'audit'));
  } catch (err: any) {
    res.status(500).send(layout('Error', `<div class="card" style="color:#fca5a5;">Error: ${escapeHtml(err.message)}</div>`));
  }
});

// ─── GET /admin/bots — Bot Registry ──────────────────────────────

router.get('/bots', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const page = parseInt(req.query.page as string) || 1;
    const limit = 30;
    const offset = (page - 1) * limit;

    const total = (db.prepare("SELECT COUNT(*) as c FROM users WHERE identity_type = 'bot'").get() as any).c;

    const bots = db.prepare(`
      SELECT u.id, u.name, u.email, u.display_name, u.passport_id, u.frozen, u.created_at,
             ep.passport_number, ep.status as passport_status, ep.trust_score,
             ep.operator_identity_id, ep.registered_at
      FROM users u
      LEFT JOIN eternitas_passports ep ON ep.identity_id = u.id
      WHERE u.identity_type = 'bot'
      ORDER BY u.created_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset) as any[];

    const totalPages = Math.ceil(total / limit);

    const rowsHtml = bots.map(b => {
      const statusBadge = b.passport_status === 'active'
        ? '<span class="badge badge-green">active</span>'
        : b.passport_status === 'suspended'
        ? '<span class="badge badge-yellow">suspended</span>'
        : b.passport_status === 'revoked'
        ? '<span class="badge badge-red">revoked</span>'
        : '<span class="badge badge-gray">unknown</span>';
      const frozenBadge = b.frozen ? ' <span class="badge badge-red">FROZEN</span>' : '';

      return `<tr>
        <td><a href="/admin/users/${escapeHtml(b.id)}">${escapeHtml(b.name)}</a></td>
        <td>${b.operator_identity_id ? `<a href="/admin/users/${escapeHtml(b.operator_identity_id)}">${escapeHtml(b.operator_identity_id.slice(0, 8))}...</a>` : '-'}</td>
        <td><code style="font-size:12px;">${escapeHtml(b.passport_number || b.passport_id || '-')}</code></td>
        <td>${statusBadge}${frozenBadge}</td>
        <td>${b.trust_score !== null && b.trust_score !== undefined ? b.trust_score.toFixed(2) : '-'}</td>
        <td style="white-space:nowrap;">${formatDate(b.registered_at || b.created_at)}</td>
      </tr>`;
    }).join('');

    let paginationHtml = '';
    if (totalPages > 1) {
      paginationHtml = `<div class="pagination">`;
      if (page > 1) paginationHtml += `<a href="/admin/bots?page=${page - 1}">Prev</a>`;
      paginationHtml += `<span style="color:#94a3b8;">Page ${page} of ${totalPages} (${total} total)</span>`;
      if (page < totalPages) paginationHtml += `<a href="/admin/bots?page=${page + 1}">Next</a>`;
      paginationHtml += `</div>`;
    }

    const content = `
      <div class="card" style="overflow-x:auto;">
        <table>
          <tr><th>Name</th><th>Owner</th><th>Passport</th><th>Status</th><th>Trust Score</th><th>Hatched</th></tr>
          ${rowsHtml || '<tr><td colspan="6" style="color:#64748b;">No bots registered</td></tr>'}
        </table>
        ${paginationHtml}
      </div>
    `;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(layout('Bot Registry', content, 'bots'));
  } catch (err: any) {
    res.status(500).send(layout('Error', `<div class="card" style="color:#fca5a5;">Error: ${escapeHtml(err.message)}</div>`));
  }
});

export default router;
