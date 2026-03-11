/**
 * Windy Pro v2.0 — Linux Debian/Ubuntu Adapter (Rewritten)
 * 
 * Covers: Debian, Ubuntu, Linux Mint, Pop!_OS, Elementary, Zorin, Kali, Raspbian
 * 
 * Strategy: Bundled first, apt second, NEVER leave grandma hanging
 * 
 * Complete cocktail: Python 3.11+, ffmpeg, portaudio, ALSA, PulseAudio,
 * sox, gstreamer, xdotool/ydotool, xclip/wl-clipboard
 */

const { exec, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { BundledAssets } = require('../core/bundled-assets');

const APP_DIR = path.join(os.homedir(), '.windy-pro');
const VENV_DIR = path.join(APP_DIR, 'venv');
const MODELS_DIR = path.join(APP_DIR, 'models');
const BIN_DIR = path.join(APP_DIR, 'bin');

// Complete list of EVERY package that Windy Pro could possibly need on Debian/Ubuntu
const APT_COCKTAIL = [
  // Python
  'python3', 'python3-pip', 'python3-venv', 'python3-dev',
  // Build tools (needed for native Python packages)
  'build-essential', 'gcc', 'g++', 'make', 'cmake',
  'libffi-dev', 'libssl-dev', 'zlib1g-dev',
  'libbz2-dev', 'libreadline-dev', 'libsqlite3-dev', 'libncurses5-dev',
  'libncursesw5-dev', 'xz-utils', 'tk-dev', 'liblzma-dev',
  // Audio — everything
  'ffmpeg',
  'portaudio19-dev', 'libportaudio2',
  'libasound2-dev', 'alsa-utils', 'alsa-base',
  'pulseaudio', 'libpulse-dev', 'pulseaudio-utils',
  'sox', 'libsox-fmt-all', 'libsox-dev',
  'libsndfile1-dev',
  'gstreamer1.0-plugins-good', 'gstreamer1.0-plugins-base',
  'gstreamer1.0-tools', 'gstreamer1.0-alsa', 'gstreamer1.0-pulseaudio',
  // GUI/input injection
  'xdotool', 'xclip', 'xsel', 'xdg-utils',
  // Wayland equivalents (installed silently, don't error if unavailable)
  // 'ydotool', 'wl-clipboard',  // These may not exist in all repos
  // Network (for WebSocket, model downloads)
  'curl', 'wget', 'ca-certificates',
  // Misc libraries that Python packages might need
  'libopenblas-dev', 'liblapack-dev', 'gfortran',
  'libjpeg-dev', 'libpng-dev', 'libtiff-dev',
];

// Wayland tools — installed separately since they may not be available
const APT_WAYLAND = ['ydotool', 'wl-clipboard'];

class LinuxDebianAdapter {
  constructor() {
    this.bundled = new BundledAssets();
    this.log = console.log;
  }

  /**
   * Install Python — bundled first, then apt
   */
  async installPython(onProgress) {
    onProgress = onProgress || (() => {});

    // Strategy 1: Bundled Python
    onProgress(5);
    const bundledPy = await this.bundled.installPython(APP_DIR, this.log);
    if (bundledPy) {
      this.log('[Debian] Using bundled Python');
      onProgress(50);
      await this._setupVenv(bundledPy);
      onProgress(100);
      return bundledPy;
    }

    // Strategy 2: Install everything via apt
    onProgress(10);
    this.log('[Debian] Installing complete dependency cocktail via apt...');
    
    try {
      // Update package list first
      await this._execSudo('apt-get update -qq');
      onProgress(15);

      // Install the FULL cocktail in one shot
      const pkgList = APT_COCKTAIL.join(' ');
      await this._execSudo(`DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ${pkgList} || true`, 600000);
      onProgress(50);

      // Try Wayland tools separately (don't fail if unavailable)
      const isWayland = process.env.XDG_SESSION_TYPE === 'wayland';
      if (isWayland) {
        await this._execSudo(`apt-get install -y ${APT_WAYLAND.join(' ')} 2>/dev/null || true`, 60000);
      }
    } catch (e) {
      this.log(`[Debian] Some apt packages failed: ${e.message}`);
    }
    onProgress(55);

    // Find the best Python
    const py = this._findPython();
    if (!py) {
      // Last resort: deadsnakes PPA
      this.log('[Debian] Trying deadsnakes PPA for newer Python...');
      try {
        await this._execSudo('apt-get install -y software-properties-common', 60000);
        await this._execSudo('add-apt-repository -y ppa:deadsnakes/ppa', 60000);
        await this._execSudo('apt-get update -qq', 60000);
        await this._execSudo('apt-get install -y python3.11 python3.11-venv python3.11-dev', 120000);
      } catch (e) {
        this.log(`[Debian] Deadsnakes failed: ${e.message}`);
      }
    }

    const finalPy = this._findPython();
    if (!finalPy) throw new Error('Could not install Python on this system');

    onProgress(60);
    await this._setupVenv(finalPy);
    onProgress(100);
    return finalPy;
  }

  /**
   * Install ffmpeg — bundled first, then apt
   */
  async installFfmpeg(onProgress) {
    onProgress = onProgress || (() => {});

    // Strategy 1: Bundled ffmpeg
    onProgress(10);
    const bundledFfmpeg = await this.bundled.installFfmpeg(APP_DIR, this.log);
    if (bundledFfmpeg) {
      onProgress(100);
      return bundledFfmpeg;
    }

    // Strategy 2: System ffmpeg (may already be installed from cocktail)
    onProgress(30);
    try {
      execSync('ffmpeg -version', { timeout: 5000, stdio: 'pipe' });
      onProgress(100);
      return 'ffmpeg';
    } catch (e) { /* not found */ }

    // Strategy 3: apt install (should have been done in cocktail, but just in case)
    onProgress(50);
    try {
      await this._execSudo('apt-get install -y ffmpeg', 120000);
    } catch (e) {
      this.log(`[Debian] ffmpeg apt install failed: ${e.message}`);
    }

    onProgress(80);
    try {
      execSync('ffmpeg -version', { timeout: 5000, stdio: 'pipe' });
      onProgress(100);
      return 'ffmpeg';
    } catch (e) {
      // Strategy 4: Static binary download
      this.log('[Debian] Downloading static ffmpeg binary...');
      const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
      const url = `https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-${arch}-static.tar.xz`;
      const tarPath = path.join(os.tmpdir(), 'ffmpeg-static.tar.xz');
      const extractDir = path.join(os.tmpdir(), 'ffmpeg-extract');
      try {
        execSync(`curl -fsSL "${url}" -o "${tarPath}"`, { timeout: 120000, stdio: 'pipe' });
        fs.mkdirSync(extractDir, { recursive: true });
        execSync(`tar xJf "${tarPath}" -C "${extractDir}"`, { timeout: 60000, stdio: 'pipe' });
        // Find ffmpeg in extracted directory
        const found = execSync(`find "${extractDir}" -name ffmpeg -type f | head -1`, {
          timeout: 5000, stdio: 'pipe'
        }).toString().trim();
        if (found) {
          fs.mkdirSync(BIN_DIR, { recursive: true });
          fs.copyFileSync(found, path.join(BIN_DIR, 'ffmpeg'));
          fs.chmodSync(path.join(BIN_DIR, 'ffmpeg'), 0o755);
          // Also copy ffprobe
          const foundProbe = execSync(`find "${extractDir}" -name ffprobe -type f | head -1`, {
            timeout: 5000, stdio: 'pipe'
          }).toString().trim();
          if (foundProbe) {
            fs.copyFileSync(foundProbe, path.join(BIN_DIR, 'ffprobe'));
            fs.chmodSync(path.join(BIN_DIR, 'ffprobe'), 0o755);
          }
          onProgress(100);
          return path.join(BIN_DIR, 'ffmpeg');
        }
      } catch (e2) {
        throw new Error('Could not install ffmpeg');
      } finally {
        try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch (e3) {}
        try { fs.unlinkSync(tarPath); } catch (e3) {}
      }
    }

    onProgress(100);
    return 'ffmpeg';
  }

  /**
   * Install CUDA — detect NVIDIA GPU and note PyTorch handles CUDA
   */
  async installCuda(onProgress) {
    onProgress = onProgress || (() => {});
    onProgress(30);

    try {
      const smiOutput = execSync('nvidia-smi 2>/dev/null', { timeout: 10000, stdio: 'pipe' }).toString();
      if (smiOutput.includes('NVIDIA')) {
        this.log('[Debian] NVIDIA GPU detected — PyTorch will use CUDA');
        onProgress(100);
        return { success: true, type: 'NVIDIA CUDA' };
      }
    } catch (e) { /* no GPU */ }

    this.log('[Debian] No NVIDIA GPU — will use CPU inference');
    onProgress(100);
    return { success: false, type: 'CPU', reason: 'No NVIDIA GPU detected' };
  }

  /**
   * Request permissions — mic access, file access
   */
  async requestPermissions() {
    // Linux doesn't have macOS-style permission prompts
    // PulseAudio/PipeWire handles mic access
    // Create desktop file for easy launching
    const desktopDir = path.join(os.homedir(), '.local', 'share', 'applications');
    fs.mkdirSync(desktopDir, { recursive: true });
    fs.writeFileSync(path.join(desktopDir, 'windy-pro.desktop'), `[Desktop Entry]
Type=Application
Name=Windy Pro
Comment=AI-powered speech recognition and translation
Exec=electron ${process.cwd()}
Icon=${path.join(process.cwd(), 'assets', 'icon.png')}
Terminal=false
Categories=Audio;Utility;
`);
  }

  /**
   * Verify installation
   */
  async verify() {
    const results = {};

    // Check Python venv
    const venvPy = path.join(VENV_DIR, 'bin', 'python3');
    if (fs.existsSync(venvPy)) {
      try {
        const output = execSync(`"${venvPy}" -c "import faster_whisper; print('OK')"`, {
          timeout: 15000, stdio: 'pipe'
        }).toString().trim();
        results.python = output === 'OK';
      } catch (e) {
        results.python = false;
      }
    } else {
      results.python = false;
    }

    // Check ffmpeg
    const ffmpegPath = path.join(BIN_DIR, 'ffmpeg');
    try {
      const cmd = fs.existsSync(ffmpegPath) ? `"${ffmpegPath}" -version` : 'ffmpeg -version';
      execSync(cmd, { timeout: 5000, stdio: 'pipe' });
      results.ffmpeg = true;
    } catch (e) {
      results.ffmpeg = false;
    }

    // Check audio
    try {
      execSync('aplay -l 2>/dev/null || pactl list sinks short 2>/dev/null', { timeout: 5000, stdio: 'pipe' });
      results.audio = true;
    } catch (e) {
      results.audio = false;
    }

    return results;
  }

  // ─── Helpers ───

  _findPython() {
    const candidates = ['python3.12', 'python3.11', 'python3.10', 'python3.9', 'python3'];
    for (const cmd of candidates) {
      try {
        const version = execSync(`${cmd} --version 2>&1`, { timeout: 5000, stdio: 'pipe' }).toString();
        if (/Python 3\.(9|1[0-9]|[2-9]\d)/.test(version)) {
          return cmd;
        }
      } catch (e) { /* try next */ }
    }
    return null;
  }

  async _setupVenv(pythonPath) {
    const venvPy = path.join(VENV_DIR, 'bin', 'python3');

    // Fast path: already set up
    if (fs.existsSync(venvPy)) {
      try {
        execSync(`"${venvPy}" -c "import faster_whisper; print('OK')"`, {
          timeout: 15000, stdio: 'pipe'
        });
        this.log('[Debian] Python venv already complete');
        return;
      } catch (e) { /* needs packages */ }
    }

    // Create venv
    if (!fs.existsSync(venvPy)) {
      try {
        execSync(`"${pythonPath}" -m venv "${VENV_DIR}"`, { timeout: 120000, stdio: 'pipe' });
      } catch (e) {
        // venv module might not be installed
        await this._execSudo('apt-get install -y python3-venv', 60000);
        execSync(`"${pythonPath}" -m venv "${VENV_DIR}"`, { timeout: 120000, stdio: 'pipe' });
      }
    }

    const pip = path.join(VENV_DIR, 'bin', 'pip');

    // Upgrade pip
    execSync(`"${pip}" install --upgrade pip setuptools wheel`, { timeout: 120000, stdio: 'pipe' });

    // Install ALL packages
    const packages = [
      'faster-whisper', 'torch', 'torchaudio',
      'sounddevice', 'numpy', 'websockets',
      'scipy', 'librosa', 'pydub',
      'ctranslate2', 'sentencepiece', 'transformers',
    ];

    for (const pkg of packages) {
      try {
        execSync(`"${pip}" install ${pkg}`, { timeout: 600000, stdio: 'pipe' });
      } catch (e) {
        this.log(`[Debian] Warning: Failed to install ${pkg}: ${e.message}`);
      }
    }
  }

  async _execSudo(cmd, timeout = 120000) {
    return new Promise((resolve, reject) => {
      // Try pkexec first (GUI prompt), then sudo, then direct
      const tryCommands = [
        `pkexec bash -c '${cmd.replace(/'/g, "'\\''")}'`,
        `sudo bash -c '${cmd.replace(/'/g, "'\\''")}'`,
        cmd // last resort: direct (may work if already root)
      ];

      const tryNext = (index) => {
        if (index >= tryCommands.length) {
          reject(new Error(`Failed to execute: ${cmd}`));
          return;
        }
        exec(tryCommands[index], { timeout, maxBuffer: 10 * 1024 * 1024 }, (error, stdout) => {
          if (error && index < tryCommands.length - 1) {
            tryNext(index + 1);
          } else if (error) {
            reject(error);
          } else {
            resolve(stdout);
          }
        });
      };

      tryNext(0);
    });
  }
}

module.exports = { LinuxDebianAdapter };
