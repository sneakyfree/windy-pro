/**
 * Windy Pro Cloud Storage API
 * 
 * Enterprise-grade distributed file storage for Windy Pro users.
 * Runs on each storage node. A central orchestrator (or this node in standalone mode)
 * handles routing, user management, and admin operations.
 * 
 * Architecture:
 *   Client → API Gateway (this) → Storage Node(s)
 *   Admin Dashboard → API Gateway → All operations
 */

const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const app = express();
app.use(cors());
app.use(express.json());

// ── Config ──────────────────────────────────────────────────────
const PORT = process.env.PORT || 8099;
const DATA_ROOT = process.env.DATA_ROOT || path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_ROOT, '_db');
const UPLOADS_PATH = path.join(DATA_ROOT, 'uploads');
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'windypro-admin-2026';
const NODE_ID = process.env.NODE_ID || 'node-01';
const NODE_NAME = process.env.NODE_NAME || 'Unknown Node';
const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB per file

// Ensure directories
[DATA_ROOT, DB_PATH, UPLOADS_PATH].forEach(d => fs.mkdirSync(d, { recursive: true }));

// ── Simple JSON DB ──────────────────────────────────────────────
class JsonDB {
  constructor(name) {
    this.path = path.join(DB_PATH, `${name}.json`);
    this.data = fs.existsSync(this.path) ? JSON.parse(fs.readFileSync(this.path, 'utf-8')) : {};
  }
  get(key) { return this.data[key]; }
  set(key, val) { this.data[key] = val; this._save(); }
  delete(key) { delete this.data[key]; this._save(); }
  all() { return { ...this.data }; }
  find(fn) { return Object.values(this.data).filter(fn); }
  _save() { fs.writeFileSync(this.path, JSON.stringify(this.data, null, 2)); }
}

const usersDB = new JsonDB('users');
const filesDB = new JsonDB('files');
const nodesDB = new JsonDB('nodes');
const auditDB = new JsonDB('audit');
const transactionsDB = new JsonDB('transactions');
const couponsDB = new JsonDB('coupons');

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';

// Register self as a node
nodesDB.set(NODE_ID, {
  id: NODE_ID,
  name: NODE_NAME,
  url: `http://localhost:${PORT}`,
  status: 'online',
  registeredAt: new Date().toISOString(),
  lastHeartbeat: new Date().toISOString()
});

// ── Multer for file uploads ─────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const userId = req.user?.id || 'anonymous';
    const userDir = path.join(UPLOADS_PATH, userId);
    fs.mkdirSync(userDir, { recursive: true });
    cb(null, userDir);
  },
  filename: (req, file, cb) => {
    const date = new Date().toISOString().slice(0, 10);
    const ext = path.extname(file.originalname);
    const name = `${date}_${uuidv4().slice(0, 8)}${ext}`;
    cb(null, name);
  }
});
const upload = multer({ storage, limits: { fileSize: MAX_FILE_SIZE } });

// ── Auth Middleware ──────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = usersDB.get(decoded.id);
    if (!user) return res.status(401).json({ error: 'User not found' });
    if (user.frozen) return res.status(403).json({ error: 'Account frozen' });
    req.user = user;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function adminMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = usersDB.get(decoded.id);
    if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    req.user = user;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function audit(action, userId, details = {}) {
  const id = uuidv4();
  auditDB.set(id, {
    id, action, userId,
    timestamp: new Date().toISOString(),
    ...details
  });
}

// ── Public Routes ───────────────────────────────────────────────

// Health check
app.get('/health', (req, res) => {
  const diskInfo = getDiskInfo();
  res.json({
    status: 'ok',
    nodeId: NODE_ID,
    nodeName: NODE_NAME,
    version: '1.0.0',
    uptime: process.uptime(),
    disk: diskInfo,
    timestamp: new Date().toISOString()
  });
});

// Register new user (from Windy Pro client)
app.post('/auth/register', async (req, res) => {
  const { email, password, deviceId } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  // Check if user exists
  const existing = Object.values(usersDB.all()).find(u => u.email === email);
  if (existing) return res.status(409).json({ error: 'Email already registered' });

  const id = uuidv4();
  const hashedPassword = await bcrypt.hash(password, 10);
  const user = {
    id,
    email,
    password: hashedPassword,
    role: 'user',
    tier: 'free',
    frozen: false,
    storageUsed: 0,
    storageLimit: 500 * 1024 * 1024, // 500MB free tier
    assignedNode: NODE_ID,
    deviceId: deviceId || null,
    createdAt: new Date().toISOString(),
    lastUpload: null,
    lastActive: new Date().toISOString()
  };

  usersDB.set(id, user);
  audit('user.register', id, { email });

  const token = jwt.sign({ id, email, role: 'user' }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ ok: true, token, userId: id });
});

// Login
app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const user = Object.values(usersDB.all()).find(u => u.email === email);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  if (user.frozen) return res.status(403).json({ error: 'Account frozen' });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  user.lastActive = new Date().toISOString();
  usersDB.set(user.id, user);

  const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
  audit('user.login', user.id, { email });
  res.json({ ok: true, token, userId: user.id, tier: user.tier });
});

// ── User File Routes ────────────────────────────────────────────

// Upload file
app.post('/files/upload', authMiddleware, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' });

  const fileId = uuidv4();
  const fileSize = req.file.size;
  const user = req.user;

  // Check storage limit
  if (user.storageUsed + fileSize > user.storageLimit) {
    // Remove the uploaded file
    try { fs.unlinkSync(req.file.path); } catch (_) { }
    return res.status(413).json({
      error: 'Storage limit exceeded',
      used: user.storageUsed,
      limit: user.storageLimit,
      fileSize
    });
  }

  const fileMeta = {
    id: fileId,
    userId: user.id,
    originalName: req.file.originalname,
    storedName: req.file.filename,
    mimeType: req.file.mimetype,
    size: fileSize,
    nodeId: NODE_ID,
    path: req.file.path,
    type: req.body.type || 'transcript', // transcript, audio, video
    sessionDate: req.body.sessionDate || new Date().toISOString().slice(0, 10),
    metadata: req.body.metadata ? JSON.parse(req.body.metadata) : {},
    uploadedAt: new Date().toISOString()
  };

  filesDB.set(fileId, fileMeta);

  // Update user storage
  user.storageUsed += fileSize;
  user.lastUpload = new Date().toISOString();
  user.lastActive = new Date().toISOString();
  usersDB.set(user.id, user);

  audit('file.upload', user.id, { fileId, size: fileSize, name: req.file.originalname });

  res.json({
    ok: true,
    fileId,
    size: fileSize,
    storageUsed: user.storageUsed,
    storageLimit: user.storageLimit
  });
});

// List user's files
app.get('/files', authMiddleware, (req, res) => {
  const userFiles = filesDB.find(f => f.userId === req.user.id);
  // Sort by upload date, newest first
  userFiles.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

  const files = userFiles.map(f => ({
    id: f.id,
    name: f.originalName,
    type: f.type,
    size: f.size,
    sessionDate: f.sessionDate,
    uploadedAt: f.uploadedAt,
    metadata: f.metadata
  }));

  res.json({
    ok: true,
    files,
    storageUsed: req.user.storageUsed,
    storageLimit: req.user.storageLimit
  });
});

// Download file
app.get('/files/:fileId', authMiddleware, (req, res) => {
  const file = filesDB.get(req.params.fileId);
  if (!file) return res.status(404).json({ error: 'File not found' });
  if (file.userId !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied' });
  }

  if (!fs.existsSync(file.path)) {
    return res.status(404).json({ error: 'File not found on disk' });
  }

  audit('file.download', req.user.id, { fileId: file.id });
  res.download(file.path, file.originalName);
});

// Delete file
app.delete('/files/:fileId', authMiddleware, (req, res) => {
  const file = filesDB.get(req.params.fileId);
  if (!file) return res.status(404).json({ error: 'File not found' });
  if (file.userId !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied' });
  }

  // Remove from disk
  try { fs.unlinkSync(file.path); } catch (_) { }

  // Update user storage
  const user = usersDB.get(file.userId);
  if (user) {
    user.storageUsed = Math.max(0, user.storageUsed - file.size);
    usersDB.set(user.id, user);
  }

  filesDB.delete(file.id);
  audit('file.delete', req.user.id, { fileId: file.id, name: file.originalName });

  res.json({ ok: true });
});

// ── Admin Routes ────────────────────────────────────────────────

// Admin login (separate from user login — uses admin secret for bootstrap)
app.post('/admin/bootstrap', async (req, res) => {
  const { secret, email, password } = req.body;
  if (secret !== ADMIN_SECRET) return res.status(403).json({ error: 'Invalid admin secret' });

  // Create or update admin user
  let admin = Object.values(usersDB.all()).find(u => u.email === email && u.role === 'admin');
  if (!admin) {
    const id = uuidv4();
    admin = {
      id, email,
      password: await bcrypt.hash(password, 10),
      role: 'admin',
      tier: 'admin',
      frozen: false,
      storageUsed: 0,
      storageLimit: -1, // unlimited
      assignedNode: NODE_ID,
      createdAt: new Date().toISOString(),
      lastActive: new Date().toISOString()
    };
    usersDB.set(id, admin);
    audit('admin.bootstrap', id, { email });
  }

  const token = jwt.sign({ id: admin.id, email: admin.email, role: 'admin' }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ ok: true, token, userId: admin.id });
});

// List all users
app.get('/admin/users', adminMiddleware, (req, res) => {
  const users = Object.values(usersDB.all()).map(u => ({
    id: u.id,
    email: u.email,
    role: u.role,
    tier: u.tier,
    frozen: u.frozen,
    storageUsed: u.storageUsed,
    storageLimit: u.storageLimit,
    assignedNode: u.assignedNode,
    fileCount: filesDB.find(f => f.userId === u.id).length,
    createdAt: u.createdAt,
    lastActive: u.lastActive,
    lastUpload: u.lastUpload
  }));
  res.json({ ok: true, users });
});

// User search (must be before parametric :userId route)
app.get('/admin/users/search', adminMiddleware, (req, res) => {
  const q = (req.query.q || '').toLowerCase().trim();
  if (!q) return res.json({ ok: true, users: [] });

  const users = Object.values(usersDB.all())
    .filter(u => u.email?.toLowerCase().includes(q))
    .map(u => ({
      id: u.id, email: u.email, role: u.role, tier: u.tier, frozen: u.frozen,
      storageUsed: u.storageUsed, storageLimit: u.storageLimit,
      assignedNode: u.assignedNode,
      fileCount: filesDB.find(f => f.userId === u.id).length,
      createdAt: u.createdAt, lastActive: u.lastActive, lastUpload: u.lastUpload
    }));

  res.json({ ok: true, users });
});

// Get single user detail
app.get('/admin/users/:userId', adminMiddleware, (req, res) => {
  const user = usersDB.get(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const files = filesDB.find(f => f.userId === user.id);
  const { password, ...safeUser } = user;
  res.json({ ok: true, user: safeUser, files });
});

// Freeze/unfreeze user
app.post('/admin/users/:userId/freeze', adminMiddleware, (req, res) => {
  const user = usersDB.get(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  user.frozen = req.body.frozen !== false;
  usersDB.set(user.id, user);
  audit('admin.freeze', req.user.id, { targetUser: user.id, frozen: user.frozen });
  res.json({ ok: true, frozen: user.frozen });
});

// Delete user and all their data
app.delete('/admin/users/:userId', adminMiddleware, (req, res) => {
  const user = usersDB.get(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  // Delete all user files
  const files = filesDB.find(f => f.userId === user.id);
  files.forEach(f => {
    try { fs.unlinkSync(f.path); } catch (_) { }
    filesDB.delete(f.id);
  });

  // Remove user upload directory
  const userDir = path.join(UPLOADS_PATH, user.id);
  try { fs.rmSync(userDir, { recursive: true }); } catch (_) { }

  usersDB.delete(user.id);
  audit('admin.deleteUser', req.user.id, { targetUser: user.id, email: user.email, filesDeleted: files.length });
  res.json({ ok: true, filesDeleted: files.length });
});

// Change user tier / storage limit
app.post('/admin/users/:userId/tier', adminMiddleware, (req, res) => {
  const user = usersDB.get(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const tierLimits = {
    free: 500 * 1024 * 1024,        // 500MB
    pro: 5 * 1024 * 1024 * 1024,    // 5GB
    translate: 10 * 1024 * 1024 * 1024, // 10GB
    'translate-pro': 50 * 1024 * 1024 * 1024, // 50GB
    unlimited: -1
  };

  if (req.body.tier) {
    user.tier = req.body.tier;
    user.storageLimit = tierLimits[req.body.tier] || tierLimits.free;
  }
  if (req.body.storageLimit !== undefined) {
    user.storageLimit = req.body.storageLimit;
  }

  usersDB.set(user.id, user);
  audit('admin.changeTier', req.user.id, { targetUser: user.id, tier: user.tier, storageLimit: user.storageLimit });
  res.json({ ok: true, tier: user.tier, storageLimit: user.storageLimit });
});

// Reassign user to different storage node
app.post('/admin/users/:userId/reassign', adminMiddleware, (req, res) => {
  const user = usersDB.get(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const { nodeId } = req.body;
  if (!nodeId) return res.status(400).json({ error: 'nodeId required' });

  const oldNode = user.assignedNode;
  user.assignedNode = nodeId;
  usersDB.set(user.id, user);
  audit('admin.reassign', req.user.id, { targetUser: user.id, from: oldNode, to: nodeId });
  res.json({ ok: true, oldNode, newNode: nodeId });
});

// ── Storage Node Management ─────────────────────────────────────

// List all nodes
app.get('/admin/nodes', adminMiddleware, (req, res) => {
  const nodes = Object.values(nodesDB.all());
  res.json({ ok: true, nodes });
});

// Register/update a storage node
app.post('/admin/nodes', adminMiddleware, (req, res) => {
  const { id, name, url } = req.body;
  if (!id || !name || !url) return res.status(400).json({ error: 'id, name, url required' });

  nodesDB.set(id, {
    id, name, url,
    status: 'online',
    registeredAt: nodesDB.get(id)?.registeredAt || new Date().toISOString(),
    lastHeartbeat: new Date().toISOString()
  });
  audit('admin.registerNode', req.user.id, { nodeId: id, name });
  res.json({ ok: true });
});

// Remove a node
app.delete('/admin/nodes/:nodeId', adminMiddleware, (req, res) => {
  nodesDB.delete(req.params.nodeId);
  audit('admin.removeNode', req.user.id, { nodeId: req.params.nodeId });
  res.json({ ok: true });
});

// ── Storage Overview ────────────────────────────────────────────

app.get('/admin/overview', adminMiddleware, (req, res) => {
  const users = Object.values(usersDB.all());
  const files = Object.values(filesDB.all());
  const nodes = Object.values(nodesDB.all());

  const totalStorage = files.reduce((sum, f) => sum + f.size, 0);
  const byType = {};
  files.forEach(f => {
    byType[f.type] = (byType[f.type] || 0) + f.size;
  });

  const byNode = {};
  files.forEach(f => {
    byNode[f.nodeId] = (byNode[f.nodeId] || 0) + f.size;
  });

  const tierCounts = {};
  users.forEach(u => {
    tierCounts[u.tier] = (tierCounts[u.tier] || 0) + 1;
  });

  res.json({
    ok: true,
    summary: {
      totalUsers: users.filter(u => u.role !== 'admin').length,
      totalFiles: files.length,
      totalStorage,
      totalStorageHuman: formatBytes(totalStorage),
      storageByType: byType,
      storageByNode: byNode,
      usersByTier: tierCounts,
      activeNodes: nodes.filter(n => n.status === 'online').length,
      totalNodes: nodes.length
    },
    disk: getDiskInfo()
  });
});

// Audit log
app.get('/admin/audit', adminMiddleware, (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const entries = Object.values(auditDB.all())
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, limit);
  res.json({ ok: true, entries });
});

// ── Stripe Webhook ──────────────────────────────────────────────

// We need raw body for Stripe signature verification
app.post('/stripe/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  let event;
  try {
    if (STRIPE_WEBHOOK_SECRET) {
      const sig = req.headers['stripe-signature'];
      // Manual HMAC verification (no stripe SDK dependency)
      const payload = req.body.toString ? req.body.toString() : JSON.stringify(req.body);
      const ts = sig?.split(',').find(s => s.startsWith('t='))?.split('=')[1];
      const v1 = sig?.split(',').find(s => s.startsWith('v1='))?.split('=')[1];
      if (ts && v1) {
        const expected = crypto.createHmac('sha256', STRIPE_WEBHOOK_SECRET)
          .update(`${ts}.${payload}`).digest('hex');
        if (expected !== v1) return res.status(400).json({ error: 'Invalid signature' });
      }
      event = JSON.parse(payload);
    } else {
      event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    }
  } catch (e) {
    return res.status(400).json({ error: 'Webhook parse error: ' + e.message });
  }

  const type = event.type;
  const data = event.data?.object || {};

  const tierByAmount = { 4900: 'pro', 799: 'translate', 7900: 'translate', 14900: 'translate-pro' };

  try {
    if (type === 'payment_intent.succeeded' || type === 'invoice.paid') {
      const email = data.receipt_email || data.customer_email || data.billing_details?.email;
      const user = email ? Object.values(usersDB.all()).find(u => u.email === email) : null;
      const txId = uuidv4();
      transactionsDB.set(txId, {
        id: txId, userId: user?.id || null, email: email || '',
        amount: data.amount || data.amount_paid || 0, currency: data.currency || 'usd',
        type: type === 'invoice.paid' ? 'subscription' : 'one_time',
        status: 'paid', stripePaymentId: data.id || '',
        createdAt: new Date().toISOString()
      });
      if (user && data.amount) {
        const newTier = tierByAmount[data.amount];
        if (newTier) {
          const tierLimits = { free: 500 * 1024 * 1024, pro: 5 * 1024 * 1024 * 1024, translate: 10 * 1024 * 1024 * 1024, 'translate-pro': 50 * 1024 * 1024 * 1024, unlimited: -1 };
          user.tier = newTier;
          user.storageLimit = tierLimits[newTier] || tierLimits.free;
          usersDB.set(user.id, user);
          audit('billing.tierUpgrade', user.id, { tier: newTier, amount: data.amount });
        }
      }
      audit('billing.payment', user?.id || 'unknown', { type, amount: data.amount, txId });
    } else if (type === 'customer.subscription.deleted') {
      const email = data.customer_email || '';
      const user = email ? Object.values(usersDB.all()).find(u => u.email === email) : null;
      if (user) {
        user.tier = 'free';
        user.storageLimit = 500 * 1024 * 1024;
        usersDB.set(user.id, user);
        audit('billing.subscriptionCancelled', user.id, { email });
      }
    } else if (type === 'charge.refunded') {
      const pid = data.payment_intent;
      const tx = Object.values(transactionsDB.all()).find(t => t.stripePaymentId === pid);
      if (tx) { tx.status = 'refunded'; transactionsDB.set(tx.id, tx); }
      const user = tx?.userId ? usersDB.get(tx.userId) : null;
      if (user) {
        user.tier = 'free'; user.storageLimit = 500 * 1024 * 1024;
        usersDB.set(user.id, user);
        audit('billing.refund', user.id, { amount: data.amount_refunded });
      }
    } else if (type === 'invoice.payment_failed') {
      const email = data.customer_email || '';
      const user = email ? Object.values(usersDB.all()).find(u => u.email === email) : null;
      const txId = uuidv4();
      transactionsDB.set(txId, {
        id: txId, userId: user?.id || null, email,
        amount: data.amount_due || 0, currency: data.currency || 'usd',
        type: 'subscription', status: 'failed', stripePaymentId: data.id || '',
        createdAt: new Date().toISOString()
      });
      if (user) { user.paymentFailed = true; usersDB.set(user.id, user); }
      audit('billing.paymentFailed', user?.id || 'unknown', { email, amount: data.amount_due });
    }
  } catch (e) {
    console.error('Webhook processing error:', e);
  }

  res.json({ received: true });
});

// ── Billing Endpoints ───────────────────────────────────────────

app.get('/admin/billing/transactions', adminMiddleware, (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;
  let txs = Object.values(transactionsDB.all());

  if (req.query.userId) txs = txs.filter(t => t.userId === req.query.userId);
  if (req.query.status) txs = txs.filter(t => t.status === req.query.status);

  txs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const total = txs.length;
  const transactions = txs.slice(offset, offset + limit);

  res.json({ ok: true, transactions, total, limit, offset });
});

app.get('/admin/billing/summary', adminMiddleware, (req, res) => {
  const txs = Object.values(transactionsDB.all());
  const now = new Date();
  const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);

  const paidTxs = txs.filter(t => t.status === 'paid');
  const totalRevenue = paidTxs.reduce((s, t) => s + (t.amount || 0), 0);
  const activeSubs = txs.filter(t => t.type === 'subscription' && t.status === 'paid');
  const mrr = activeSubs.reduce((s, t) => s + (t.amount || 0), 0);
  const cancelledRecent = txs.filter(t => t.status === 'refunded' && new Date(t.createdAt) > thirtyDaysAgo).length;
  const totalSubsEver = txs.filter(t => t.type === 'subscription').length;
  const churnRate = totalSubsEver > 0 ? ((cancelledRecent / totalSubsEver) * 100) : 0;
  const failedPayments = txs.filter(t => t.status === 'failed').length;
  const newCustomers = txs.filter(t => t.status === 'paid' && new Date(t.createdAt) > thirtyDaysAgo).length;

  // Revenue by month (last 6 months)
  const revenueByMonth = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const month = d.toISOString().slice(0, 7);
    const amount = paidTxs
      .filter(t => (t.createdAt || '').startsWith(month))
      .reduce((s, t) => s + (t.amount || 0), 0);
    revenueByMonth.push({ month, amount });
  }

  res.json({
    ok: true, mrr, totalRevenue, activeSubscriptions: activeSubs.length,
    churnRate: parseFloat(churnRate.toFixed(1)), failedPayments,
    newCustomersThisMonth: newCustomers, revenueByMonth
  });
});

app.post('/admin/billing/refund', adminMiddleware, async (req, res) => {
  const { transactionId } = req.body;
  if (!transactionId) return res.status(400).json({ error: 'transactionId required' });

  const tx = transactionsDB.get(transactionId);
  if (!tx) return res.status(404).json({ error: 'Transaction not found' });

  tx.status = 'refunded';
  tx.refundedAt = new Date().toISOString();
  transactionsDB.set(tx.id, tx);

  // Downgrade user
  if (tx.userId) {
    const user = usersDB.get(tx.userId);
    if (user) {
      user.tier = 'free';
      user.storageLimit = 500 * 1024 * 1024;
      usersDB.set(user.id, user);
    }
  }

  // Call Stripe refund API if key is set
  if (STRIPE_SECRET_KEY && tx.stripePaymentId) {
    try {
      const postData = `payment_intent=${tx.stripePaymentId}`;
      await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: 'api.stripe.com', path: '/v1/refunds', method: 'POST',
          headers: {
            'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(postData)
          }
        }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => resolve(d)); });
        req.on('error', reject);
        req.write(postData);
        req.end();
      });
    } catch (e) { console.error('Stripe refund API error:', e.message); }
  }

  audit('admin.refund', req.user.id, { transactionId: tx.id, amount: tx.amount, userId: tx.userId });
  res.json({ ok: true, transaction: tx });
});

// ── Coupons ─────────────────────────────────────────────────────

app.post('/admin/billing/coupons', adminMiddleware, (req, res) => {
  const { code, discountPercent, maxUses, expiresAt } = req.body;
  if (!code || !discountPercent) return res.status(400).json({ error: 'code and discountPercent required' });

  couponsDB.set(code, {
    code, discountPercent, maxUses: maxUses || 999,
    expiresAt: expiresAt || null, usageCount: 0,
    active: true, createdAt: new Date().toISOString()
  });
  audit('admin.createCoupon', req.user.id, { code, discountPercent });
  res.json({ ok: true });
});

app.get('/admin/billing/coupons', adminMiddleware, (req, res) => {
  const coupons = Object.values(couponsDB.all());
  res.json({ ok: true, coupons });
});

app.post('/admin/billing/coupons/:code/disable', adminMiddleware, (req, res) => {
  const coupon = couponsDB.get(req.params.code);
  if (!coupon) return res.status(404).json({ error: 'Coupon not found' });
  coupon.active = false;
  couponsDB.set(coupon.code, coupon);
  audit('admin.disableCoupon', req.user.id, { code: coupon.code });
  res.json({ ok: true });
});

// ── Node Health Aggregation ─────────────────────────────────────

function pingNodeHealth(nodeUrl) {
  return new Promise(resolve => {
    const start = Date.now();
    try {
      const parsed = new URL(nodeUrl + '/health');
      const mod = parsed.protocol === 'https:' ? https : http;
      const req = mod.get(parsed.href, { timeout: 5000 }, r => {
        let data = '';
        r.on('data', c => data += c);
        r.on('end', () => {
          try {
            const h = JSON.parse(data);
            resolve({ ...h, latencyMs: Date.now() - start, status: h.status || 'ok', error: null });
          } catch (e) { resolve({ status: 'error', latencyMs: Date.now() - start, error: 'Invalid JSON' }); }
        });
      });
      req.on('error', e => resolve({ status: 'offline', latencyMs: Date.now() - start, error: e.message }));
      req.on('timeout', () => { req.destroy(); resolve({ status: 'offline', latencyMs: 5000, error: 'Timeout' }); });
    } catch (e) { resolve({ status: 'offline', latencyMs: 0, error: e.message }); }
  });
}

app.get('/admin/nodes/health', adminMiddleware, async (req, res) => {
  const nodes = Object.values(nodesDB.all());
  const results = await Promise.all(nodes.map(async n => {
    if (!n.url) return { nodeId: n.id, name: n.name, url: n.url, status: 'offline', error: 'No URL configured' };
    const h = await pingNodeHealth(n.url);
    return {
      nodeId: n.id, name: n.name, url: n.url,
      status: h.status, latencyMs: h.latencyMs,
      disk: h.disk || {}, uptime: h.uptime || 0,
      lastChecked: new Date().toISOString(), error: h.error
    };
  }));
  res.json({ ok: true, nodes: results });
});

// ── File Migration ──────────────────────────────────────────────

app.post('/admin/migrate', adminMiddleware, (req, res) => {
  const { userId, fromNodeId, toNodeId, scope } = req.body;
  if (!toNodeId) return res.status(400).json({ error: 'toNodeId required' });

  let migrated = [];

  if (scope === 'all' && fromNodeId) {
    // Migrate all users from one node to another
    const users = Object.values(usersDB.all()).filter(u => u.assignedNode === fromNodeId);
    users.forEach(u => {
      const old = u.assignedNode;
      u.assignedNode = toNodeId;
      usersDB.set(u.id, u);
      migrated.push(u.id);
      audit('admin.migrate', req.user.id, { targetUser: u.id, from: old, to: toNodeId });
    });
  } else if (userId) {
    const user = usersDB.get(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const old = user.assignedNode;
    user.assignedNode = toNodeId;
    usersDB.set(user.id, user);
    migrated.push(user.id);
    audit('admin.migrate', req.user.id, { targetUser: user.id, from: old, to: toNodeId });
  } else {
    return res.status(400).json({ error: 'userId or scope:"all" with fromNodeId required' });
  }

  res.json({ ok: true, migrated: migrated.length, users: migrated });
});

// ── System Alerts ───────────────────────────────────────────────

app.get('/admin/alerts', adminMiddleware, async (req, res) => {
  const alerts = [];
  const now = new Date();
  const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);

  // Node disk alerts
  const nodes = Object.values(nodesDB.all());
  for (const n of nodes) {
    if (!n.url) continue;
    try {
      const h = await pingNodeHealth(n.url);
      const pct = h.disk?.usedPercent || 0;
      if (pct >= 90) {
        alerts.push({
          id: `disk-crit-${n.id}`, type: 'disk', severity: 'critical',
          message: `Node ${n.name || n.id} at ${pct}% disk usage — CRITICAL`, nodeId: n.id, timestamp: now.toISOString()
        });
      } else if (pct >= 80) {
        alerts.push({
          id: `disk-warn-${n.id}`, type: 'disk', severity: 'warning',
          message: `Node ${n.name || n.id} at ${pct}% disk usage`, nodeId: n.id, timestamp: now.toISOString()
        });
      }
      if (h.status === 'offline') {
        alerts.push({
          id: `offline-${n.id}`, type: 'node', severity: 'critical',
          message: `Node ${n.name || n.id} is offline`, nodeId: n.id, timestamp: now.toISOString()
        });
      }
    } catch (_) { }
  }

  // User quota alerts
  Object.values(usersDB.all()).forEach(u => {
    if (u.storageLimit > 0 && u.storageUsed > 0) {
      const pct = Math.round((u.storageUsed / u.storageLimit) * 100);
      if (pct >= 90) {
        alerts.push({
          id: `quota-${u.id}`, type: 'quota', severity: 'warning',
          message: `User ${u.email} at ${pct}% storage quota`, userId: u.id, timestamp: now.toISOString()
        });
      }
    }
  });

  // Audit-based alerts (last 24h)
  const recentAudit = Object.values(auditDB.all()).filter(e => new Date(e.timestamp) > oneDayAgo);

  // Failed uploads
  recentAudit.filter(e => e.action === 'file.upload' && e.error).forEach(e => {
    alerts.push({
      id: `upload-fail-${e.id}`, type: 'upload', severity: 'warning',
      message: `Failed upload for user ${e.userId}`, userId: e.userId, timestamp: e.timestamp
    });
  });

  // New registrations
  recentAudit.filter(e => e.action === 'user.register').forEach(e => {
    alerts.push({
      id: `reg-${e.id}`, type: 'registration', severity: 'info',
      message: `New user registered: ${e.email || e.userId}`, userId: e.userId, timestamp: e.timestamp
    });
  });

  res.json({ ok: true, alerts });
});

// ── Reports ─────────────────────────────────────────────────────

app.get('/admin/reports/summary', adminMiddleware, async (req, res) => {
  const users = Object.values(usersDB.all()).filter(u => u.role !== 'admin');
  const files = Object.values(filesDB.all());
  const nodes = Object.values(nodesDB.all());
  const txs = Object.values(transactionsDB.all());
  const now = new Date();
  const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

  const tierCounts = {};
  users.forEach(u => { tierCounts[u.tier] = (tierCounts[u.tier] || 0) + 1; });

  const totalUsed = files.reduce((s, f) => s + f.size, 0);
  const byType = {};
  files.forEach(f => { byType[f.type] = (byType[f.type] || 0) + f.size; });

  // Storage by node (from files)
  const byNodeMap = {};
  files.forEach(f => { byNodeMap[f.nodeId] = (byNodeMap[f.nodeId] || 0) + f.size; });
  const storageByNode = nodes.map(n => ({
    nodeId: n.id, name: n.name,
    used: byNodeMap[n.id] || 0, capacity: 0, // real capacity comes from health ping
    percent: 0
  }));

  // Ping nodes for capacity
  for (const sn of storageByNode) {
    const node = nodes.find(n => n.id === sn.nodeId);
    if (node?.url) {
      try {
        const h = await pingNodeHealth(node.url);
        sn.capacity = h.disk?.total || 0;
        sn.percent = h.disk?.usedPercent || 0;
      } catch (_) { }
    }
  }

  const paidTxs = txs.filter(t => t.status === 'paid');
  const mrr = paidTxs.filter(t => t.type === 'subscription').reduce((s, t) => s + (t.amount || 0), 0);
  const totalRevenue = paidTxs.reduce((s, t) => s + (t.amount || 0), 0);
  const activeSubs = paidTxs.filter(t => t.type === 'subscription').length;

  const onlineNodes = [];
  const offlineNodes = [];
  for (const n of nodes) {
    if (n.url) {
      const h = await pingNodeHealth(n.url);
      (h.status === 'offline' ? offlineNodes : onlineNodes).push(n.id);
    } else { offlineNodes.push(n.id); }
  }

  const recentActivity = Object.values(auditDB.all())
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 20);

  res.json({
    ok: true,
    generatedAt: now.toISOString(), period: 'current',
    users: {
      total: users.length, byTier: tierCounts,
      newLast30d: users.filter(u => new Date(u.createdAt) > thirtyDaysAgo).length,
      activeLast7d: users.filter(u => u.lastActive && new Date(u.lastActive) > sevenDaysAgo).length
    },
    storage: { totalUsed, totalCapacity: storageByNode.reduce((s, n) => s + n.capacity, 0), byNode: storageByNode, byType },
    billing: { mrr, totalRevenue, activeSubscriptions: activeSubs },
    nodes: { total: nodes.length, online: onlineNodes.length, offline: offlineNodes.length },
    recentActivity
  });
});

app.get('/admin/reports/export/users', adminMiddleware, (req, res) => {
  const users = Object.values(usersDB.all()).filter(u => u.role !== 'admin');
  const header = 'id,email,tier,storageUsed,storageLimit,assignedNode,fileCount,createdAt,lastActive';
  const rows = users.map(u => {
    const fc = filesDB.find(f => f.userId === u.id).length;
    return [u.id, u.email, u.tier, u.storageUsed, u.storageLimit, u.assignedNode, fc, u.createdAt, u.lastActive]
      .map(v => `"${String(v || '').replace(/"/g, '""')}"`)
      .join(',');
  });
  const csv = [header, ...rows].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="users-export.csv"');
  res.send(csv);
});

app.get('/admin/reports/export/audit', adminMiddleware, (req, res) => {
  const limit = parseInt(req.query.limit) || 1000;
  const entries = Object.values(auditDB.all())
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, limit);
  const header = 'id,timestamp,action,userId,details';
  const rows = entries.map(e => {
    const details = JSON.stringify(e);
    return [e.id, e.timestamp, e.action, e.userId, details]
      .map(v => `"${String(v || '').replace(/"/g, '""')}"`)
      .join(',');
  });
  const csv = [header, ...rows].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="audit-export.csv"');
  res.send(csv);
});



// ── Seed / Test Data Generator ──────────────────────────────────

app.post('/admin/seed', adminMiddleware, async (req, res) => {
  const count = Math.min(parseInt(req.body.count) || 50, 500);

  const tierLimits = {
    free: 500 * 1024 * 1024, pro: 5 * 1024 * 1024 * 1024,
    translate: 10 * 1024 * 1024 * 1024, 'translate-pro': 50 * 1024 * 1024 * 1024
  };

  const firstNames = ['alice', 'bob', 'carol', 'dave', 'eve', 'frank', 'grace', 'henry', 'ivy', 'jack',
    'kate', 'leo', 'mia', 'noah', 'olivia', 'peter', 'quinn', 'ruby', 'sam', 'tina',
    'uma', 'victor', 'wendy', 'xander', 'yara', 'zach', 'emma', 'liam', 'sophia', 'mason'];
  const domains = ['example.com', 'gmail.com', 'outlook.com', 'yahoo.com', 'proton.me', 'icloud.com',
    'company.co', 'startup.io', 'university.edu', 'creative.studio'];
  const actions = ['user.login', 'file.upload', 'file.download', 'file.delete', 'user.register'];
  const fileTypes = ['transcript', 'audio', 'video'];
  const fileExts = { transcript: '.txt', audio: '.m4a', video: '.mp4' };

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
  function weightedTier() {
    const r = Math.random();
    if (r < 0.60) return 'free';
    if (r < 0.85) return 'pro';
    if (r < 0.95) return 'translate';
    return 'translate-pro';
  }
  function randomDate(daysBack) {
    return new Date(Date.now() - rand(0, daysBack * 24 * 60 * 60 * 1000)).toISOString();
  }

  const seededUsers = [];
  const nodes = Object.values(nodesDB.all());
  const nodeIds = nodes.map(n => n.id);
  if (!nodeIds.length) nodeIds.push(NODE_ID);

  for (let i = 0; i < count; i++) {
    const firstName = pick(firstNames);
    const num = rand(1, 999);
    const email = `${firstName}${num}@${pick(domains)}`;

    // Skip if email exists
    if (Object.values(usersDB.all()).find(u => u.email === email)) continue;

    const id = uuidv4();
    const tier = weightedTier();
    const limit = tierLimits[tier] || tierLimits.free;
    const usagePct = rand(0, 80) / 100;
    const storageUsed = Math.floor(limit * usagePct);
    const frozen = Math.random() < 0.05;
    const createdAt = randomDate(90);
    const lastActive = randomDate(14);

    const user = {
      id, email,
      password: await bcrypt.hash('password123', 10),
      role: 'user', tier, frozen,
      storageUsed, storageLimit: limit,
      assignedNode: pick(nodeIds),
      createdAt, lastActive,
      lastUpload: Math.random() > 0.3 ? randomDate(30) : null
    };
    usersDB.set(id, user);
    seededUsers.push(id);

    // Generate files for this user
    const fileCount = rand(0, 15);
    for (let j = 0; j < fileCount; j++) {
      const fid = uuidv4();
      const ft = pick(fileTypes);
      const size = rand(1024, 50 * 1024 * 1024); // 1KB - 50MB
      filesDB.set(fid, {
        id: fid, userId: id,
        originalName: `session_${rand(1, 100)}${fileExts[ft]}`,
        storedName: `${fid}${fileExts[ft]}`,
        mimeType: ft === 'audio' ? 'audio/m4a' : ft === 'video' ? 'video/mp4' : 'text/plain',
        size, nodeId: user.assignedNode,
        path: path.join(UPLOADS_PATH, id, `${fid}${fileExts[ft]}`),
        type: ft, sessionDate: randomDate(60).slice(0, 10),
        metadata: {}, uploadedAt: randomDate(60)
      });
    }
  }

  // Generate transactions for paid-tier users
  let txCount = 0;
  seededUsers.forEach(uid => {
    const u = usersDB.get(uid);
    if (!u || u.tier === 'free') return;
    const amounts = { pro: 4900, translate: 7900, 'translate-pro': 14900 };
    const txId = uuidv4();
    transactionsDB.set(txId, {
      id: txId, userId: uid, email: u.email,
      amount: amounts[u.tier] || 4900, currency: 'usd',
      type: 'subscription', status: 'paid',
      stripePaymentId: `pi_seed_${txId.slice(0, 8)}`,
      createdAt: u.createdAt
    });
    txCount++;
  });

  // Some failed transactions
  for (let i = 0; i < Math.min(5, Math.floor(count / 10)); i++) {
    const uid = pick(seededUsers);
    const u = usersDB.get(uid);
    if (!u) continue;
    const txId = uuidv4();
    transactionsDB.set(txId, {
      id: txId, userId: uid, email: u.email,
      amount: rand(500, 15000), currency: 'usd',
      type: 'subscription', status: 'failed',
      stripePaymentId: `pi_fail_${txId.slice(0, 8)}`,
      createdAt: randomDate(30)
    });
    txCount++;
  }

  // Generate audit entries
  let auditCount = 0;
  seededUsers.forEach(uid => {
    const u = usersDB.get(uid);
    if (!u) return;
    // Registration
    audit('user.register', uid, { email: u.email });
    auditCount++;
    // Some logins
    for (let i = 0; i < rand(1, 5); i++) {
      const aid = uuidv4();
      auditDB.set(aid, {
        id: aid, action: 'user.login', userId: uid,
        email: u.email, timestamp: randomDate(30)
      });
      auditCount++;
    }
    // Some file actions
    for (let i = 0; i < rand(0, 3); i++) {
      const aid = uuidv4();
      auditDB.set(aid, {
        id: aid, action: pick(['file.upload', 'file.download']), userId: uid,
        timestamp: randomDate(30)
      });
      auditCount++;
    }
  });

  audit('admin.seed', req.user.id, { users: seededUsers.length, transactions: txCount, auditEntries: auditCount });

  res.json({
    ok: true,
    seeded: { users: seededUsers.length, transactions: txCount, auditEntries: auditCount }
  });
});

// ── Helpers ─────────────────────────────────────────────────────

function getDiskInfo() {
  try {
    const { execSync } = require('child_process');
    const out = execSync('df -B1 . 2>/dev/null || df -g . 2>/dev/null').toString();
    const lines = out.trim().split('\n');
    if (lines.length >= 2) {
      const parts = lines[1].split(/\s+/);
      // Linux: filesystem, 1B-blocks, used, available, use%, mounted
      const total = parseInt(parts[1]) || 0;
      const used = parseInt(parts[2]) || 0;
      const available = parseInt(parts[3]) || 0;
      return {
        total, used, available,
        totalHuman: formatBytes(total),
        usedHuman: formatBytes(used),
        availableHuman: formatBytes(available),
        usedPercent: total > 0 ? Math.round((used / total) * 100) : 0
      };
    }
  } catch (_) { }
  return { total: 0, used: 0, available: 0, error: 'Could not read disk info' };
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// ── Start ───────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🌪️  Windy Pro Cloud Storage API`);
  console.log(`   Node: ${NODE_NAME} (${NODE_ID})`);
  console.log(`   Port: ${PORT}`);
  console.log(`   Data: ${DATA_ROOT}`);
  console.log(`   Ready.\n`);
});
