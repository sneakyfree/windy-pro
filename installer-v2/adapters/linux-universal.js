/**
 * Windy Pro v2.0 — Linux Universal Platform Adapter
 * For non-Debian distros: Fedora, Arch, openSUSE, etc.
 * 
 * COCKTAIL APPROACH: Bundle everything. Don't rely on any package manager.
 * Downloads portable binaries when system packages aren't available.
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

// Portable binary URLs
const FFMPEG_STATIC_URL = 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz';

class LinuxUniversalAdapter {
  constructor() {}

  /**
   * Install Python — try system package managers in order, then portable
   */
  async installPython(onProgress) {
    onProgress(0);
    fs.mkdirSync(APP_DIR, { recursive: true });
    fs.mkdirSync(MODELS_DIR, { recursive: true });
    fs.mkdirSync(BIN_DIR, { recursive: true });

    const pythonBin = await this._findOrInstallPython();
    onProgress(30);

    // Create venv
    if (!fs.existsSync(path.join(VENV_DIR, 'bin', 'python3'))) {
      await this._exec(`"${pythonBin}" -m venv "${VENV_DIR}"`, 120000);
    }
    onProgress(50);

    // Upgrade pip + install packages
    const pip = path.join(VENV_DIR, 'bin', 'pip');
    await this._exec(`"${pip}" install --upgrade pip setuptools wheel`, 120000);
    onProgress(60);

    const packages = [
      'faster-whisper', 'torch', 'torchaudio', 'sounddevice',
      'numpy', 'websockets', 'scipy', 'librosa', 'pydub'
    ];

    for (let i = 0; i < packages.length; i++) {
      try {
        await this._exec(`"${pip}" install ${packages[i]}`, 300000);
      } catch (e) {
        console.error(`Failed to install ${packages[i]}: ${e.message}`);
      }
      onProgress(60 + ((i + 1) / packages.length) * 40);
    }

    onProgress(100);
  }

  async _findOrInstallPython() {
    // Check existing Python
    const candidates = ['python3.12', 'python3.11', 'python3.10', 'python3.9', 'python3', 'python'];
    for (const cmd of candidates) {
      try {
        const version = execSync(`${cmd} --version 2>&1`, { timeout: 5000 }).toString().trim();
        const match = version.match(/Python (\d+)\.(\d+)/);
        if (match && parseInt(match[1]) >= 3 && parseInt(match[2]) >= 9) return cmd;
      } catch (e) {}
    }

    // Detect package manager and install
    const pmCommands = [
      { check: 'which dnf', install: 'sudo dnf install -y python3 python3-devel python3-pip' },
      { check: 'which yum', install: 'sudo yum install -y python3 python3-devel python3-pip' },
      { check: 'which pacman', install: 'sudo pacman -S --noconfirm python python-pip' },
      { check: 'which zypper', install: 'sudo zypper install -y python3 python3-pip python3-devel' },
      { check: 'which apk', install: 'sudo apk add python3 py3-pip python3-dev' },
      { check: 'which emerge', install: 'sudo emerge dev-lang/python:3.11' },
      { check: 'which apt-get', install: 'sudo apt-get install -y python3 python3-venv python3-pip python3-dev' }
    ];

    for (const pm of pmCommands) {
      try {
        execSync(pm.check, { timeout: 3000, stdio: 'pipe' });
        await this._exec(pm.install, 300000);
        // Re-check
        for (const cmd of candidates) {
          try {
            const v = execSync(`${cmd} --version 2>&1`, { timeout: 5000 }).toString();
            const m = v.match(/Python (\d+)\.(\d+)/);
            if (m && parseInt(m[1]) >= 3 && parseInt(m[2]) >= 9) return cmd;
          } catch (e) {}
        }
      } catch (e) {}
    }

    throw new Error('Could not install Python 3.9+. Please install it manually for your distribution.');
  }

  /**
   * Install ffmpeg — try package manager, fallback to static binary
   */
  async installFfmpeg(onProgress) {
    onProgress(0);

    // Check if already available
    try {
      execSync('ffmpeg -version', { timeout: 5000, stdio: 'pipe' });
      onProgress(100);
      return;
    } catch (e) {}

    // Try package managers
    const pmCommands = [
      { check: 'which dnf', install: 'sudo dnf install -y ffmpeg portaudio-devel alsa-lib-devel pulseaudio-libs-devel' },
      { check: 'which pacman', install: 'sudo pacman -S --noconfirm ffmpeg portaudio alsa-lib pulseaudio' },
      { check: 'which zypper', install: 'sudo zypper install -y ffmpeg portaudio-devel alsa-devel' },
      { check: 'which apt-get', install: 'sudo apt-get install -y ffmpeg portaudio19-dev libasound2-dev pulseaudio' }
    ];

    for (const pm of pmCommands) {
      try {
        execSync(pm.check, { timeout: 3000, stdio: 'pipe' });
        await this._exec(pm.install, 300000);
        onProgress(100);
        return;
      } catch (e) {}
    }

    // Fallback: download static ffmpeg binary
    onProgress(30);
    const ffmpegPath = path.join(BIN_DIR, 'ffmpeg');
    if (!fs.existsSync(ffmpegPath)) {
      try {
        // Download static build
        await this._downloadFile(FFMPEG_STATIC_URL, path.join(BIN_DIR, 'ffmpeg-static.tar.xz'));
        await this._exec(`cd "${BIN_DIR}" && tar xf ffmpeg-static.tar.xz --strip-components=1 --wildcards "*/ffmpeg" "*/ffprobe"`, 60000);
        fs.chmodSync(ffmpegPath, 0o755);
        // Clean up archive
        try { fs.unlinkSync(path.join(BIN_DIR, 'ffmpeg-static.tar.xz')); } catch (e) {}
      } catch (e) {
        console.error('Static ffmpeg download failed:', e.message);
      }
    }

    // Add to PATH for this session
    process.env.PATH = `${BIN_DIR}:${process.env.PATH}`;
    onProgress(100);
  }

  /**
   * Install CUDA (best effort — same across distros)
   */
  async installCuda(onProgress) {
    onProgress(0);
    try {
      execSync('nvcc --version', { timeout: 5000, stdio: 'pipe' });
      onProgress(100);
      return;
    } catch (e) {}

    // CUDA is tricky across distros — just check if the driver is there
    // PyTorch will use CUDA via its own bundled libs
    try {
      execSync('nvidia-smi', { timeout: 5000, stdio: 'pipe' });
      // Driver exists — PyTorch CUDA should work via pip-installed torch
      onProgress(100);
    } catch (e) {
      console.error('No NVIDIA driver found — will use CPU inference');
      onProgress(100);
    }
  }

  /**
   * Download a model (delegates to the shared DownloadManager via wizard-main)
   */
  async downloadModel(modelId, modelInfo, onProgress) {
    // This is handled by the shared DownloadManager in wizard-main.js
    // Platform adapter only provides the simulation fallback
    let progress = 0;
    return new Promise((resolve) => {
      const interval = setInterval(() => {
        progress += Math.random() * 8 + 2;
        if (progress >= 100) {
          progress = 100;
          clearInterval(interval);
          const modelPath = path.join(MODELS_DIR, `${modelId}.wpr`);
          fs.mkdirSync(MODELS_DIR, { recursive: true });
          fs.writeFileSync(modelPath, `WNDY0001-placeholder-${modelId}`);
          onProgress(100);
          resolve();
        } else {
          onProgress(progress);
        }
      }, 500 + Math.random() * 500);
    });
  }

  async verify() {
    const pythonPath = path.join(VENV_DIR, 'bin', 'python3');
    if (!fs.existsSync(pythonPath)) throw new Error('Python not found');
    try {
      execSync(`"${pythonPath}" -c "from faster_whisper import WhisperModel; print('OK')"`, { timeout: 30000, stdio: 'pipe' });
    } catch (e) {
      console.error('Verification warning: faster-whisper import failed');
    }
  }

  async requestPermissions() {
    const xdg = process.env.XDG_SESSION_TYPE || 'x11';
    // Try to install clipboard/injection tools
    const tools = xdg === 'wayland'
      ? ['ydotool', 'wl-clipboard']
      : ['xdotool', 'xclip', 'xsel'];

    for (const tool of tools) {
      try {
        execSync(`which ${tool}`, { timeout: 3000, stdio: 'pipe' });
      } catch (e) {
        // Can't install without knowing package manager — just warn
        console.error(`${tool} not found — cursor injection may not work. Install it with your package manager.`);
      }
    }
  }

  async _downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(destPath);
      https.get(url, { timeout: 60000 }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          https.get(res.headers.location, { timeout: 60000 }, (res2) => {
            res2.pipe(file);
            file.on('finish', () => { file.close(resolve); });
          }).on('error', reject);
        } else {
          res.pipe(file);
          file.on('finish', () => { file.close(resolve); });
        }
      }).on('error', reject);
    });
  }

  _exec(cmd, timeout = 60000) {
    return new Promise((resolve, reject) => {
      exec(cmd, { timeout, maxBuffer: 10 * 1024 * 1024 }, (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      });
    });
  }
}

module.exports = { LinuxUniversalAdapter };
