// Regression coverage for "wizard stuck at 0%" — the hang shipped in
// session 1 with two distinct root causes:
//
//   A. execSync inside the wizard-install handler blocked Electron's
//      event loop, so `sendProgress` IPCs queued but never reached the
//      renderer.
//   B. CleanSlate._killProcesses targeted the wizard's own .app bundle
//      Electron helpers, killing the IPC channel mid-install.
//
// Both have direct unit-test coverage in tests/installer-* — those are
// the authoritative pins. This E2E layer adds one integration check
// the unit tests can't provide:
//
//   * Round-trip: wizard renderer → preload → IPC → main → wizardLog
//     file → readable from the test. Proves the whole pipe is wired.
//     A regression that breaks the preload bridge or the IPC channel
//     itself would fail here, not in unit tests.
//
// We deliberately don't drive a full install end-to-end at the E2E
// layer:
//   * In dev electron, process.resourcesPath/bundled doesn't exist, so
//     the install handler falls through to the legacy
//     brew/apt/dnf-install-Python path with 10-minute internal
//     timeouts. Driving that to completion would make CI take 10
//     minutes per run.
//   * The "install always returns" and "kill never targets self"
//     guarantees are pure-logic invariants — unit tests verify them
//     more cheaply and more thoroughly.

const { test, expect } = require('@playwright/test');
const { launchWizard, readWizardLog } = require('../helpers/wizard-launch');

test('IPC round-trip works: scanHardware reaches main and writes wizardLog', async () => {
  // The wizardLog file is the diagnostic anchor for the hang fix.
  // If wizardLog ever stops working (e.g. wizard-logger init fails
  // silently), we lose the only signal we have when an install hangs.
  // Verify the file actually gets written through a real IPC path.
  const w = await launchWizard();
  try {
    await w.page.evaluate(() => window.wizardAPI.scanHardware());
    // Allow the wizardLog write stream to flush.
    await new Promise(r => setTimeout(r, 500));
    const log = readWizardLog(w.tmpHome);
    expect(log).toMatch(/WIZARD START/);
    expect(log).toMatch(/IPC wizard-scan-hardware ENTRY/);
    expect(log).toMatch(/IPC wizard-scan-hardware EXIT/);
  } finally {
    await w.cleanup();
  }
});

test('preload exposes every IPC the renderer relies on (signature contract)', async () => {
  // If wizard-preload.js drifts from wizard-main.js's IPC channel
  // names, the renderer fails silently — wizardAPI.someMethod() throws
  // a confusing "channel does not exist" error mid-flow. Lock the
  // contract here so any rename is caught immediately.
  const w = await launchWizard();
  try {
    const exposed = await w.page.evaluate(() => {
      return Object.keys(window.wizardAPI).sort();
    });
    expect(exposed).toEqual([
      'complete',
      'createFreeAccount',
      'install',
      'login',
      'micStatus',
      'onProgress',
      'onWindowFocus',
      'openExternal',
      'openPermSettings',
      'pasteDetect',
      'pasteInstall',
      'pasteTestInject',
      'purchaseTranslate',
      'register',
      'saveLanguageProfile',
      'scanHardware',
      'selectModels',
      'toggleModel',
      'verifyAccessibility',
    ].sort());
  } finally {
    await w.cleanup();
  }
});
