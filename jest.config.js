// Jest config for the windy-pro repo.
//
// The repo holds both unit tests (under tests/) and a Playwright e2e suite
// (under e2e/). The two share *.test.js naming but use different runners,
// so jest must skip e2e/ entirely. Same for the account-server's
// jest project, the venv, node_modules, dist, and build.
//
// Special case: tests/ecosystem-smoke.test.js is a standalone integration
// script (top-level server spawn + process.exit), not a jest suite.
// Despite the *.test.js name it's only ever meant to be invoked via
// `node tests/ecosystem-smoke.test.js`. Excluded explicitly here so jest
// doesn't try to babel-parse it and timeout waiting for the spawned server.

module.exports = {
  testPathIgnorePatterns: [
    '/node_modules/',
    '/e2e/',
    '/account-server/',
    '/dist/',
    '/build/',
    '/.venv/',
    '<rootDir>/tests/ecosystem-smoke\\.test\\.js$',
    // services/translate-api ships its own node:test suite (node --test),
    // run by its own `npm test` — not jest. Exclude so root jest doesn't
    // mis-run it (ADR-060 translate ops work, 2026-07-13).
    '/services/translate-api/',
  ],
};
