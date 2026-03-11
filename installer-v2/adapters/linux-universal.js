/**
 * Windy Pro v2.0 — Linux Universal Adapter (Rewritten)
 * 
 * Fallback for any Linux distro that doesn't match Debian/Fedora/Arch.
 * Uses bundled assets exclusively — no package manager assumptions.
 * 
 * This is the "grandma on an obscure Linux" adapter.
 * Everything must come from the bundle or standalone downloads.
 */

const { exec, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { BundledAssets } = require('../core/bundled-assets');

const APP_DIR = path.join(os.homedir(), '.windy-pro');
const VENV_DIR = path.join(APP_DIR, 'venv');
const BIN_DIR = path.join(APP_DIR, 'bin');

class LinuxUniversalAdapter {
  constructor() {
    this.bundled = new BundledAssets();
    this.log = console.log;
  }

  /**
   * Install Python — bundled or Miniforge standalone
   */
  async installPython(onProgress) {
    onProgress = onProgress || (() => { });

    // Strategy 1: Bundled Python
    onProgress(5);
    const bundledPy = await this.bundled.installPython(APP_DIR, this.log);
    if (bundledPy) {
      this.log('[Universal] Using bundled Python');
      onProgress(60);
      await this._setupVenv(bundledPy);
      onProgress(100);
      return bundledPy;
    }

    // Strategy 2: System Python
    onProgress(15);
    const systemPy = this._findPython();
    if (systemPy) {
      this.log(`[Universal] Using system Python: ${systemPy}`);
      onProgress(40);
      await this._setupVenv(systemPy);
      onProgress(100);
      return systemPy;
    }

    // Strategy 3: Miniforge (standalone, no root needed)
    onProgress(20);
    this.log('[Universal] Installing Miniforge standalone Python...');
    const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
    const miniforgeUrl = `https://github.com/conda-forge/miniforge/releases/latest/download/Miniforge3-Linux-${arch}.sh`;
    const installerPath = path.join(os.tmpdir(), 'miniforge.sh');
    const pythonDir = path.join(APP_DIR, 'python');

    try {
      execSync(`curl -fsSL "${miniforgeUrl}" -o "${installerPath}"`, { timeout: 120000, stdio: 'pipe' });
      onProgress(40);
      execSync(`bash "${installerPath}" -b -p "${pythonDir}"`, { timeout: 300000, stdio: 'pipe' });
      onProgress(60);
      try { fs.unlinkSync(installerPath); } catch (e) { }

      const pyExe = path.join(pythonDir, 'bin', 'python3');
      if (fs.existsSync(pyExe)) {
        await this._setupVenv(pyExe);
        onProgress(100);
        return pyExe;
      }
    } catch (e) {
      this.log(`[Universal] Miniforge install failed: ${e.message}`);
      try { fs.unlinkSync(installerPath); } catch (e2) { }
    }

    throw new Error('Could not install Python. No package manager available and Miniforge download failed.');
  }

  /**
   * Install ffmpeg — bundled or static binary
   */
  async installFfmpeg(onProgress) {
    onProgress = onProgress || (() => { });

    // Strategy 1: Bundled
    onProgress(10);
    const bundledFfmpeg = await this.bundled.installFfmpeg(APP_DIR, this.log);
    if (bundledFfmpeg) {
      onProgress(100);
      return bundledFfmpeg;
    }

    // Strategy 2: System ffmpeg
    onProgress(30);
    try {
      execSync('ffmpeg -version', { timeout: 5000, stdio: 'pipe' });
      onProgress(100);
      return 'ffmpeg';
    } catch (e) { /* not found */ }

    // Strategy 3: Static binary
    onProgress(40);
    this.log('[Universal] Downloading static ffmpeg...');
    const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
    const url = `https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-${arch}-static.tar.xz`;
    const tarPath = path.join(os.tmpdir(), 'ffmpeg-static.tar.xz');
    fs.mkdirSync(BIN_DIR, { recursive: true });

    try {
      execSync(`curl -fsSL "${url}" -o "${tarPath}"`, { timeout: 120000, stdio: 'pipe' });
      onProgress(70);
      const extractDir = path.join(os.tmpdir(), 'ffmpeg-extract');
      fs.mkdirSync(extractDir, { recursive: true });
      execSync(`tar xJf "${tarPath}" -C "${extractDir}"`, { timeout: 60000, stdio: 'pipe' });

      const found = execSync(`find "${extractDir}" -name ffmpeg -type f | head -1`, {
        timeout: 5000, stdio: 'pipe'
      }).toString().trim();

      if (found) {
        fs.copyFileSync(found, path.join(BIN_DIR, 'ffmpeg'));
        fs.chmodSync(path.join(BIN_DIR, 'ffmpeg'), 0o755);
        const probe = execSync(`find "${extractDir}" -name ffprobe -type f | head -1`, {
          timeout: 5000, stdio: 'pipe'
        }).toString().trim();
        if (probe) {
          fs.copyFileSync(probe, path.join(BIN_DIR, 'ffprobe'));
          fs.chmodSync(path.join(BIN_DIR, 'ffprobe'), 0o755);
        }
        fs.rmSync(extractDir, { recursive: true, force: true });
        fs.unlinkSync(tarPath);
        onProgress(100);
        return path.join(BIN_DIR, 'ffmpeg');
      }
      fs.rmSync(extractDir, { recursive: true, force: true });
    } catch (e) { /* fall through */ }
    try { fs.unlinkSync(tarPath); } catch (e) { }

    throw new Error('Could not install ffmpeg');
  }

  async installCuda(onProgress) {
    onProgress = onProgress || (() => { });
    try {
      execSync('nvidia-smi 2>/dev/null', { timeout: 10000, stdio: 'pipe' });
      onProgress(100);
      return { success: true, type: 'NVIDIA CUDA' };
    } catch (e) {
      onProgress(100);
      return { success: false, type: 'CPU' };
    }
  }

  async requestPermissions() {
    // Create .desktop file if XDG is available
    const desktopDir = path.join(os.homedir(), '.local', 'share', 'applications');
    try {
      fs.mkdirSync(desktopDir, { recursive: true });
      fs.writeFileSync(path.join(desktopDir, 'windy-pro.desktop'), `[Desktop Entry]
Type=Application
Name=Windy Pro
Comment=AI-powered speech recognition and translation
Exec=${process.execPath} ${process.cwd()}
Terminal=false
Categories=Audio;Utility;
`);
    } catch (e) { /* non-fatal */ }
  }

  async verify() {
    const results = {};
    const venvPy = path.join(VENV_DIR, 'bin', 'python3');
    try {
      execSync(`"${venvPy}" -c "import faster_whisper; print('ok')"`, { timeout: 15000, stdio: 'pipe' });
      results.python = true;
    } catch (e) { results.python = false; }

    try {
      const ffmpegPath = path.join(BIN_DIR, 'ffmpeg');
      const cmd = fs.existsSync(ffmpegPath) ? `"${ffmpegPath}" -version` : 'ffmpeg -version';
      execSync(cmd, { timeout: 5000, stdio: 'pipe' });
      results.ffmpeg = true;
    } catch (e) { results.ffmpeg = false; }

    return results;
  }

  // ─── Helpers ───

  _findPython() {
    for (const cmd of ['python3.12', 'python3.11', 'python3.10', 'python3.9', 'python3']) {
      try {
        const version = execSync(`${cmd} --version 2>&1`, { timeout: 5000, stdio: 'pipe' }).toString();
        if (/Python 3\.(9|1[0-9]|[2-9]\d)/.test(version)) return cmd;
      } catch (e) { /* next */ }
    }
    return null;
  }

  async _setupVenv(pythonPath) {
    const venvPy = path.join(VENV_DIR, 'bin', 'python3');
    if (fs.existsSync(venvPy)) {
      try {
        execSync(`"${venvPy}" -c "import faster_whisper; print('OK')"`, { timeout: 15000, stdio: 'pipe' });
        return; // Already complete
      } catch (e) { /* needs packages */ }
    }

    if (!fs.existsSync(venvPy)) {
      execSync(`"${pythonPath}" -m venv "${VENV_DIR}"`, { timeout: 120000, stdio: 'pipe' });
    }

    const pip = path.join(VENV_DIR, 'bin', 'pip');
    execSync(`"${pip}" install --upgrade pip setuptools wheel`, { timeout: 120000, stdio: 'pipe' });

    const packages = [
      'faster-whisper', 'torch', 'torchaudio',
      'sounddevice', 'numpy', 'websockets',
      'scipy', 'pydub', 'ctranslate2',
      'sentencepiece', 'transformers',
    ];
    for (const pkg of packages) {
      try {
        execSync(`"${pip}" install ${pkg}`, { timeout: 600000, stdio: 'pipe' });
      } catch (e) {
        this.log(`[Universal] Warning: ${pkg} install failed: ${e.message}`);
      }
    }
  }
}

module.exports = { LinuxUniversalAdapter };
