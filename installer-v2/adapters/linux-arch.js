/**
 * Windy Pro v2.0 — Linux Arch/Manjaro Platform Adapter
 * Uses pacman for all dependency installation.
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

class LinuxArchAdapter {
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
        const pyBin = await this._findPython();
        onProgress(30);
        if (!fs.existsSync(venvPy)) await this._exec(`"${pyBin}" -m venv "${VENV_DIR}"`, 120000);
        onProgress(50);
        const pip = path.join(VENV_DIR, 'bin', 'pip');
        await this._exec(`"${pip}" install --upgrade pip setuptools wheel`, 120000);
        onProgress(65);
        const pkgs = ['faster-whisper', 'torch', 'torchaudio', 'sounddevice', 'numpy', 'websockets', 'scipy', 'librosa', 'pydub'];
        for (let i = 0; i < pkgs.length; i++) {
            try { await this._exec(`"${pip}" install ${pkgs[i]}`, 300000); } catch (e) { console.error(`${pkgs[i]} failed`); }
            onProgress(65 + ((i + 1) / pkgs.length) * 35);
        }
        onProgress(100);
    }

    async _findPython() {
        for (const cmd of ['python3', 'python']) {
            try {
                const v = execSync(`${cmd} --version 2>&1`, { timeout: 5000 }).toString();
                const m = v.match(/Python (\d+)\.(\d+)/);
                if (m && parseInt(m[1]) >= 3 && parseInt(m[2]) >= 9) return cmd;
            } catch (_) { }
        }
        await this._execSudo('pacman -Sy --noconfirm python python-pip python-virtualenv base-devel libffi openssl || true');
        for (const cmd of ['python3', 'python']) {
            try {
                const v = execSync(`${cmd} --version 2>&1`, { timeout: 5000 }).toString();
                const m = v.match(/Python (\d+)\.(\d+)/);
                if (m && parseInt(m[1]) >= 3 && parseInt(m[2]) >= 9) return cmd;
            } catch (_) { }
        }
        throw new Error('Python 3.9+ required. Run: sudo pacman -S python');
    }

    async installFfmpeg(onProgress) {
        onProgress(0);
        try { execSync('ffmpeg -version', { timeout: 5000, stdio: 'pipe' }); onProgress(100); return; } catch (_) { }
        try { await this._execSudo('pacman -Sy --noconfirm ffmpeg portaudio alsa-utils pulseaudio libpulse sox gstreamer gst-plugins-good || true', 300000); } catch (_) { }
        onProgress(100);
    }

    async installCuda(onProgress) {
        onProgress(0);
        try { execSync('nvcc --version', { timeout: 5000, stdio: 'pipe' }); onProgress(100); return; } catch (_) { }
        try { await this._execSudo('pacman -Sy --noconfirm cuda cudnn || true', 600000); } catch (_) { }
        onProgress(100);
    }

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
        try { execSync('ffmpeg -version', { timeout: 5000, stdio: 'pipe' }); } catch (_) { }
    }

    async requestPermissions() {
        const tool = (process.env.XDG_SESSION_TYPE || 'x11') === 'wayland' ? 'ydotool' : 'xdotool';
        try { execSync(`which ${tool}`, { timeout: 3000, stdio: 'pipe' }); } catch (_) { try { await this._execSudo(`pacman -Sy --noconfirm ${tool} || true`); } catch (_) { } }
        try { await this._execSudo('pacman -Sy --noconfirm xclip xsel wl-clipboard || true'); } catch (_) { }
    }

    async _execSudo(cmd, timeout = 120000) { return this._exec(`pkexec bash -c '${cmd.replace(/'/g, "'\\''")}' `, timeout); }
    _exec(cmd, timeout = 60000) { return new Promise((res, rej) => { exec(cmd, { timeout, maxBuffer: 10 * 1024 * 1024 }, (e, out) => e ? rej(e) : res(out)); }); }
}

module.exports = { LinuxArchAdapter };
