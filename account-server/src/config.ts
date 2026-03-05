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
            // Allow a development-only fallback
            if (name === 'JWT_SECRET') return 'windy-pro-dev-only-secret-DO-NOT-USE-IN-PROD';
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
    JWT_EXPIRY: '24h' as const,
    REFRESH_EXPIRY: '30d' as const,
    MAX_DEVICES: 5,
    BCRYPT_ROUNDS: 10,
    DB_PATH: path.join(__dirname, '..', 'accounts.db'),
    GROQ_API_KEY: process.env.GROQ_API_KEY || '',
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
    // File storage
    DATA_ROOT,
    UPLOADS_PATH,
    MAX_FILE_SIZE: 500 * 1024 * 1024, // 500MB
    // Stripe billing
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || '',
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || '',
} as const;
