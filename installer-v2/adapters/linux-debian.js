/**
 * Windy Pro v2.0 — Linux Debian/Ubuntu Platform Adapter
 * Handles all Debian-specific dependency installation.
 * 
 * THE COCKTAIL APPROACH: Install every possible version of every possible
 * dependency. Let the runtime sort it out. No user should EVER hit a missing
 * dependency error.
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

// Model download URLs (placeholder — replace with actual CDN URLs)
const MODEL_CDN_BASE = 'https://models.windypro.thewindstorm.uk/v2';

class LinuxDebianAdapter {
  constructor() {
    this.sudoPassword = null; // Will prompt if needed
  }

  /**
   * Install Python + create venv + install pip packages
   * The COCKTAIL: try every possible Python version, every possible method
   */
  async installPython(onProgress) {
    onProgress(0);
    fs.mkdirSync(APP_DIR, { recursive: true });
    fs.mkdirSync(MODELS_DIR, { recursive: true });
    fs.mkdirSync(BIN_DIR, { recursive: true });

    // ═══ FAST PATH: Skip if venv + key packages already installed ═══
    const venvPython = path.join(VENV_DIR, 'bin', 'python3');
    if (fs.existsSync(venvPython)) {
      try {
        const check = execSync(
          `"${venvPython}" -c "import faster_whisper, torch, sounddevice, websockets; print('OK')"`,
          { timeout: 15000, stdio: 'pipe' }
        ).toString().trim();
        if (check === 'OK') {
          console.log('[LinuxDebianAdapter] Python deps already installed — skipping');
          onProgress(100);
          return;
        }
      } catch (e) {
        console.log('[LinuxDebianAdapter] Some Python deps missing — installing');
      }
    }

    // Step 1: Find or install Python 3.9+
    const pythonBin = await this._findOrInstallPython();
    onProgress(30);

    // Step 2: Create venv
    if (!fs.existsSync(venvPython)) {
      await this._exec(`"${pythonBin}" -m venv "${VENV_DIR}"`, 120000);
    }
    onProgress(50);

    // Step 3: Upgrade pip
    const pip = path.join(VENV_DIR, 'bin', 'pip');
    await this._exec(`"${pip}" install --upgrade pip setuptools wheel`, 120000);
    onProgress(65);

    // Step 4: Install all Python packages
    const packages = [
      'faster-whisper',           // Core transcription engine
      'torch',                     // PyTorch (for GPU inference)
      'torchaudio',               // Audio processing
      'sounddevice',              // Microphone capture
      'numpy',                     // Math
      'websockets',               // WebSocket server
      'scipy',                     // Signal processing
      'librosa',                   // Audio analysis
      'pydub',                     // Audio format conversion
    ];

    // Install in batches for better progress reporting
    const batchSize = 3;
    for (let i = 0; i < packages.length; i += batchSize) {
      const batch = packages.slice(i, i + batchSize).join(' ');
      try {
        await this._exec(`"${pip}" install ${batch}`, 600000); // 10 min timeout per batch
      } catch (e) {
        // Try individually if batch fails
        for (const pkg of packages.slice(i, i + batchSize)) {
          try {
            await this._exec(`"${pip}" install ${pkg}`, 300000);
          } catch (e2) {
            console.error(`Failed to install ${pkg}: ${e2.message}`);
          }
        }
      }
      onProgress(65 + ((i + batchSize) / packages.length) * 35);
    }

    onProgress(100);
  }

  /**
   * Find Python 3.9+ on the system, or install it
   */
  async _findOrInstallPython() {
    // Try common Python paths in order
    const candidates = [
      'python3.12', 'python3.11', 'python3.10', 'python3.9',
      'python3', 'python'
    ];

    for (const cmd of candidates) {
      try {
        const version = execSync(`${cmd} --version 2>&1`, { timeout: 5000 }).toString().trim();
        const match = version.match(/Python (\d+)\.(\d+)/);
        if (match && (parseInt(match[1]) >= 3 && parseInt(match[2]) >= 9)) {
          return cmd;
        }
      } catch (e) {}
    }

    // Python not found — try to install via APT
    // THE COCKTAIL: install every available Python version
    const aptPackages = [
      'python3', 'python3-venv', 'python3-pip', 'python3-dev',
      'python3.12', 'python3.12-venv', 'python3.12-dev',
      'python3.11', 'python3.11-venv', 'python3.11-dev',
      'python3.10', 'python3.10-venv', 'python3.10-dev',
      'python3.9', 'python3.9-venv', 'python3.9-dev',
      'python3-full',  // Some distros use this
      'build-essential', 'libffi-dev', 'libssl-dev'
    ];

    try {
      // Update package lists
      await this._execSudo('apt-get update -y');
      // Install everything — ignore individual failures
      await this._execSudo(`apt-get install -y ${aptPackages.join(' ')} || true`);
    } catch (e) {
      // If APT fails entirely, try deadsnakes PPA
      try {
        await this._execSudo('apt-get install -y software-properties-common');
        await this._execSudo('add-apt-repository -y ppa:deadsnakes/ppa');
        await this._execSudo('apt-get update -y');
        await this._execSudo('apt-get install -y python3.11 python3.11-venv python3.11-dev');
      } catch (e2) {
        throw new Error('Could not install Python. Please install Python 3.9+ manually.');
      }
    }

    // Try again after install
    for (const cmd of candidates) {
      try {
        const version = execSync(`${cmd} --version 2>&1`, { timeout: 5000 }).toString().trim();
        const match = version.match(/Python (\d+)\.(\d+)/);
        if (match && (parseInt(match[1]) >= 3 && parseInt(match[2]) >= 9)) {
          return cmd;
        }
      } catch (e) {}
    }

    throw new Error('Python installation failed. Please install Python 3.9+ and try again.');
  }

  /**
   * Install ffmpeg + audio dependencies
   * COCKTAIL: install every possible audio package
   */
  async installFfmpeg(onProgress) {
    onProgress(0);

    // ═══ FAST PATH: Skip if ffmpeg already available ═══
    try {
      execSync('ffmpeg -version', { timeout: 5000, stdio: 'pipe' });
      console.log('[LinuxDebianAdapter] ffmpeg already installed — skipping');
      onProgress(100);
      return;
    } catch (e) { /* not found, install it */ }

    const audioPackages = [
      'ffmpeg',
      'portaudio19-dev', 'libportaudio2',
      'libasound2-dev', 'libasound2',
      'pulseaudio', 'libpulse-dev',
      'alsa-utils',
      'libsndfile1-dev', 'libsndfile1',
      'sox', 'libsox-dev',
      'libavcodec-extra',
      'libmp3lame-dev', 'libvorbis-dev',
      'gstreamer1.0-tools', 'gstreamer1.0-plugins-good', 'gstreamer1.0-plugins-bad'
    ];

    try {
      await this._execSudo(`apt-get install -y ${audioPackages.join(' ')} || true`, 300000);
    } catch (e) {
      console.error('Some audio packages failed — ffmpeg is likely still available');
    }

    // Verify ffmpeg
    try {
      execSync('ffmpeg -version', { timeout: 5000, stdio: 'pipe' });
      onProgress(100);
    } catch (e) {
      // Try snap as fallback
      try {
        await this._execSudo('snap install ffmpeg');
        onProgress(100);
      } catch (e2) {
        console.error('ffmpeg installation failed — some features may not work');
        onProgress(100);
      }
    }
  }

  /**
   * Install CUDA toolkit for NVIDIA GPUs
   */
  async installCuda(onProgress) {
    onProgress(0);

    // Check if CUDA is already available
    try {
      execSync('nvcc --version', { timeout: 5000, stdio: 'pipe' });
      onProgress(100);
      return; // Already installed
    } catch (e) {}

    const cudaPackages = [
      'nvidia-cuda-toolkit',
      'nvidia-cuda-dev',
      'libcudnn8', 'libcudnn8-dev',
      'libnccl2', 'libnccl-dev'
    ];

    try {
      await this._execSudo(`apt-get install -y ${cudaPackages.join(' ')} || true`, 600000);
    } catch (e) {
      // CUDA is nice-to-have, not required — CPU inference still works
      console.error('CUDA installation failed — will use CPU inference');
    }

    onProgress(100);
  }

  /**
   * Download a model .wpr file from CDN
   */
  async downloadModel(modelId, modelInfo, onProgress) {
    const sizeMB = modelInfo?.sizeMB || 100;
    const modelPath = path.join(MODELS_DIR, `${modelId}.wpr`);

    // Skip if already downloaded
    if (fs.existsSync(modelPath)) {
      const stat = fs.statSync(modelPath);
      if (stat.size > sizeMB * 1024 * 0.5) { // At least 50% of expected size
        onProgress(100);
        return;
      }
    }

    const url = `${MODEL_CDN_BASE}/${modelId}.wpr`;

    return new Promise((resolve, reject) => {
      // For now, simulate download since CDN isn't set up yet
      // TODO: Replace with actual HTTPS download with resume support
      let progress = 0;
      const interval = setInterval(() => {
        progress += Math.random() * 8 + 2; // 2-10% per tick
        if (progress >= 100) {
          progress = 100;
          clearInterval(interval);
          // Create placeholder model file
          fs.writeFileSync(modelPath, `WNDY0001-placeholder-${modelId}`);
          onProgress(100);
          resolve();
        } else {
          onProgress(progress);
        }
      }, 500 + Math.random() * 500); // Every 0.5-1s
    });
  }

  /**
   * Verify the installation
   */
  async verify() {
    const pythonPath = path.join(VENV_DIR, 'bin', 'python3');

    if (!fs.existsSync(pythonPath)) {
      throw new Error('Python environment not found');
    }

    // Test faster-whisper import
    try {
      execSync(`"${pythonPath}" -c "from faster_whisper import WhisperModel; print('OK')"`, {
        timeout: 30000,
        stdio: 'pipe'
      });
    } catch (e) {
      console.error('Verification warning: faster-whisper import failed');
      // Don't throw — let user try anyway
    }

    // Test ffmpeg
    try {
      execSync('ffmpeg -version', { timeout: 5000, stdio: 'pipe' });
    } catch (e) {
      console.error('Verification warning: ffmpeg not found in PATH');
    }
  }

  /**
   * Request microphone and other permissions
   */
  async requestPermissions() {
    // Linux: mic permissions are handled by PulseAudio/ALSA — no explicit request needed
    // But we check for xdotool/ydotool for cursor injection

    const xdgSession = process.env.XDG_SESSION_TYPE || 'x11';

    if (xdgSession === 'wayland') {
      // Install ydotool for Wayland cursor injection
      try {
        execSync('which ydotool', { timeout: 3000, stdio: 'pipe' });
      } catch (e) {
        try {
          await this._execSudo('apt-get install -y ydotool || true');
        } catch (e2) {
          console.error('ydotool not available — cursor injection may not work on Wayland');
        }
      }
    } else {
      // Install xdotool for X11 cursor injection
      try {
        execSync('which xdotool', { timeout: 3000, stdio: 'pipe' });
      } catch (e) {
        try {
          await this._execSudo('apt-get install -y xdotool || true');
        } catch (e2) {
          console.error('xdotool not available — cursor injection may not work on X11');
        }
      }
    }

    // Install xclip/xsel for clipboard
    try {
      await this._execSudo('apt-get install -y xclip xsel wl-clipboard || true');
    } catch (e) {}
  }

  /**
   * Execute a command with sudo (using pkexec for GUI prompt)
   */
  async _execSudo(cmd, timeout = 120000) {
    return this._exec(`pkexec bash -c '${cmd.replace(/'/g, "'\\''")}'`, timeout);
  }

  /**
   * Execute a command and return stdout
   */
  _exec(cmd, timeout = 60000) {
    return new Promise((resolve, reject) => {
      exec(cmd, { timeout, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) reject(error);
        else resolve(stdout);
      });
    });
  }
}

module.exports = { LinuxDebianAdapter };
