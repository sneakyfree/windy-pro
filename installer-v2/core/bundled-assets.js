/**
 * Windy Pro v2.0 — Bundled Assets Resolver
 * 
 * Grant's Rule: "We need the total, complete, holistic cocktail in our
 * installation wizard so that anything any hardware could possibly need
 * to run Windy Pro is in that cocktail."
 * 
 * This module resolves bundled Python, ffmpeg, and model assets.
 * Bundled assets are the PRIMARY source. Internet downloads are FALLBACK only.
 * 
 * Directory structure (relative to app root):
 *   bundled/
 *     python/
 *       python-3.11.9-linux.tar.gz
 *       python-3.11.9-macos.tar.gz
 *       python-3.11.9-win64.zip
 *       linux/       (extracted)
 *       macos/       (extracted)
 *       win64/       (extracted)
 *     ffmpeg/
 *       ffmpeg-linux.tar.xz
 *       ffmpeg-macos.zip
 *       ffmpeg-win64.zip
 *       extracted-linux/
 *       extracted-mac/
 *       extracted-win/
 *     model/
 *       faster-whisper-base/   (default model for first-run)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

class BundledAssets {
  constructor() {
    // Resolve bundle directory - could be in several locations depending on packaging
    this.bundleDir = this._findBundleDir();
    this.platform = process.platform; // win32, darwin, linux
    this.arch = process.arch; // x64, arm64
  }

  /**
   * Find the bundled/ directory. It can be in:
   * - ./bundled/ (development)
   * - ../bundled/ (from installer-v2/)
   * - resources/bundled/ (Electron packaged)
   * - process.resourcesPath/bundled/ (Electron asar)
   */
  _findBundleDir() {
    const candidates = [
      path.join(__dirname, '..', '..', 'bundled'),          // from core/ → installer-v2/ → project root
      path.join(__dirname, '..', 'bundled'),                 // from core/ → installer-v2/bundled
      path.join(process.cwd(), 'bundled'),                   // from project root
      path.join(process.cwd(), '..', 'bundled'),
    ];

    // Electron packaged app
    if (process.resourcesPath) {
      candidates.unshift(path.join(process.resourcesPath, 'bundled'));
    }

    for (const dir of candidates) {
      if (fs.existsSync(dir) && fs.existsSync(path.join(dir, 'python'))) {
        return dir;
      }
    }

    return path.join(process.cwd(), 'bundled'); // fallback, may not exist
  }

  /**
   * Check if bundled assets are available
   */
  hasBundledPython() {
    const pythonDir = this._getPythonExtractedDir();
    return fs.existsSync(pythonDir);
  }

  hasBundledFfmpeg() {
    const ffmpegDir = this._getFfmpegExtractedDir();
    return fs.existsSync(ffmpegDir);
  }

  hasBundledModel() {
    return fs.existsSync(path.join(this.bundleDir, 'model', 'faster-whisper-base'));
  }

  /**
   * Get the path to the bundled production requirements file
   * (shipped by stage-portable-bundle.js). Used for offline pip install.
   * Returns null if not bundled (legacy bundle without wheels).
   */
  getBundledRequirementsPath() {
    const p = path.join(this.bundleDir, 'requirements-bundle.txt');
    return fs.existsSync(p) ? p : null;
  }

  /**
   * Get the path to the bundled Python directory.
   *
   * Modern flat layout (produced by scripts/build-portable-bundle.js):
   *   bundled/python/{bin,lib,...}                 — single platform per build
   *
   * Legacy platform-segmented layout (older prepare-bundle.js):
   *   bundled/python/{macos,linux,win64}/python/   — all platforms in one dir
   *
   * We check the modern layout first, then fall back to legacy.
   */
  _getPythonExtractedDir() {
    // Modern flat layout: bundled/python/bin/python3 (Unix) or python.exe (Win)
    const flatProbe = this.platform === 'win32'
      ? path.join(this.bundleDir, 'python', 'python.exe')
      : path.join(this.bundleDir, 'python', 'bin', 'python3');
    if (fs.existsSync(flatProbe)) {
      return path.join(this.bundleDir, 'python');
    }
    // Legacy platform-segmented layout
    if (this.platform === 'win32') {
      return path.join(this.bundleDir, 'python', 'win64');
    } else if (this.platform === 'darwin') {
      return path.join(this.bundleDir, 'python', 'macos', 'python');
    } else {
      return path.join(this.bundleDir, 'python', 'linux', 'python');
    }
  }

  /**
   * Get the path to the bundled ffmpeg directory.
   *
   * Modern flat layout: bundled/ffmpeg/ffmpeg(.exe)
   * Legacy layout:      bundled/ffmpeg/extracted-{mac,linux,win}/...
   */
  _getFfmpegExtractedDir() {
    const flatProbe = this.platform === 'win32'
      ? path.join(this.bundleDir, 'ffmpeg', 'ffmpeg.exe')
      : path.join(this.bundleDir, 'ffmpeg', 'ffmpeg');
    if (fs.existsSync(flatProbe)) {
      return path.join(this.bundleDir, 'ffmpeg');
    }
    if (this.platform === 'win32') {
      return path.join(this.bundleDir, 'ffmpeg', 'extracted-win');
    } else if (this.platform === 'darwin') {
      return path.join(this.bundleDir, 'ffmpeg', 'extracted-mac');
    } else {
      return path.join(this.bundleDir, 'ffmpeg', 'extracted-linux');
    }
  }

  /**
   * Get path to the bundled wheels directory.
   * Returns null if no wheels are bundled (legacy bundle without wheels).
   */
  _getWheelsDir() {
    const dir = path.join(this.bundleDir, 'wheels');
    return fs.existsSync(dir) ? dir : null;
  }

  /**
   * Check if bundled wheels are available for offline pip install.
   */
  hasBundledWheels() {
    const dir = this._getWheelsDir();
    if (!dir) return false;
    try {
      return fs.readdirSync(dir).some(f => f.endsWith('.whl'));
    } catch { return false; }
  }

  /**
   * Create a fresh venv using bundled Python and install dependencies
   * from bundled wheels. Fully offline, no system Python required.
   *
   * Returns the venv's python executable path on success, null on failure.
   *
   * @param {string} appDir - User app dir, typically ~/.windy-pro/
   * @param {string} requirementsPath - Path to requirements file
   * @param {Function} onLog - Optional logger
   */
  async installVenvFromWheels(appDir, requirementsPath, onLog) {
    const log = onLog || console.log;
    const wheelsDir = this._getWheelsDir();
    if (!wheelsDir) {
      log('[BundledAssets] No bundled wheels — cannot do offline venv install');
      return null;
    }
    if (!fs.existsSync(requirementsPath)) {
      log(`[BundledAssets] Requirements file not found: ${requirementsPath}`);
      return null;
    }

    // Get bundled Python
    const bundledPyDir = this._getPythonExtractedDir();
    const bundledPyExe = this._findPythonExe(bundledPyDir);
    if (!bundledPyExe || !this._isPythonWorking(bundledPyExe)) {
      log('[BundledAssets] Bundled Python not available or not working');
      return null;
    }

    // Create fresh venv on user's machine — no path portability issues possible
    const venvDir = path.join(appDir, 'venv');
    const venvPyExe = this.platform === 'win32'
      ? path.join(venvDir, 'Scripts', 'python.exe')
      : path.join(venvDir, 'bin', 'python');
    const venvPipExe = this.platform === 'win32'
      ? path.join(venvDir, 'Scripts', 'pip.exe')
      : path.join(venvDir, 'bin', 'pip');

    if (fs.existsSync(venvPyExe) && this._isPythonWorking(venvPyExe)) {
      log('[BundledAssets] Venv already exists and works');
      return venvPyExe;
    }

    log(`[BundledAssets] Creating venv at ${venvDir}`);
    fs.mkdirSync(appDir, { recursive: true });
    try {
      execSync(`"${bundledPyExe}" -m venv "${venvDir}"`, { stdio: 'pipe', timeout: 60000 });
    } catch (e) {
      log(`[BundledAssets] venv creation failed: ${e.message}`);
      return null;
    }

    log(`[BundledAssets] Installing wheels from ${wheelsDir}`);
    try {
      execSync(
        `"${venvPipExe}" install --no-index --find-links "${wheelsDir}" -r "${requirementsPath}"`,
        { stdio: 'pipe', timeout: 180000 }
      );
    } catch (e) {
      log(`[BundledAssets] pip install failed: ${e.message}`);
      return null;
    }

    if (this._isPythonWorking(venvPyExe)) {
      log('[BundledAssets] Venv ready');
      return venvPyExe;
    }
    log('[BundledAssets] Venv created but not working');
    return null;
  }

  /**
   * Install bundled Python to APP_DIR/python/
   * Returns the path to the python3 executable, or null if not available.
   */
  async installPython(appDir, onLog) {
    const destDir = path.join(appDir, 'python');
    const log = onLog || console.log;

    // Already installed?
    const existingPy = this._findPythonExe(destDir);
    if (existingPy && this._isPythonWorking(existingPy)) {
      log('[BundledAssets] Python already installed and working');
      return existingPy;
    }

    // Try extracted directory first
    const extractedDir = this._getPythonExtractedDir();
    if (fs.existsSync(extractedDir)) {
      log('[BundledAssets] Installing Python from bundled extracted directory...');
      this._copyDir(extractedDir, destDir);
      // Make executables executable on Unix
      if (this.platform !== 'win32') {
        this._makeExecutable(destDir);
      }
      const pyExe = this._findPythonExe(destDir);
      if (pyExe && this._isPythonWorking(pyExe)) {
        log('[BundledAssets] Bundled Python installed successfully');
        return pyExe;
      }
      log('[BundledAssets] Bundled Python installed but not working, will try archive...');
    }

    // Try compressed archive
    const archivePath = this._getPythonArchivePath();
    if (archivePath && fs.existsSync(archivePath)) {
      log('[BundledAssets] Extracting Python from bundled archive...');
      await this._extractArchive(archivePath, destDir);
      if (this.platform !== 'win32') {
        this._makeExecutable(destDir);
      }
      const pyExe = this._findPythonExe(destDir);
      if (pyExe && this._isPythonWorking(pyExe)) {
        log('[BundledAssets] Bundled Python extracted and working');
        return pyExe;
      }
    }

    log('[BundledAssets] No bundled Python available for this platform');
    return null;
  }

  /**
   * Install bundled ffmpeg to APP_DIR/bin/
   * Returns path to ffmpeg executable, or null if not available.
   */
  async installFfmpeg(appDir, onLog) {
    const binDir = path.join(appDir, 'bin');
    const log = onLog || console.log;
    fs.mkdirSync(binDir, { recursive: true });

    const ffmpegExe = this.platform === 'win32'
      ? path.join(binDir, 'ffmpeg.exe')
      : path.join(binDir, 'ffmpeg');

    // Already installed?
    if (fs.existsSync(ffmpegExe)) {
      log('[BundledAssets] ffmpeg already installed');
      return ffmpegExe;
    }

    // Try extracted directory
    const extractedDir = this._getFfmpegExtractedDir();
    if (fs.existsSync(extractedDir)) {
      log('[BundledAssets] Installing ffmpeg from bundled directory...');
      const srcExe = this._findFileRecursive(extractedDir, this.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
      if (srcExe) {
        fs.copyFileSync(srcExe, ffmpegExe);
        if (this.platform !== 'win32') {
          fs.chmodSync(ffmpegExe, 0o755);
        }
        // Also copy ffprobe if available
        const probeExe = this._findFileRecursive(extractedDir, this.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
        if (probeExe) {
          const probeDest = path.join(binDir, this.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
          fs.copyFileSync(probeExe, probeDest);
          if (this.platform !== 'win32') fs.chmodSync(probeDest, 0o755);
        }
        log('[BundledAssets] Bundled ffmpeg installed');
        return ffmpegExe;
      }
    }

    // Try archive
    const archivePath = this._getFfmpegArchivePath();
    if (archivePath && fs.existsSync(archivePath)) {
      log('[BundledAssets] Extracting ffmpeg from bundled archive...');
      const tempDir = path.join(os.tmpdir(), 'windy-ffmpeg-extract');
      await this._extractArchive(archivePath, tempDir);
      const srcExe = this._findFileRecursive(tempDir, this.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
      if (srcExe) {
        fs.copyFileSync(srcExe, ffmpegExe);
        if (this.platform !== 'win32') fs.chmodSync(ffmpegExe, 0o755);
        fs.rmSync(tempDir, { recursive: true, force: true });
        log('[BundledAssets] Bundled ffmpeg extracted and installed');
        return ffmpegExe;
      }
      fs.rmSync(tempDir, { recursive: true, force: true });
    }

    log('[BundledAssets] No bundled ffmpeg available for this platform');
    return null;
  }

  /**
   * Install bundled default model to APP_DIR/models/
   * Returns path to model directory, or null if not available.
   */
  async installDefaultModel(appDir, onLog) {
    const modelsDir = path.join(appDir, 'models');
    const log = onLog || console.log;
    fs.mkdirSync(modelsDir, { recursive: true });

    const bundledModel = path.join(this.bundleDir, 'model', 'faster-whisper-base');
    const destModel = path.join(modelsDir, 'faster-whisper-base');

    if (fs.existsSync(destModel) && fs.readdirSync(destModel).length > 0) {
      log('[BundledAssets] Default model already installed');
      return destModel;
    }

    if (fs.existsSync(bundledModel)) {
      log('[BundledAssets] Installing bundled default model...');
      this._copyDir(bundledModel, destModel);
      log('[BundledAssets] Default model installed');
      return destModel;
    }

    log('[BundledAssets] No bundled default model available');
    return null;
  }

  // ─── Helpers ───

  _getPythonArchivePath() {
    const map = {
      win32: 'python-3.11.9-win64.zip',
      darwin: 'python-3.11.9-macos.tar.gz',
      linux: 'python-3.11.9-linux.tar.gz'
    };
    const file = map[this.platform];
    return file ? path.join(this.bundleDir, 'python', file) : null;
  }

  _getFfmpegArchivePath() {
    const map = {
      win32: 'ffmpeg-win64.zip',
      darwin: 'ffmpeg-macos.zip',
      linux: 'ffmpeg-linux.tar.xz'
    };
    const file = map[this.platform];
    return file ? path.join(this.bundleDir, 'ffmpeg', file) : null;
  }

  _findPythonExe(dir) {
    if (!fs.existsSync(dir)) return null;
    if (this.platform === 'win32') {
      const exe = path.join(dir, 'python.exe');
      return fs.existsSync(exe) ? exe : null;
    }
    // Unix: look for python3, python3.11, python
    for (const name of ['bin/python3', 'bin/python3.11', 'bin/python', 'python3', 'python']) {
      const exe = path.join(dir, name);
      if (fs.existsSync(exe)) return exe;
    }
    return null;
  }

  _isPythonWorking(pyExe) {
    try {
      const output = execSync(`"${pyExe}" --version 2>&1`, { timeout: 5000, stdio: 'pipe' }).toString();
      if (!output.includes('Python 3')) return false;
      // Also verify venv module is available (required for setup)
      execSync(`"${pyExe}" -c "import venv; print('ok')"`, { timeout: 5000, stdio: 'pipe' });
      return true;
    } catch (e) {
      return false;
    }
  }

  _makeExecutable(dir) {
    try {
      execSync(`find "${dir}" -type f -name "python*" -exec chmod +x {} +`, { stdio: 'pipe', timeout: 5000 });
      execSync(`find "${dir}" -type f -name "pip*" -exec chmod +x {} +`, { stdio: 'pipe', timeout: 5000 });
    } catch (e) { /* ignore */ }
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

  async _extractArchive(archivePath, destDir) {
    fs.mkdirSync(destDir, { recursive: true });
    const ext = archivePath.toLowerCase();

    if (ext.endsWith('.zip')) {
      if (this.platform === 'win32') {
        // Escape single quotes for PowerShell to prevent path injection
        const safeSrc = archivePath.replace(/'/g, "''");
        const safeDest = destDir.replace(/'/g, "''");
        execSync(`powershell -Command "Expand-Archive -Force '${safeSrc}' '${safeDest}'"`, {
          timeout: 120000, stdio: 'pipe'
        });
      } else {
        execSync(`unzip -o "${archivePath}" -d "${destDir}"`, { timeout: 120000, stdio: 'pipe' });
      }
    } else if (ext.endsWith('.tar.gz') || ext.endsWith('.tgz')) {
      execSync(`tar xzf "${archivePath}" -C "${destDir}"`, { timeout: 120000, stdio: 'pipe' });
    } else if (ext.endsWith('.tar.xz')) {
      execSync(`tar xJf "${archivePath}" -C "${destDir}"`, { timeout: 120000, stdio: 'pipe' });
    }
  }

  _copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        this._copyDir(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
}

module.exports = { BundledAssets };
