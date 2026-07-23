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

  // Helper apps need their OWN camera/mic usage strings: Ventura's TCC kills
  // "<app> Helper (Plugin)" with SIGABRT on first camera touch when the helper's
  // Info.plist lacks them (mac.extendInfo only reaches the MAIN app's plist).
  // Proven on OC5 2026-07-23 — crash report, TCC namespace, camera picker dead.
  // Runs unconditionally (signing optional): unsigned dev builds crash the same way.
  {
    const fs = require('node:fs');
    const appName0 = context.packager.appInfo.productFilename + '.app';
    const frameworks = path.join(context.appOutDir, appName0, 'Contents', 'Frameworks');
    const usage = {
      NSCameraUsageDescription: 'Windy Word needs camera access for video recording.',
      NSMicrophoneUsageDescription: 'Windy Word needs microphone access for transcription.',
    };
    for (const entry of fs.existsSync(frameworks) ? fs.readdirSync(frameworks) : []) {
      if (!/Helper.*\.app$/.test(entry)) continue;
      const plist = path.join(frameworks, entry, 'Contents', 'Info.plist');
      for (const [k, v] of Object.entries(usage)) {
        spawnSync('/usr/libexec/PlistBuddy', ['-c', `Add :${k} string ${v}`, plist]);
        spawnSync('/usr/libexec/PlistBuddy', ['-c', `Set :${k} ${v}`, plist]);
      }
      console.log(`[afterpack-sign-bundled] usage strings -> ${entry}`);
    }
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
