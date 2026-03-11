/**
 * Windy Pro v2.0 — Linux Arch/Manjaro Adapter (Rewritten)
 * 
 * Covers: Arch Linux, Manjaro, EndeavourOS, Garuda, Artix
 * Strategy: Bundled first, pacman second
 */

const { exec, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { BundledAssets } = require('../core/bundled-assets');

const APP_DIR = path.join(os.homedir(), '.windy-pro');
const VENV_DIR = path.join(APP_DIR, 'venv');
const BIN_DIR = path.join(APP_DIR, 'bin');

const PACMAN_COCKTAIL = [
  'python', 'python-pip', 'python-virtualenv',
  'base-devel', 'gcc', 'cmake',
  'ffmpeg',
  'portaudio', 'alsa-utils', 'alsa-lib',
  'pulseaudio', 'libpulse',
  'sox', 'libsndfile',
  'gstreamer', 'gst-plugins-good', 'gst-plugins-base',
  'xdotool', 'xclip', 'xsel', 'xdg-utils',
  'curl', 'wget', 'ca-certificates',
  'openblas', 'lapack',
];

class LinuxArchAdapter {
  constructor() {
    this.bundled = new BundledAssets();
    this.log = console.log;
  }

  async installPython(onProgress) {
    onProgress = onProgress || (() => {});

    onProgress(5);
    const bundledPy = await this.bundled.installPython(APP_DIR, this.log);
    if (bundledPy) {
      onProgress(60);
      await this._setupVenv(bundledPy);
      onProgress(100);
      return bundledPy;
    }

    onProgress(10);
    this.log('[Arch] Installing complete cocktail via pacman...');
    try {
      await this._execSudo(`pacman -Sy --noconfirm ${PACMAN_COCKTAIL.join(' ')} || true`, 600000);
    } catch (e) {
      this.log(`[Arch] Some packages failed: ${e.message}`);
    }
    onProgress(50);

    // Wayland tools from AUR or direct
    if (process.env.XDG_SESSION_TYPE === 'wayland') {
      try {
        await this._execSudo('pacman -Sy --noconfirm ydotool wl-clipboard || true', 60000);
      } catch (e) {}
    }

    const py = this._findPython();
    if (!py) throw new Error('Could not install Python');
    await this._setupVenv(py);
    onProgress(100);
    return py;
  }

  async installFfmpeg(onProgress) {
    onProgress = onProgress || (() => {});

    const bundledFfmpeg = await this.bundled.installFfmpeg(APP_DIR, this.log);
    if (bundledFfmpeg) { onProgress(100); return bundledFfmpeg; }

    try {
      execSync('ffmpeg -version', { timeout: 5000, stdio: 'pipe' });
      onProgress(100);
      return 'ffmpeg';
    } catch (e) {
      // Static binary fallback
      const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
      fs.mkdirSync(BIN_DIR, { recursive: true });
      try {
        const tarPath = path.join(os.tmpdir(), 'ffmpeg-static.tar.xz');
        execSync(`curl -fsSL "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-${arch}-static.tar.xz" -o "${tarPath}"`, { timeout: 120000, stdio: 'pipe' });
        const extractDir = path.join(os.tmpdir(), 'ffmpeg-extract');
        fs.mkdirSync(extractDir, { recursive: true });
        execSync(`tar xJf "${tarPath}" -C "${extractDir}"`, { timeout: 60000, stdio: 'pipe' });
        const found = execSync(`find "${extractDir}" -name ffmpeg -type f | head -1`, { timeout: 5000, stdio: 'pipe' }).toString().trim();
        if (found) {
          fs.copyFileSync(found, path.join(BIN_DIR, 'ffmpeg'));
          fs.chmodSync(path.join(BIN_DIR, 'ffmpeg'), 0o755);
          fs.rmSync(extractDir, { recursive: true, force: true });
          fs.unlinkSync(tarPath);
          onProgress(100);
          return path.join(BIN_DIR, 'ffmpeg');
        }
      } catch (e2) {}
      throw new Error('Could not install ffmpeg');
    }
  }

  async installCuda(onProgress) {
    onProgress = onProgress || (() => {});
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
    const desktopDir = path.join(os.homedir(), '.local', 'share', 'applications');
    try {
      fs.mkdirSync(desktopDir, { recursive: true });
      fs.writeFileSync(path.join(desktopDir, 'windy-pro.desktop'), `[Desktop Entry]
Type=Application
Name=Windy Pro
Exec=electron ${process.cwd()}
Terminal=false
Categories=Audio;Utility;
`);
    } catch (e) {}
  }

  async verify() {
    const results = {};
    const venvPy = path.join(VENV_DIR, 'bin', 'python3');
    try {
      execSync(`"${venvPy}" -c "import faster_whisper; print('ok')"`, { timeout: 15000, stdio: 'pipe' });
      results.python = true;
    } catch (e) { results.python = false; }
    try {
      const fp = path.join(BIN_DIR, 'ffmpeg');
      execSync(fs.existsSync(fp) ? `"${fp}" -version` : 'ffmpeg -version', { timeout: 5000, stdio: 'pipe' });
      results.ffmpeg = true;
    } catch (e) { results.ffmpeg = false; }
    return results;
  }

  _findPython() {
    for (const cmd of ['python3.12', 'python3.11', 'python3', 'python']) {
      try {
        const v = execSync(`${cmd} --version 2>&1`, { timeout: 5000, stdio: 'pipe' }).toString();
        if (/Python 3\.(9|1[0-9]|[2-9]\d)/.test(v)) return cmd;
      } catch (e) {}
    }
    return null;
  }

  async _setupVenv(pythonPath) {
    const venvPy = path.join(VENV_DIR, 'bin', 'python3');
    if (fs.existsSync(venvPy)) {
      try {
        execSync(`"${venvPy}" -c "import faster_whisper; print('OK')"`, { timeout: 15000, stdio: 'pipe' });
        return;
      } catch (e) {}
    }
    if (!fs.existsSync(venvPy)) {
      execSync(`"${pythonPath}" -m venv "${VENV_DIR}"`, { timeout: 120000, stdio: 'pipe' });
    }
    const pip = path.join(VENV_DIR, 'bin', 'pip');
    execSync(`"${pip}" install --upgrade pip setuptools wheel`, { timeout: 120000, stdio: 'pipe' });
    for (const pkg of ['faster-whisper', 'torch', 'torchaudio', 'sounddevice', 'numpy', 'websockets', 'scipy', 'pydub', 'ctranslate2', 'sentencepiece', 'transformers']) {
      try { execSync(`"${pip}" install ${pkg}`, { timeout: 600000, stdio: 'pipe' }); } catch (e) {
        this.log(`[Arch] Warning: ${pkg} failed`);
      }
    }
  }

  async _execSudo(cmd, timeout = 120000) {
    return new Promise((resolve, reject) => {
      const tries = [
        `pkexec bash -c '${cmd.replace(/'/g, "'\\''")}'`,
        `sudo bash -c '${cmd.replace(/'/g, "'\\''")}'`,
        cmd
      ];
      const tryNext = (i) => {
        if (i >= tries.length) { reject(new Error(`Failed: ${cmd}`)); return; }
        exec(tries[i], { timeout, maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
          if (err && i < tries.length - 1) tryNext(i + 1);
          else if (err) reject(err);
          else resolve(stdout);
        });
      };
      tryNext(0);
    });
  }
}

module.exports = { LinuxArchAdapter };
