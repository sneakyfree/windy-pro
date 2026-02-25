/**
 * Windy Pro Dependency Installer — Bundled Edition (v0.5.0)
 * 
 * All dependencies ship inside the app. No internet required.
 * This installer extracts bundled Python, ffmpeg, venv, and model
 * to ~/.windy-pro/ on first run.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, exec } = require('child_process');

class DependencyInstaller {
    constructor(appRoot) {
        this.appRoot = appRoot;
        this.appDataDir = path.join(os.homedir(), '.windy-pro');
        this.venvDir = path.join(this.appDataDir, 'venv');
        this.listeners = [];
        
        // Find bundled resources directory
        // In packaged app: process.resourcesPath/bundled/
        // In dev: appRoot/extraResources/
        if (process.resourcesPath) {
            this.bundledDir = path.join(process.resourcesPath, 'bundled');
        } else {
            this.bundledDir = path.join(appRoot, 'extraResources');
        }
    }

    on(event, fn) { this.listeners.push({ event, fn }); }
    
    _progress(step, pct, msg) {
        this.listeners
            .filter(l => l.event === 'progress')
            .forEach(l => l.fn({ step, percent: pct, message: msg }));
    }

    getBundledPythonPath() {
        if (process.platform === 'win32') {
            return path.join(this.bundledDir, 'python', 'python.exe');
        }
        return path.join(this.bundledDir, 'python', 'bin', 'python3');
    }

    getPythonPath() {
        if (process.platform === 'win32') {
            return path.join(this.venvDir, 'Scripts', 'python.exe');
        }
        return path.join(this.venvDir, 'bin', 'python3');
    }

    getFfmpegPath() {
        const localFfmpeg = path.join(this.appDataDir, 'ffmpeg',
            process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
        if (fs.existsSync(localFfmpeg)) return localFfmpeg;
        
        const bundledFfmpeg = path.join(this.bundledDir, 'ffmpeg',
            process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
        if (fs.existsSync(bundledFfmpeg)) return bundledFfmpeg;
        
        return 'ffmpeg'; // fallback to PATH
    }

    isInstalled() {
        const pythonPath = this.getPythonPath();
        if (!fs.existsSync(pythonPath)) return false;

        // Check faster_whisper is installed
        try {
            execSync(`"${pythonPath}" -c "import faster_whisper"`, { timeout: 10000, stdio: 'pipe' });
        } catch (e) {
            return false;
        }

        // Check ffmpeg
        const ffmpegPath = this.getFfmpegPath();
        if (ffmpegPath === 'ffmpeg') {
            try {
                execSync('ffmpeg -version', { timeout: 5000, stdio: 'pipe' });
            } catch (e) {
                return false;
            }
        }

        // Check model exists
        const modelDir = path.join(this.appDataDir, 'model', 'faster-whisper-base');
        if (!fs.existsSync(path.join(modelDir, 'model.bin'))) return false;

        return true;
    }

    copyDirSync(src, dst) {
        if (!fs.existsSync(src)) throw new Error(`Source not found: ${src}`);
        fs.mkdirSync(dst, { recursive: true });
        const entries = fs.readdirSync(src, { withFileTypes: true });
        for (const entry of entries) {
            const srcPath = path.join(src, entry.name);
            const dstPath = path.join(dst, entry.name);
            if (entry.isDirectory()) {
                this.copyDirSync(srcPath, dstPath);
            } else {
                fs.copyFileSync(srcPath, dstPath);
                // Preserve execute permissions
                const stat = fs.statSync(srcPath);
                fs.chmodSync(dstPath, stat.mode);
            }
        }
    }

    async installAll() {
        fs.mkdirSync(this.appDataDir, { recursive: true });

        // Step 1: Extract bundled venv (has Python + faster-whisper pre-installed)
        this._progress('venv', 10, 'Setting up Python environment...');
        const bundledVenv = path.join(this.bundledDir, 'venv');
        if (fs.existsSync(bundledVenv) && !fs.existsSync(this.getPythonPath())) {
            try {
                this.copyDirSync(bundledVenv, this.venvDir);
                this._progress('venv', 30, 'Python environment ready.');
            } catch (e) {
                this._progress('venv', 30, `Venv copy failed: ${e.message}. Trying from bundled Python...`);
                await this._createVenvFromBundledPython();
            }
        } else if (!fs.existsSync(this.getPythonPath())) {
            await this._createVenvFromBundledPython();
        } else {
            this._progress('venv', 30, 'Python environment already exists.');
        }

        // Step 2: Extract ffmpeg
        this._progress('ffmpeg', 40, 'Setting up ffmpeg...');
        const ffmpegDst = path.join(this.appDataDir, 'ffmpeg');
        const ffmpegExe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
        const bundledFfmpeg = path.join(this.bundledDir, 'ffmpeg', ffmpegExe);
        if (!fs.existsSync(path.join(ffmpegDst, ffmpegExe)) && fs.existsSync(bundledFfmpeg)) {
            fs.mkdirSync(ffmpegDst, { recursive: true });
            fs.copyFileSync(bundledFfmpeg, path.join(ffmpegDst, ffmpegExe));
            if (process.platform !== 'win32') {
                fs.chmodSync(path.join(ffmpegDst, ffmpegExe), 0o755);
            }
        }
        this._progress('ffmpeg', 55, 'ffmpeg ready.');

        // Step 3: Extract Whisper model
        this._progress('model', 60, 'Setting up speech recognition model...');
        const modelDst = path.join(this.appDataDir, 'model', 'faster-whisper-base');
        const bundledModel = path.join(this.bundledDir, 'model', 'faster-whisper-base');
        if (!fs.existsSync(path.join(modelDst, 'model.bin')) && fs.existsSync(bundledModel)) {
            this.copyDirSync(bundledModel, modelDst);
        }
        this._progress('model', 85, 'Model ready.');

        // Step 4: Verify everything works
        this._progress('verify', 90, 'Verifying installation...');
        try {
            const pythonPath = this.getPythonPath();
            execSync(`"${pythonPath}" -c "from faster_whisper import WhisperModel; print('OK')"`, 
                { timeout: 30000, stdio: 'pipe' });
            this._progress('verify', 100, 'All dependencies verified! Ready to transcribe.');
        } catch (e) {
            this._progress('verify', 100, `Warning: Verification failed (${e.message}). Transcription may not work.`);
        }
    }

    async _createVenvFromBundledPython() {
        const bundledPython = this.getBundledPythonPath();
        if (!fs.existsSync(bundledPython)) {
            // Last resort: try system python
            this._progress('venv', 15, 'No bundled Python found. Trying system Python...');
            const sysPython = process.platform === 'win32' ? 'python' : 'python3';
            try {
                execSync(`${sysPython} -m venv "${this.venvDir}"`, { timeout: 60000, stdio: 'pipe' });
            } catch (e) {
                throw new Error('No Python available. Please install Python 3.9+ manually.');
            }
        } else {
            execSync(`"${bundledPython}" -m venv "${this.venvDir}"`, { timeout: 60000, stdio: 'pipe' });
        }
        
        // Install faster-whisper
        this._progress('venv', 20, 'Installing transcription engine...');
        const pipBin = process.platform === 'win32'
            ? path.join(this.venvDir, 'Scripts', 'pip.exe')
            : path.join(this.venvDir, 'bin', 'pip');
        execSync(`"${pipBin}" install faster-whisper`, { timeout: 300000, stdio: 'pipe' });
    }

    execAsync(cmd, opts = {}) {
        return new Promise((resolve, reject) => {
            exec(cmd, { timeout: 120000, ...opts }, (err, stdout, stderr) => {
                if (err) reject(err);
                else resolve(stdout);
            });
        });
    }
}

module.exports = DependencyInstaller;
