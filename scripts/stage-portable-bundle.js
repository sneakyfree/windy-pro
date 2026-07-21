#!/usr/bin/env node
/**
 * stage-portable-bundle.js
 *
 * Copies the output of build-portable-bundle.js (in bundled-portable/<target>/)
 * into the location electron-builder expects (extraResources/).
 *
 * This is the bridge between the new portable build pipeline and the existing
 * electron-builder config. Run it after build-portable-bundle.js, before
 * `npm run build:mac` / `npm run build:linux` / etc.
 *
 * Usage:
 *   node scripts/stage-portable-bundle.js                  # use host target
 *   node scripts/stage-portable-bundle.js --target mac-x64
 *   node scripts/stage-portable-bundle.js --universal      # macOS x64 + arm64
 *
 * --universal stages BOTH mac-x64 and mac-arm64 portable bundles into one
 * extraResources/ tree. The CPU-arch-specific payloads (python, wheels, ffmpeg,
 * uv) are written to `<name>-<arch>` dirs (python-x64, python-arm64, ...); the
 * arch-independent model/ + requirements + manifest are shared (single copy).
 * The app resolves the right arch at runtime (see installer-v2/core/
 * bundled-assets.js#_archDir and main.js#startPythonServer). This is what makes
 * a single Mac download "just work" on both Intel and Apple Silicon.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function detectHostTarget() {
  if (process.platform === 'darwin' && process.arch === 'arm64') return 'mac-arm64';
  if (process.platform === 'darwin' && process.arch === 'x64') return 'mac-x64';
  if (process.platform === 'linux' && process.arch === 'x64') return 'linux-x64';
  if (process.platform === 'win32' && process.arch === 'x64') return 'win-x64';
  throw new Error(`Unsupported host: ${process.platform}/${process.arch}`);
}

const args = process.argv.slice(2);
const universal = args.includes('--universal');
const targetIdx = args.indexOf('--target');
const target = targetIdx !== -1 ? args[targetIdx + 1] : detectHostTarget();

const repoRoot = path.resolve(__dirname, '..');
const dst = path.join(repoRoot, 'extraResources');
const requirementsBundle = path.join(repoRoot, 'requirements-bundle.txt');

// CPU-arch-specific native payloads (suffixed per-arch in universal builds) vs
// arch-independent payloads (shared, single copy).
const ARCH_SUBS = ['python', 'wheels', 'ffmpeg', 'uv'];
const SHARED_SUBS = ['model'];

/** Copy one bundle component from a source target dir into extraResources/. */
function copySub(srcTargetDir, sub, dstName) {
  const subSrc = path.join(srcTargetDir, sub);
  if (!fs.existsSync(subSrc)) return false;
  const subDst = path.join(dst, dstName);
  // fs.rmSync/cpSync (not `rm -rf`/`cp -R`) so staging works on Windows — those are
  // Unix-only and crashed native Windows builds in cmd.exe (Mission 10b, 2026-07-08).
  if (fs.existsSync(subDst)) fs.rmSync(subDst, { recursive: true, force: true });
  // verbatimSymlinks keeps the bundle's relative symlinks (python's pkgconfig/man
  // links) intact — the default resolves them to absolute build-tree paths, which
  // breaks the codesign resource seal on macOS.
  fs.cpSync(subSrc, subDst, { recursive: true, verbatimSymlinks: true });
  console.log(`✓ copied ${sub}/ → ${dstName}/`);
  return true;
}

/** Copy the shared requirements + manifest from a source target dir (once). */
function copyMeta(srcTargetDir) {
  if (fs.existsSync(requirementsBundle) && !fs.existsSync(path.join(dst, 'requirements-bundle.txt'))) {
    fs.copyFileSync(requirementsBundle, path.join(dst, 'requirements-bundle.txt'));
    console.log(`✓ copied requirements-bundle.txt`);
  }
  const manifest = path.join(srcTargetDir, 'bundle-manifest.json');
  if (fs.existsSync(manifest) && !fs.existsSync(path.join(dst, 'bundle-manifest.json'))) {
    fs.copyFileSync(manifest, path.join(dst, 'bundle-manifest.json'));
    console.log(`✓ copied bundle-manifest.json`);
  }
}

// fs.rmSync (not `rm -rf`) so staging works on Windows — Unix-only commands crashed
// native Windows builds in cmd.exe (Mission 10b, 2026-07-08).
if (fs.existsSync(dst)) fs.rmSync(dst, { recursive: true, force: true });
fs.mkdirSync(dst, { recursive: true });

if (universal) {
  // macOS only: stage both arches into one tree.
  const targets = [
    { dir: 'mac-x64', arch: 'x64' },
    { dir: 'mac-arm64', arch: 'arm64' },
  ];
  console.log(`▸ staging UNIVERSAL (${targets.map(t => t.dir).join(' + ')}) → extraResources/`);
  for (const { dir, arch } of targets) {
    const srcTargetDir = path.join(repoRoot, 'bundled-portable', dir);
    if (!fs.existsSync(srcTargetDir)) {
      console.error(`✗ ${srcTargetDir} not found.`);
      console.error(`  Run: node scripts/build-portable-bundle.js --target ${dir}`);
      process.exit(1);
    }
    // Arch-specific → suffixed dirs.
    for (const sub of ARCH_SUBS) copySub(srcTargetDir, sub, `${sub}-${arch}`);
    // Arch-independent → shared (only stage once, from whichever target has it).
    for (const sub of SHARED_SUBS) {
      if (!fs.existsSync(path.join(dst, sub))) copySub(srcTargetDir, sub, sub);
    }
    copyMeta(srcTargetDir);
  }
} else {
  const src = path.join(repoRoot, 'bundled-portable', target);
  if (!fs.existsSync(src)) {
    console.error(`✗ ${src} not found.`);
    console.error(`  Run: node scripts/build-portable-bundle.js --target ${target}`);
    process.exit(1);
  }
  console.log(`▸ staging ${target} → extraResources/`);
  for (const sub of [...ARCH_SUBS, ...SHARED_SUBS]) {
    if (!copySub(src, sub, sub)) console.warn(`⚠ ${sub}/ missing in ${src} — skipping`);
  }
  copyMeta(src);
}

// `du` is Unix-only; guard so the final size print never crashes staging on Windows.
let totalSize = '?';
try { totalSize = execSync(`du -sh "${dst}" | cut -f1`).toString().trim(); } catch { /* windows / no du */ }
console.log(`\n✓ extraResources/ ready (${totalSize})`);
if (universal) {
  console.log(`  next: npx electron-builder --mac dmg --universal --publish never`);
} else {
  console.log(`  next: npm run build:${target.startsWith('mac') ? 'mac' : target.startsWith('win') ? 'win' : 'linux'}`);
}
