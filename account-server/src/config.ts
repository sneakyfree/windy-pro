/**
 * Server configuration — loaded from environment variables.
 * NO hardcoded fallback for JWT_SECRET. Must be set in production.
 */

import path from 'path';
import fs from 'fs';

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
            // SEC-C4: Generate a random secret at startup instead of using a hardcoded value.
            // This means tokens are invalidated on restart, which is acceptable for dev.
            if (name === 'JWT_SECRET') {
                const crypto = require('crypto');
                const generated = crypto.randomBytes(32).toString('hex');
                console.warn(`⚠️  [SEC-C4] JWT_SECRET not set — generated ephemeral secret for development. Set JWT_SECRET in .env for persistent tokens.`);
                return generated;
            }
        }
        throw new Error(`❌ Environment variable ${name} is required. Set it in your .env file or environment.`);
    }
    return value;
}

const DATA_ROOT = process.env.DATA_ROOT || path.join(__dirname, '..', 'data');
const UPLOADS_PATH = path.join(DATA_ROOT, 'uploads');

// Ensure upload directories exist
[DATA_ROOT, UPLOADS_PATH].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

export const config = {
    PORT: parseInt(process.env.PORT || '8098', 10),
    JWT_SECRET: requireEnv('JWT_SECRET'),
    JWT_EXPIRY: '15m' as const, // SEC-M6: Reduced from 24h — short-lived tokens minimize stolen-token risk
    REFRESH_EXPIRY: '30d' as const,
    MAX_DEVICES: 5,
    BCRYPT_ROUNDS: 12, // SEC-L2: Increased from 10 to meet modern recommendations
    DB_PATH: path.join(__dirname, '..', 'accounts.db'),
    GROQ_API_KEY: process.env.GROQ_API_KEY || '',
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
    // File storage
    DATA_ROOT,
    UPLOADS_PATH,
    MAX_FILE_SIZE: 500 * 1024 * 1024, // 500MB
    // Stripe billing — set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET in .env or system env
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || '',
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || '',
} as const;
