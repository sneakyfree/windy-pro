/**
 * Windy Pro v2.0 — Linux Fedora/RHEL Adapter (Rewritten)
 * 
 * Covers: Fedora, RHEL, CentOS, Rocky Linux, Alma Linux, Amazon Linux, Oracle Linux
 * Strategy: Bundled first, dnf second
 */

const { exec, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { BundledAssets } = require('../core/bundled-assets');

const APP_DIR = path.join(os.homedir(), '.windy-pro');
const VENV_DIR = path.join(APP_DIR, 'venv');
const BIN_DIR = path.join(APP_DIR, 'bin');

// Complete cocktail for Fedora/RHEL
const DNF_COCKTAIL = [
  'python3', 'python3-devel', 'python3-pip', 'python3-virtualenv',
  'gcc', 'gcc-c++', 'make', 'cmake', 'redhat-rpm-config',
  'libffi-devel', 'openssl-devel', 'zlib-devel',
  'ffmpeg', 'ffmpeg-devel',
  'portaudio-devel', 'alsa-lib-devel', 'alsa-utils',
  'pulseaudio', 'pulseaudio-libs-devel', 'pulseaudio-utils',
  'sox', 'libsndfile-devel',
  'gstreamer1-plugins-good', 'gstreamer1-plugins-base',
  'xdotool', 'xclip', 'xsel', 'xdg-utils',
  'curl', 'wget', 'ca-certificates',
  'openblas-devel', 'lapack-devel',
];

class LinuxFedoraAdapter {
  constructor() {
    this.bundled = new BundledAssets();
    this.log = console.log;
    this.pkgMgr = this._detectPkgMgr(); // dnf or yum
  }

  _detectPkgMgr() {
    try { execSync('which dnf', { stdio: 'pipe' }); return 'dnf'; } catch (e) { }
    try { execSync('which yum', { stdio: 'pipe' }); return 'yum'; } catch (e) { }
    return 'dnf';
  }

  async installPython(onProgress) {
    onProgress = onProgress || (() => { });

    // Strategy 1: Bundled
    onProgress(5);
    const bundledPy = await this.bundled.installPython(APP_DIR, this.log);
    if (bundledPy) {
      onProgress(60);
      await this._setupVenv(bundledPy);
      onProgress(100);
      return bundledPy;
    }

    // Strategy 2: DNF
    onProgress(10);
    this.log('[Fedora] Installing complete cocktail via ' + this.pkgMgr);

    // Enable RPM Fusion for ffmpeg
    try {
      const fedoraVer = execSync('rpm -E %fedora 2>/dev/null', { stdio: 'pipe' }).toString().trim();
      if (fedoraVer && !isNaN(parseInt(fedoraVer))) {
        await this._execSudo(
          `${this.pkgMgr} install -y https://download1.rpmfusion.org/free/fedora/rpmfusion-free-release-${fedoraVer}.noarch.rpm || true`,
          120000
        );
      }
    } catch (e) { /* skip RPM Fusion */ }
    onProgress(15);

    try {
      await this._execSudo(`${this.pkgMgr} install -y ${DNF_COCKTAIL.join(' ')} || true`, 600000);
    } catch (e) {
      this.log(`[Fedora] Some packages failed: ${e.message}`);
    }
    onProgress(50);

    const py = this._findPython();
    if (!py) throw new Error('Could not install Python');

    await this._setupVenv(py);
    onProgress(100);
    return py;
  }

  async installFfmpeg(onProgress) {
    onProgress = onProgress || (() => { });

    const bundledFfmpeg = await this.bundled.installFfmpeg(APP_DIR, this.log);
    if (bundledFfmpeg) { onProgress(100); return bundledFfmpeg; }

    try {
      execSync('ffmpeg -version', { timeout: 5000, stdio: 'pipe' });
      onProgress(100);
      return 'ffmpeg';
    } catch (e) {
      // Static binary fallback
      const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
      const url = `https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-${arch}-static.tar.xz`;
      const tarPath = path.join(os.tmpdir(), 'ffmpeg-static.tar.xz');
      fs.mkdirSync(BIN_DIR, { recursive: true });
      try {
        execSync(`curl -fsSL "${url}" -o "${tarPath}"`, { timeout: 120000, stdio: 'pipe' });
        const extractDir = path.join(os.tmpdir(), 'ffmpeg-extract');
        fs.mkdirSync(extractDir, { recursive: true });
        execSync(`tar xJf "${tarPath}" -C "${extractDir}"`, { timeout: 60000, stdio: 'pipe' });
        const found = execSync(`find "${extractDir}" -name ffmpeg -type f | head -1`, {
          timeout: 5000, stdio: 'pipe'
        }).toString().trim();
        if (found) {
          fs.copyFileSync(found, path.join(BIN_DIR, 'ffmpeg'));
          fs.chmodSync(path.join(BIN_DIR, 'ffmpeg'), 0o755);
          fs.rmSync(extractDir, { recursive: true, force: true });
          onProgress(100);
          return path.join(BIN_DIR, 'ffmpeg');
        }
        fs.rmSync(extractDir, { recursive: true, force: true });
      } catch (e2) { /* fall through */ }
      try { fs.unlinkSync(tarPath); } catch (e2) { }
      throw new Error('Could not install ffmpeg');
    }
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
    const desktopDir = path.join(os.homedir(), '.local', 'share', 'applications');
    try {
      fs.mkdirSync(desktopDir, { recursive: true });
      fs.writeFileSync(path.join(desktopDir, 'windy-pro.desktop'), `[Desktop Entry]
Type=Application
Name=Windy Pro
Exec=${process.execPath} ${process.cwd()}
Terminal=false
Categories=Audio;Utility;
`);
    } catch (e) { }
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

  _findPython() {
    for (const cmd of ['python3.12', 'python3.11', 'python3.10', 'python3.9', 'python3']) {
      try {
        const v = execSync(`${cmd} --version 2>&1`, { timeout: 5000, stdio: 'pipe' }).toString();
        if (/Python 3\.(9|1[0-9]|[2-9]\d)/.test(v)) return cmd;
      } catch (e) { }
    }
    return null;
  }

  async _setupVenv(pythonPath) {
    const venvPy = path.join(VENV_DIR, 'bin', 'python3');
    if (fs.existsSync(venvPy)) {
      try {
        execSync(`"${venvPy}" -c "import faster_whisper; print('OK')"`, { timeout: 15000, stdio: 'pipe' });
        return;
      } catch (e) { }
    }
    if (!fs.existsSync(venvPy)) {
      execSync(`"${pythonPath}" -m venv "${VENV_DIR}"`, { timeout: 120000, stdio: 'pipe' });
    }
    const pip = path.join(VENV_DIR, 'bin', 'pip');
    execSync(`"${pip}" install --upgrade pip setuptools wheel`, { timeout: 120000, stdio: 'pipe' });
    for (const pkg of ['faster-whisper', 'torch', 'torchaudio', 'sounddevice', 'numpy', 'websockets', 'scipy', 'pydub', 'ctranslate2', 'sentencepiece', 'transformers']) {
      try { execSync(`"${pip}" install ${pkg}`, { timeout: 600000, stdio: 'pipe' }); } catch (e) {
        this.log(`[Fedora] Warning: ${pkg} failed`);
      }
    }
  }

  async _execSudo(cmd, timeout = 120000) {
    return new Promise((resolve, reject) => {
      const tries = [];
      if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) {
        tries.push(`pkexec bash -c '${cmd.replace(/'/g, "'\\''")}'`);
      }
      tries.push(
        `sudo -n bash -c '${cmd.replace(/'/g, "'\\''")}'`,
        cmd
      );
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

module.exports = { LinuxFedoraAdapter };
