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
const targetIdx = args.indexOf('--target');
const target = targetIdx !== -1 ? args[targetIdx + 1] : detectHostTarget();

const repoRoot = path.resolve(__dirname, '..');
const src = path.join(repoRoot, 'bundled-portable', target);
const dst = path.join(repoRoot, 'extraResources');
const requirementsBundle = path.join(repoRoot, 'requirements-bundle.txt');

if (!fs.existsSync(src)) {
  console.error(`✗ ${src} not found.`);
  console.error(`  Run: node scripts/build-portable-bundle.js --target ${target}`);
  process.exit(1);
}

console.log(`▸ staging ${target} → extraResources/`);
if (fs.existsSync(dst)) execSync(`rm -rf "${dst}"`);
fs.mkdirSync(dst, { recursive: true });

// Copy each bundle component
for (const sub of ['python', 'wheels', 'ffmpeg', 'model']) {
  const subSrc = path.join(src, sub);
  if (!fs.existsSync(subSrc)) {
    console.warn(`⚠ ${sub}/ missing in ${src} — skipping`);
    continue;
  }
  const subDst = path.join(dst, sub);
  execSync(`cp -R "${subSrc}" "${subDst}"`);
  console.log(`✓ copied ${sub}/`);
}

// Copy the bundle requirements file (the wizard needs it to install wheels)
if (fs.existsSync(requirementsBundle)) {
  fs.copyFileSync(requirementsBundle, path.join(dst, 'requirements-bundle.txt'));
  console.log(`✓ copied requirements-bundle.txt`);
}

// Copy the manifest
const manifest = path.join(src, 'bundle-manifest.json');
if (fs.existsSync(manifest)) {
  fs.copyFileSync(manifest, path.join(dst, 'bundle-manifest.json'));
  console.log(`✓ copied bundle-manifest.json`);
}

const totalSize = execSync(`du -sh "${dst}" | cut -f1`).toString().trim();
console.log(`\n✓ extraResources/ ready (${totalSize})`);
console.log(`  next: npm run build:${target.startsWith('mac') ? 'mac' : target.startsWith('win') ? 'win' : 'linux'}`);
