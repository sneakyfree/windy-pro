/**
 * translateSQL — two-arg SQLite datetime() must translate to Postgres.
 *
 * Prod regression: ecosystem-provisioner uses datetime('now', '+5 minutes')
 * (pending_provisions INSERT), datetime('now', '+N minutes') (retry backoff
 * UPDATE) and datetime('now', '-N days') (both cleanup DELETEs). The adapter
 * only translated the one-arg datetime('now'), so all four queries failed on
 * Postgres with "function datetime(unknown, unknown) does not exist" — the
 * hatch retry queue and its cleanup never worked in prod.
 */
import { translateSQL } from '../src/db/postgres-adapter';

describe('translateSQL — datetime() interval forms', () => {
    it('translates one-arg datetime(\'now\')', () => {
        expect(translateSQL("SELECT datetime('now')")).toBe('SELECT NOW()');
    });

    it('translates +minutes (pending_provisions INSERT)', () => {
        expect(translateSQL("VALUES (?, datetime('now'), datetime('now', '+5 minutes'))"))
            .toBe("VALUES ($1, NOW(), (NOW() + INTERVAL '5 minutes'))");
    });

    it('translates interpolated backoff minutes (retry UPDATE)', () => {
        expect(translateSQL("SET next_retry_at = datetime('now', '+40 minutes') WHERE id = ?"))
            .toBe("SET next_retry_at = (NOW() + INTERVAL '40 minutes') WHERE id = $1");
    });

    it('translates -days (cleanup DELETEs)', () => {
        expect(translateSQL("WHERE created_at < datetime('now', '-30 days')"))
            .toBe("WHERE created_at < (NOW() - INTERVAL '30 days')");
    });

    it('every datetime() call in ecosystem-provisioner.ts translates away', () => {
        const fs = require('fs');
        const path = require('path');
        const src = fs.readFileSync(
            path.join(__dirname, '../src/services/ecosystem-provisioner.ts'),
            'utf8',
        );
        const calls = src.match(/datetime\s*\([^)]*\)/g) || [];
        expect(calls.length).toBeGreaterThan(0);
        for (const call of calls) {
            // Interpolated ${...} values are numbers at runtime — substitute one
            const runtime = call.replace(/\$\{[^}]+\}/g, '7');
            expect(translateSQL(runtime)).not.toMatch(/datetime\s*\(/);
        }
    });
});
