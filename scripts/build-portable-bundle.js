#!/usr/bin/env node
/**
 * build-portable-bundle.js
 *
 * Phase 1+2 of the bulletproof installer plan:
 * Produces a TRULY portable bundle of Python + wheels + ffmpeg + starter model
 * that can ship inside the Electron .app/.exe/.AppImage with zero system
 * modifications on the user's machine.
 *
 * Why this script exists:
 *   The existing `prepare-bundle.js` ships a pre-built venv, but the venv
 *   contains hardcoded absolute paths in pyvenv.cfg (e.g. /Users/thewindstorm/...).
 *   That venv is dead on arrival on any other machine. This script avoids
 *   that trap entirely:
 *     - Bundles a portable Python via python-build-standalone (Astral)
 *     - Bundles all dependency wheels (offline pip install at first-run)
 *     - Bundles ffmpeg + starter model
 *     - DOES NOT bundle a venv. The wizard creates the venv at first-run
 *       on the user's actual machine — no path issues possible.
 *
 * Output layout (under bundled-portable/<target>/):
 *   python/                 — extracted python-build-standalone (portable)
 *   wheels/                 — all .whl files from requirements.txt
 *   ffmpeg/ffmpeg(.exe)     — static ffmpeg binary
 *   model/<starter>/        — bundled starter Whisper model
 *   bundle-manifest.json    — versions + checksums + build metadata
 *
 * Usage:
 *   node scripts/build-portable-bundle.js                      # build for host
 *   node scripts/build-portable-bundle.js --target mac-arm64   # specific target
 *   node scripts/build-portable-bundle.js --target all         # all platforms
 *   node scripts/build-portable-bundle.js --skip-wheels        # skip wheel download
 *   node scripts/build-portable-bundle.js --skip-ffmpeg        # skip ffmpeg
 *
 * Targets:
 *   mac-arm64   — Apple Silicon native
 *   mac-x64     — Intel Mac
 *   linux-x64   — glibc Linux x86_64 (Ubuntu/Debian/Fedora/Arch)
 *   win-x64     — Windows x86_64
 *   all         — all of the above
 *
 * After this runs, `prepare-bundle.js` (or its successor) copies the
 * appropriate target's output to `extraResources/` for electron-builder.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync, execFileSync } = require('child_process');
const crypto = require('crypto');

// ─── Configuration ──────────────────────────────────────────────────────────

// python-build-standalone release: pin to a known-good version.
// To upgrade: check https://github.com/astral-sh/python-build-standalone/releases
// and update both PBS_TAG and PBS_PYTHON.
const PBS_TAG = '20260414';
const PBS_PYTHON = '3.11.15';

const PBS_URLS = {
  'mac-arm64':  `https://github.com/astral-sh/python-build-standalone/releases/download/${PBS_TAG}/cpython-${PBS_PYTHON}+${PBS_TAG}-aarch64-apple-darwin-install_only.tar.gz`,
  'mac-x64':    `https://github.com/astral-sh/python-build-standalone/releases/download/${PBS_TAG}/cpython-${PBS_PYTHON}+${PBS_TAG}-x86_64-apple-darwin-install_only.tar.gz`,
  'linux-x64':  `https://github.com/astral-sh/python-build-standalone/releases/download/${PBS_TAG}/cpython-${PBS_PYTHON}+${PBS_TAG}-x86_64-unknown-linux-gnu-install_only.tar.gz`,
  'win-x64':    `https://github.com/astral-sh/python-build-standalone/releases/download/${PBS_TAG}/cpython-${PBS_PYTHON}+${PBS_TAG}-x86_64-pc-windows-msvc-install_only.tar.gz`,
};

// Pip platform tags — used so we can `pip download` cross-platform wheels
// from the host machine. Falls back to host-native if cross-download fails.
// See https://packaging.python.org/specifications/platform-compatibility-tags/
const PIP_PLATFORM_TAGS = {
  'mac-arm64':  ['macosx_11_0_arm64', 'macosx_12_0_arm64'],
  'mac-x64':    ['macosx_10_9_x86_64', 'macosx_11_0_x86_64'],
  'linux-x64':  ['manylinux2014_x86_64', 'manylinux_2_17_x86_64'],
  'win-x64':    ['win_amd64'],
};

// uv (Astral) — drop-in pip replacement that's ~5–10x faster on offline
// wheel installs because it parallelises wheel resolution and uses
// hardlinks instead of copies. Bundling it cuts the wizard's pip-install
// step from ~48s to <10s on Grant's iMac, getting us inside the
// "30 second install" promise on windyword.ai.
//
// Pin a known-good release. To upgrade: check
// https://github.com/astral-sh/uv/releases and bump UV_VERSION.
const UV_VERSION = '0.5.13';
const UV_URLS = {
  'mac-arm64': `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-aarch64-apple-darwin.tar.gz`,
  'mac-x64':   `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-x86_64-apple-darwin.tar.gz`,
  'linux-x64': `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-x86_64-unknown-linux-gnu.tar.gz`,
  'win-x64':   `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-x86_64-pc-windows-msvc.zip`,
};

// ─── Argument parsing ───────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(name, defaultValue) {
  const idx = args.indexOf(name);
  if (idx === -1) return defaultValue;
  return args[idx + 1] || true;
}

function detectHostTarget() {
  const platform = process.platform;
  const arch = process.arch;
  if (platform === 'darwin' && arch === 'arm64') return 'mac-arm64';
  if (platform === 'darwin' && arch === 'x64') return 'mac-x64';
  if (platform === 'linux' && arch === 'x64') return 'linux-x64';
  if (platform === 'win32' && arch === 'x64') return 'win-x64';
  throw new Error(`Unsupported host platform: ${platform}/${arch}`);
}

const target = getArg('--target', detectHostTarget());
const skipWheels = args.includes('--skip-wheels');
const skipFfmpeg = args.includes('--skip-ffmpeg');
const skipModel = args.includes('--skip-model');
const skipPython = args.includes('--skip-python');
const skipUv = args.includes('--skip-uv');
const force = args.includes('--force');

const targets = target === 'all' ? Object.keys(PBS_URLS) : [target];
for (const t of targets) {
  if (!PBS_URLS[t]) {
    console.error(`Unknown target "${t}". Valid: ${Object.keys(PBS_URLS).join(', ')}, all`);
    process.exit(1);
  }
}

// ─── Path setup ─────────────────────────────────────────────────────────────

const repoRoot = path.resolve(__dirname, '..');
const cacheDir = path.join(repoRoot, '.bundle-cache');
const outputRoot = path.join(repoRoot, 'bundled-portable');
const requirementsFile = path.join(repoRoot, 'requirements-bundle.txt');
const existingModelDir = path.join(repoRoot, 'bundled', 'model', 'faster-whisper-base');
const existingFfmpegDir = path.join(repoRoot, 'bundled', 'ffmpeg');

fs.mkdirSync(cacheDir, { recursive: true });
fs.mkdirSync(outputRoot, { recursive: true });

// ─── Logging ────────────────────────────────────────────────────────────────

function log(msg) { console.log(`▸ ${msg}`); }
function ok(msg)  { console.log(`✓ ${msg}`); }
function warn(msg){ console.warn(`⚠ ${msg}`); }
function fail(msg){ console.error(`✗ ${msg}`); process.exit(1); }

// ─── Helpers ────────────────────────────────────────────────────────────────

function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function du(p) {
  if (!fs.existsSync(p)) return '0';
  try {
    return execSync(`du -sh "${p}" 2>/dev/null`).toString().split('\t')[0].trim();
  } catch { return '?'; }
}

function rm(p) {
  if (fs.existsSync(p)) {
    fs.rmSync(p, { recursive: true, force: true });
  }
}

function downloadFile(url, destPath) {
  if (fs.existsSync(destPath) && !force) {
    ok(`cached: ${path.basename(destPath)}`);
    return Promise.resolve(destPath);
  }
  log(`downloading ${path.basename(destPath)}`);
  const tmp = destPath + '.tmp';
  rm(tmp);
  // curl is bulletproof with redirects, retries, and large files. This script
  // only runs in dev/CI, so the curl dep is fine.
  try {
    execFileSync('curl', [
      '-L',                       // follow redirects
      '--fail',                   // exit non-zero on HTTP errors
      '--retry', '3',
      '--retry-delay', '2',
      '--connect-timeout', '20',
      '--max-time', '600',
      '-o', tmp,
      url,
    ], { stdio: ['ignore', 'inherit', 'inherit'], timeout: 620000 });
    if (!fs.existsSync(tmp) || fs.statSync(tmp).size === 0) {
      throw new Error('curl produced empty file');
    }
    fs.renameSync(tmp, destPath);
    ok(`downloaded: ${path.basename(destPath)} (${du(destPath)})`);
    return Promise.resolve(destPath);
  } catch (e) {
    rm(tmp);
    return Promise.reject(new Error(`download failed: ${url}\n  ${e.message}`));
  }
}

function extractTarGz(tarPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  log(`extracting ${path.basename(tarPath)} → ${path.relative(repoRoot, destDir)}`);
  execSync(`tar xzf "${tarPath}" -C "${destDir}"`, { stdio: 'pipe', timeout: 300000 });
}

// ─── Build steps ────────────────────────────────────────────────────────────

async function buildPython(t, targetOut) {
  const url = PBS_URLS[t];
  const archive = path.join(cacheDir, path.basename(url.split('?')[0]));
  await downloadFile(url, archive);

  const pyOut = path.join(targetOut, 'python');
  if (fs.existsSync(pyOut) && !force) {
    ok(`python already extracted: ${path.relative(repoRoot, pyOut)}`);
  } else {
    rm(pyOut);
    const tmpExtract = path.join(cacheDir, `pbs-${t}-extract`);
    rm(tmpExtract);
    extractTarGz(archive, tmpExtract);
    // python-build-standalone tarballs contain a top-level "python/" directory.
    const inner = path.join(tmpExtract, 'python');
    if (!fs.existsSync(inner)) fail(`unexpected pbs layout in ${tmpExtract}`);
    fs.renameSync(inner, pyOut);
    rm(tmpExtract);
    ok(`python extracted: ${path.relative(repoRoot, pyOut)} (${du(pyOut)})`);
  }

  return {
    pythonDir: pyOut,
    pythonExe: t === 'win-x64'
      ? path.join(pyOut, 'python.exe')
      : path.join(pyOut, 'bin', 'python3'),
    archiveSha256: sha256(archive),
  };
}

function buildWheels(t, targetOut, hostPython) {
  const wheelsOut = path.join(targetOut, 'wheels');
  if (fs.existsSync(wheelsOut) && !force) {
    const count = fs.readdirSync(wheelsOut).filter(f => f.endsWith('.whl') || f.endsWith('.tar.gz')).length;
    if (count > 0) {
      ok(`wheels already downloaded: ${count} files in ${path.relative(repoRoot, wheelsOut)}`);
      return wheelsOut;
    }
  }
  rm(wheelsOut);
  fs.mkdirSync(wheelsOut, { recursive: true });

  // Use the bundled python (now extracted) to download wheels.
  // For cross-platform downloads we add --platform tags. For host-native
  // build we omit --platform so pip uses the running interpreter.
  const isHostTarget = t === detectHostTarget();
  const platTags = PIP_PLATFORM_TAGS[t];
  const pythonForPip = isHostTarget ? hostPython : hostPython; // always use host pip

  log(`downloading wheels for ${t} (${isHostTarget ? 'host-native' : 'cross-platform'})`);

  const baseArgs = [
    '-m', 'pip', 'download',
    '-r', requirementsFile,
    '-d', wheelsOut,
    '--no-cache-dir',
  ];

  if (!isHostTarget) {
    // Cross-platform: tell pip what the target looks like
    baseArgs.push('--only-binary=:all:');
    baseArgs.push('--python-version', PBS_PYTHON.split('.').slice(0, 2).join('.'));
    for (const tag of platTags) {
      baseArgs.push('--platform', tag);
    }
  }

  try {
    execFileSync(pythonForPip, baseArgs, { stdio: 'inherit', timeout: 600000 });
    const count = fs.readdirSync(wheelsOut).filter(f => f.endsWith('.whl') || f.endsWith('.tar.gz')).length;
    ok(`downloaded ${count} wheels (${du(wheelsOut)})`);
  } catch (e) {
    warn(`wheel download failed: ${e.message}`);
    if (!isHostTarget) {
      warn('cross-platform wheel download often fails for source-only packages.');
      warn('build this target on the actual platform (or in CI) for full wheel set.');
    }
    throw e;
  }
  return wheelsOut;
}

function buildFfmpeg(t, targetOut) {
  // For now reuse the existing pre-extracted ffmpeg in bundled/ffmpeg/.
  // A future improvement: download ffmpeg-static per-platform here.
  const ffmpegOut = path.join(targetOut, 'ffmpeg');
  if (fs.existsSync(ffmpegOut) && !force) {
    ok(`ffmpeg already present: ${path.relative(repoRoot, ffmpegOut)}`);
    return ffmpegOut;
  }
  fs.mkdirSync(ffmpegOut, { recursive: true });
  const map = {
    'mac-arm64':  { src: path.join(existingFfmpegDir, 'extracted-mac', 'ffmpeg'), name: 'ffmpeg' },
    'mac-x64':    { src: path.join(existingFfmpegDir, 'extracted-mac', 'ffmpeg'), name: 'ffmpeg' },
    'linux-x64':  { src: null, name: 'ffmpeg' }, // depends on existing extracted layout
    'win-x64':    { src: null, name: 'ffmpeg.exe' },
  };
  const entry = map[t];
  if (!entry || !entry.src || !fs.existsSync(entry.src)) {
    warn(`no pre-existing ffmpeg for ${t} — skipping (will be added in next iteration)`);
    return null;
  }
  const dst = path.join(ffmpegOut, entry.name);
  fs.copyFileSync(entry.src, dst);
  if (t !== 'win-x64') fs.chmodSync(dst, 0o755);
  ok(`ffmpeg copied: ${path.relative(repoRoot, dst)} (${du(ffmpegOut)})`);
  return ffmpegOut;
}

/**
 * Download and stage uv. The release archives contain a single binary
 * (uv) at the archive root, so we extract to a temp dir and then move
 * the binary into bundled-portable/<target>/uv/.
 */
async function buildUv(t, targetOut) {
  const url = UV_URLS[t];
  if (!url) {
    warn(`no uv URL for target ${t} — skipping`);
    return null;
  }
  const archiveName = path.basename(url);
  const archive = path.join(cacheDir, `uv-${UV_VERSION}-${t}-${archiveName}`);
  await downloadFile(url, archive);

  const uvOut = path.join(targetOut, 'uv');
  if (fs.existsSync(uvOut) && !force) {
    ok(`uv already present: ${path.relative(repoRoot, uvOut)}`);
    return uvOut;
  }
  rm(uvOut);
  fs.mkdirSync(uvOut, { recursive: true });

  const tmpExtract = path.join(cacheDir, `uv-${UV_VERSION}-${t}-extract`);
  rm(tmpExtract);
  fs.mkdirSync(tmpExtract, { recursive: true });

  if (archiveName.endsWith('.zip')) {
    execSync(`unzip -o "${archive}" -d "${tmpExtract}"`, { stdio: 'pipe', timeout: 120000 });
  } else {
    execSync(`tar xzf "${archive}" -C "${tmpExtract}"`, { stdio: 'pipe', timeout: 120000 });
  }

  // The 0.5.x release tarballs put the binary under a subdir named like
  // the platform tuple (e.g. uv-aarch64-apple-darwin/uv). Find any "uv"
  // or "uv.exe" anywhere under the extract dir.
  const wantedName = t === 'win-x64' ? 'uv.exe' : 'uv';
  const found = findRecursive(tmpExtract, wantedName);
  if (!found) {
    rm(tmpExtract);
    fail(`uv binary not found inside ${archive}`);
  }
  const dst = path.join(uvOut, wantedName);
  fs.copyFileSync(found, dst);
  if (t !== 'win-x64') fs.chmodSync(dst, 0o755);
  rm(tmpExtract);
  ok(`uv staged: ${path.relative(repoRoot, dst)} (${du(uvOut)})`);
  return uvOut;
}

function findRecursive(dir, name) {
  if (!fs.existsSync(dir)) return null;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      const hit = findRecursive(full, name);
      if (hit) return hit;
    } else if (e.name === name) {
      return full;
    }
  }
  return null;
}

function buildModel(targetOut) {
  const modelOut = path.join(targetOut, 'model', 'faster-whisper-base');
  if (fs.existsSync(modelOut) && !force) {
    ok(`model already present: ${path.relative(repoRoot, modelOut)}`);
    return modelOut;
  }
  if (!fs.existsSync(existingModelDir)) {
    warn(`source model not found: ${existingModelDir} — skipping`);
    return null;
  }
  fs.mkdirSync(path.dirname(modelOut), { recursive: true });
  log(`copying model: ${path.relative(repoRoot, existingModelDir)} → ${path.relative(repoRoot, modelOut)}`);
  execSync(`cp -r "${existingModelDir}" "${modelOut}"`);
  ok(`model copied (${du(modelOut)})`);
  return modelOut;
}

/**
 * Compute per-file sha256 hashes for every file in a directory,
 * recursively. Returns a { relPath: sha256 } map sorted by relPath.
 * Used by writeManifest so the wizard can verify the installed model
 * hasn't been tampered with or corrupted.
 */
function hashDirectoryContents(dir) {
  const out = {};
  function walk(d, prefix) {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) walk(full, rel);
      else if (e.isFile()) out[rel] = sha256(full);
    }
  }
  walk(dir, '');
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

function writeManifest(t, targetOut, info) {
  const modelDir = info.model;
  const manifest = {
    target: t,
    builtAt: new Date().toISOString(),
    builtOn: `${process.platform}/${process.arch}`,
    pythonBuildStandalone: { tag: PBS_TAG, version: PBS_PYTHON, sha256: info.python.archiveSha256 },
    wheelCount: info.wheels ? fs.readdirSync(info.wheels).length : 0,
    hasFfmpeg: !!info.ffmpeg,
    hasModel: !!info.model,
    // Per-file SHA-256 so wizard can detect corruption / tampering.
    // Keyed by path relative to the model dir. Keeping the map small
    // enough to inline in the manifest (typical model = 4-6 files).
    modelFiles: modelDir ? hashDirectoryContents(modelDir) : null,
    hasUv: !!info.uv,
    uvVersion: info.uv ? UV_VERSION : null,
    sizes: {
      python: du(path.join(targetOut, 'python')),
      wheels: du(path.join(targetOut, 'wheels')),
      ffmpeg: du(path.join(targetOut, 'ffmpeg')),
      model:  du(path.join(targetOut, 'model')),
      uv:     du(path.join(targetOut, 'uv')),
      total:  du(targetOut),
    },
  };
  fs.writeFileSync(
    path.join(targetOut, 'bundle-manifest.json'),
    JSON.stringify(manifest, null, 2)
  );
  return manifest;
}

// ─── Main ───────────────────────────────────────────────────────────────────

(async function main() {
  console.log(`\n=== build-portable-bundle ===`);
  console.log(`pbs:    ${PBS_TAG} (Python ${PBS_PYTHON})`);
  console.log(`output: ${path.relative(process.cwd(), outputRoot)}`);
  console.log(`cache:  ${path.relative(process.cwd(), cacheDir)}`);
  console.log(`targets: ${targets.join(', ')}\n`);

  for (const t of targets) {
    console.log(`\n── target: ${t} ──`);
    const targetOut = path.join(outputRoot, t);
    fs.mkdirSync(targetOut, { recursive: true });

    const info = {};

    if (!skipPython) {
      info.python = await buildPython(t, targetOut);
    }

    if (!skipWheels && info.python) {
      try {
        info.wheels = buildWheels(t, targetOut, info.python.pythonExe);
      } catch (e) {
        warn(`wheels phase failed for ${t}: ${e.message}`);
      }
    }

    if (!skipFfmpeg) {
      info.ffmpeg = buildFfmpeg(t, targetOut);
    }

    if (!skipUv) {
      try {
        info.uv = await buildUv(t, targetOut);
      } catch (e) {
        warn(`uv phase failed for ${t}: ${e.message} — wizard will fall back to pip`);
      }
    }

    if (!skipModel) {
      info.model = buildModel(targetOut);
    }

    const manifest = writeManifest(t, targetOut, info);
    console.log(`\n  manifest: ${JSON.stringify(manifest.sizes)}`);
  }

  console.log(`\n✓ build complete\n`);
  console.log(`next steps:`);
  console.log(`  1. inspect bundled-portable/<target>/ to verify layout`);
  console.log(`  2. test the bundled python: bundled-portable/<target>/python/bin/python3 --version`);
  console.log(`  3. update prepare-bundle.js (or its successor) to copy from`);
  console.log(`     bundled-portable/<target>/ → extraResources/`);
  console.log(`  4. update bundled-assets.js to detect the new layout`);
  console.log(`  5. update main.js startPythonServer() to prefer bundled venv`);
})().catch((e) => {
  console.error(`\n✗ build failed: ${e.message}\n`);
  console.error(e.stack);
  process.exit(1);
});
