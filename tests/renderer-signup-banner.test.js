/**
 * @jest-environment jsdom
 *
 * Unit tests for src/client/desktop/renderer/signup-banner.js.
 *
 * Why a separate file from the E2E (e2e/main/01-signup-banner.spec.js):
 *   - jsdom tests run in milliseconds; E2E spawns Electron (~2s each).
 *   - jsdom tests run on every push; E2E runs only on the e2e CI job.
 *   - These tests can poke setTimeout via jest.useFakeTimers() to
 *     deterministically test the auto-dismiss timer without waiting.
 *
 * The shared signup-banner.js module is the single source of truth.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Load the script as text and eval it inside jsdom's window so the
// IIFE binds window.WindySignupBanner.
const scriptText = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'client', 'desktop', 'renderer', 'signup-banner.js'),
  'utf-8'
);
// eslint-disable-next-line no-eval
eval(scriptText);

const banner = window.WindySignupBanner;

beforeEach(() => {
  // Wipe state between tests
  document.body.innerHTML = '';
  localStorage.clear();
  // Remove the injected <style id="windy-signup-banner-style"> too so
  // each test gets a clean DOM
  const style = document.getElementById('windy-signup-banner-style');
  if (style) style.remove();
});

describe('WindySignupBanner — guard conditions', () => {
  test.each([
    [{ partial: true, text: 'hello' }],
    [{ partial: false, text: '' }],
    [{ partial: false, text: '   ' }],
    [null],
    [undefined],
  ])('returns null for %j', (msg) => {
    expect(banner(msg)).toBeNull();
    expect(document.getElementById('windy-signup-banner')).toBeNull();
  });

  test('returns null when localStorage stamp is set', () => {
    localStorage.setItem('windy_signup_banner_shown', '1');
    expect(banner({ text: 'hi', partial: false })).toBeNull();
  });

  test('returns null when account token is set', () => {
    localStorage.setItem('windy_account_token', 'jwt-token');
    expect(banner({ text: 'hi', partial: false })).toBeNull();
  });

  test('returns null when banner already mounted (no double-render)', () => {
    expect(banner({ text: 'hi', partial: false })).not.toBeNull();
    expect(banner({ text: 'hi', partial: false })).toBeNull();
  });
});

describe('WindySignupBanner — happy path', () => {
  test('renders banner element with both buttons', () => {
    const el = banner({ text: 'hello', partial: false });
    expect(el).not.toBeNull();
    expect(el.id).toBe('windy-signup-banner');
    expect(document.getElementById('windy-signup-yes')).not.toBeNull();
    expect(document.getElementById('windy-signup-no')).not.toBeNull();
  });

  test('"No thanks" stamps localStorage and removes element', async () => {
    banner({ text: 'hi', partial: false });
    document.getElementById('windy-signup-no').click();
    expect(localStorage.getItem('windy_signup_banner_shown')).toBe('1');
    // Banner uses 220ms fade — wait it out
    await new Promise(r => setTimeout(r, 250));
    expect(document.getElementById('windy-signup-banner')).toBeNull();
  });

  test('"Create free account" calls electronAPI.openExternal when present', async () => {
    let openedUrl = null;
    window.electronAPI = { openExternal: (u) => { openedUrl = u; } };
    banner({ text: 'hi', partial: false });
    document.getElementById('windy-signup-yes').click();
    expect(openedUrl).toBe('https://windyword.ai/signup?source=app-first-transcript');
    expect(localStorage.getItem('windy_signup_banner_shown')).toBe('1');
    await new Promise(r => setTimeout(r, 250));
    expect(document.getElementById('windy-signup-banner')).toBeNull();
    delete window.electronAPI;
  });

  test('"Create free account" falls back to window.open when electronAPI missing', () => {
    let opened = false;
    window.open = () => { opened = true; return null; };
    banner({ text: 'hi', partial: false });
    document.getElementById('windy-signup-yes').click();
    expect(opened).toBe(true);
  });

  test('honours opts.signupUrl override', () => {
    let openedUrl = null;
    window.electronAPI = { openExternal: (u) => { openedUrl = u; } };
    banner({ text: 'hi', partial: false }, { signupUrl: 'https://example.com/test' });
    document.getElementById('windy-signup-yes').click();
    expect(openedUrl).toBe('https://example.com/test');
    delete window.electronAPI;
  });
});

describe('WindySignupBanner — auto-dismiss timing', () => {
  test('auto-dismisses after opts.autoDismissMs without stamping localStorage', async () => {
    banner({ text: 'hi', partial: false }, { autoDismissMs: 200 });
    expect(document.getElementById('windy-signup-banner')).not.toBeNull();
    // Wait for autoDismissMs (200) + fade-out (220) + slack (50)
    await new Promise(r => setTimeout(r, 500));
    expect(document.getElementById('windy-signup-banner')).toBeNull();
    // Auto-dismiss does NOT remember the decision
    expect(localStorage.getItem('windy_signup_banner_shown')).toBeNull();
  });

  test('autoDismissMs=0 disables auto-dismiss entirely', async () => {
    banner({ text: 'hi', partial: false }, { autoDismissMs: 0 });
    await new Promise(r => setTimeout(r, 100));
    // Still mounted
    expect(document.getElementById('windy-signup-banner')).not.toBeNull();
  });
});

describe('WindySignupBanner — exposed constants', () => {
  test('exposes storage keys + signup URL on the function object', () => {
    expect(banner.STORAGE_KEY_DISMISSED).toBe('windy_signup_banner_shown');
    expect(banner.STORAGE_KEY_TOKEN).toBe('windy_account_token');
    expect(banner.DEFAULT_AUTO_DISMISS_MS).toBe(30_000);
    expect(banner.SIGNUP_URL).toContain('https://');
    expect(banner.SIGNUP_URL).toContain('signup');
  });
});
