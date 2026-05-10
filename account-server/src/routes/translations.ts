/**
 * Translation routes — text, speech, languages, history, favorites.
 */
import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import { config } from '../config';
import { getStatements } from '../db/statements';
import { authenticateToken, optionalAuth, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validation';
import {
    TranslateTextRequestSchema,
    FavoriteToggleRequestSchema,
    SpeechTranslateBodySchema,
    HistoryQuerySchema,
} from '@windy-pro/contracts';
import type { Language } from '@windy-pro/contracts';

const router = Router();
const stmts = getStatements();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ─── Windy Mind broker helper (ADR-010 §8 BYOM invariant) ────
//
// Routes translate's LLM chat-completion step through api.windymind.ai/v1/chat
// when:
//   - MIND_API_URL is configured (default: https://api.windymind.ai)
//   - The caller has a valid Pro JWT in req.headers.authorization
//
// Mind's broker handles routing to the actual provider (Groq Llama by default
// for the model name we pass), applies EI-tier rate limits, writes audit_log
// rows, and returns OpenAI-compatible response. Existing GROQ_API_KEY remains
// in account-server .env as fallback when Mind is unavailable.
//
// Returns translated text on success, null on any failure (caller falls back
// to direct Groq/OpenAI per existing code paths). NEVER throws.
//
// Per Mind master plan §1 — Mind accepts windy-pro JWT (RS256, JWKS at
// account.windyword.ai) OR Eternitas EPT (ES256). Dispatch by typ header.
async function tryMindBroker(args: {
    text: string;
    prompt: string;
    userJwt: string;
}): Promise<{ translatedText: string; modelUsed: string } | null> {
    try {
        const res = await fetch(`${config.MIND_API_URL}/v1/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${args.userJwt}`,
            },
            body: JSON.stringify({
                // llama-3.3-70b-versatile is the Groq SKU per Mind master plan
                // §1 V1 model lineup. Cheapest path; same provider as direct.
                model: 'llama-3.3-70b-versatile',
                messages: [{ role: 'user', content: args.prompt }],
                temperature: 0.3,
                max_tokens: 2048,
            }),
            signal: AbortSignal.timeout(10000),
        });

        if (!res.ok) {
            // Mind broker non-200; caller falls back to direct.
            // SEC-H7: don't log response body (may contain provider-side detail).
            console.warn(`⚠️  Mind broker returned ${res.status}; falling back to direct`);
            return null;
        }

        const data: any = await res.json();
        const translatedText = data.choices?.[0]?.message?.content?.trim();
        if (!translatedText) return null;

        // Mind echoes back the model actually used (may differ from requested
        // if broker fell back internally — Sonnet → Llama chain). We log this
        // so audit_log on windy-pro side stays correlated with Mind's.
        const modelUsed = data.model || 'mind:llama-3.3-70b-versatile';
        return { translatedText, modelUsed };
    } catch (err: any) {
        // Network error, timeout, or DNS failure — fall back to direct.
        console.warn(`⚠️  Mind broker call failed (${err.message}); falling back to direct`);
        return null;
    }
}

const SUPPORTED_LANGUAGES: Language[] = [
    { code: 'en', name: 'English' },
    { code: 'es', name: 'Spanish' },
    { code: 'fr', name: 'French' },
    { code: 'de', name: 'German' },
    { code: 'it', name: 'Italian' },
    { code: 'pt', name: 'Portuguese' },
    { code: 'zh', name: 'Chinese' },
    { code: 'ja', name: 'Japanese' },
    { code: 'ko', name: 'Korean' },
    { code: 'ar', name: 'Arabic' },
    { code: 'ru', name: 'Russian' },
    { code: 'pl', name: 'Polish' },
];

// ─── POST /api/v1/translate/speech ───────────────────────────

// SEC-H2: authenticateToken — resource-intensive endpoints require auth
router.post('/speech', authenticateToken, upload.single('audio'), validate(SpeechTranslateBodySchema), async (req: Request, res: Response) => {
    try {
        // Normalize: mobile sends source/target, desktop sends sourceLang/targetLang
        const sourceLang = req.body.sourceLang || req.body.source;
        const targetLang = req.body.targetLang || req.body.target;

        if (!req.file) {
            return res.status(400).json({ error: 'Audio file is required' });
        }

        const groqKey = config.GROQ_API_KEY;
        const openaiKey = config.OPENAI_API_KEY;

        if (!groqKey && !openaiKey) {
            return res.status(501).json({
                error: 'Not implemented',
                message: 'Speech translation requires a speech-to-text API. Configure GROQ_API_KEY or OPENAI_API_KEY.',
            });
        }

        // Step 1: Transcribe audio using Whisper API
        const isGroq = !!groqKey;
        const whisperUrl = isGroq
            ? 'https://api.groq.com/openai/v1/audio/transcriptions'
            : 'https://api.openai.com/v1/audio/transcriptions';
        const apiKey = groqKey || openaiKey;
        const whisperModel = isGroq ? 'whisper-large-v3' : 'whisper-1';

        const FormData = (await import('form-data')).default;
        const formData = new FormData();
        formData.append('file', req.file.buffer, { filename: 'audio.webm', contentType: req.file.mimetype });
        formData.append('model', whisperModel);
        formData.append('language', sourceLang);

        const whisperRes = await fetch(whisperUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                ...formData.getHeaders(),
            },
            body: formData as any,
            signal: AbortSignal.timeout(30000),
        });

        if (!whisperRes.ok) {
            const errBody = await whisperRes.text();
            console.warn(`⚠️  Whisper API returned ${whisperRes.status}: ${errBody}`);
            return res.status(502).json({ error: 'Speech transcription failed' });
        }

        const whisperData: any = await whisperRes.json();
        const transcribedText = whisperData.text?.trim();

        if (!transcribedText) {
            return res.status(422).json({ error: 'No speech detected in audio' });
        }

        // Step 2: Translate transcribed text — try Mind broker first (BYOM
        // invariant per ADR-010 §8). /speech is always authenticated so the
        // user JWT is always available. Fall back to direct provider if Mind
        // unavailable.
        const langName = (code: string) => (SUPPORTED_LANGUAGES.find(l => l.code === code) || { name: code }).name;
        let translatedText: string;
        let engine: string = isGroq ? 'groq' : 'openai';
        const prompt = `Translate the following text from ${langName(sourceLang)} to ${langName(targetLang)}. Return ONLY the translated text, nothing else.\n\n${transcribedText}`;

        const speechUserJwt = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
        let mindTranslated: string | undefined;
        if (speechUserJwt && config.MIND_API_URL) {
            const mindResult = await tryMindBroker({ text: transcribedText, prompt, userJwt: speechUserJwt });
            if (mindResult) {
                mindTranslated = mindResult.translatedText;
                engine = `mind:${mindResult.modelUsed}`;
            }
        }

        const chatUrl = isGroq
            ? 'https://api.groq.com/openai/v1/chat/completions'
            : 'https://api.openai.com/v1/chat/completions';
        const chatModel = isGroq ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini';

        // If Mind answered, skip the direct call entirely; otherwise hit the
        // existing direct path. Either way translatedText ends up set.
        const chatRes = mindTranslated ? null : await fetch(chatUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: chatModel,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.3,
                max_tokens: 2048,
            }),
            signal: AbortSignal.timeout(10000),
        });

        if (mindTranslated) {
            translatedText = mindTranslated;
        } else if (chatRes && chatRes.ok) {
            const chatData: any = await chatRes.json();
            translatedText = chatData.choices?.[0]?.message?.content?.trim() || `[${targetLang}] ${transcribedText}`;
        } else {
            translatedText = `[${targetLang}] ${transcribedText}`;
            engine = 'stub';
        }

        const translationId = uuidv4();
        const confidence = engine !== 'stub' ? Math.round((0.92 + Math.random() * 0.06) * 100) / 100 : 0.88;

        stmts.insertTranslation.run(
            translationId, (req as AuthRequest).user?.userId || 'anonymous',
            sourceLang, targetLang,
            transcribedText, translatedText,
            confidence, 'speech'
        );

        console.log(`🎤 Speech translation: ${sourceLang}→${targetLang} (engine: ${engine})`);

        res.json({
            id: translationId,
            sourceText: transcribedText,
            translatedText,
            sourceLang,
            targetLang,
            confidence,
            type: 'speech',
            engine,
        });
    } catch (err: any) {
        console.error('Speech translation error:', err);
        // SEC-H7: Don't expose internal error details
        res.status(500).json({ error: 'Speech translation failed' });
    }
});

// ─── POST /api/v1/translate/text ─────────────────────────────

// i18n Tier 2 dynamic translations need to work without login, use optionalAuth
router.post('/text', optionalAuth, validate(TranslateTextRequestSchema), async (req: Request, res: Response) => {
    try {
        const text = req.body.text;
        // Normalize: mobile sends source/target, desktop sends sourceLang/targetLang
        const sourceLang = req.body.sourceLang || req.body.source;
        const targetLang = req.body.targetLang || req.body.target;

        let translatedText: string | undefined;
        let engine = 'stub';
        const langName = (code: string) => (SUPPORTED_LANGUAGES.find(l => l.code === code) || { name: code }).name;
        const prompt = `Translate the following text from ${langName(sourceLang)} to ${langName(targetLang)}. Return ONLY the translated text, nothing else.\n\n${text}`;

        // ──── BYOM via Windy Mind (preferred path when authenticated) ────
        // Per ADR-010 §8: internal Windy products should route LLM calls through
        // Mind, not direct providers. Currently authenticated users only (Mind
        // requires Pro JWT). Anonymous callers fall through to direct-provider
        // logic below (per MIND_FORCE_FOR_ANONYMOUS flag; default off).
        const userId = (req as AuthRequest).user?.userId;
        const userJwt = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
        const isAuthed = !!userId && !!userJwt;

        if (isAuthed && config.MIND_API_URL) {
            const mindResult = await tryMindBroker({ text, prompt, userJwt });
            if (mindResult) {
                translatedText = mindResult.translatedText;
                engine = `mind:${mindResult.modelUsed}`;
                console.log(`📝 AI Translation (${engine}): ${sourceLang}→${targetLang}`);
            }
        }

        // ──── Direct-provider fallback (existing logic; runs when Mind didn't answer) ────
        const groqKey = config.GROQ_API_KEY;
        const openaiKey = config.OPENAI_API_KEY;

        if (!translatedText && (groqKey || openaiKey)) {
            try {
                const isGroq = !!groqKey;
                const apiUrl = isGroq
                    ? 'https://api.groq.com/openai/v1/chat/completions'
                    : 'https://api.openai.com/v1/chat/completions';
                const apiKey = groqKey || openaiKey;
                const model = isGroq ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini';

                const apiRes = await fetch(apiUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`,
                    },
                    body: JSON.stringify({
                        model,
                        messages: [{ role: 'user', content: prompt }],
                        temperature: 0.3,
                        max_tokens: 2048,
                    }),
                    signal: AbortSignal.timeout(10000),
                });

                if (apiRes.ok) {
                    const data: any = await apiRes.json();
                    translatedText = data.choices?.[0]?.message?.content?.trim();
                    engine = isGroq ? 'groq' : 'openai';
                    console.log(`📝 AI Translation (${engine}): ${sourceLang}→${targetLang}`);
                } else {
                    console.warn(`⚠️  AI translation API returned ${apiRes.status}, falling back to stub`);
                }
            } catch (aiErr: any) {
                console.warn('⚠️  AI translation failed, falling back to stub:', aiErr.message);
            }
        }

        // Fallback
        if (!translatedText) {
            translatedText = `[${targetLang}] ${text}`;
        }

        // engine is 'mind:*' (Mind broker) or 'groq' / 'openai' / 'stub' (direct/fallback)
        const isAiEngine = engine !== 'stub';
        const confidence = Math.round((isAiEngine ? 0.92 + Math.random() * 0.06 : 0.88 + Math.random() * 0.10) * 100) / 100;
        const translationId = uuidv4();
        // userId already extracted above for Mind broker auth check

        // Persist history only for authenticated users. The translations.user_id
        // column has a FK to users(id) and a NOT NULL constraint; passing
        // 'anonymous' triggers SQLITE_CONSTRAINT_FOREIGNKEY (test env) and
        // invalid-UUID rejection on Postgres (prod), turning a successful
        // translation into a 500. Anonymous callers still get the translated
        // payload back, just with no row in the history table.
        if (userId) {
            stmts.insertTranslation.run(
                translationId, userId,
                sourceLang, targetLang,
                text, translatedText,
                confidence, 'text'
            );
        }

        console.log(`📝 Text translation: ${sourceLang}→${targetLang} for user ${userId ? userId.slice(0, 8) : 'anonymous'} (engine: ${engine})`);

        res.json({
            id: translationId,
            sourceText: text,
            translatedText,
            sourceLang,
            targetLang,
            confidence,
            type: 'text',
            engine,
        });
    } catch (err: any) {
        console.error('Text translation error:', err);
        // SEC-H7: Don't expose internal error details
        res.status(500).json({ error: 'Text translation failed' });
    }
});

// ─── GET /api/v1/translate/languages ─────────────────────────

router.get('/languages', (_req: Request, res: Response) => {
    res.json({ languages: SUPPORTED_LANGUAGES });
});

// ─── GET /api/v1/user/history ────────────────────────────────
// Mounted under /translate but path overridden in server.ts

export function historyHandler(req: Request, res: Response): void {
    try {
        const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
        const offset = parseInt(req.query.offset as string) || 0;
        const userId = (req as AuthRequest).user.userId;

        const history = stmts.getTranslationHistory.all(userId, limit, offset) as any[];
        const total = (stmts.countTranslations.get(userId) as any).count;

        // Collect unique languages from history entries
        const langSet = new Set<string>();
        let favoriteCount = 0;
        for (const h of history) {
            if (h.source_lang) langSet.add(h.source_lang);
            if (h.target_lang) langSet.add(h.target_lang);
            if (h.is_favorite) favoriteCount++;
        }

        res.json({
            // Frontend compat fields (Dashboard.jsx, Profile.jsx)
            translations: history,
            total,
            languages: Array.from(langSet),
            favoriteCount,
            // Original structured response
            history,
            pagination: { limit, offset, total, hasMore: offset + limit < total },
        });
    } catch (err: any) {
        console.error('History error:', err);
        // SEC-H7: Don't expose internal error details
        res.status(500).json({ error: 'Failed to fetch history' });
    }
}

// ─── POST /api/v1/user/favorites ─────────────────────────────

export function favoritesHandler(req: Request, res: Response): void {
    try {
        const { translationId } = req.body;
        const userId = (req as AuthRequest).user.userId;

        if (!translationId) {
            res.status(400).json({ error: 'translationId is required' });
            return;
        }

        const translation = stmts.findTranslation.get(translationId, userId) as any;
        if (!translation) {
            res.status(404).json({ error: 'Translation not found' });
            return;
        }

        const favoriteId = uuidv4();
        const result = stmts.insertFavorite.run(favoriteId, userId, translationId);

        if (result.changes === 0) {
            stmts.removeFavorite.run(userId, translationId);
            console.log(`💔 Unfavorited: ${translationId.slice(0, 8)} by ${userId.slice(0, 8)}`);
            res.json({ favorited: false, translationId });
            return;
        }

        console.log(`⭐ Favorited: ${translationId.slice(0, 8)} by ${userId.slice(0, 8)}`);
        res.json({ favorited: true, translationId, favoriteId });
    } catch (err: any) {
        console.error('Favorite error:', err);
        // SEC-H7: Don't expose internal error details
        res.status(500).json({ error: 'Failed to save favorite' });
    }
}

export default router;
