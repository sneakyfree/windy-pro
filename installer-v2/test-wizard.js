/**
 * Windy Pro v2.0 — Test the Installation Wizard
 * Run: npx electron installer-v2/test-wizard.js
 */

const { app, BrowserWindow } = require('electron');
const { InstallWizard } = require('./wizard-main');
const { LinuxDebianAdapter } = require('./adapters/linux-debian');

app.whenReady().then(async () => {
  const wizard = new InstallWizard({
    platformAdapter: null // Set to new LinuxDebianAdapter() for real install
    // platformAdapter: new LinuxDebianAdapter() // Uncomment for real install
  });

  await wizard.show();
  app.quit();
});

app.on('window-all-closed', () => app.quit());
