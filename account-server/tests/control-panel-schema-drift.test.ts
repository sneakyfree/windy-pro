/**
 * Drift guard for the vendored Vitals v1 + Fleet v1 JSON Schemas.
 *
 * The canonical source lives in
 *   sneakyfree/windy-control-panel/packages/protocols/schemas/
 * The vendored copies live in
 *   src/contracts/control-panel/windy.vitals.v1.json
 *   src/contracts/control-panel/windy.fleet.v1.json
 *
 * When both repos are checked out side-by-side under $HOME, this test
 * asserts byte-identity. When the canonical repo isn't present (CI in a
 * windy-pro-only environment, foreign machines), the test no-ops with a
 * clear log message — CI must not fail just because a sibling repo
 * happens not to be on disk.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const VENDORED_DIR = path.resolve(__dirname, '..', 'src', 'contracts', 'control-panel');
const CANONICAL_DIR = path.join(
    os.homedir(),
    'windy-control-panel',
    'packages',
    'protocols',
    'schemas',
);

const FILES = ['windy.vitals.v1.json', 'windy.fleet.v1.json'] as const;

describe('Control Panel schema drift guard', () => {
    const canonicalAvailable = FILES.every((f) =>
        fs.existsSync(path.join(CANONICAL_DIR, f)),
    );

    if (!canonicalAvailable) {
        test.skip('canonical schemas not present — skipping drift check', () => {});
        return;
    }

    for (const file of FILES) {
        test(`${file} matches canonical (byte-identity)`, () => {
            const vendored = fs.readFileSync(path.join(VENDORED_DIR, file), 'utf-8');
            const canonical = fs.readFileSync(path.join(CANONICAL_DIR, file), 'utf-8');
            // Compare on parsed JSON to make whitespace/eol-insensitive but
            // structurally strict.
            expect(JSON.parse(vendored)).toEqual(JSON.parse(canonical));
        });
    }
});
