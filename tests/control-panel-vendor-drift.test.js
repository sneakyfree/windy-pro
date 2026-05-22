/**
 * @jest-environment node
 *
 * WD-31 M-H drift guard — when sneakyfree/windy-control-panel is checked
 * out side-by-side at ~/windy-control-panel/, asserts that the wire
 * constants in this repo's vendored copies match the canonical sources.
 *
 * The canonical packages use Zod for runtime validation; the vendored
 * copies have Zod stripped (no bundler in the renderer). Byte equality
 * is therefore not the right check — but the wire constants (schema
 * IDs, message type strings, sandbox origin lock) MUST stay in sync or
 * the iframe protocol silently breaks. This test catches that drift
 * via textual presence checks across both repos.
 *
 * Cleanly skips when ~/windy-control-panel is absent (CI in a
 * windy-pro-only environment, foreign machines).
 *
 * See VENDOR_README.md for the broader vendoring contract and
 * [[feedback_vendor_drift_guard_pattern]] for the pattern.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const VENDOR_DIR = path.join(
  __dirname, '..', 'src', 'client', 'desktop', 'control-panel', 'vendor',
);
const CANONICAL_ROOT = path.join(os.homedir(), 'windy-control-panel');

const CANONICAL_FILES = {
  hostWebHost: path.join(CANONICAL_ROOT, 'packages', 'host-web', 'src', 'host.ts'),
  hostWebProtocol: path.join(CANONICAL_ROOT, 'packages', 'host-web', 'src', 'protocol.ts'),
  protocolsIndex: path.join(CANONICAL_ROOT, 'packages', 'protocols', 'src', 'index.ts'),
  hostElectronCollect: path.join(CANONICAL_ROOT, 'packages', 'host-electron', 'src', 'collect.ts'),
};

const canonicalAvailable = Object.values(CANONICAL_FILES).every((p) => fs.existsSync(p));

(canonicalAvailable ? describe : describe.skip)(
  'Control Panel vendor drift guard (canonical present)',
  () => {
    // Read all canonical sources once.
    const canon = Object.fromEntries(
      Object.entries(CANONICAL_FILES).map(([k, p]) => [k, fs.readFileSync(p, 'utf-8')]),
    );

    function vendor(rel) {
      return fs.readFileSync(path.join(VENDOR_DIR, rel), 'utf-8');
    }

    test('vendor/host-web/host.js sandbox origin lock matches canonical', () => {
      // Both must lock the iframe's origin to the literal string "null"
      // (forced by sandbox="allow-scripts" with no allow-same-origin grant
      // per ADR-053 §"Sandbox security model (v1)"). If the canonical
      // ever changes this string, the registry's sandbox_host.py + every
      // consumer surface must update in lockstep.
      expect(canon.hostWebHost).toMatch(/const\s+NULL_ORIGIN\s*=\s*["']null["']/);
      const host = vendor('host-web/host.js');
      expect(host).toMatch(/=\s*["']null["']/);
    });

    test('vendor/host-web/host.js targetOrigin "*" matches canonical', () => {
      // Both must use "*" as the postMessage targetOrigin when posting to
      // the null-origin iframe — spec doesn't permit "null" as a
      // targetOrigin value.
      expect(canon.hostWebHost).toMatch(/postMessage\([^,]+,\s*["']\*["']\)/);
      expect(vendor('host-web/host.js')).toMatch(/postMessage\([^,]+,\s*["']\*["']\)/);
    });

    test('vendor/host-web/protocol.js wire message types match canonical', () => {
      // The 4 envelope types — "ready", "rendered", "error",
      // "data-update" — define the host↔drop protocol. Both sides must
      // agree on the strings.
      const wireTypes = ['"ready"', '"rendered"', '"error"', '"data-update"'];
      const canonProto = canon.hostWebProtocol;
      const vendorProto = vendor('host-web/protocol.js');
      for (const t of wireTypes) {
        expect(canonProto).toContain(t);
        expect(vendorProto).toContain(t);
      }
    });

    test('vendor/protocols/index.js Vitals + Fleet schema IDs match canonical', () => {
      // The two schema literals are the version handshake for the entire
      // host↔drop data flow. A typo in either silently breaks every drop.
      expect(canon.protocolsIndex).toContain('"windy.vitals.v1"');
      expect(canon.protocolsIndex).toContain('"windy.fleet.v1"');
      const v = vendor('protocols/index.js');
      expect(v).toContain('"windy.vitals.v1"');
      expect(v).toContain('"windy.fleet.v1"');
    });

    test('vendor/collect.cjs Vitals schema ID matches canonical', () => {
      // Canonical collect.ts imports `VITALS_V1_SCHEMA_ID` from the
      // protocols package (= "windy.vitals.v1"); the vendored CJS port
      // has the constant inlined as the literal. Check that both end
      // up emitting the right schema string.
      expect(canon.hostElectronCollect).toMatch(/VITALS_V1_SCHEMA_ID/);
      expect(canon.protocolsIndex).toContain('"windy.vitals.v1"');
      expect(vendor('collect.cjs')).toContain('"windy.vitals.v1"');
    });

    test('renderer-side vendored files match canonical surface (exports)', () => {
      // Vendored copies have Zod stripped, but the exported function/
      // value NAMES (createHost, parseFromChildMessage, etc.) must match
      // upstream so the renderer's import statements keep resolving.
      const canonHostExports = (canon.hostWebHost.match(/export\s+(?:function|const)\s+\w+/g) || []).map(
        (s) => s.replace(/^export\s+(?:function|const)\s+/, ''),
      );
      const vendorHostExports = (vendor('host-web/host.js').match(/export\s+(?:function|const)\s+\w+/g) || []).map(
        (s) => s.replace(/^export\s+(?:function|const)\s+/, ''),
      );
      // Every canonical-public export must be present in the vendor.
      // (Vendor may have extras for the stripped Zod replacements.)
      for (const name of canonHostExports) {
        expect(vendorHostExports).toContain(name);
      }
    });
  },
);

describe('Control Panel vendor drift guard (skip path)', () => {
  test('canonical absence does not break CI', () => {
    // Pure documentation of intended behavior — the describe.skip above
    // already does the work. This test exists so jest reports SOMETHING
    // even when canonical isn't checked out.
    expect(true).toBe(true);
  });
});
