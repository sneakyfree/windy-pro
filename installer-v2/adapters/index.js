/**
 * Windy Pro v2.0 — Platform Adapter Auto-Selector
 * Detects the current platform and returns the appropriate adapter.
 */

const os = require('os');
const fs = require('fs');

function getAdapter() {
  const platform = process.platform;

  switch (platform) {
    case 'win32':
      const { WindowsAdapter } = require('./windows');
      return new WindowsAdapter();

    case 'darwin':
      const { MacOSAdapter } = require('./macos');
      return new MacOSAdapter();

    case 'linux':
      // Detect if Debian/Ubuntu or other
      if (isDebian()) {
        const { LinuxDebianAdapter } = require('./linux-debian');
        return new LinuxDebianAdapter();
      } else {
        const { LinuxUniversalAdapter } = require('./linux-universal');
        return new LinuxUniversalAdapter();
      }

    default:
      // Fallback to universal
      const { LinuxUniversalAdapter: Fallback } = require('./linux-universal');
      return new Fallback();
  }
}

/**
 * Check if running on Debian/Ubuntu
 */
function isDebian() {
  try {
    if (fs.existsSync('/etc/debian_version')) return true;
    const release = fs.readFileSync('/etc/os-release', 'utf-8');
    return release.includes('debian') || release.includes('ubuntu') || release.includes('Ubuntu');
  } catch (e) {
    return false;
  }
}

/**
 * Get platform display name
 */
function getPlatformName() {
  switch (process.platform) {
    case 'win32': return 'Windows';
    case 'darwin': return process.arch === 'arm64' ? 'macOS (Apple Silicon)' : 'macOS (Intel)';
    case 'linux': return isDebian() ? 'Linux (Debian/Ubuntu)' : 'Linux';
    default: return process.platform;
  }
}

module.exports = { getAdapter, isDebian, getPlatformName };
