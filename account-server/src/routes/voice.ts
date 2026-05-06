/**
 * Voice dispatch routes — the keystone of "voice as the command plane."
 *
 * The vision (from the 2026-05-06 ecosystem strategy doc): every Windy
 * surface — Pro, Mail, Chat, Cloud, Code, Word, Mobile — drops in the
 * SAME `<VoiceButton/>` component. The button posts here. This endpoint
 * (a) optionally transcribes audio, (b) creates a voice_task row, (c)
 * dispatches to the user's hatched agent via the fly gateway, and (d)
 * exposes an SSE stream the frontend's status chip subscribes to.
 *
 * v0 scope (this PR):
 *   - Text-mode only (audio stubbed; client posts `text` directly).
 *   - Synchronous fly-gateway forwarding with synthesized progress
 *     events around the round-trip (dispatched → thinking → response
 *     → done). Real streaming from the agent comes when the agent
 *     gateway supports it.
 *   - Graceful degradation: if WINDYFLY_GATEWAY_URL is unset or the
 *     gateway is offline, the stream emits a `scaffold_mode` event so
 *     frontends can render "your agent is offline" without breaking.
 *
 * v1+ deferred:
 *   - Audio mode (multipart/form-data → Word STT → text).
 *   - Real agent SSE forwarding (per-tool-call events).
 *   - Long-running task persistence + cross-surface resumption (close
 *     the laptop, open phone, status chip is still there).
 *
 * Protocol contract: docs/VOICE_DISPATCH_PROTOCOL.md
 */
import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { getDb } from '../db/schema';
import { makeRateLimiter } from '../services/rate-limiter';

const router = Router();

// ─── Rate limit ──────────────────────────────────────────────
// Per-user, post-auth. 60/min = 1/sec — generous enough for rapid
// fire voice commands; tight enough to backstop runaway frontends.
const dispatchLimiter = makeRateLimiter('voice-dispatch', {
    windowMs: 60 * 1000,
    max: process.env.NODE_ENV === 'test' ? 10_000 : 60,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: any) => {
        const userId = req?.user?.userId;
        return typeof userId === 'string' && userId.length > 0
            ? `user:${userId}`
            : `ip:${req?.ip ?? 'unknown'}`;
    },
});

// ─── Schema bootstrap (idempotent) ───────────────────────────
function ensureVoiceTasksTable(): void {
    const db = getDb();
    db.exec(`
        CREATE TABLE IF NOT EXISTS voice_tasks (
            task_id     TEXT PRIMARY KEY,
            user_id     TEXT NOT NULL,
            transcript  TEXT NOT NULL,
            surface     TEXT NOT NULL DEFAULT 'unknown',
            context     TEXT NOT NULL DEFAULT '{}',
            status      TEXT NOT NULL DEFAULT 'pending',
            response    TEXT,
            error       TEXT,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            completed_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_voice_tasks_user
            ON voice_tasks(user_id, created_at);
    `);
}

// ─── Helpers ─────────────────────────────────────────────────
function newTaskId(): string {
    return `vt_${crypto.randomBytes(16).toString('hex')}`;
}

function writeSse(res: Response, event: string, data: object): void {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    // @ts-ignore — flush exists at runtime when compression is in the chain
    res.flush?.();
}

interface VoiceTaskRow {
    task_id: string;
    user_id: string;
    transcript: string;
    surface: string;
    context: string;
    status: string;
    response: string | null;
    error: string | null;
    created_at: string;
    completed_at: string | null;
}

// ─── POST /api/v1/voice/dispatch ─────────────────────────────
//
// Body: { text: string, context?: { surface?: string, ...arbitrary } }
// Returns: { task_id, transcript, stream_url }
//
// Persists the task, returns the task_id and the SSE URL the client
// should subscribe to. Dispatch to the agent gateway happens inside
// the SSE handler (so the client sees `dispatched` + `thinking` +
// `response` events flow through one stream).
router.post('/dispatch', authenticateToken, dispatchLimiter, async (req: Request, res: Response) => {
    try {
        ensureVoiceTasksTable();

        const userId = (req as AuthRequest).user.userId;
        const { text, context } = req.body || {};

        if (!text || typeof text !== 'string' || !text.trim()) {
            return res.status(400).json({ error: 'text is required (non-empty string)' });
        }
        if (text.length > 10_000) {
            return res.status(400).json({ error: 'text exceeds 10000 char limit' });
        }

        const taskId = newTaskId();
        const transcript = text.trim();
        const ctx = (context && typeof context === 'object') ? context : {};
        const surface = typeof ctx.surface === 'string' ? ctx.surface : 'unknown';

        const db = getDb();
        db.prepare(`
            INSERT INTO voice_tasks (task_id, user_id, transcript, surface, context, status)
            VALUES (?, ?, ?, ?, ?, 'pending')
        `).run(taskId, userId, transcript, surface, JSON.stringify(ctx));

        return res.status(202).json({
            task_id: taskId,
            transcript,
            stream_url: `/api/v1/voice/tasks/${taskId}/events`,
        });
    } catch (err: any) {
        console.error('[voice/dispatch] error:', err);
        return res.status(500).json({ error: 'voice_dispatch_failed' });
    }
});

// ─── GET /api/v1/voice/tasks/:id/events ──────────────────────
//
// SSE stream. Auth: same Bearer JWT — task ownership is verified by
// matching task.user_id against req.user.userId.
//
// Event sequence:
//   dispatched   { task_id, transcript, ts }
//   thinking     { ts }
//   response     { text, ts }   ← when agent responds
//   done         { duration_ms, ts }
//   failed       { error, ts }   ← terminal alternative
//   scaffold_mode { reason, ts } ← when fly gateway is offline; frontend
//                                  should render a "your agent is offline" state
router.get('/tasks/:id/events', authenticateToken, async (req: Request, res: Response) => {
    const userId = (req as AuthRequest).user.userId;
    const taskId = req.params.id;

    ensureVoiceTasksTable();
    const db = getDb();
    const task = db.prepare(
        'SELECT * FROM voice_tasks WHERE task_id = ?',
    ).get(taskId) as VoiceTaskRow | undefined;

    if (!task) {
        return res.status(404).json({ error: 'task_not_found' });
    }
    if (task.user_id !== userId) {
        return res.status(403).json({ error: 'task_owned_by_other_user' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-store');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const t0 = Date.now();
    const ts = () => new Date().toISOString();

    writeSse(res, 'dispatched', {
        task_id: task.task_id,
        transcript: task.transcript,
        surface: task.surface,
        ts: ts(),
    });

    // If the task is already done (replay scenario), stream the cached
    // result and close. This makes the SSE endpoint idempotent — the
    // frontend can reconnect after a network blip and replay history.
    if (task.status === 'done' && task.response) {
        writeSse(res, 'response', { text: task.response, ts: ts() });
        writeSse(res, 'done', {
            duration_ms: 0,
            replayed: true,
            ts: ts(),
        });
        return res.end();
    }
    if (task.status === 'failed' && task.error) {
        writeSse(res, 'failed', { error: task.error, replayed: true, ts: ts() });
        return res.end();
    }

    writeSse(res, 'thinking', { ts: ts() });

    // ─── Forward to fly gateway ──────────────────────────────
    // The fly gateway is the same target /api/v1/fly/chat uses today.
    // v1 will switch to SSE forwarding for per-tool-call granularity.
    const gatewayUrl = process.env.WINDYFLY_GATEWAY_URL;
    if (!gatewayUrl) {
        const reason = 'WINDYFLY_GATEWAY_URL not configured (scaffold mode — voice dispatch backend is being wired)';
        db.prepare(
            "UPDATE voice_tasks SET status = 'scaffold', completed_at = datetime('now') WHERE task_id = ?",
        ).run(task.task_id);
        writeSse(res, 'scaffold_mode', { reason, ts: ts() });
        writeSse(res, 'done', { duration_ms: Date.now() - t0, scaffold: true, ts: ts() });
        return res.end();
    }

    try {
        const resp = await fetch(`${gatewayUrl.replace(/\/$/, '')}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: task.transcript, user_id: userId }),
            signal: AbortSignal.timeout(60_000),
        });
        const data: any = await resp.json().catch(() => ({}));

        if (!resp.ok) {
            const errText = (data && (data.error || data.message)) || `gateway_${resp.status}`;
            db.prepare(
                "UPDATE voice_tasks SET status = 'failed', error = ?, completed_at = datetime('now') WHERE task_id = ?",
            ).run(String(errText), task.task_id);
            writeSse(res, 'failed', { error: String(errText), ts: ts() });
            return res.end();
        }

        const responseText: string = (data && typeof data.response === 'string')
            ? data.response
            : JSON.stringify(data);

        db.prepare(
            "UPDATE voice_tasks SET status = 'done', response = ?, completed_at = datetime('now') WHERE task_id = ?",
        ).run(responseText, task.task_id);

        writeSse(res, 'response', { text: responseText, ts: ts() });
        writeSse(res, 'done', { duration_ms: Date.now() - t0, ts: ts() });
        return res.end();
    } catch (err: any) {
        const reason = `gateway_unreachable: ${err?.message || err}`;
        db.prepare(
            "UPDATE voice_tasks SET status = 'failed', error = ?, completed_at = datetime('now') WHERE task_id = ?",
        ).run(reason, task.task_id);
        // Fly gateway being offline is a "scaffold mode" experience for the
        // user, not a hard failure. Frontends should render an offline pill
        // and offer a retry, not blow up.
        writeSse(res, 'scaffold_mode', { reason, ts: ts() });
        writeSse(res, 'done', { duration_ms: Date.now() - t0, scaffold: true, ts: ts() });
        return res.end();
    }
});

export default router;
