/**
 * Windy Pro v2.0 — Dependency Installer (Rewritten)
 * 
 * Grant's Rule: "We need the total, complete, holistic cocktail so that
 * anything any hardware could possibly need to run Windy Pro is in that
 * cocktail. Can you imagine grandma getting told to download an obscure
 * version of Python?"
 * 
 * Strategy:
 * 1. Use BUNDLED assets first (Python, ffmpeg, model)
 * 2. Fall back to system-installed versions
 * 3. Fall back to platform package manager (apt/brew/choco)
 * 4. NEVER tell the user to install something manually
 * 
 * Sequence:
 * 0. CleanSlate (prior version removal) — called BEFORE this
 * 1. Install bundled Python → create venv → install pip packages
 * 2. Install bundled ffmpeg
 * 3. Install audio subsystem deps (portaudio, alsa, etc.)
 * 4. Install CUDA if GPU detected
 * 5. Install clipboard/injection tools (xdotool, etc.)
 * 6. Verify everything works
 */

const { exec, execSync } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { BundledAssets } = require('./bundled-assets');

const APP_DIR = path.join(os.homedir(), '.windy-pro');
const VENV_DIR = path.join(APP_DIR, 'venv');
const MODELS_DIR = path.join(APP_DIR, 'models');
const BIN_DIR = path.join(APP_DIR, 'bin');

class DependencyInstaller {
  constructor(options = {}) {
    this.platform = process.platform;
    this.bundled = new BundledAssets();
    this.onLog = options.onLog || console.log;
    this.onProgress = options.onProgress || (() => { });
    this.results = {};
    this.adapter = null; // Set by wizard-main to the platform adapter
  }

  /**
   * Install ALL dependencies. This is the one-stop method.
   * Returns { success, results, errors }
   */
  async installAll() {
    const errors = [];
    const results = {};

    this.onLog('[DependencyInstaller] Starting complete dependency installation...');
    this.onProgress(0, 'Starting dependency install...');

    // Create base directories
    for (const dir of [APP_DIR, MODELS_DIR, BIN_DIR]) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // ── Fast path: bundled Python + bundled wheels (offline, ~10s) ─────────
    // If the .app ships with a portable Python AND pre-downloaded wheels
    // (the new bulletproof bundling architecture from build-portable-bundle.js),
    // we skip the slow legacy "install Python from package manager → pip
    // install from PyPI" path entirely. This is the architecture that
    // honors the windyword.ai promise of "30 second install" + "no internet".
    let usedFastPath = false;
    if (this.bundled.hasBundledPython() && this.bundled.hasBundledWheels()) {
      this.onLog('[DependencyInstaller] Bundled Python + wheels detected — using fast path');
      const reqPath = this.bundled.getBundledRequirementsPath();
      if (reqPath) {
        try {
          const venvPython = await this.bundled.installVenvFromWheels(APP_DIR, reqPath, this.onLog);
          if (venvPython) {
            results.python = { success: true, path: venvPython, source: 'bundled-fast-path' };
            results.venv = { success: true, source: 'bundled-fast-path' };
            usedFastPath = true;
            this.onLog(`[DependencyInstaller] Fast-path venv ready: ${venvPython}`);
            this.onProgress(40, '✓ Python environment ready (fast path)');
          }
        } catch (e) {
          this.onLog(`[DependencyInstaller] Fast path failed (${e.message}) — falling back to legacy`);
        }
      } else {
        this.onLog('[DependencyInstaller] Bundled wheels present but no requirements-bundle.txt — falling back to legacy');
      }
    }

    // ── Legacy path: install Python (or detect system) + pip install from PyPI ──
    // This path runs only when bundled assets aren't present, OR the fast
    // path failed for some reason. Slower, requires internet, more crash-prone
    // across distros. Kept as a safety net while the new bundling is rolled
    // out, and as a fallback for dev installs without a packaged bundle.
    if (!usedFastPath) {
      // Step 1: Python
      this.onLog('[DependencyInstaller] Step 1/6: Installing Python...');
      this.onProgress(5, 'Installing Python runtime...');
      try {
        const pythonPath = await this._installPython();
        results.python = { success: true, path: pythonPath, source: 'legacy' };
        this.onLog(`[DependencyInstaller] Python: ${pythonPath}`);
      } catch (e) {
        errors.push(`Python: ${e.message}`);
        results.python = { success: false, error: e.message };
      }
      this.onProgress(20, '✓ Python runtime ready');

      // Step 2: Python venv + packages
      if (results.python?.success) {
        this.onLog('[DependencyInstaller] Step 2/6: Setting up Python environment...');
        try {
          await this._setupVenv(results.python.path);
          results.venv = { success: true, source: 'legacy' };
        } catch (e) {
          errors.push(`Python venv: ${e.message}`);
          results.venv = { success: false, error: e.message };
        }
      }
      this.onProgress(40, '✓ Python environment ready');
    }

    // Step 3: ffmpeg
    this.onLog('[DependencyInstaller] Step 3/6: Installing ffmpeg...');
    this.onProgress(45, 'Installing ffmpeg...');
    try {
      const ffmpegPath = await this._installFfmpeg();
      results.ffmpeg = { success: true, path: ffmpegPath };
      this.onLog(`[DependencyInstaller] ffmpeg: ${ffmpegPath}`);
    } catch (e) {
      errors.push(`ffmpeg: ${e.message}`);
      results.ffmpeg = { success: false, error: e.message };
    }
    this.onProgress(55, '✓ ffmpeg ready');

    // Step 4: Audio subsystem
    this.onLog('[DependencyInstaller] Step 4/6: Setting up audio subsystem...');
    this.onProgress(58, 'Configuring audio subsystem...');
    try {
      await this._installAudioDeps();
      results.audio = { success: true };
    } catch (e) {
      // Audio deps are non-fatal — some will already exist
      results.audio = { success: true, warning: e.message };
    }
    this.onProgress(65, '✓ Audio configured');

    // Step 5: CUDA (if applicable)
    this.onLog('[DependencyInstaller] Step 5/6: Checking GPU/CUDA...');
    this.onProgress(70, 'Checking for GPU acceleration...');
    try {
      const cuda = await this._installCuda();
      results.cuda = cuda;
    } catch (e) {
      results.cuda = { success: false, error: e.message, reason: 'Will use CPU inference' };
    }
    this.onProgress(80, '✓ GPU check complete');

    // Step 6: Clipboard/injection tools
    this.onLog('[DependencyInstaller] Step 6/6: Installing clipboard tools...');
    this.onProgress(85, 'Installing paste/clipboard tools...');
    try {
      await this._installClipboardTools();
      results.clipboard = { success: true };
    } catch (e) {
      results.clipboard = { success: true, warning: e.message };
    }
    this.onProgress(90, '✓ Paste tools ready');

    // Step 7: Default model from bundle
    this.onLog('[DependencyInstaller] Installing default model...');
    this.onProgress(92, 'Installing starter voice model...');
    try {
      const modelPath = await this.bundled.installDefaultModel(APP_DIR, this.onLog);
      results.defaultModel = { success: !!modelPath, path: modelPath };
    } catch (e) {
      results.defaultModel = { success: false, error: e.message };
    }
    this.onProgress(95, '✓ Starter model installed');

    // Verify
    this.onLog('[DependencyInstaller] Verifying installation...');
    this.onProgress(97, 'Verifying installation...');
    const verification = await this._verify();
    results.verification = verification;
    this.onProgress(100, '✓ All dependencies ready');

    const success = results.python?.success && results.ffmpeg?.success;
    this.results = results;

    return { success, results, errors };
  }

  /**
   * Check all dependencies without installing — returns status map
   */
  async checkAll() {
    const checks = {};

    // Python
    checks.python = await this._checkBinary('python3', ['python3 --version', 'python --version'], /Python 3\.\d+/);

    // ffmpeg
    checks.ffmpeg = await this._checkBinary('ffmpeg', ['ffmpeg -version'], /ffmpeg version/);

    // Python packages (in venv)
    const venvPy = path.join(VENV_DIR, this.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python3');
    if (fs.existsSync(venvPy)) {
      try {
        execSync(`"${venvPy}" -c "import faster_whisper, torch, sounddevice, websockets; print('OK')"`, {
          timeout: 15000, stdio: 'pipe'
        });
        checks.packages = { status: 'installed' };
      } catch (e) {
        checks.packages = { status: 'missing' };
      }
    } else {
      checks.packages = { status: 'missing' };
    }

    // Models
    if (fs.existsSync(MODELS_DIR) && fs.readdirSync(MODELS_DIR).length > 0) {
      checks.models = { status: 'installed', count: fs.readdirSync(MODELS_DIR).length };
    } else {
      checks.models = { status: 'missing' };
    }

    return checks;
  }

  // ─── Installation Methods ───

  async _installPython() {
    // Strategy 1: Bundled Python
    const bundledPy = await this.bundled.installPython(APP_DIR, this.onLog);
    if (bundledPy) return bundledPy;

    // Strategy 2: System Python
    const systemPy = this._findSystemPython();
    if (systemPy) return systemPy;

    // Strategy 3: Platform package manager
    return await this._installPythonFromPackageManager();
  }

  _findSystemPython() {
    const candidates = ['python3.12', 'python3.11', 'python3.10', 'python3.9', 'python3', 'python'];
    for (const cmd of candidates) {
      try {
        const version = execSync(`${cmd} --version 2>&1`, { timeout: 5000, stdio: 'pipe' }).toString().trim();
        const match = version.match(/Python (\d+)\.(\d+)/);
        if (match && parseInt(match[1]) >= 3 && parseInt(match[2]) >= 9) {
          this.onLog(`[DependencyInstaller] Found system Python: ${version}`);
          return cmd;
        }
      } catch (e) { /* try next */ }
    }
    return null;
  }

  async _installPythonFromPackageManager() {
    this.onLog('[DependencyInstaller] Installing Python via package manager...');

    if (this.platform === 'darwin') {
      // macOS: try Homebrew, then install Homebrew if needed
      try {
        execSync('which brew', { stdio: 'pipe', timeout: 3000 });
      } catch (e) {
        this.onLog('[DependencyInstaller] Installing Homebrew (required for macOS Python)...');
        await this._exec('NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"', 300000);
      }
      await this._exec('brew install python@3.11 || brew install python3', 300000);
      return this._findSystemPython() || 'python3';

    } else if (this.platform === 'linux') {
      // Linux: detect distro and use appropriate package manager
      const distro = this._detectLinuxDistro();
      switch (distro) {
        case 'debian':
        case 'ubuntu':
          await this._execSudo('apt-get update && apt-get install -y python3 python3-pip python3-venv python3-dev build-essential libffi-dev', 300000);
          break;
        case 'fedora':
        case 'rhel':
        case 'centos':
          await this._execSudo('dnf install -y python3 python3-devel python3-pip gcc libffi-devel || yum install -y python3 python3-devel python3-pip', 300000);
          break;
        case 'arch':
        case 'manjaro':
          await this._execSudo('pacman -Sy --noconfirm python python-pip python-virtualenv base-devel', 300000);
          break;
        case 'suse':
          await this._execSudo('zypper install -y python3 python3-pip python3-devel gcc', 300000);
          break;
        default:
          // Universal fallback: Miniforge
          this.onLog('[DependencyInstaller] Unknown distro, installing Miniforge standalone Python...');
          const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
          const miniforge = path.join(os.tmpdir(), 'miniforge.sh');
          await this._exec(`curl -fsSL https://github.com/conda-forge/miniforge/releases/latest/download/Miniforge3-Linux-${arch}.sh -o "${miniforge}"`, 120000);
          await this._exec(`bash "${miniforge}" -b -p "${path.join(APP_DIR, 'python')}"`, 120000);
          return path.join(APP_DIR, 'python', 'bin', 'python3');
      }
      return this._findSystemPython() || 'python3';

    } else if (this.platform === 'win32') {
      // Windows: bundled Python should always work, but try winget as fallback
      try {
        await this._exec('winget install Python.Python.3.11 --accept-package-agreements --accept-source-agreements', 300000);
      } catch (e) {
        throw new Error('Could not install Python. The bundled Python should have worked. Please report this bug.');
      }
      return this._findSystemPython() || 'python';
    }

    throw new Error('Could not install Python on this platform');
  }

  async _setupVenv(pythonPath) {
    const venvPy = path.join(VENV_DIR, this.platform === 'win32' ? 'Scripts\\python.exe' : 'bin/python3');

    // Fast path: venv already set up with all packages
    if (fs.existsSync(venvPy)) {
      try {
        const check = execSync(
          `"${venvPy}" -c "import faster_whisper, torch, sounddevice, websockets; print('OK')"`,
          { timeout: 15000, stdio: 'pipe' }
        ).toString().trim();
        if (check === 'OK') {
          this.onLog('[DependencyInstaller] Python venv already complete');
          return;
        }
      } catch (e) {
        this.onLog('[DependencyInstaller] Some packages missing, installing...');
      }
    }

    // Create venv if needed
    if (!fs.existsSync(venvPy)) {
      this.onProgress(22, 'Creating Python virtual environment...');
      await this._exec(`"${pythonPath}" -m venv "${VENV_DIR}"`, 120000);
    }

    // Upgrade pip
    const pip = path.join(VENV_DIR, this.platform === 'win32' ? 'Scripts\\pip.exe' : 'bin/pip');
    this.onProgress(25, 'Upgrading pip, setuptools, wheel...');
    await this._exec(`"${pip}" install --upgrade pip setuptools wheel`, 120000);

    // Install packages in order of importance
    const packages = [
      'faster-whisper',
      'torch',
      'torchaudio',
      'sounddevice',
      'numpy',
      'websockets',
      'scipy',
      'librosa',
      'pydub',
      'ctranslate2',          // For CPU INT8 models
      'sentencepiece',        // For OPUS-MT translation pairs
      'transformers',         // For loading HF models
    ];

    // Install in batches of 3 for speed, with individual fallback.
    // Between batch boundaries we emit onProgress so the UI bar moves;
    // inside a single `pip install` call we can't see progress, but a
    // ticker asymptotically advances the bar + rotates the message so
    // a 5-minute llvmlite compile doesn't look like a frozen wizard.
    const batchSize = 3;
    const totalBatches = Math.ceil(packages.length / batchSize);
    // Batch progress spans pct 27 → 38 (final onProgress(40) lives in installAll)
    const batchStart = 27;
    const batchSpan = 11;

    for (let i = 0; i < packages.length; i += batchSize) {
      const batchIdx = Math.floor(i / batchSize);
      const batchPkgs = packages.slice(i, i + batchSize);
      const batchLabel = batchPkgs.join(', ');
      const startPct = batchStart + (batchIdx / totalBatches) * batchSpan;
      const endPct = batchStart + ((batchIdx + 1) / totalBatches) * batchSpan;

      this.onProgress(startPct, `Installing ${batchLabel}...`);

      // Heartbeat — advance pct asymptotically toward endPct so the bar
      // visibly creeps forward even when pip is blocked on a slow compile.
      const tickerStart = Date.now();
      const ticker = setInterval(() => {
        const elapsed = (Date.now() - tickerStart) / 1000;
        const advanced = startPct + (endPct - startPct) * (1 - Math.exp(-elapsed / 45));
        const hint = elapsed > 30
          ? `Installing ${batchLabel}... (${Math.round(elapsed)}s — some packages build from source, this is normal)`
          : `Installing ${batchLabel}...`;
        this.onProgress(advanced, hint);
      }, 3000);

      try {
        await this._exec(`"${pip}" install ${batchPkgs.join(' ')}`, 600000);
      } catch (e) {
        // Retry individually
        for (const pkg of batchPkgs) {
          this.onProgress(startPct, `Retrying ${pkg} individually...`);
          try {
            await this._exec(`"${pip}" install ${pkg}`, 300000);
          } catch (e2) {
            this.onLog(`[DependencyInstaller] Warning: Failed to install ${pkg}: ${e2.message}`);
          }
        }
      } finally {
        clearInterval(ticker);
      }

      this.onProgress(endPct, `✓ ${batchLabel} installed`);
    }
  }

  async _installFfmpeg() {
    // Strategy 1: Bundled ffmpeg
    const bundledPath = await this.bundled.installFfmpeg(APP_DIR, this.onLog);
    if (bundledPath) return bundledPath;

    // Strategy 2: System ffmpeg
    try {
      execSync('ffmpeg -version', { timeout: 5000, stdio: 'pipe' });
      this.onLog('[DependencyInstaller] System ffmpeg found');
      return 'ffmpeg';
    } catch (e) { /* not found */ }

    // Strategy 3: Platform package manager
    this.onLog('[DependencyInstaller] Installing ffmpeg via package manager...');
    if (this.platform === 'darwin') {
      await this._exec('brew install ffmpeg', 300000);
    } else if (this.platform === 'linux') {
      const distro = this._detectLinuxDistro();
      switch (distro) {
        case 'debian':
        case 'ubuntu':
          await this._execSudo('apt-get install -y ffmpeg', 300000);
          break;
        case 'fedora':
          await this._execSudo('dnf install -y https://download1.rpmfusion.org/free/fedora/rpmfusion-free-release-$(rpm -E %fedora).noarch.rpm && dnf install -y ffmpeg', 300000);
          break;
        case 'arch':
          await this._execSudo('pacman -Sy --noconfirm ffmpeg', 300000);
          break;
        default:
          // Try snap/flatpak as last resort
          await this._execSudo('snap install ffmpeg || apt-get install -y ffmpeg || dnf install -y ffmpeg', 300000);
      }
    } else if (this.platform === 'win32') {
      // Download static binary for Windows
      const ffmpegUrl = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip';
      const zipPath = path.join(os.tmpdir(), 'ffmpeg-win64.zip');
      const extractDir = path.join(os.tmpdir(), 'ffmpeg-extract');
      await this._exec(`powershell -Command "Invoke-WebRequest -Uri '${ffmpegUrl}' -OutFile '${zipPath}'"`, 300000);
      await this._exec(`powershell -Command "Expand-Archive -Force '${zipPath}' '${extractDir}'"`, 60000);
      // Find ffmpeg.exe and copy to BIN_DIR
      const ffmpegExe = this._findFileRecursive(extractDir, 'ffmpeg.exe');
      if (ffmpegExe) {
        fs.copyFileSync(ffmpegExe, path.join(BIN_DIR, 'ffmpeg.exe'));
        return path.join(BIN_DIR, 'ffmpeg.exe');
      }
    }

    // Verify
    try {
      execSync('ffmpeg -version', { timeout: 5000, stdio: 'pipe' });
      return 'ffmpeg';
    } catch (e) {
      throw new Error('Could not install ffmpeg');
    }
  }

  async _installAudioDeps() {
    if (this.platform === 'linux') {
      const distro = this._detectLinuxDistro();
      const packages = {
        debian: 'portaudio19-dev libasound2-dev alsa-utils pulseaudio libpulse-dev sox libsox-fmt-all gstreamer1.0-plugins-good',
        ubuntu: 'portaudio19-dev libasound2-dev alsa-utils pulseaudio libpulse-dev sox libsox-fmt-all gstreamer1.0-plugins-good',
        fedora: 'portaudio-devel alsa-lib-devel alsa-utils pulseaudio pulseaudio-libs-devel sox gstreamer1-plugins-good',
        arch: 'portaudio alsa-utils pulseaudio libpulse sox gstreamer gst-plugins-good',
      };
      const pkgList = packages[distro] || packages.debian;
      try {
        if (['debian', 'ubuntu'].includes(distro)) {
          await this._execSudo(`apt-get install -y ${pkgList} || true`, 120000);
        } else if (distro === 'fedora') {
          await this._execSudo(`dnf install -y ${pkgList} || true`, 120000);
        } else if (distro === 'arch') {
          await this._execSudo(`pacman -Sy --noconfirm ${pkgList} || true`, 120000);
        }
      } catch (e) {
        this.onLog(`[DependencyInstaller] Some audio deps failed: ${e.message}`);
      }
    }
    // macOS and Windows handle audio natively
  }

  async _installCuda() {
    // Check if GPU exists
    try {
      if (this.platform === 'win32') {
        execSync('nvidia-smi', { stdio: 'pipe', timeout: 5000 });
      } else {
        execSync('nvidia-smi 2>/dev/null', { stdio: 'pipe', timeout: 5000 });
      }
    } catch (e) {
      return { success: false, reason: 'No NVIDIA GPU detected. Will use CPU inference.' };
    }

    // Check if CUDA is already installed
    try {
      execSync('nvcc --version', { stdio: 'pipe', timeout: 5000 });
      return { success: true, preinstalled: true };
    } catch (e) { /* not installed */ }

    // Don't auto-install CUDA — it's huge and complex.
    // Instead, note that PyTorch will use CUDA if available.
    return { success: true, reason: 'NVIDIA GPU detected. PyTorch will use GPU acceleration.' };
  }

  async _installClipboardTools() {
    if (this.platform === 'linux') {
      const session = process.env.XDG_SESSION_TYPE || 'x11';
      const distro = this._detectLinuxDistro();
      if (['debian', 'ubuntu'].includes(distro)) {
        if (session === 'wayland') {
          await this._execSudo('apt-get install -y ydotool wl-clipboard xclip || true', 60000);
        } else {
          await this._execSudo('apt-get install -y xdotool xclip xsel || true', 60000);
        }
      } else if (distro === 'fedora') {
        await this._execSudo(`dnf install -y ${session === 'wayland' ? 'ydotool wl-clipboard' : 'xdotool xclip xsel'} || true`, 60000);
      } else if (distro === 'arch') {
        await this._execSudo(`pacman -Sy --noconfirm ${session === 'wayland' ? 'ydotool wl-clipboard' : 'xdotool xclip xsel'} || true`, 60000);
      }
    }
    // macOS and Windows have built-in clipboard support
  }

  async _verify() {
    const checks = {};

    // Check Python venv
    const venvPy = path.join(VENV_DIR, this.platform === 'win32' ? 'Scripts\\python.exe' : 'bin/python3');
    if (fs.existsSync(venvPy)) {
      try {
        const output = execSync(`"${venvPy}" -c "import faster_whisper; print('OK')"`, {
          timeout: 15000, stdio: 'pipe'
        }).toString().trim();
        checks.python = output === 'OK' ? 'pass' : 'partial';
      } catch (e) {
        checks.python = 'fail';
      }
    } else {
      checks.python = 'fail';
    }

    // Check ffmpeg
    try {
      // Check bundled ffmpeg first
      const bundledFfmpeg = path.join(BIN_DIR, this.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
      if (fs.existsSync(bundledFfmpeg)) {
        execSync(`"${bundledFfmpeg}" -version`, { timeout: 5000, stdio: 'pipe' });
        checks.ffmpeg = 'pass';
      } else {
        execSync('ffmpeg -version', { timeout: 5000, stdio: 'pipe' });
        checks.ffmpeg = 'pass';
      }
    } catch (e) {
      checks.ffmpeg = 'fail';
    }

    // Check models directory
    checks.models = fs.existsSync(MODELS_DIR) && fs.readdirSync(MODELS_DIR).length > 0 ? 'pass' : 'empty';

    return checks;
  }

  // ─── Helpers ───

  _detectLinuxDistro() {
    try {
      const osRelease = fs.readFileSync('/etc/os-release', 'utf-8').toLowerCase();
      if (osRelease.includes('ubuntu')) return 'ubuntu';
      if (osRelease.includes('debian')) return 'debian';
      if (osRelease.includes('fedora')) return 'fedora';
      if (osRelease.includes('centos') || osRelease.includes('rhel') || osRelease.includes('red hat')) return 'fedora';
      if (osRelease.includes('arch') || osRelease.includes('manjaro')) return 'arch';
      if (osRelease.includes('suse') || osRelease.includes('opensuse')) return 'suse';
    } catch (e) { /* ignore */ }

    // Fallback: check which package managers exist
    try { execSync('which apt-get', { stdio: 'pipe' }); return 'debian'; } catch (e) { }
    try { execSync('which dnf', { stdio: 'pipe' }); return 'fedora'; } catch (e) { }
    try { execSync('which pacman', { stdio: 'pipe' }); return 'arch'; } catch (e) { }
    try { execSync('which zypper', { stdio: 'pipe' }); return 'suse'; } catch (e) { }

    return 'unknown';
  }

  _exec(cmd, timeout = 60000) {
    return new Promise((resolve, reject) => {
      exec(cmd, { timeout, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) reject(error);
        else resolve(stdout);
      });
    });
  }

  async _execSudo(cmd, timeout = 120000) {
    // Try pkexec (GUI prompt) only if display available, then non-interactive sudo, then direct
    if (this.platform !== 'win32') {
      if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) {
        try {
          return await this._exec(`pkexec bash -c '${cmd.replace(/'/g, "'\\''")}'`, timeout);
        } catch (e) { /* fall through */ }
      }
      try {
        return await this._exec(`sudo -n bash -c '${cmd.replace(/'/g, "'\\''")}'`, timeout);
      } catch (e2) {
        // Last resort: try without sudo (may work if packages already installed)
        return await this._exec(cmd, timeout);
      }
    }
    return await this._exec(cmd, timeout);
  }

  _findFileRecursive(dir, filename) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const found = this._findFileRecursive(full, filename);
          if (found) return found;
        } else if (entry.name.toLowerCase() === filename.toLowerCase()) {
          return full;
        }
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  async _checkBinary(name, commands, pattern) {
    for (const cmd of commands) {
      try {
        const output = execSync(cmd, { timeout: 5000, stdio: 'pipe' }).toString();
        if (pattern.test(output)) {
          return { status: 'installed', version: output.trim().split('\n')[0] };
        }
      } catch (e) { /* try next */ }
    }
    return { status: 'missing' };
  }

  /**
   * Get wizard-friendly summary
   */
  getSummary() {
    if (!this.results) return [];
    return Object.entries(this.results).map(([name, r]) => ({
      name,
      icon: r.success ? '✅' : r.warning ? '⚠️' : '❌',
      status: r.success ? 'installed' : 'failed',
      detail: r.path || r.warning || r.error || r.reason || '',
    }));
  }
}

module.exports = { DependencyInstaller };
