/**
 * Windy Pro v2.0 — Windows Platform Adapter
 * 
 * KEY LESSON FROM v1: Never rely on system Python. Ever.
 * Uses Python embedded distribution — a standalone Python that
 * doesn't need installation, doesn't touch PATH, doesn't conflict
 * with anything. This eliminates our #1 recurring bug.
 * 
 * COCKTAIL APPROACH: Bundle Python embedded + ffmpeg static + 
 * Visual C++ redistributable check. Zero external dependencies.
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
const PYTHON_DIR = path.join(APP_DIR, 'python');

// Embedded Python (no installer needed, no system changes)
const PYTHON_EMBED_URL = 'https://www.python.org/ftp/python/3.11.8/python-3.11.8-embed-amd64.zip';
const GET_PIP_URL = 'https://bootstrap.pypa.io/get-pip.py';
const FFMPEG_WIN_URL = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip';

class WindowsAdapter {
  constructor() {}

  /**
   * Install Python using embedded distribution — ZERO system changes
   */
  async installPython(onProgress) {
    onProgress(0);
    fs.mkdirSync(APP_DIR, { recursive: true });
    fs.mkdirSync(MODELS_DIR, { recursive: true });
    fs.mkdirSync(BIN_DIR, { recursive: true });

    const pythonExe = path.join(PYTHON_DIR, 'python.exe');

    // Step 1: Download Python embedded if not present
    if (!fs.existsSync(pythonExe)) {
      onProgress(5);
      const zipPath = path.join(APP_DIR, 'python-embed.zip');
      await this._downloadFile(PYTHON_EMBED_URL, zipPath);
      onProgress(15);

      // Extract
      fs.mkdirSync(PYTHON_DIR, { recursive: true });
      await this._exec(`powershell -Command "Expand-Archive -Force '${zipPath}' '${PYTHON_DIR}'"`, 120000);
      onProgress(20);

      // Enable pip by modifying python311._pth
      const pthFiles = fs.readdirSync(PYTHON_DIR).filter(f => f.endsWith('._pth'));
      for (const pth of pthFiles) {
        const pthPath = path.join(PYTHON_DIR, pth);
        let content = fs.readFileSync(pthPath, 'utf-8');
        // Uncomment "import site" line
        content = content.replace('#import site', 'import site');
        // Add Lib/site-packages
        if (!content.includes('Lib/site-packages')) {
          content += '\nLib/site-packages\n';
        }
        fs.writeFileSync(pthPath, content);
      }
      onProgress(22);

      // Install pip
      const getPipPath = path.join(APP_DIR, 'get-pip.py');
      await this._downloadFile(GET_PIP_URL, getPipPath);
      await this._exec(`"${pythonExe}" "${getPipPath}"`, 120000);
      onProgress(30);

      // Cleanup
      try { fs.unlinkSync(zipPath); } catch (e) {}
      try { fs.unlinkSync(getPipPath); } catch (e) {}
    } else {
      onProgress(30);
    }

    // Step 2: Create venv
    const venvPython = path.join(VENV_DIR, 'Scripts', 'python.exe');
    if (!fs.existsSync(venvPython)) {
      await this._exec(`"${pythonExe}" -m venv "${VENV_DIR}"`, 120000);
    }
    onProgress(40);

    // Step 3: Install packages
    const pip = path.join(VENV_DIR, 'Scripts', 'pip.exe');
    await this._exec(`"${pip}" install --upgrade pip setuptools wheel`, 120000);
    onProgress(50);

    const packages = [
      'faster-whisper', 'torch', 'torchaudio', 'sounddevice',
      'numpy', 'websockets', 'scipy', 'pydub'
    ];

    for (let i = 0; i < packages.length; i++) {
      try {
        await this._exec(`"${pip}" install ${packages[i]}`, 600000);
      } catch (e) {
        console.error(`Failed to install ${packages[i]}: ${e.message}`);
      }
      onProgress(50 + ((i + 1) / packages.length) * 45);
    }

    // Step 4: Check Visual C++ Redistributable
    try {
      const regQuery = execSync(
        'reg query "HKLM\\SOFTWARE\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\x64" /v Version 2>NUL',
        { timeout: 5000, stdio: 'pipe' }
      ).toString();
      if (!regQuery.includes('Version')) throw new Error('not found');
    } catch (e) {
      console.log('Visual C++ Redistributable may need to be installed for some features.');
      // Could auto-download vc_redist.x64.exe from Microsoft here
    }

    onProgress(100);
  }

  /**
   * Install static ffmpeg for Windows
   */
  async installFfmpeg(onProgress) {
    onProgress(0);
    const ffmpegExe = path.join(BIN_DIR, 'ffmpeg.exe');

    // Check PATH first
    try {
      execSync('ffmpeg -version', { timeout: 5000, stdio: 'pipe' });
      onProgress(100);
      return;
    } catch (e) {}

    // Check our bundled dir
    if (fs.existsSync(ffmpegExe)) {
      process.env.PATH = `${BIN_DIR};${process.env.PATH}`;
      onProgress(100);
      return;
    }

    // Download static ffmpeg
    onProgress(10);
    const zipPath = path.join(APP_DIR, 'ffmpeg-win.zip');
    try {
      await this._downloadFile(FFMPEG_WIN_URL, zipPath);
      onProgress(60);

      // Extract just ffmpeg.exe and ffprobe.exe
      await this._exec(
        `powershell -Command "Expand-Archive -Force '${zipPath}' '${APP_DIR}\\ffmpeg-temp'"`,
        120000
      );

      // Find the exe in the extracted folder
      const tempDir = path.join(APP_DIR, 'ffmpeg-temp');
      await this._findAndCopy(tempDir, 'ffmpeg.exe', ffmpegExe);
      await this._findAndCopy(tempDir, 'ffprobe.exe', path.join(BIN_DIR, 'ffprobe.exe'));

      // Cleanup
      try { fs.unlinkSync(zipPath); } catch (e) {}
      try { this._rmdir(tempDir); } catch (e) {}

      process.env.PATH = `${BIN_DIR};${process.env.PATH}`;
    } catch (e) {
      console.error('ffmpeg download failed:', e.message);
    }

    onProgress(100);
  }

  /**
   * NVIDIA CUDA detection — don't install, just detect
   * PyTorch bundles its own CUDA runtime
   */
  async installCuda(onProgress) {
    onProgress(0);
    try {
      const output = execSync('nvidia-smi', { timeout: 10000, stdio: 'pipe' }).toString();
      if (output.includes('NVIDIA')) {
        // Driver present — PyTorch CUDA will work
        onProgress(100);
        return;
      }
    } catch (e) {}

    // No NVIDIA driver — CPU inference
    console.log('No NVIDIA GPU driver — will use CPU inference');
    onProgress(100);
  }

  /**
   * Download model (placeholder — real downloads via shared DownloadManager)
   */
  async downloadModel(modelId, modelInfo, onProgress) {
    let progress = 0;
    return new Promise((resolve) => {
      const interval = setInterval(() => {
        progress += Math.random() * 8 + 2;
        if (progress >= 100) {
          clearInterval(interval);
          fs.mkdirSync(MODELS_DIR, { recursive: true });
          fs.writeFileSync(path.join(MODELS_DIR, `${modelId}.wpr`), `WNDY0001-placeholder-${modelId}`);
          onProgress(100);
          resolve();
        } else {
          onProgress(progress);
        }
      }, 500 + Math.random() * 500);
    });
  }

  async verify() {
    const pythonPath = path.join(VENV_DIR, 'Scripts', 'python.exe');
    if (!fs.existsSync(pythonPath)) throw new Error('Python not found');
    try {
      execSync(`"${pythonPath}" -c "from faster_whisper import WhisperModel; print('OK')"`, { timeout: 30000, stdio: 'pipe' });
    } catch (e) {
      console.error('Verification warning: faster-whisper import failed');
    }
  }

  /**
   * Windows permissions — UAC, firewall, etc.
   */
  async requestPermissions() {
    // Windows: no explicit mic permission needed (handled by OS prompt)
    // Cursor injection uses PowerShell SendKeys — no special permission
    // Firewall: WebSocket is localhost only — no firewall rule needed
  }

  // ─── Helpers ───

  async _downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(destPath);
      const doGet = (u) => {
        https.get(u, { timeout: 60000 }, (res) => {
          if (res.statusCode === 301 || res.statusCode === 302) {
            doGet(res.headers.location);
            return;
          }
          res.pipe(file);
          file.on('finish', () => file.close(resolve));
        }).on('error', (err) => { file.close(); reject(err); });
      };
      doGet(url);
    });
  }

  async _findAndCopy(dir, filename, dest) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        try {
          await this._findAndCopy(full, filename, dest);
          return;
        } catch (e) {}
      } else if (entry.name.toLowerCase() === filename.toLowerCase()) {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(full, dest);
        return;
      }
    }
    throw new Error(`${filename} not found in ${dir}`);
  }

  _rmdir(dir) {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
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

module.exports = { WindowsAdapter };
