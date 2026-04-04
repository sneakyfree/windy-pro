import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth';

const router = Router();

// Phone provisioning — requires Twilio integration (not yet implemented)
router.post('/phone/provision', authenticateToken, (req: Request, res: Response) => {
    res.status(501).json({
        error: 'Not implemented',
        message: 'Phone provisioning requires Twilio integration. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER.',
    });
});

// Phone release — requires Twilio integration (not yet implemented)
router.post('/phone/release', authenticateToken, (req: Request, res: Response) => {
    res.status(501).json({
        error: 'Not implemented',
        message: 'Phone release requires Twilio integration.',
    });
});

// Push notifications — requires APNs/FCM integration (not yet implemented)
router.post('/push/send', authenticateToken, (req: Request, res: Response) => {
    res.status(501).json({
        error: 'Not implemented',
        message: 'Push notifications require APNs/FCM integration.',
    });
});

export default router;
