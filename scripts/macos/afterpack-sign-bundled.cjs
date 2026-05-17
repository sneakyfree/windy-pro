// electron-builder `afterPack` hook for Windy Word.
//
// Why: electron-builder's built-in macOS signing (and `codesign --deep`) cannot
// recurse into the Python `.whl` zip files we bundle for Whisper/STT, so
// every wheel-internal `.so`/`.dylib` ships unsigned and Apple's notary
// rejects with hundreds of "binary not signed" errors. This hook fixes that.
//
// To enable, add to package.json `build`:
//   "afterPack": "scripts/macos/afterpack-sign-bundled.cjs"
//
// Required env vars at build time:
//   CODESIGN_IDENTITY  e.g. "Developer ID Application: Grant Whitmer (VXZ434QL89)"
//
// This hook ONLY runs on darwin targets. Win/Linux are no-ops.

const path = require('node:path');
const { spawnSync } = require('node:child_process');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') {
    return;
  }
  if (!process.env.CODESIGN_IDENTITY) {
    console.warn('[afterpack-sign-bundled] CODESIGN_IDENTITY not set, skipping.');
    console.warn('  Set it in the build env to sign for distribution.');
    return;
  }

  const appName = context.packager.appInfo.productFilename + '.app';
  const appPath = path.join(context.appOutDir, appName);
  const repoRoot = path.resolve(__dirname, '..', '..');
  const script = path.join(repoRoot, 'scripts', 'macos', 'sign-bundled.sh');
  const entitlements = path.join(repoRoot, 'build', 'entitlements.mac.plist');

  console.log(`[afterpack-sign-bundled] signing ${appPath}`);

  const result = spawnSync('bash', [script, appPath], {
    stdio: 'inherit',
    env: {
      ...process.env,
      CODESIGN_IDENTITY: process.env.CODESIGN_IDENTITY,
      ENTITLEMENTS_PLIST: entitlements,
      // PRODUCT_SHORT must match productName in package.json (used by helper-app
      // filenames inside the bundle). Hard-coded to "Windy Pro" was a stale
      // value from before the Pro/Word brand split; fixed 2026-05-17.
      PRODUCT_SHORT: context.packager.appInfo.productName,
    },
  });

  if (result.status !== 0) {
    throw new Error(`[afterpack-sign-bundled] sign-bundled.sh failed (exit ${result.status})`);
  }

  console.log('[afterpack-sign-bundled] done');
};
