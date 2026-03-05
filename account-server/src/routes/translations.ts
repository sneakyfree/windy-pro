/**
 * Translation routes — text, speech, languages, history, favorites.
 */
import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import { config } from '../config';
import { getStatements } from '../db/statements';
import { authenticateToken, AuthRequest } from '../middleware/auth';
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

router.post('/speech', authenticateToken, upload.single('audio'), validate(SpeechTranslateBodySchema), (req: Request, res: Response) => {
    try {
        // Normalize: mobile sends source/target, desktop sends sourceLang/targetLang
        const sourceLang = req.body.sourceLang || req.body.source;
        const targetLang = req.body.targetLang || req.body.target;

        if (!req.file) {
            return res.status(400).json({ error: 'Audio file is required' });
        }

        // Stub translation
        const detectedText = `[Detected speech in ${sourceLang}]`;
        const translatedText = `[Translation to ${targetLang}]`;
        const confidence = Math.round((0.82 + Math.random() * 0.15) * 100) / 100;
        const translationId = uuidv4();

        stmts.insertTranslation.run(
            translationId, (req as AuthRequest).user.userId,
            sourceLang, targetLang,
            detectedText, translatedText,
            confidence, 'speech'
        );

        console.log(`🗣️  Speech translation: ${sourceLang}→${targetLang} for user ${(req as AuthRequest).user.userId.slice(0, 8)}`);

        res.set('X-Stub', 'true');
        res.json({
            id: translationId,
            sourceText: detectedText,
            translatedText,
            sourceLang,
            targetLang,
            confidence,
            type: 'speech',
            audioData: null,
        });
    } catch (err: any) {
        console.error('Speech translation error:', err);
        res.status(500).json({ error: 'Speech translation failed: ' + err.message });
    }
});

// ─── POST /api/v1/translate/text ─────────────────────────────

router.post('/text', authenticateToken, validate(TranslateTextRequestSchema), async (req: Request, res: Response) => {
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
            translationId, (req as AuthRequest).user.userId,
            sourceLang, targetLang,
            text, translatedText,
            confidence, 'text'
        );

        console.log(`📝 Text translation: ${sourceLang}→${targetLang} for user ${(req as AuthRequest).user.userId.slice(0, 8)} (engine: ${engine})`);

        if (engine === 'stub') res.set('X-Stub', 'true');
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
        res.status(500).json({ error: 'Text translation failed: ' + err.message });
    }
});

// ─── GET /api/v1/translate/languages ─────────────────────────

router.get('/languages', authenticateToken, (_req: Request, res: Response) => {
    res.json({ languages: SUPPORTED_LANGUAGES });
});

// ─── GET /api/v1/user/history ────────────────────────────────
// Mounted under /translate but path overridden in server.ts

export function historyHandler(req: Request, res: Response): void {
    try {
        const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
        const offset = parseInt(req.query.offset as string) || 0;
        const userId = (req as AuthRequest).user.userId;

        const history = stmts.getTranslationHistory.all(userId, limit, offset);
        const total = (stmts.countTranslations.get(userId) as any).count;

        res.json({
            history,
            pagination: { limit, offset, total, hasMore: offset + limit < total },
        });
    } catch (err: any) {
        console.error('History error:', err);
        res.status(500).json({ error: 'Failed to fetch history: ' + err.message });
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
        res.status(500).json({ error: 'Failed to save favorite: ' + err.message });
    }
}

export default router;
