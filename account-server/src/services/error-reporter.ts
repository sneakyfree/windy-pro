/**
 * Lightweight error reporter. Posts to Sentry DSN if configured.
 * No npm dependency — uses native fetch to Sentry's envelope API.
 */

interface SentryDsnParts {
    publicKey: string;
    host: string;
    projectId: string;
}

function parseDsn(dsn: string): SentryDsnParts | null {
    try {
        const url = new URL(dsn);
        const publicKey = url.username;
        const host = url.host;
        const projectId = url.pathname.replace('/', '');
        if (!publicKey || !host || !projectId) return null;
        return { publicKey, host, projectId };
    } catch {
        return null;
    }
}

export function reportError(error: Error, context?: Record<string, any>): void {
    const dsn = process.env.SENTRY_DSN;
    if (!dsn) return;

    const parts = parseDsn(dsn);
    if (!parts) return;

    const envelope = buildEnvelope(parts, error, context);
    const url = `https://${parts.host}/api/${parts.projectId}/envelope/`;

    // Fire-and-forget — don't await, don't block
    fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-sentry-envelope',
            'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${parts.publicKey}, sentry_client=windy-pro/1.0`,
        },
        body: envelope,
    }).catch(() => {
        // Silently ignore — error reporting should never itself cause errors
    });
}

function buildEnvelope(parts: SentryDsnParts, error: Error, context?: Record<string, any>): string {
    const eventId = crypto.randomUUID().replace(/-/g, '');
    const timestamp = new Date().toISOString();

    const header = JSON.stringify({
        event_id: eventId,
        dsn: process.env.SENTRY_DSN,
        sent_at: timestamp,
    });

    const itemHeader = JSON.stringify({
        type: 'event',
        content_type: 'application/json',
    });

    const event = JSON.stringify({
        event_id: eventId,
        timestamp,
        platform: 'node',
        server_name: 'windy-pro-account-server',
        environment: process.env.NODE_ENV || 'development',
        exception: {
            values: [{
                type: error.name || 'Error',
                value: error.message,
                stacktrace: error.stack ? {
                    frames: error.stack.split('\n').slice(1).reverse().map(line => {
                        const match = line.match(/at\s+(.+?)\s+\((.+):(\d+):(\d+)\)/);
                        if (match) {
                            return {
                                function: match[1],
                                filename: match[2],
                                lineno: parseInt(match[3]),
                                colno: parseInt(match[4]),
                            };
                        }
                        const simpleMatch = line.match(/at\s+(.+):(\d+):(\d+)/);
                        if (simpleMatch) {
                            return {
                                filename: simpleMatch[1],
                                lineno: parseInt(simpleMatch[2]),
                                colno: parseInt(simpleMatch[3]),
                            };
                        }
                        return { filename: line.trim() };
                    }),
                } : undefined,
            }],
        },
        extra: context || {},
    });

    return `${header}\n${itemHeader}\n${event}`;
}

export function initErrorReporting(): void {
    const dsn = process.env.SENTRY_DSN;
    if (!dsn) {
        console.log('[Sentry] No DSN configured — error reporting disabled');
        return;
    }

    const parts = parseDsn(dsn);
    if (!parts) {
        console.warn('[Sentry] Invalid DSN format — error reporting disabled');
        return;
    }

    process.on('uncaughtException', (err) => {
        reportError(err, { handler: 'uncaughtException' });
    });

    process.on('unhandledRejection', (err) => {
        reportError(
            err instanceof Error ? err : new Error(String(err)),
            { handler: 'unhandledRejection' }
        );
    });

    console.log('[Sentry] Error reporting initialized');
}
