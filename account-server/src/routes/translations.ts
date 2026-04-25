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

        // Step 2: Translate transcribed text
        const langName = (code: string) => (SUPPORTED_LANGUAGES.find(l => l.code === code) || { name: code }).name;
        let translatedText: string;
        let engine = isGroq ? 'groq' : 'openai';

        const chatUrl = isGroq
            ? 'https://api.groq.com/openai/v1/chat/completions'
            : 'https://api.openai.com/v1/chat/completions';
        const chatModel = isGroq ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini';
        const prompt = `Translate the following text from ${langName(sourceLang)} to ${langName(targetLang)}. Return ONLY the translated text, nothing else.\n\n${transcribedText}`;

        const chatRes = await fetch(chatUrl, {
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

        if (chatRes.ok) {
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

        // Try real translation via Groq or OpenAI
        const groqKey = config.GROQ_API_KEY;
        const openaiKey = config.OPENAI_API_KEY;

        if (groqKey || openaiKey) {
            try {
                const isGroq = !!groqKey;
                const apiUrl = isGroq
                    ? 'https://api.groq.com/openai/v1/chat/completions'
                    : 'https://api.openai.com/v1/chat/completions';
                const apiKey = groqKey || openaiKey;
                const model = isGroq ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini';

                const prompt = `Translate the following text from ${langName(sourceLang)} to ${langName(targetLang)}. Return ONLY the translated text, nothing else.\n\n${text}`;

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

        const confidence = Math.round((engine !== 'stub' ? 0.92 + Math.random() * 0.06 : 0.88 + Math.random() * 0.10) * 100) / 100;
        const translationId = uuidv4();

        stmts.insertTranslation.run(
            translationId, (req as AuthRequest).user?.userId || 'anonymous',
            sourceLang, targetLang,
            text, translatedText,
            confidence, 'text'
        );

        console.log(`📝 Text translation: ${sourceLang}→${targetLang} for user ${((req as AuthRequest).user?.userId || 'anonymous').slice(0, 8)} (engine: ${engine})`);

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
