// library-service.js — manages the Control Panel's local drop library.
//
// State file: <userData>/control-panel-library.json
//   {
//     "selected": "windy-echo-hq",        // dropId currently active in the renderer
//     "selected_version": "0.1.0",        // version pinned by user
//     "installed": [                      // user-installed drops (NOT built-ins)
//       {
//         "id": "windy-glance",
//         "version": "0.1.0",
//         "name": "Glance",               // cached from manifest for offline list-render
//         "subtitle": "...",
//         "type": "control-panel-template",
//         "installed_at": "2026-05-22T...Z",
//         "bundle_origin": "https://drops.windydrops.com/windy-glance/0.1.0"
//       }
//     ]
//   }
//
// Echo HQ is built-in (ships with the Pro DMG under src/client/desktop/control-panel/drops/)
// and is always available — not tracked in installed[]. It's surfaced
// in listAll() with source: "builtin" so the renderer can list it
// alongside installed drops.

const fs = require('fs');
const path = require('path');
const https = require('https');

const REGISTRY_BASE = process.env.WINDY_REGISTRY_URL || 'https://api.windydrops.com';

const BUILTIN_ECHO_HQ = {
  id: 'windy-echo-hq',
  version: '0.1.0',
  name: 'Echo HQ',
  subtitle: "Cyberpunk-vitals dashboard for the box you're sitting at",
  type: 'control-panel-template',
  source: 'builtin',
};

function libraryPath(userDataDir) {
  return path.join(userDataDir, 'control-panel-library.json');
}

function loadLibrary(userDataDir) {
  const p = libraryPath(userDataDir);
  if (!fs.existsSync(p)) {
    return {
      selected: BUILTIN_ECHO_HQ.id,
      selected_version: BUILTIN_ECHO_HQ.version,
      installed: [],
    };
  }
  try {
    const raw = fs.readFileSync(p, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      selected: parsed.selected || BUILTIN_ECHO_HQ.id,
      selected_version: parsed.selected_version || BUILTIN_ECHO_HQ.version,
      installed: Array.isArray(parsed.installed) ? parsed.installed : [],
    };
  } catch {
    return {
      selected: BUILTIN_ECHO_HQ.id,
      selected_version: BUILTIN_ECHO_HQ.version,
      installed: [],
    };
  }
}

function saveLibrary(userDataDir, library) {
  const p = libraryPath(userDataDir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(library, null, 2), 'utf-8');
}

/**
 * Return every drop the user has access to — built-in Echo HQ first,
 * then installed drops in install order. Each entry has a `source`
 * field ("builtin" | "installed") so the renderer can style + tag
 * them appropriately.
 */
function listAll(userDataDir) {
  const lib = loadLibrary(userDataDir);
  return [
    BUILTIN_ECHO_HQ,
    ...lib.installed.map((drop) => ({ ...drop, source: 'installed' })),
  ];
}

function getSelected(userDataDir) {
  const lib = loadLibrary(userDataDir);
  return { id: lib.selected, version: lib.selected_version };
}

function setSelected(userDataDir, dropId, version) {
  const lib = loadLibrary(userDataDir);
  // Validate target exists (built-in or installed).
  const matchesBuiltin = dropId === BUILTIN_ECHO_HQ.id && version === BUILTIN_ECHO_HQ.version;
  const installed = lib.installed.find((d) => d.id === dropId && d.version === version);
  if (!matchesBuiltin && !installed) {
    throw new Error(`Cannot select unknown drop: ${dropId}@${version}`);
  }
  lib.selected = dropId;
  lib.selected_version = version;
  saveLibrary(userDataDir, lib);
  return { id: dropId, version };
}

/**
 * Record an install. We DON'T download the bundle — the iframe loads
 * directly from the CDN (drops.windydrops.com) on render. Recording the
 * install lets the user pick the drop from their library list without
 * a registry round-trip every time. v1.1 will add offline-mode +
 * actual bundle download.
 */
function installDrop(userDataDir, manifest) {
  if (!manifest || !manifest.id || !manifest.version) {
    throw new Error('installDrop: manifest must include id + version');
  }
  if (manifest.id === BUILTIN_ECHO_HQ.id) {
    throw new Error('installDrop: Echo HQ is built-in and cannot be re-installed');
  }
  const lib = loadLibrary(userDataDir);
  const existing = lib.installed.find((d) => d.id === manifest.id);
  const entry = {
    id: manifest.id,
    version: manifest.version,
    name: manifest.name || manifest.id,
    subtitle: manifest.subtitle || '',
    type: manifest.type || 'control-panel-template',
    installed_at: new Date().toISOString(),
    bundle_origin: `https://drops.windydrops.com/${encodeURIComponent(manifest.id)}/${encodeURIComponent(manifest.version)}`,
  };
  if (existing) {
    // Update version + metadata; preserve installed_at if matched version.
    if (existing.version === manifest.version) entry.installed_at = existing.installed_at;
    lib.installed = lib.installed.map((d) => (d.id === manifest.id ? entry : d));
  } else {
    lib.installed.push(entry);
  }
  saveLibrary(userDataDir, lib);
  return entry;
}

function uninstallDrop(userDataDir, dropId) {
  if (dropId === BUILTIN_ECHO_HQ.id) {
    throw new Error('uninstallDrop: Echo HQ is built-in and cannot be uninstalled');
  }
  const lib = loadLibrary(userDataDir);
  const before = lib.installed.length;
  lib.installed = lib.installed.filter((d) => d.id !== dropId);
  if (lib.installed.length === before) {
    return { removed: false };
  }
  // If the uninstalled drop was selected, fall back to built-in.
  if (lib.selected === dropId) {
    lib.selected = BUILTIN_ECHO_HQ.id;
    lib.selected_version = BUILTIN_ECHO_HQ.version;
  }
  saveLibrary(userDataDir, lib);
  return { removed: true };
}

/**
 * Fetch the registry catalog via api.windydrops.com. Returns the raw
 * registry response shape so the renderer can pick what it needs.
 */
function browseRegistry(query = {}) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams();
    if (query.type) params.set('type', query.type);
    if (query.q) params.set('q', query.q);
    if (query.limit) params.set('limit', String(query.limit));
    const url = `${REGISTRY_BASE}/api/v1/drops${params.toString() ? `?${params}` : ''}`;
    https
      .get(url, { headers: { Accept: 'application/json' } }, (res) => {
        let body = '';
        res.setEncoding('utf-8');
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            return reject(new Error(`registry returned HTTP ${res.statusCode}`));
          }
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(err);
          }
        });
      })
      .on('error', reject);
  });
}

module.exports = {
  BUILTIN_ECHO_HQ,
  REGISTRY_BASE,
  libraryPath,
  loadLibrary,
  saveLibrary,
  listAll,
  getSelected,
  setSelected,
  installDrop,
  uninstallDrop,
  browseRegistry,
};
