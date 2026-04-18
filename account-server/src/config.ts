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
    DB_PATH: process.env.DB_PATH || path.join(__dirname, '..', 'accounts.db'),
    GROQ_API_KEY: process.env.GROQ_API_KEY || '',
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
    // File storage
    DATA_ROOT,
    UPLOADS_PATH,
    MAX_FILE_SIZE: 500 * 1024 * 1024, // 500MB
    // Stripe billing — set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET in .env or system env
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || '',
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || '',
    // Phase 7A: PostgreSQL + Redis (optional — omit for SQLite + in-memory defaults)
    DATABASE_URL: process.env.DATABASE_URL || '',   // postgres://... or '' for SQLite
    REDIS_URL: process.env.REDIS_URL || '',          // redis://... or '' for in-memory
    // Ecosystem product webhook URLs — used by provision-all to notify services
    WINDY_CHAT_WEBHOOK_URL: process.env.WINDY_CHAT_WEBHOOK_URL || '',   // e.g. http://chat-onboarding:8101/api/v1/chat/provision-hook
    WINDY_MAIL_WEBHOOK_URL: process.env.WINDY_MAIL_WEBHOOK_URL || '',   // e.g. http://windy-mail:8105/api/v1/mail/provision-hook
    // Ecosystem service URLs — used for direct provisioning and health checks
    // Ecosystem service URLs — used for direct provisioning and health checks.
    // Dev defaults reflect each service's own documented port (see each
    // repo's CLAUDE.md). Note: mail + cloud + eternitas all use 8200 by
    // default in their own repos; running them simultaneously in dev
    // requires overriding these via .env. Wave 7 P1-3 fix:
    //   - WINDY_CLOUD_URL was pointing at 8098, the account-server's own
    //     port — asking it to call itself when checking cloud health.
    //   - ETERNITAS_URL had the same 8200 as mail; now uses 8500 which is
    //     the conventional bot-registry dev port and avoids the collision.
    WINDY_CHAT_URL: process.env.WINDY_CHAT_URL || 'http://localhost:8101',
    WINDY_MAIL_URL: process.env.WINDY_MAIL_URL || 'http://localhost:8200',
    WINDY_CLOUD_URL: process.env.WINDY_CLOUD_URL || 'http://localhost:8103',
    ETERNITAS_URL: process.env.ETERNITAS_URL || 'http://localhost:8500',
    // Eternitas — bot identity & trust registry
    ETERNITAS_API_KEY: process.env.ETERNITAS_API_KEY || '',           // et_plt_xxx (platform API key)
    ETERNITAS_WEBHOOK_SECRET: process.env.ETERNITAS_WEBHOOK_SECRET || '', // For verifying inbound webhooks
    ETERNITAS_SERVICE_TOKEN: process.env.ETERNITAS_SERVICE_TOKEN || '',
    // Windy Chat — service-to-service auth
    CHAT_SERVICE_TOKEN: process.env.CHAT_SERVICE_TOKEN || '',
    // Windy Cloud — service-to-service auth for compute APIs (clone training, etc.)
    WINDY_CLOUD_SERVICE_TOKEN: process.env.WINDY_CLOUD_SERVICE_TOKEN || '',
    // AWS cloud STT failover — GPU instances for heavy transcription workloads
    AWS_STT_ENABLED: process.env.AWS_STT_ENABLED === 'true',
    AWS_STT_ENDPOINT: process.env.AWS_STT_ENDPOINT || '',  // e.g. https://stt.windycloud.ai/api/v1/compute/stt
    // Wave 8: Managed-credential broker — shared HMAC secret for
    // service-to-service credential issuance. Any caller of
    // POST /api/v1/agent/credentials/issue must sign with this.
    BROKER_HMAC_SECRET: process.env.BROKER_HMAC_SECRET || '',
    // Wave 8: Provider LLM keys — Pro holds these centrally and hands out
    // short-lived broker tokens; the agent never sees them directly.
    OPENAI_KEY: process.env.OPENAI_KEY || process.env.OPENAI_API_KEY || '',
    ANTHROPIC_KEY: process.env.ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY || '',
    GEMINI_KEY: process.env.GEMINI_KEY || process.env.GOOGLE_API_KEY || '',
    // Wave 8: Windy Fly (windy-agent) remote hatch — Pro calls /hatch/remote
    // on the agent host to spin up the user's managed agent.
    WINDY_AGENT_URL: process.env.WINDY_AGENT_URL || 'http://localhost:3000',
    WINDY_AGENT_SERVICE_TOKEN: process.env.WINDY_AGENT_SERVICE_TOKEN || '',
} as const;
