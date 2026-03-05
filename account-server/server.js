/**
 * Compatibility shim for the old server.js entry point.
 *
 * The desktop Electron app and some scripts may still import or run
 * `account-server/server.js`. This shim delegates to the TypeScript
 * server via tsx (dev) or the compiled dist/ (production).
 *
 * Usage:
 *   NODE_ENV=development node server.js   — runs via tsx
 *   node server.js                        — runs compiled dist/
 */

try {
  // Try compiled output first
  require('./dist/server.js');
} catch (err) {
  // Fall back to tsx for development
  try {
    require('tsx/cjs');
    require('./src/server.ts');
  } catch (tsxErr) {
    console.error('❌ Cannot start server. Either build with `npm run build` or install tsx for development.');
    console.error('   Run: cd account-server && npm install && npm run build');
    process.exit(1);
  }
}
