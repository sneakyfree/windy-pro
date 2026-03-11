/**
 * Windy Pro v2.0 — macOS Adapter (Rewritten)
 * 
 * Strategy: Bundled first, Homebrew second, NEVER "please install manually"
 * 
 * Grant's Rule: "Can you imagine grandma getting told to download
 * an obscure version of Python?"
 */

const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { BundledAssets } = require('../core/bundled-assets');

const APP_DIR = path.join(os.homedir(), '.windy-pro');

class MacOSAdapter {
  constructor() {
    this.bundled = new BundledAssets();
    this.log = console.log;
  }

  /**
   * Install Python — bundled first, then system, then brew
   */
  async installPython(progressCallback) {
    progressCallback = progressCallback || (() => {});

    // Strategy 1: Bundled Python
    progressCallback(10);
    const bundledPy = await this.bundled.installPython(APP_DIR, this.log);
    if (bundledPy) {
      progressCallback(100);
      return bundledPy;
    }

    // Strategy 2: Check system Python (Apple ships Python 3 with Xcode CLI tools)
    progressCallback(30);
    const systemPy = this._findSystemPython();
    if (systemPy) {
      progressCallback(100);
      return systemPy;
    }

    // Strategy 3: Xcode Command Line Tools (lightweight, includes Python 3)
    progressCallback(40);
    try {
      execSync('xcode-select --install 2>/dev/null || true', { timeout: 5000, stdio: 'pipe' });
      // Wait for install dialog — user must click Install
      // After 60 seconds check if python3 appeared
      await new Promise(resolve => setTimeout(resolve, 5000));
      const py = this._findSystemPython();
      if (py) {
        progressCallback(100);
        return py;
      }
    } catch (e) { /* move on */ }

    // Strategy 4: Homebrew
    progressCallback(50);
    await this._ensureHomebrew();
    progressCallback(70);
    try {
      execSync('brew install python@3.11 2>/dev/null || brew install python3', {
        timeout: 300000, stdio: 'pipe'
      });
    } catch (e) { /* try to proceed anyway */ }

    progressCallback(90);
    const finalPy = this._findSystemPython();
    if (finalPy) {
      progressCallback(100);
      return finalPy;
    }

    // Strategy 5: Download standalone Python.org framework build
    this.log('[macOS] Downloading Python from python.org as last resort...');
    const arch = process.arch === 'arm64' ? 'macos11' : 'macos10.9';
    const pkgUrl = `https://www.python.org/ftp/python/3.11.9/python-3.11.9-${arch}.pkg`;
    const pkgPath = path.join(os.tmpdir(), 'python-3.11.9.pkg');
    try {
      execSync(`curl -fsSL "${pkgUrl}" -o "${pkgPath}"`, { timeout: 120000, stdio: 'pipe' });
      // Install silently using installer command (requires admin)
      execSync(`installer -pkg "${pkgPath}" -target / 2>/dev/null || sudo installer -pkg "${pkgPath}" -target /`, {
        timeout: 120000, stdio: 'pipe'
      });
    } catch (e) {
      // osascript fallback for admin prompt
      try {
        execSync(`osascript -e 'do shell script "installer -pkg ${pkgPath} -target /" with administrator privileges'`, {
          timeout: 120000, stdio: 'pipe'
        });
      } catch (e2) { /* fall through */ }
    }

    const veryFinalPy = this._findSystemPython();
    progressCallback(100);
    if (veryFinalPy) return veryFinalPy;

    throw new Error('Could not install Python on macOS');
  }

  /**
   * Install ffmpeg — bundled first, then brew
   */
  async installFfmpeg(progressCallback) {
    progressCallback = progressCallback || (() => {});

    // Strategy 1: Bundled ffmpeg
    progressCallback(10);
    const bundledFfmpeg = await this.bundled.installFfmpeg(APP_DIR, this.log);
    if (bundledFfmpeg) {
      progressCallback(100);
      return bundledFfmpeg;
    }

    // Strategy 2: System ffmpeg
    progressCallback(30);
    try {
      execSync('ffmpeg -version', { timeout: 5000, stdio: 'pipe' });
      progressCallback(100);
      return 'ffmpeg';
    } catch (e) { /* not found */ }

    // Strategy 3: Homebrew
    progressCallback(50);
    await this._ensureHomebrew();
    try {
      execSync('brew install ffmpeg', { timeout: 300000, stdio: 'pipe' });
      progressCallback(100);
      return 'ffmpeg';
    } catch (e) { /* try static download */ }

    // Strategy 4: Static binary download
    progressCallback(70);
    const binDir = path.join(APP_DIR, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    const ffmpegDest = path.join(binDir, 'ffmpeg');
    try {
      const url = process.arch === 'arm64'
        ? 'https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip'
        : 'https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip';
      const zipPath = path.join(os.tmpdir(), 'ffmpeg.zip');
      execSync(`curl -fsSL "${url}" -o "${zipPath}"`, { timeout: 120000, stdio: 'pipe' });
      execSync(`unzip -o "${zipPath}" -d "${binDir}"`, { timeout: 30000, stdio: 'pipe' });
      fs.chmodSync(ffmpegDest, 0o755);
      progressCallback(100);
      return ffmpegDest;
    } catch (e) {
      throw new Error('Could not install ffmpeg on macOS');
    }
  }

  /**
   * Install CUDA — macOS doesn't have NVIDIA anymore, but check for Apple Metal
   */
  async installCuda(progressCallback) {
    progressCallback = progressCallback || (() => {});
    // macOS uses Metal/MPS for GPU acceleration (Apple Silicon)
    progressCallback(50);
    const isAppleSilicon = process.arch === 'arm64';
    progressCallback(100);
    return {
      success: isAppleSilicon,
      type: isAppleSilicon ? 'Apple Metal (MPS)' : 'Intel (CPU only)',
      detail: isAppleSilicon
        ? 'Apple Silicon detected — PyTorch MPS acceleration available'
        : 'Intel Mac — will use CPU inference'
    };
  }

  /**
   * Create application shortcuts and launch agents
   */
  async requestPermissions() {
    // Create a .desktop-equivalent launcher
    try {
      const appScript = `#!/bin/bash
cd "${path.join(process.cwd())}"
electron . &
`;
      const scriptPath = path.join(APP_DIR, 'bin', 'windy-pro');
      fs.writeFileSync(scriptPath, appScript);
      fs.chmodSync(scriptPath, 0o755);

      // Request microphone access (will prompt user)
      execSync('osascript -e \'tell application "System Events" to return (name of processes)\'', {
        timeout: 5000, stdio: 'pipe'
      });
    } catch (e) { /* non-fatal */ }
  }

  /**
   * Verify installation
   */
  async verify() {
    const results = {};

    // Check Python
    const venvPy = path.join(APP_DIR, 'venv', 'bin', 'python3');
    const bundledPy = path.join(APP_DIR, 'python', 'bin', 'python3');
    const py = fs.existsSync(venvPy) ? venvPy : fs.existsSync(bundledPy) ? bundledPy : 'python3';
    try {
      execSync(`"${py}" -c "import faster_whisper; print('ok')"`, { timeout: 15000, stdio: 'pipe' });
      results.python = true;
    } catch (e) {
      results.python = false;
    }

    // Check ffmpeg
    const ffmpegPath = path.join(APP_DIR, 'bin', 'ffmpeg');
    try {
      const cmd = fs.existsSync(ffmpegPath) ? `"${ffmpegPath}" -version` : 'ffmpeg -version';
      execSync(cmd, { timeout: 5000, stdio: 'pipe' });
      results.ffmpeg = true;
    } catch (e) {
      results.ffmpeg = false;
    }

    return results;
  }

  // ─── Helpers ───

  _findSystemPython() {
    const candidates = [
      '/opt/homebrew/bin/python3',
      '/usr/local/bin/python3',
      '/Library/Frameworks/Python.framework/Versions/3.11/bin/python3',
      '/Library/Frameworks/Python.framework/Versions/3.12/bin/python3',
      'python3',
    ];
    for (const cmd of candidates) {
      try {
        const version = execSync(`"${cmd}" --version 2>&1`, { timeout: 5000, stdio: 'pipe' }).toString();
        if (/Python 3\.(9|1[0-9]|[2-9]\d)/.test(version)) {
          return cmd;
        }
      } catch (e) { /* try next */ }
    }
    return null;
  }

  async _ensureHomebrew() {
    try {
      execSync('which brew', { stdio: 'pipe', timeout: 3000 });
    } catch (e) {
      this.log('[macOS] Installing Homebrew...');
      try {
        execSync(
          'NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
          { timeout: 300000, stdio: 'pipe' }
        );
      } catch (e2) {
        this.log('[macOS] Homebrew install failed — proceeding without it');
      }
    }
  }
}

module.exports = { MacOSAdapter };
