/**
 * Transcription routes — single file and batch (stubs).
 */
import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import { optionalAuth } from '../middleware/auth';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ─── POST /api/v1/transcribe ─────────────────────────────────

router.post('/', optionalAuth, upload.single('audio'), (req: Request, res: Response) => {
    try {
        const language = req.body.language || 'en';
        const engine = req.body.engine || 'cloud-standard';
        const duration = 0;

        const segments = [{
            id: uuidv4(),
            text: '[Transcription stub — connect a real STT engine]',
            startTime: 0,
            endTime: duration || 5.0,
            confidence: 0.95,
            language,
            partial: false,
        }];

        console.log(`🎤 Transcribe: language=${language} engine=${engine}`);

        res.set('X-Stub', 'true');
        res.json({
            segments,
            fullText: segments.map(s => s.text).join(' '),
            language,
            duration: duration || 5.0,
        });
    } catch (err: any) {
        console.error('Transcribe error:', err);
        res.status(500).json({ error: 'Transcription failed: ' + err.message });
    }
});

// ─── POST /api/v1/transcribe/batch ───────────────────────────

router.post('/batch', optionalAuth, upload.array('audio', 20), (req: Request, res: Response) => {
    try {
        const language = req.body.language || 'en';
        const engine = req.body.engine || 'cloud-standard';
        const files = req.files || [];
        const count = (files as Express.Multer.File[]).length || parseInt(req.body.count) || 1;

        const results = Array.from({ length: count }, (_, i) => ({
            index: i,
            segments: [{
                id: uuidv4(),
                text: `[Batch transcription stub — item ${i + 1}]`,
                startTime: 0,
                endTime: 5.0,
                confidence: 0.95,
                language,
                partial: false,
            }],
            fullText: `[Batch transcription stub — item ${i + 1}]`,
            language,
            duration: 5.0,
        }));

        console.log(`🎤 Batch transcribe: ${count} items, language=${language}`);

        res.set('X-Stub', 'true');
        res.json({ results });
    } catch (err: any) {
        console.error('Batch transcribe error:', err);
        res.status(500).json({ error: 'Batch transcription failed: ' + err.message });
    }
});

export default router;
