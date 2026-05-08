/**
 * Windy Mind V1 — broker route.
 *
 * Single chokepoint every Windy product calls into when it needs an LLM.
 * Per ADR-010 §8 (BYOM via Windy Mind): every LLM call across the Windy
 * ecosystem goes through this route — not direct provider calls.
 *
 * V1 endpoints:
 *   POST /api/v1/mind/chat       — invoke an LLM. OpenAI-compatible request.
 *   GET  /api/v1/mind/models     — list the V1 model lineup
 *   GET  /api/v1/mind/status     — diagnostic: which providers are wired
 *
 * V2 will add: SSE streaming, per-user model preferences from DB, BYOK
 * pulled from Secrets Manager, soul-file logging, billing meter.
 */
import { Router, type Request, type Response } from 'express';
import { authenticateToken, optionalAuth, type AuthRequest } from '../middleware/auth';
import { brokerChat, brokerStatus } from '../services/mind/broker';
import {
    MODEL_LINEUP,
    type MindChatRequest,
    type ChatMessage,
    type ModelId,
} from '../services/mind/types';

const router = Router();

const VALID_ROLES = new Set(['system', 'user', 'assistant']);
const VALID_MODEL_IDS = new Set(MODEL_LINEUP.map(m => m.id));

function isValidMessage(m: any): m is ChatMessage {
    return m
        && typeof m === 'object'
        && typeof m.role === 'string'
        && VALID_ROLES.has(m.role)
        && typeof m.content === 'string'
        && m.content.length > 0
        && m.content.length < 100_000; // sanity cap
}

router.post('/chat', optionalAuth, async (req: Request, res: Response) => {
    try {
        const body = req.body as Partial<MindChatRequest>;
        if (!Array.isArray(body.messages) || body.messages.length === 0) {
            return res.status(400).json({ error: 'messages array required' });
        }
        if (body.messages.length > 200) {
            return res.status(400).json({ error: 'messages array too long (max 200 turns)' });
        }
        if (!body.messages.every(isValidMessage)) {
            return res.status(400).json({ error: 'messages must each have role and content (1-100k chars)' });
        }
        if (body.model !== undefined && !VALID_MODEL_IDS.has(body.model as ModelId)) {
            return res.status(400).json({
                error: `unknown model: ${body.model}`,
                valid_models: [...VALID_MODEL_IDS],
            });
        }
        if (body.max_tokens !== undefined && (typeof body.max_tokens !== 'number' || body.max_tokens < 1 || body.max_tokens > 8192)) {
            return res.status(400).json({ error: 'max_tokens must be 1-8192' });
        }

        const result = await brokerChat({
            model: body.model,
            messages: body.messages,
            max_tokens: body.max_tokens,
            temperature: body.temperature,
        });

        // Diagnostic header so callers can see if a fallback fired.
        if (result.fellBackFrom) {
            res.setHeader('x-mind-fallback-from', result.fellBackFrom);
        }
        res.setHeader('x-mind-model', result.actualModel);

        const userId = (req as AuthRequest).user?.userId || 'anonymous';
        console.log(
            `[mind] ${userId.slice(0, 8)} → ${result.actualModel}` +
            (result.fellBackFrom ? ` (fallback from ${result.fellBackFrom})` : '') +
            ` in=${result.response.usage?.prompt_tokens || '?'}t out=${result.response.usage?.completion_tokens || '?'}t`
        );

        res.json(result.response);
    } catch (err: any) {
        console.error('[mind] chat error:', err?.message || err);
        const status = typeof err?.statusCode === 'number' ? err.statusCode : 500;
        // SEC: don't expose provider error bodies to clients verbatim.
        const safe = status === 503 ? err.message : 'Mind broker error';
        res.status(status).json({ error: safe });
    }
});

router.get('/models', (_req: Request, res: Response) => {
    res.json({
        models: MODEL_LINEUP.map(m => ({
            id: m.id,
            label: m.label,
            persona: m.persona,
            persona_emoji: m.persona_emoji,
            provider: m.provider,
            production_default: m.productionDefault,
            dev_test_default: m.devTest,
        })),
    });
});

router.get('/status', (_req: Request, res: Response) => {
    res.json({
        providers: brokerStatus(),
        node_env: process.env.NODE_ENV || 'development',
        default_model: process.env.NODE_ENV === 'production'
            ? MODEL_LINEUP.find(m => m.productionDefault)?.id
            : MODEL_LINEUP.find(m => m.devTest)?.id,
    });
});

export default router;
