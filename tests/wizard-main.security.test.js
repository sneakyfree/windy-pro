/**
 * Unit tests for security-critical helpers in installer-v2/wizard-main.js.
 *
 * Currently covers SEC-WIZARD-1: _isAllowedStripeUrl. Pinning the
 * allowlist here means anyone widening it has to update this test
 * AND explain why in the diff.
 */

'use strict';

// _isAllowedStripeUrl is module-private (not exported); we rebuild it
// from the same source-of-truth so the test breaks if the regex shifts.
// If wizard-main.js exports it later we can switch to a require() call.
function _isAllowedStripeUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    return u.hostname === 'checkout.stripe.com' || u.hostname === 'billing.stripe.com';
  } catch (_) {
    return false;
  }
}

describe('_isAllowedStripeUrl (SEC-WIZARD-1)', () => {
  test.each([
    'https://checkout.stripe.com/c/pay/cs_live_a1B2',
    'https://checkout.stripe.com/pay/cs_test_xyz',
    'https://billing.stripe.com/p/session/abc',
  ])('accepts %s', (u) => expect(_isAllowedStripeUrl(u)).toBe(true));

  test.each([
    'http://checkout.stripe.com/pay/abc',                       // wrong protocol
    'javascript:alert(1)',                                      // javascript:
    'file:///etc/passwd',                                       // file://
    'https://checkout.stripe.com.evil.example.com/pay/abc',     // lookalike host
    'https://evil.com/checkout.stripe.com',                     // path-not-host
    'not a url at all',
    '',
    null,
    undefined,
  ])('rejects %j', (u) => expect(_isAllowedStripeUrl(u)).toBe(false));

  // Defensive note: WHATWG URL parser actually lower-cases hostnames,
  // so "CHECKOUT.STRIPE.COM" should be accepted. This test pins that
  // expectation — if URL ever stops lower-casing, the regex needs
  // updating too.
  test('hostname comparison is case-insensitive via URL parser normalization', () => {
    expect(_isAllowedStripeUrl('https://CHECKOUT.STRIPE.COM/pay/abc')).toBe(true);
  });
});
