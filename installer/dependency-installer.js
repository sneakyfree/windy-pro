/**
 * Windy Pro - Dependency Installer
 * Handles Python environment setup and model downloads.
 * 
 * DNA Strand: B4.3, B4.4
 */

const { exec, spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

class DependencyInstaller {
    constructor() {
        this.appDataDir = path.join(os.homedir(), '.windy-pro');
        this.venvDir = path.join(this.appDataDir, 'venv');
        this.requirementsPath = path.join(__dirname, '..', 'requirements.txt');
        this.onProgress = null;  // callback(step, percent, message)
    }

    /**
     * Set progress callback
     */
    setProgressCallback(callback) {
        this.onProgress = callback;
    }

    _progress(step, percent, message) {
        if (this.onProgress) {
            this.onProgress(step, percent, message);
        }
    }

    /**
     * Check if Python 3.9+ is available
     * @returns {Promise<{available: boolean, version: string, path: string}>}
     */
    async checkPython() {
        const commands = process.platform === 'win32'
            ? ['python', 'python3', 'py -3']
            : ['python3', 'python'];

        for (const cmd of commands) {
            try {
                const output = await this.execAsync(`${cmd} --version`);
                const match = output.trim().match(/Python (\d+)\.(\d+)\.(\d+)/);
                if (match) {
                    const [, major, minor] = match.map(Number);
                    if (major >= 3 && minor >= 9) {
                        const whichCmd = process.platform === 'win32' ? 'where' : 'which';
                        const pythonPath = await this.execAsync(`${whichCmd} ${cmd.split(' ')[0]}`).catch(() => cmd);
                        return { available: true, version: `${major}.${minor}`, path: pythonPath.trim().split('\n')[0] || cmd };
                    }
                }
            } catch (e) {
                // Try next command
            }
        }
        return { available: false, version: '', path: '' };
    }

    /**
     * Auto-install Python on Windows if missing
     */
    async installPython() {
        if (process.platform !== 'win32') {
            throw new Error('Python 3.9+ is required. Install via: sudo apt install python3 (Linux) or brew install python (macOS)');
        }

        this._progress('python', 2, 'Python not found — downloading Python installer...');
        const installerUrl = 'https://www.python.org/ftp/python/3.12.3/python-3.12.3-amd64.exe';
        const installerPath = path.join(this.appDataDir, 'python-installer.exe');

        try {
            await this.execAsync(`curl -L -o "${installerPath}" "${installerUrl}"`, { timeout: 300000 });
            this._progress('python', 3, 'Installing Python (this may take a minute)...');

            // Silent install with PATH and pip
            await this.execAsync(
                `"${installerPath}" /quiet InstallAllUsers=0 PrependPath=1 Include_pip=1 Include_test=0`,
                { timeout: 300000 }
            );

            // Cleanup installer
            try { fs.unlinkSync(installerPath); } catch (e) {}

            this._progress('python', 4, 'Python installed. Verifying...');

            // Re-check after install (need to refresh PATH)
            const refreshedPath = process.env.LOCALAPPDATA
                ? `${process.env.LOCALAPPDATA}\\Programs\\Python\\Python312\\python.exe`
                : 'python';

            if (fs.existsSync(refreshedPath)) {
                return { available: true, version: '3.12', path: refreshedPath };
            }

            // Try standard check again
            return await this.checkPython();
        } catch (err) {
            console.error('[Installer] Python install failed:', err.message);
            throw new Error('Failed to install Python automatically. Please install Python 3.9+ from python.org');
        }
    }

    /**
     * Install Visual C++ Redistributable on Windows if needed
     */
    async ensureVCRedist() {
        if (process.platform !== 'win32') return;

        // Check if VC++ redist is present by looking for common DLL
        try {
            await this.execAsync('where vcruntime140.dll');
            return; // Already installed
        } catch (e) {
            // Not found in PATH, check System32
            const sys32 = `${process.env.SYSTEMROOT || 'C:\\Windows'}\\System32\\vcruntime140.dll`;
            if (fs.existsSync(sys32)) return;
        }

        this._progress('vcredist', 45, 'Installing Visual C++ Runtime...');
        const url = 'https://aka.ms/vs/17/release/vc_redist.x64.exe';
        const installerPath = path.join(this.appDataDir, 'vc_redist.x64.exe');

        try {
            await this.execAsync(`curl -L -o "${installerPath}" "${url}"`, { timeout: 120000 });
            await this.execAsync(`"${installerPath}" /quiet /norestart`, { timeout: 120000 });
            try { fs.unlinkSync(installerPath); } catch (e) {}
            this._progress('vcredist', 48, 'Visual C++ Runtime installed.');
        } catch (err) {
            console.warn('[Installer] VC++ Redist install failed (non-fatal):', err.message);
        }
    }

    /**
     * Create Python virtual environment
     */
    async createVenv(pythonPath) {
        this._progress('venv', 10, 'Creating Python virtual environment...');

        if (!fs.existsSync(this.appDataDir)) {
            fs.mkdirSync(this.appDataDir, { recursive: true });
        }

        await this.execAsync(`"${pythonPath}" -m venv "${this.venvDir}"`);
        this._progress('venv', 30, 'Virtual environment created.');
    }

    /**
     * Get the pip executable path within the venv
     */
    getPipPath() {
        if (process.platform === 'win32') {
            return path.join(this.venvDir, 'Scripts', 'pip.exe');
        }
        return path.join(this.venvDir, 'bin', 'pip');
    }

    /**
     * Get the python executable path within the venv
     */
    getPythonPath() {
        if (process.platform === 'win32') {
            return path.join(this.venvDir, 'Scripts', 'python.exe');
        }
        return path.join(this.venvDir, 'bin', 'python');
    }

    /**
     * Install Python requirements
     */
    async installRequirements() {
        this._progress('deps', 30, 'Installing Python dependencies...');

        const pipPath = this.getPipPath();
        const pythonPath = this.getPythonPath();

        // Upgrade pip first (use python -m pip on Windows to avoid self-overwrite error)
        try {
            await this.execAsync(`"${pythonPath}" -m pip install --upgrade pip`);
        } catch (e) {
            console.warn('[Installer] pip upgrade failed (non-fatal):', e.message);
        }
        this._progress('deps', 40, 'Installing packages...');

        // Find requirements.txt — try multiple paths
        let reqPath = this.requirementsPath;
        if (!fs.existsSync(reqPath)) {
            // Try relative to app root
            reqPath = path.join(process.resourcesPath || __dirname, '..', 'requirements.txt');
        }

        if (fs.existsSync(reqPath)) {
            await this.execAsync(`"${pythonPath}" -m pip install -r "${reqPath}"`, { timeout: 300000 });
        } else {
            // Install core deps directly
            await this.execAsync(
                `"${pythonPath}" -m pip install faster-whisper numpy sounddevice soundfile websockets`,
                { timeout: 300000 }
            );
        }

        this._progress('deps', 70, 'Python dependencies installed.');
    }

        /**
     * Ensure ffmpeg is available (download on Windows if missing)
     */
    async ensureFfmpeg() {
        // Check if ffmpeg is already available
        try {
            await this.execAsync('ffmpeg -version');
            this._progress('ffmpeg', 65, 'ffmpeg found.');
            return;
        } catch (e) {
            // Not in PATH
        }

        // Check bundled location
        const ffmpegDir = path.join(this.appDataDir, 'ffmpeg');
        const ffmpegExe = path.join(ffmpegDir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
        if (fs.existsSync(ffmpegExe)) {
            this._progress('ffmpeg', 65, 'ffmpeg found (bundled).');
            return;
        }

        if (process.platform !== 'win32') {
            this._progress('ffmpeg', 65, 'ffmpeg not found — install via package manager (apt/brew).');
            return;
        }

        // Download ffmpeg for Windows
        this._progress('ffmpeg', 55, 'Downloading ffmpeg for Windows...');
        const url = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip';
        const zipPath = path.join(this.appDataDir, 'ffmpeg-download.zip');

        try {
            // Download using curl (available on Windows 10+)
            await this.execAsync(`curl -L -o "${zipPath}" "${url}"`, { timeout: 300000 });
            this._progress('ffmpeg', 60, 'Extracting ffmpeg...');

            // Extract using PowerShell
            if (!fs.existsSync(ffmpegDir)) fs.mkdirSync(ffmpegDir, { recursive: true });
            await this.execAsync(
                `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${this.appDataDir}\\ffmpeg-temp' -Force"`,
                { timeout: 120000 }
            );

            // Find and move ffmpeg.exe
            const tempDir = path.join(this.appDataDir, 'ffmpeg-temp');
            const findFfmpeg = (dir) => {
                const items = fs.readdirSync(dir);
                for (const item of items) {
                    const full = path.join(dir, item);
                    if (item === 'ffmpeg.exe') return full;
                    if (fs.statSync(full).isDirectory()) {
                        const found = findFfmpeg(full);
                        if (found) return found;
                    }
                }
                return null;
            };
            const foundExe = findFfmpeg(tempDir);
            if (foundExe) {
                fs.copyFileSync(foundExe, ffmpegExe);
            }

            // Cleanup
            try { fs.unlinkSync(zipPath); } catch (e) {}
            try { fs.rmSync(path.join(this.appDataDir, 'ffmpeg-temp'), { recursive: true }); } catch (e) {}

            this._progress('ffmpeg', 65, 'ffmpeg installed.');
        } catch (err) {
            console.warn('[Installer] ffmpeg download failed:', err.message);
            this._progress('ffmpeg', 65, 'ffmpeg download failed — please install manually from ffmpeg.org');
        }
    }

    /**
     * Download the Whisper model
     * faster-whisper downloads it on first use, we trigger that here
     */
    async downloadModel(modelSize = 'base') {
        this._progress('model', 70, `Downloading ${modelSize} model... (this may take a few minutes)`);

        const pythonPath = this.getPythonPath();
        const downloadScript = `
import sys
try:
    from faster_whisper import WhisperModel
    print("Downloading model: ${modelSize}")
    model = WhisperModel("${modelSize}", device="cpu", compute_type="int8")
    print("Model ready!")
except Exception as e:
    print(f"Error: {e}", file=sys.stderr)
    sys.exit(1)
`;

        const tmpScript = path.join(this.appDataDir, '_download_model.py');
        fs.writeFileSync(tmpScript, downloadScript);

        try {
            await this.execAsync(`"${pythonPath}" "${tmpScript}"`, { timeout: 600000 });
            this._progress('model', 95, `Model ${modelSize} downloaded and ready.`);
        } finally {
            // Clean up temp script
            try { fs.unlinkSync(tmpScript); } catch (e) { }
        }
    }

    /**
     * Check system permissions (mic, accessibility)
     */
    async checkPermissions() {
        const results = { mic: false, accessibility: true };

        if (process.platform === 'darwin') {
            try {
                const { systemPreferences } = require('electron');
                results.mic = await systemPreferences.askForMediaAccess('microphone');
                results.accessibility = systemPreferences.isTrustedAccessibilityClient(false);
            } catch (e) {
                // Not in Electron context
            }
        } else {
            results.mic = true;  // Linux/Windows handle mic via browser API
        }

        return results;
    }

    /**
     * Run the complete installation
     */
    async installAll(modelSize = 'base') {
        // Step 1: Check Python (auto-install on Windows if missing)
        this._progress('python', 0, 'Checking Python installation...');
        let python = await this.checkPython();
        if (!python.available) {
            python = await this.installPython();
            if (!python.available) {
                throw new Error('Python 3.9+ is required. Please install Python from python.org');
            }
        }
        this._progress('python', 5, `Found Python ${python.version}`);

        // Step 1.5: Ensure VC++ Redistributable on Windows
        await this.ensureVCRedist();

        // Step 2: Create venv
        if (!fs.existsSync(this.venvDir)) {
            await this.createVenv(python.path);
        } else {
            this._progress('venv', 30, 'Virtual environment already exists.');
        }

        // Step 3: Install deps
        await this.installRequirements();

        // Step 3.5: Install ffmpeg on Windows if missing
        await this.ensureFfmpeg();

        // Step 4: Download model
        await this.downloadModel(modelSize);

        // Step 5: Verify
        this._progress('verify', 98, 'Verifying installation...');
        const pythonPath = this.getPythonPath();
        await this.execAsync(`"${pythonPath}" -c "from faster_whisper import WhisperModel; print('OK')"`);

        this._progress('complete', 100, 'Installation complete! Ready to transcribe.');
    }

    /**
     * Install just Python deps (venv + pip) without downloading a model.
     * Used by multi-model wizard flow.
     */
    async installDependencies() {
        this._progress('python', 0, 'Checking Python installation...');
        let python = await this.checkPython();
        if (!python.available) {
            python = await this.installPython();
            if (!python.available) {
                throw new Error('Python 3.9+ is required. Please install Python from python.org');
            }
        }
        this._progress('python', 5, `Found Python ${python.version}`);
        await this.ensureVCRedist();

        if (!fs.existsSync(this.venvDir)) {
            await this.createVenv(python.path);
        } else {
            this._progress('venv', 30, 'Virtual environment already exists.');
        }

        await this.installRequirements();
        await this.ensureFfmpeg();
        this._progress('deps', 50, 'Python environment ready.');
    }

    /**
     * Set the default active model (writes a config file).
     */
    async setDefaultModel(modelId) {
        const configPath = path.join(this.appDataDir, 'config.json');
        let config = {};
        if (fs.existsSync(configPath)) {
            try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch (e) {}
        }
        config.defaultModel = modelId;
        config.installedModels = config.installedModels || [];
        if (!config.installedModels.includes(modelId)) {
            config.installedModels.push(modelId);
        }
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    }

    /**
     * Check if already installed
     */
    isInstalled() {
        const pythonPath = this.getPythonPath();
        return fs.existsSync(pythonPath);
    }

    execAsync(cmd, options = {}) {
        return new Promise((resolve, reject) => {
            exec(cmd, { timeout: 30000, ...options }, (error, stdout, stderr) => {
                if (error) reject(error);
                else resolve(stdout || stderr);
            });
        });
    }
}

module.exports = { DependencyInstaller };
