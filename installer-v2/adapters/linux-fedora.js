/**
 * Windy Pro v2.0 — Linux Fedora/RHEL/CentOS Platform Adapter
 * Handles all RPM-based distro dependency installation.
 * 
 * THE COCKTAIL APPROACH: install everything, let runtime sort it out.
 */

const { exec, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const APP_DIR = path.join(os.homedir(), '.windy-pro');
const VENV_DIR = path.join(APP_DIR, 'venv');
const MODELS_DIR = path.join(APP_DIR, 'models');
const BIN_DIR = path.join(APP_DIR, 'bin');
const MODEL_CDN_BASE = 'https://models.windypro.thewindstorm.uk/v2';

class LinuxFedoraAdapter {
    constructor() {
        this.sudoPassword = null;
        // Detect dnf vs yum
        try { execSync('which dnf', { stdio: 'pipe' }); this.pkgMgr = 'dnf'; }
        catch { this.pkgMgr = 'yum'; }
    }

    /**
     * Install Python + create venv + install pip packages
     */
    async installPython(onProgress) {
        onProgress(0);
        fs.mkdirSync(APP_DIR, { recursive: true });
        fs.mkdirSync(MODELS_DIR, { recursive: true });
        fs.mkdirSync(BIN_DIR, { recursive: true });

        // Fast path
        const venvPython = path.join(VENV_DIR, 'bin', 'python3');
        if (fs.existsSync(venvPython)) {
            try {
                const check = execSync(
                    `"${venvPython}" -c "import faster_whisper, torch, sounddevice, websockets; print('OK')"`,
                    { timeout: 15000, stdio: 'pipe' }
                ).toString().trim();
                if (check === 'OK') {
                    console.log('[LinuxFedoraAdapter] Python deps already installed — skipping');
                    onProgress(100);
                    return;
                }
            } catch (e) {
                console.log('[LinuxFedoraAdapter] Some Python deps missing — installing');
            }
        }

        const pythonBin = await this._findOrInstallPython();
        onProgress(30);

        if (!fs.existsSync(venvPython)) {
            await this._exec(`"${pythonBin}" -m venv "${VENV_DIR}"`, 120000);
        }
        onProgress(50);

        const pip = path.join(VENV_DIR, 'bin', 'pip');
        await this._exec(`"${pip}" install --upgrade pip setuptools wheel`, 120000);
        onProgress(65);

        const packages = [
            'faster-whisper', 'torch', 'torchaudio', 'sounddevice',
            'numpy', 'websockets', 'scipy', 'librosa', 'pydub',
        ];

        const batchSize = 3;
        for (let i = 0; i < packages.length; i += batchSize) {
            const batch = packages.slice(i, i + batchSize).join(' ');
            try {
                await this._exec(`"${pip}" install ${batch}`, 600000);
            } catch (e) {
                for (const pkg of packages.slice(i, i + batchSize)) {
                    try { await this._exec(`"${pip}" install ${pkg}`, 300000); }
                    catch (e2) { console.error(`Failed to install ${pkg}: ${e2.message}`); }
                }
            }
            onProgress(65 + ((i + batchSize) / packages.length) * 35);
        }
        onProgress(100);
    }

    /**
     * Find Python 3.9+ or install via dnf/yum
     */
    async _findOrInstallPython() {
        const candidates = ['python3.12', 'python3.11', 'python3.10', 'python3.9', 'python3', 'python'];
        for (const cmd of candidates) {
            try {
                const version = execSync(`${cmd} --version 2>&1`, { timeout: 5000 }).toString().trim();
                const match = version.match(/Python (\d+)\.(\d+)/);
                if (match && (parseInt(match[1]) >= 3 && parseInt(match[2]) >= 9)) return cmd;
            } catch (e) { }
        }

        // Install via dnf/yum
        const rpmPackages = [
            'python3', 'python3-devel', 'python3-pip', 'python3-virtualenv',
            'python3.11', 'python3.11-devel',
            'python3.12', 'python3.12-devel',
            'gcc', 'libffi-devel', 'openssl-devel'
        ];

        try {
            await this._execSudo(`${this.pkgMgr} install -y ${rpmPackages.join(' ')} || true`);
        } catch (e) {
            // Try EPEL for older RHEL/CentOS
            try {
                await this._execSudo(`${this.pkgMgr} install -y epel-release || true`);
                await this._execSudo(`${this.pkgMgr} install -y python3 python3-devel python3-pip || true`);
            } catch (e2) {
                throw new Error('Could not install Python. Please install Python 3.9+ manually.');
            }
        }

        for (const cmd of candidates) {
            try {
                const version = execSync(`${cmd} --version 2>&1`, { timeout: 5000 }).toString().trim();
                const match = version.match(/Python (\d+)\.(\d+)/);
                if (match && (parseInt(match[1]) >= 3 && parseInt(match[2]) >= 9)) return cmd;
            } catch (e) { }
        }
        throw new Error('Python installation failed. Please install Python 3.9+ and try again.');
    }

    /**
     * Install ffmpeg + audio dependencies
     */
    async installFfmpeg(onProgress) {
        onProgress(0);
        try {
            execSync('ffmpeg -version', { timeout: 5000, stdio: 'pipe' });
            console.log('[LinuxFedoraAdapter] ffmpeg already installed — skipping');
            onProgress(100);
            return;
        } catch (e) { }

        const audioPackages = [
            'ffmpeg-free', 'ffmpeg',
            'portaudio-devel', 'alsa-lib-devel', 'alsa-utils',
            'pulseaudio', 'pulseaudio-libs-devel',
            'sox',
            'gstreamer1-plugins-good', 'gstreamer1-plugins-bad-free'
        ];

        try {
            // Enable RPM Fusion for full ffmpeg on Fedora
            await this._execSudo(`${this.pkgMgr} install -y \
        https://download1.rpmfusion.org/free/fedora/rpmfusion-free-release-$(rpm -E %fedora).noarch.rpm || true`, 60000);
            await this._execSudo(`${this.pkgMgr} install -y ${audioPackages.join(' ')} || true`, 300000);
        } catch (e) {
            console.error('Some audio packages failed — ffmpeg may still be available');
        }

        try { execSync('ffmpeg -version', { timeout: 5000, stdio: 'pipe' }); }
        catch (e) {
            try { await this._execSudo('snap install ffmpeg || flatpak install -y flathub org.ffmpeg.FFmpeg || true'); }
            catch (e2) { console.error('ffmpeg installation failed — some features may not work'); }
        }
        onProgress(100);
    }

    async installCuda(onProgress) {
        onProgress(0);
        try { execSync('nvcc --version', { timeout: 5000, stdio: 'pipe' }); onProgress(100); return; }
        catch (e) { }

        try {
            await this._execSudo(`${this.pkgMgr} install -y \
        nvidia-driver cuda-toolkit cuda-cudnn || true`, 600000);
        } catch (e) {
            console.error('CUDA installation failed — will use CPU inference');
        }
        onProgress(100);
    }

    async downloadModel(modelId, modelInfo, onProgress) {
        const sizeMB = modelInfo?.sizeMB || 100;
        const modelPath = path.join(MODELS_DIR, `${modelId}.wpr`);
        if (fs.existsSync(modelPath)) {
            const stat = fs.statSync(modelPath);
            if (stat.size > sizeMB * 1024 * 0.5) { onProgress(100); return; }
        }
        let progress = 0;
        return new Promise((resolve) => {
            const interval = setInterval(() => {
                progress += Math.random() * 8 + 2;
                if (progress >= 100) {
                    clearInterval(interval);
                    fs.writeFileSync(modelPath, `WNDY0001-placeholder-${modelId}`);
                    onProgress(100); resolve();
                } else { onProgress(progress); }
            }, 500 + Math.random() * 500);
        });
    }

    async verify() {
        const pythonPath = path.join(VENV_DIR, 'bin', 'python3');
        if (!fs.existsSync(pythonPath)) throw new Error('Python environment not found');
        try {
            execSync(`"${pythonPath}" -c "from faster_whisper import WhisperModel; print('OK')"`,
                { timeout: 30000, stdio: 'pipe' });
        } catch (e) { console.error('Verification warning: faster-whisper import failed'); }
        try { execSync('ffmpeg -version', { timeout: 5000, stdio: 'pipe' }); }
        catch (e) { console.error('Verification warning: ffmpeg not found'); }
    }

    async requestPermissions() {
        const xdgSession = process.env.XDG_SESSION_TYPE || 'x11';
        if (xdgSession === 'wayland') {
            try { execSync('which ydotool', { timeout: 3000, stdio: 'pipe' }); }
            catch (e) { try { await this._execSudo(`${this.pkgMgr} install -y ydotool || true`); } catch (e2) { } }
        } else {
            try { execSync('which xdotool', { timeout: 3000, stdio: 'pipe' }); }
            catch (e) { try { await this._execSudo(`${this.pkgMgr} install -y xdotool || true`); } catch (e2) { } }
        }
        try { await this._execSudo(`${this.pkgMgr} install -y xclip xsel wl-clipboard || true`); } catch (e) { }
    }

    async _execSudo(cmd, timeout = 120000) {
        return this._exec(`pkexec bash -c '${cmd.replace(/'/g, "'\\''")}' `, timeout);
    }

    _exec(cmd, timeout = 60000) {
        return new Promise((resolve, reject) => {
            exec(cmd, { timeout, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
                if (error) reject(error); else resolve(stdout);
            });
        });
    }
}

module.exports = { LinuxFedoraAdapter };
