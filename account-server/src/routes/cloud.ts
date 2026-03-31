import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth';

const router = Router();

// Stub: Provision a phone number for a bot
router.post('/phone/provision', authenticateToken, (req: Request, res: Response) => {
    const { agent_name, passport_id } = req.body;
    res.set('X-Stub', 'true');
    res.json({
        phone_number: '+1-555-0100',
        provider: 'stub',
        message: 'Twilio integration coming soon. Using placeholder number.',
    });
});

// Stub: Release a phone number
router.post('/phone/release', authenticateToken, (req: Request, res: Response) => {
    res.set('X-Stub', 'true');
    res.json({ released: true });
});

// Stub: Send push notification
router.post('/push/send', authenticateToken, (req: Request, res: Response) => {
    const { user_id, title, body } = req.body;
    console.log(`[Cloud/Push] Stub notification to ${user_id}: ${title}`);
    res.set('X-Stub', 'true');
    res.json({ sent: true, provider: 'stub' });
});

export default router;
