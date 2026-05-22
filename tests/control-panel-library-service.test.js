/**
 * @jest-environment node
 *
 * WD-31 Phase 3a — library service unit tests.
 *
 * Pure-Node module (fs + https), trivially testable with a tmp userData dir.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const libsvc = require('../src/client/desktop/control-panel/library-service.js');

function freshDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cp-lib-test-'));
}

describe('library-service', () => {
  describe('initial state', () => {
    test('listAll returns built-in Echo HQ only', () => {
      const d = freshDir();
      const list = libsvc.listAll(d);
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe('windy-echo-hq');
      expect(list[0].source).toBe('builtin');
    });

    test('getSelected returns built-in Echo HQ', () => {
      const d = freshDir();
      const sel = libsvc.getSelected(d);
      expect(sel).toEqual({ id: 'windy-echo-hq', version: '0.1.0' });
    });

    test('no library file is created until first write', () => {
      const d = freshDir();
      libsvc.listAll(d);
      expect(fs.existsSync(libsvc.libraryPath(d))).toBe(false);
    });
  });

  describe('installDrop', () => {
    test('records the drop with bundle_origin pointing at CDN', () => {
      const d = freshDir();
      const entry = libsvc.installDrop(d, {
        id: 'windy-glance',
        version: '0.1.0',
        name: 'Glance',
        subtitle: 'Calm at-a-glance vitals',
        type: 'control-panel-template',
      });
      expect(entry.id).toBe('windy-glance');
      expect(entry.bundle_origin).toBe('https://drops.windydrops.com/windy-glance/0.1.0');
      expect(entry.installed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    test('appears in listAll alongside built-in', () => {
      const d = freshDir();
      libsvc.installDrop(d, { id: 'windy-glance', version: '0.1.0', name: 'Glance' });
      const list = libsvc.listAll(d);
      expect(list).toHaveLength(2);
      expect(list[0].id).toBe('windy-echo-hq');
      expect(list[1].id).toBe('windy-glance');
      expect(list[1].source).toBe('installed');
    });

    test('rejects re-install of built-in Echo HQ', () => {
      const d = freshDir();
      expect(() =>
        libsvc.installDrop(d, { id: 'windy-echo-hq', version: '0.1.0', name: 'Echo HQ' }),
      ).toThrow(/built-in/);
    });

    test('rejects manifest without id or version', () => {
      const d = freshDir();
      expect(() => libsvc.installDrop(d, { id: 'no-ver' })).toThrow(/id \+ version/);
      expect(() => libsvc.installDrop(d, { version: '1.0.0' })).toThrow(/id \+ version/);
      expect(() => libsvc.installDrop(d, null)).toThrow(/id \+ version/);
    });

    test('upgrading the same drop replaces the version + preserves installed_at on same version', () => {
      const d = freshDir();
      const v1 = libsvc.installDrop(d, { id: 'windy-glance', version: '0.1.0', name: 'Glance' });
      // Re-install same version: preserve installed_at.
      const v1again = libsvc.installDrop(d, { id: 'windy-glance', version: '0.1.0', name: 'Glance' });
      expect(v1again.installed_at).toBe(v1.installed_at);
      // Install newer version: replace entry.
      const v2 = libsvc.installDrop(d, { id: 'windy-glance', version: '0.2.0', name: 'Glance 2' });
      const list = libsvc.listAll(d);
      const glance = list.find((dr) => dr.id === 'windy-glance');
      expect(glance.version).toBe('0.2.0');
      expect(glance.name).toBe('Glance 2');
      expect(v2.bundle_origin).toBe('https://drops.windydrops.com/windy-glance/0.2.0');
    });
  });

  describe('setSelected', () => {
    test('switches between built-in and installed drops', () => {
      const d = freshDir();
      libsvc.installDrop(d, { id: 'windy-glance', version: '0.1.0', name: 'Glance' });
      libsvc.setSelected(d, 'windy-glance', '0.1.0');
      expect(libsvc.getSelected(d)).toEqual({ id: 'windy-glance', version: '0.1.0' });
      libsvc.setSelected(d, 'windy-echo-hq', '0.1.0');
      expect(libsvc.getSelected(d)).toEqual({ id: 'windy-echo-hq', version: '0.1.0' });
    });

    test('rejects selecting an unknown drop', () => {
      const d = freshDir();
      expect(() => libsvc.setSelected(d, 'never-installed', '1.0.0')).toThrow(/unknown/);
    });

    test('rejects selecting wrong version of installed drop', () => {
      const d = freshDir();
      libsvc.installDrop(d, { id: 'windy-glance', version: '0.1.0', name: 'Glance' });
      expect(() => libsvc.setSelected(d, 'windy-glance', '9.9.9')).toThrow(/unknown/);
    });
  });

  describe('uninstallDrop', () => {
    test('removes an installed drop', () => {
      const d = freshDir();
      libsvc.installDrop(d, { id: 'windy-glance', version: '0.1.0', name: 'Glance' });
      const result = libsvc.uninstallDrop(d, 'windy-glance');
      expect(result.removed).toBe(true);
      const list = libsvc.listAll(d);
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe('windy-echo-hq');
    });

    test('falls back selected to built-in when the uninstalled drop was selected', () => {
      const d = freshDir();
      libsvc.installDrop(d, { id: 'windy-glance', version: '0.1.0', name: 'Glance' });
      libsvc.setSelected(d, 'windy-glance', '0.1.0');
      libsvc.uninstallDrop(d, 'windy-glance');
      expect(libsvc.getSelected(d)).toEqual({ id: 'windy-echo-hq', version: '0.1.0' });
    });

    test('rejects uninstall of built-in Echo HQ', () => {
      const d = freshDir();
      expect(() => libsvc.uninstallDrop(d, 'windy-echo-hq')).toThrow(/built-in/);
    });

    test('returns {removed: false} for unknown drop (no-op)', () => {
      const d = freshDir();
      const result = libsvc.uninstallDrop(d, 'never-installed');
      expect(result.removed).toBe(false);
    });
  });

  describe('persistence', () => {
    test('survives across module re-requires', () => {
      const d = freshDir();
      libsvc.installDrop(d, { id: 'windy-glance', version: '0.1.0', name: 'Glance' });
      libsvc.setSelected(d, 'windy-glance', '0.1.0');

      // Simulate fresh start: clear the require cache for the service.
      const servicePath = require.resolve('../src/client/desktop/control-panel/library-service.js');
      delete require.cache[servicePath];
      const libsvc2 = require('../src/client/desktop/control-panel/library-service.js');

      expect(libsvc2.getSelected(d)).toEqual({ id: 'windy-glance', version: '0.1.0' });
      expect(libsvc2.listAll(d)).toHaveLength(2);
    });

    test('corrupt library file falls back to defaults gracefully', () => {
      const d = freshDir();
      fs.writeFileSync(libsvc.libraryPath(d), 'not json at all');
      expect(libsvc.getSelected(d)).toEqual({ id: 'windy-echo-hq', version: '0.1.0' });
      expect(libsvc.listAll(d)).toHaveLength(1);
    });
  });
});
