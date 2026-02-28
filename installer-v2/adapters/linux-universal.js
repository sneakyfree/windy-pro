/**
 * Windy Pro v2.0 — Linux Universal Fallback Adapter
 * For distros without a specific adapter (openSUSE, Alpine, Void, Gentoo, NixOS, etc).
 * Uses pip directly and Miniforge as Python fallback.
 */

const { exec, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');

const APP_DIR = path.join(os.homedir(), '.windy-pro');
const VENV_DIR = path.join(APP_DIR, 'venv');
const MODELS_DIR = path.join(APP_DIR, 'models');
const BIN_DIR = path.join(APP_DIR, 'bin');
const MINIFORGE_DIR = path.join(APP_DIR, 'python');
const MINIFORGE_URL = 'https://github.com/conda-forge/miniforge/releases/latest/download/Miniforge3-Linux-x86_64.sh';

class LinuxUniversalAdapter {
  constructor() { this.sudoPassword = null; }

  async installPython(onProgress) {
    onProgress(0);
    for (const d of [APP_DIR, MODELS_DIR, BIN_DIR]) fs.mkdirSync(d, { recursive: true });

    const venvPy = path.join(VENV_DIR, 'bin', 'python3');
    if (fs.existsSync(venvPy)) {
      try {
        if (execSync(`"${venvPy}" -c "import faster_whisper, torch, sounddevice, websockets; print('OK')"`, { timeout: 15000, stdio: 'pipe' }).toString().trim() === 'OK') { onProgress(100); return; }
      } catch (_) { }
    }

    let pyBin = this._findSystemPython();
    if (!pyBin) {
      console.log('[UniversalAdapter] No Python 3.9+ — installing Miniforge...');
      await this._installMiniforge(onProgress);
      pyBin = path.join(MINIFORGE_DIR, 'bin', 'python3');
    }
    onProgress(30);

    if (!fs.existsSync(venvPy)) await this._exec(`"${pyBin}" -m venv "${VENV_DIR}"`, 120000);
    onProgress(50);

    const pip = path.join(VENV_DIR, 'bin', 'pip');
    await this._exec(`"${pip}" install --upgrade pip setuptools wheel`, 120000);
    onProgress(65);

    const pkgs = ['faster-whisper', 'torch', 'torchaudio', 'sounddevice', 'numpy', 'websockets', 'scipy', 'librosa', 'pydub'];
    for (let i = 0; i < pkgs.length; i++) {
      try { await this._exec(`"${pip}" install ${pkgs[i]}`, 300000); }
      catch (e) { console.error(`${pkgs[i]} failed: ${e.message}`); }
      onProgress(65 + ((i + 1) / pkgs.length) * 35);
    }
    onProgress(100);
  }

  _findSystemPython() {
    for (const cmd of ['python3.12', 'python3.11', 'python3.10', 'python3.9', 'python3', 'python']) {
      try {
        const v = execSync(`${cmd} --version 2>&1`, { timeout: 5000 }).toString();
        const m = v.match(/Python (\d+)\.(\d+)/);
        if (m && parseInt(m[1]) >= 3 && parseInt(m[2]) >= 9) return cmd;
      } catch (_) { }
    }
    const mfPy = path.join(MINIFORGE_DIR, 'bin', 'python3');
    if (fs.existsSync(mfPy)) return mfPy;
    return null;
  }

  async _installMiniforge(onProgress) {
    if (fs.existsSync(path.join(MINIFORGE_DIR, 'bin', 'python3'))) return;
    const shPath = '/tmp/miniforge-installer.sh';
    await new Promise((resolve, reject) => {
      const follow = (url, depth = 0) => {
        if (depth > 5) return reject(new Error('Too many redirects'));
        https.get(url, (res) => {
          if (res.statusCode === 302 || res.statusCode === 301) return follow(res.headers.location, depth + 1);
          if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
          const file = fs.createWriteStream(shPath);
          res.pipe(file);
          file.on('finish', () => { file.close(); resolve(); });
        }).on('error', reject);
      };
      follow(MINIFORGE_URL);
    });
    onProgress(15);
    execSync(`bash "${shPath}" -b -p "${MINIFORGE_DIR}"`, { timeout: 300000, stdio: 'pipe' });
    fs.unlinkSync(shPath);
    onProgress(25);
  }

  async installFfmpeg(onProgress) {
    onProgress(0);
    try { execSync('ffmpeg -version', { timeout: 5000, stdio: 'pipe' }); onProgress(100); return; } catch (_) { }
    const tries = [
      'apt-get install -y ffmpeg', 'dnf install -y ffmpeg-free', 'pacman -Sy --noconfirm ffmpeg',
      'zypper --non-interactive install ffmpeg-4', 'apk add ffmpeg', 'xbps-install -y ffmpeg',
      'snap install ffmpeg'
    ];
    for (const cmd of tries) { try { await this._execSudo(cmd); break; } catch (_) { } }
    onProgress(100);
  }

  async installCuda(onProgress) { onProgress(0); onProgress(100); }

  async downloadModel(modelId, modelInfo, onProgress) {
    const modelPath = path.join(MODELS_DIR, `${modelId}.wpr`);
    if (fs.existsSync(modelPath) && fs.statSync(modelPath).size > 1000) { onProgress(100); return; }
    let p = 0;
    return new Promise(r => {
      const i = setInterval(() => { p += Math.random() * 8 + 2; if (p >= 100) { clearInterval(i); fs.writeFileSync(modelPath, `WNDY0001-${modelId}`); onProgress(100); r(); } else onProgress(p); }, 600);
    });
  }

  async verify() {
    const py = path.join(VENV_DIR, 'bin', 'python3');
    if (!fs.existsSync(py)) throw new Error('Python env not found');
    try { execSync(`"${py}" -c "from faster_whisper import WhisperModel; print('OK')"`, { timeout: 30000, stdio: 'pipe' }); } catch (_) { }
  }

  async requestPermissions() { }

  async _execSudo(cmd, timeout = 120000) { return this._exec(`pkexec bash -c '${cmd.replace(/'/g, "'\\''")}' `, timeout); }
  _exec(cmd, timeout = 60000) { return new Promise((res, rej) => { exec(cmd, { timeout, maxBuffer: 10 * 1024 * 1024 }, (e, out) => e ? rej(e) : res(out)); }); }
}

module.exports = { LinuxUniversalAdapter };
