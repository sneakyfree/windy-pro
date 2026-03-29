/**
 * Windy Social — Public feeds, posts, follows, and discovery
 *
 * Port: 8107
 * Database: PostgreSQL
 * Auth: JWT Bearer tokens via shared jwt-verify module
 */

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const { createAuthMiddleware } = require('../shared/jwt-verify');

// ── Config ──────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 8107;
const CORS_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:5173').split(',');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/windy_social',
});

// ── Express Setup ───────────────────────────────────────────────────────────

const app = express();

app.use(helmet());
app.use(cors({
  origin: CORS_ORIGINS,
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));

// Rate limiters
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { error: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many write requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(generalLimiter);

// Auth middleware
const authenticate = createAuthMiddleware({
  fallbackToken: process.env.CHAT_API_TOKEN,
});

// ── Database Schema ─────────────────────────────────────────────────────────

async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS posts (
        id UUID PRIMARY KEY,
        author_identity_id TEXT NOT NULL,
        content TEXT NOT NULL,
        media_urls JSONB DEFAULT '[]',
        language TEXT DEFAULT 'en',
        translated_versions JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS follows (
        follower_id TEXT NOT NULL,
        following_id TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (follower_id, following_id)
      );

      CREATE TABLE IF NOT EXISTS likes (
        post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        identity_id TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (post_id, identity_id)
      );

      CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_identity_id);
      CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_id);
      CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id);
      CREATE INDEX IF NOT EXISTS idx_likes_post ON likes(post_id);
    `);
    console.log('[Social] Database schema initialized');
  } finally {
    client.release();
  }
}

// ── Helper ──────────────────────────────────────────────────────────────────

function getIdentityId(req) {
  return req.user.windy_identity_id || req.user.userId || req.user.sub;
}

// ── Health Check ────────────────────────────────────────────────────────────

app.get('/health', async (_req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*) AS count FROM posts');
    res.json({
      status: 'ok',
      service: 'windy-social',
      posts: parseInt(result.rows[0].count, 10),
      uptime: process.uptime(),
    });
  } catch (err) {
    res.status(503).json({ status: 'error', error: err.message });
  }
});

// ── POST /api/v1/posts — Create a post ─────────────────────────────────────

app.post('/api/v1/posts', authenticate, writeLimiter, async (req, res) => {
  try {
    const identityId = getIdentityId(req);
    const { content, media_urls, language, translated_versions } = req.body;

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return res.status(400).json({ error: 'Content is required' });
    }

    if (content.length > 5000) {
      return res.status(400).json({ error: 'Content must be 5000 characters or fewer' });
    }

    const id = uuidv4();
    const result = await pool.query(
      `INSERT INTO posts (id, author_identity_id, content, media_urls, language, translated_versions)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        id,
        identityId,
        content.trim(),
        JSON.stringify(media_urls || []),
        language || 'en',
        JSON.stringify(translated_versions || {}),
      ]
    );

    res.status(201).json({ post: result.rows[0] });
  } catch (err) {
    console.error('[POST /api/v1/posts]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/v1/posts/:id — Get a single post ──────────────────────────────

app.get('/api/v1/posts/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT p.*,
              (SELECT COUNT(*) FROM likes WHERE post_id = p.id) AS like_count
       FROM posts p
       WHERE p.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }

    res.json({ post: result.rows[0] });
  } catch (err) {
    console.error('[GET /api/v1/posts/:id]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/v1/feed — Get feed (posts from followed users) ────────────────

app.get('/api/v1/feed', authenticate, async (req, res) => {
  try {
    const identityId = getIdentityId(req);
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const offset = parseInt(req.query.offset, 10) || 0;

    const result = await pool.query(
      `SELECT p.*,
              (SELECT COUNT(*) FROM likes WHERE post_id = p.id) AS like_count
       FROM posts p
       WHERE p.author_identity_id IN (
         SELECT following_id FROM follows WHERE follower_id = $1
       )
       OR p.author_identity_id = $1
       ORDER BY p.created_at DESC
       LIMIT $2 OFFSET $3`,
      [identityId, limit, offset]
    );

    res.json({ posts: result.rows, limit, offset });
  } catch (err) {
    console.error('[GET /api/v1/feed]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/v1/follow/:identity_id — Follow a user ──────────────────────

app.post('/api/v1/follow/:identity_id', authenticate, writeLimiter, async (req, res) => {
  try {
    const followerId = getIdentityId(req);
    const followingId = req.params.identity_id;

    if (followerId === followingId) {
      return res.status(400).json({ error: 'Cannot follow yourself' });
    }

    await pool.query(
      `INSERT INTO follows (follower_id, following_id)
       VALUES ($1, $2)
       ON CONFLICT (follower_id, following_id) DO NOTHING`,
      [followerId, followingId]
    );

    res.status(201).json({ followed: followingId });
  } catch (err) {
    console.error('[POST /api/v1/follow]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /api/v1/follow/:identity_id — Unfollow a user ───────────────────

app.delete('/api/v1/follow/:identity_id', authenticate, writeLimiter, async (req, res) => {
  try {
    const followerId = getIdentityId(req);
    const followingId = req.params.identity_id;

    const result = await pool.query(
      `DELETE FROM follows WHERE follower_id = $1 AND following_id = $2`,
      [followerId, followingId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Follow relationship not found' });
    }

    res.json({ unfollowed: followingId });
  } catch (err) {
    console.error('[DELETE /api/v1/follow]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Start Server ────────────────────────────────────────────────────────────

async function start() {
  await initDatabase();
  app.listen(PORT, () => {
    console.log(`[Social] Windy Social running on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error('[Social] Failed to start:', err.message);
  process.exit(1);
});
