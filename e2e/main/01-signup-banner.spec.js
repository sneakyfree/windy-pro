// Phase 8 signup banner E2E.
//
// We intentionally don't drive a real transcription end-to-end — that
// would require the Python engine, a mic device, a model loaded, and a
// recorded sample. Instead we launch the main-app renderer, then call
// `app.maybeShowSignupBanner({ text, partial: false })` directly via
// page.evaluate. That exercises every code path the user would hit
// without the audio dependency.
//
// What this catches:
//   - Banner doesn't appear when it should
//   - Banner reappears after "No thanks" (regression in localStorage stamp)
//   - Banner appears when user is already signed in (regression in token check)
//   - Banner mutates DOM in a way that breaks the transcript area
//   - Banner doesn't auto-dismiss after timeout

const path = require('path');
const fs = require('fs');
const os = require('os');
const { test, expect } = require('@playwright/test');
const { _electron: electron } = require('playwright');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ELECTRON_BIN = path.join(REPO_ROOT, 'node_modules', '.bin', 'electron');
// We launch a thin harness page that loads app.js with the minimum
// scaffolding the banner code needs (transcriptContent, localStorage,
// no electronAPI). See e2e/fixtures/banner-harness.html.
const HARNESS_HTML = path.join(REPO_ROOT, 'e2e', 'fixtures', 'banner-harness.html');
const HARNESS_ENTRY = path.join(REPO_ROOT, 'e2e', 'fixtures', 'banner-harness-main.js');

async function launchHarness() {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'windy-banner-'));
  const app = await electron.launch({
    executablePath: ELECTRON_BIN,
    args: [HARNESS_ENTRY],
    env: {
      ...process.env,
      HOME: tmpHome,
      ELECTRON_DISABLE_SANDBOX: '1',
      WINDY_HARNESS_PATH: HARNESS_HTML,
    },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return {
    app, page, tmpHome,
    async cleanup() {
      try { await app.close(); } catch (_) {}
      try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch (_) {}
    },
  };
}

test('banner appears after first non-partial transcript', async () => {
  const w = await launchHarness();
  try {
    // Simulate the call site in addTranscriptSegment
    await w.page.evaluate(() => {
      window.__app.maybeShowSignupBanner({ text: 'hello world', partial: false });
    });
    await w.page.waitForSelector('#windy-signup-banner', { timeout: 3000 });
    const visible = await w.page.locator('#windy-signup-banner').isVisible();
    expect(visible).toBe(true);
  } finally {
    await w.cleanup();
  }
});

test('banner does NOT appear for partial transcripts', async () => {
  const w = await launchHarness();
  try {
    await w.page.evaluate(() => {
      window.__app.maybeShowSignupBanner({ text: 'partial...', partial: true });
    });
    // Wait long enough that any async render would have happened
    await w.page.waitForTimeout(300);
    const exists = await w.page.locator('#windy-signup-banner').count();
    expect(exists).toBe(0);
  } finally {
    await w.cleanup();
  }
});

test('banner does NOT appear for empty/whitespace transcripts', async () => {
  const w = await launchHarness();
  try {
    await w.page.evaluate(() => {
      window.__app.maybeShowSignupBanner({ text: '   ', partial: false });
      window.__app.maybeShowSignupBanner({ text: '', partial: false });
    });
    await w.page.waitForTimeout(300);
    const exists = await w.page.locator('#windy-signup-banner').count();
    expect(exists).toBe(0);
  } finally {
    await w.cleanup();
  }
});

test('"No thanks" dismisses + stamps localStorage so banner never reappears', async () => {
  const w = await launchHarness();
  try {
    await w.page.evaluate(() => {
      window.__app.maybeShowSignupBanner({ text: 'first', partial: false });
    });
    await w.page.waitForSelector('#windy-signup-banner');
    await w.page.click('#windy-signup-no');
    // Banner fades out via 220ms transition; wait for removal
    await w.page.waitForFunction(() => !document.getElementById('windy-signup-banner'), null, { timeout: 2000 });
    const stamp = await w.page.evaluate(() => localStorage.getItem('windy_signup_banner_shown'));
    expect(stamp).toBe('1');

    // Try again — should be a no-op
    await w.page.evaluate(() => {
      window.__app.maybeShowSignupBanner({ text: 'second', partial: false });
    });
    await w.page.waitForTimeout(300);
    expect(await w.page.locator('#windy-signup-banner').count()).toBe(0);
  } finally {
    await w.cleanup();
  }
});

test('banner does NOT appear when an account token is already in localStorage', async () => {
  const w = await launchHarness();
  try {
    await w.page.evaluate(() => {
      localStorage.setItem('windy_account_token', 'fake-jwt-for-test');
      window.__app.maybeShowSignupBanner({ text: 'hello', partial: false });
    });
    await w.page.waitForTimeout(300);
    expect(await w.page.locator('#windy-signup-banner').count()).toBe(0);
  } finally {
    await w.cleanup();
  }
});

test('"Create free account" stamps localStorage so banner never reappears', async () => {
  const w = await launchHarness();
  try {
    // Stub openExternal so the test doesn't actually open a browser
    await w.page.evaluate(() => {
      window.electronAPI = { openExternal: () => {} };
      window.__app.maybeShowSignupBanner({ text: 'first', partial: false });
    });
    await w.page.waitForSelector('#windy-signup-banner');
    await w.page.click('#windy-signup-yes');
    await w.page.waitForFunction(() => !document.getElementById('windy-signup-banner'), null, { timeout: 2000 });
    const stamp = await w.page.evaluate(() => localStorage.getItem('windy_signup_banner_shown'));
    expect(stamp).toBe('1');
  } finally {
    await w.cleanup();
  }
});

test('banner auto-dismisses after the timeout (testing with a 500ms hook)', async () => {
  const w = await launchHarness();
  try {
    // The harness exposes window.__bannerOpts as an override that
    // signup-banner.js reads to set autoDismissMs. Set 500ms so the
    // test doesn't have to wait the production 30s.
    await w.page.evaluate(() => {
      window.__bannerOpts = { autoDismissMs: 500 };
      window.__app.maybeShowSignupBanner({ text: 'fade me', partial: false });
    });
    await w.page.waitForSelector('#windy-signup-banner');
    // Wait for the auto-dismiss to fire + the 220ms fade-out
    await w.page.waitForFunction(
      () => !document.getElementById('windy-signup-banner'),
      null,
      { timeout: 3000 }
    );
    // Auto-dismiss does NOT remember the decision — banner can reappear
    // on a subsequent transcript. Verify by trying again.
    const stampAfterAutoDismiss = await w.page.evaluate(
      () => localStorage.getItem('windy_signup_banner_shown')
    );
    expect(stampAfterAutoDismiss).toBeNull();
  } finally {
    await w.cleanup();
  }
});

test('banner cannot stack — calling maybeShow twice in a row only renders one', async () => {
  const w = await launchHarness();
  try {
    await w.page.evaluate(() => {
      window.__app.maybeShowSignupBanner({ text: 'a', partial: false });
      window.__app.maybeShowSignupBanner({ text: 'b', partial: false });
    });
    await w.page.waitForSelector('#windy-signup-banner');
    const count = await w.page.locator('#windy-signup-banner').count();
    expect(count).toBe(1);
  } finally {
    await w.cleanup();
  }
});
