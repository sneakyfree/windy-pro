// Playwright config for the Windy Pro E2E suite.
//
// Two test categories live side by side:
//   e2e/wizard/   — wizard flow, runs against the unpackaged Electron
//                   entry point (`installer-v2/test-wizard.js`) so we
//                   can exercise every screen quickly without rebuilding
//                   the .app between runs.
//   e2e/main/     — full app, runs against the packaged
//                   `dist/mac/Windy Pro.app` so we test what users
//                   actually launch (asar-bundled, sandboxed, etc.).
//
// Both layers use Playwright-electron (`playwright._electron`) — the
// bundled-electron driver is the only thing in this codebase that can
// reach Electron's IPC channels and BrowserWindow internals.
//
// Why two layers (instead of always going against the packaged .app):
//   1. The packaged .app takes ~30s to launch on macOS first run because
//      of Gatekeeper checks. Wizard test iteration would crawl.
//   2. Wizard tests need to start from a *clean* state every time
//      (no ~/.windy-pro/, no prior installs). Cleaning the user's real
//      home dir between every test is a footgun. The unpackaged
//      entry-point lets us point WINDY_HOME at a tmpdir.
//   3. The packaged .app is what users see, so "main app" tests
//      validate end-to-end fidelity once per CI run.
//
// Trace + screenshot capture is on by default — when E2E fails on CI
// the artefacts are the only signal we'll have.

const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e',
  // Each test gets its own clean Electron app instance. Workers > 1
  // would step on the shared $HOME/.windy-pro dir; keep serial.
  workers: 1,
  fullyParallel: false,
  // E2E is inherently slower than unit tests. 60s per test is generous
  // but catches truly stuck wizards (mirrors the install handler's
  // own withTimeout budgets).
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Retry once on CI to absorb transient flakes (Electron cold start,
  // window-focus races on the verify screen). Local runs: no retries
  // so flakiness is loud.
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'e2e-report' }]]
    : [['list']],
  use: {
    // Capture trace + video on failure only (full trace on every run
    // bloats CI artefacts; failures are the interesting cases).
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  outputDir: 'e2e-results',
});
