/**
 * Authentication middleware — JWT verification, optional auth, admin guard.
 */
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';

export interface AuthUser {
    userId: string;
    email: string;
    tier: string;
    accountId: string;
    role?: string;
}

export interface AuthRequest extends Request {
    user: AuthUser;
}

/**
 * Require valid JWT Bearer token. Sets req.user on success.
 */
export function authenticateToken(req: Request, res: Response, next: NextFunction): void {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        res.status(401).json({ error: 'Authentication required' });
        return;
    }

    try {
        const decoded = jwt.verify(token, config.JWT_SECRET) as AuthUser;
        (req as AuthRequest).user = decoded;
        next();
    } catch (err: any) {
        if (err.name === 'TokenExpiredError') {
            res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
            return;
        }
        res.status(403).json({ error: 'Invalid token' });
    }
}

/**
 * Optional auth — sets req.user if valid token present, otherwise continues.
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token) {
        try {
            (req as AuthRequest).user = jwt.verify(token, config.JWT_SECRET) as AuthUser;
        } catch { /* ignore invalid tokens */ }
    }
    next();
}

/**
 * Admin-only guard — must be used after authenticateToken.
 */
export function adminOnly(req: Request, res: Response, next: NextFunction): void {
    const { getDb } = require('../db/schema');
    const db = getDb();
    const user = db.prepare('SELECT role FROM users WHERE id = ?').get((req as AuthRequest).user.userId) as { role: string } | undefined;
    if (!user || user.role !== 'admin') {
        res.status(403).json({ error: 'Admin access required' });
        return;
    }
    next();
}
