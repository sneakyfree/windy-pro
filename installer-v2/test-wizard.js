/**
 * Windy Pro v2.0 — Launch the Installation Wizard
 * 
 * Run modes:
 *   npx electron installer-v2/test-wizard.js           — Simulated (no real installs)
 *   npx electron installer-v2/test-wizard.js --real     — Real installs with platform adapter
 */

const { app } = require('electron');
const { InstallWizard } = require('./wizard-main');
const { getAdapter, getPlatformName } = require('./adapters');

const realMode = process.argv.includes('--real');

app.whenReady().then(async () => {
  console.log(`🌪️  Windy Pro v2.0 Installation Wizard`);
  console.log(`   Platform: ${getPlatformName()}`);
  console.log(`   Mode: ${realMode ? 'REAL INSTALL' : 'SIMULATION (use --real for actual install)'}`);
  console.log('');

  const wizard = new InstallWizard({
    platformAdapter: realMode ? getAdapter() : null
  });

  await wizard.show();
  app.quit();
});

app.on('window-all-closed', () => app.quit());
