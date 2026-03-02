/**
 * Windy Pro — Dependency Installer (B4.3)
 * 
 * Wizard step that installs required dependencies:
 * - Python 3.8+ with pip
 * - faster-whisper (Python package)
 * - FFmpeg (for audio conversion)
 * - Node.js native modules
 * 
 * Uses child_process to run platform-specific install commands.
 */

const { exec, execSync } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

class DependencyInstaller {
    constructor() {
        this.platform = process.platform;
        this.results = {};
    }

    /**
     * Check all dependencies — returns status map
     */
    async checkAll() {
        const [python, pip, ffmpeg, whisper, node] = await Promise.all([
            this._check('python', this._checkPython.bind(this)),
            this._check('pip', this._checkPip.bind(this)),
            this._check('ffmpeg', this._checkFFmpeg.bind(this)),
            this._check('faster-whisper', this._checkWhisper.bind(this)),
            this._check('node-modules', this._checkNodeModules.bind(this)),
        ]);

        this.results = { python, pip, ffmpeg, whisper, node };
        return this.results;
    }

    async _check(name, fn) {
        try {
            const result = await fn();
            return { name, status: 'installed', ...result };
        } catch (err) {
            return { name, status: 'missing', error: err.message };
        }
    }

    async _checkPython() {
        const cmds = ['python3 --version', 'python --version'];
        for (const cmd of cmds) {
            try {
                const version = await this._exec(cmd);
                const match = version.match(/Python (\d+\.\d+)/);
                if (match && parseFloat(match[1]) >= 3.8) {
                    return { version: match[0], path: cmd.split(' ')[0] };
                }
            } catch { /* try next */ }
        }
        throw new Error('Python 3.8+ not found');
    }

    async _checkPip() {
        const cmds = ['pip3 --version', 'pip --version'];
        for (const cmd of cmds) {
            try {
                const version = await this._exec(cmd);
                return { version: version.trim().split('\n')[0] };
            } catch { /* try next */ }
        }
        throw new Error('pip not found');
    }

    async _checkFFmpeg() {
        const version = await this._exec('ffmpeg -version');
        const match = version.match(/ffmpeg version (\S+)/);
        return { version: match ? match[1] : 'unknown' };
    }

    async _checkWhisper() {
        await this._exec('python3 -c "import faster_whisper; print(faster_whisper.__version__)"');
        return { version: 'installed' };
    }

    async _checkNodeModules() {
        const nmPath = path.join(__dirname, '..', '..', 'node_modules');
        if (fs.existsSync(nmPath)) {
            return { path: nmPath };
        }
        throw new Error('node_modules not found');
    }

    // ── Install Methods ──────────────────────────────

    /**
     * Install a specific dependency
     */
    async install(name) {
        const installer = {
            'python': this._installPython.bind(this),
            'pip': this._installPip.bind(this),
            'ffmpeg': this._installFFmpeg.bind(this),
            'faster-whisper': this._installWhisper.bind(this),
            'node-modules': this._installNodeModules.bind(this),
        };

        if (!installer[name]) throw new Error(`Unknown dependency: ${name}`);
        return await installer[name]();
    }

    /**
     * Install all missing dependencies
     */
    async installMissing() {
        const results = [];
        for (const [name, status] of Object.entries(this.results)) {
            if (status.status === 'missing') {
                try {
                    await this.install(name);
                    results.push({ name, installed: true });
                } catch (err) {
                    results.push({ name, installed: false, error: err.message });
                }
            }
        }
        return results;
    }

    async _installPython() {
        if (this.platform === 'darwin') {
            return this._exec('brew install python3 || echo "Install Python 3 from python.org"');
        } else if (this.platform === 'linux') {
            return this._exec('sudo apt-get install -y python3 python3-pip || sudo dnf install -y python3 python3-pip');
        }
        throw new Error('Download Python 3 from https://python.org/downloads');
    }

    async _installPip() {
        return this._exec('python3 -m ensurepip --upgrade');
    }

    async _installFFmpeg() {
        if (this.platform === 'darwin') {
            return this._exec('brew install ffmpeg');
        } else if (this.platform === 'linux') {
            return this._exec('sudo apt-get install -y ffmpeg || sudo dnf install -y ffmpeg');
        }
        throw new Error('Download FFmpeg from https://ffmpeg.org/download.html');
    }

    async _installWhisper() {
        return this._exec('pip3 install faster-whisper');
    }

    async _installNodeModules() {
        const rootDir = path.join(__dirname, '..', '..');
        return this._exec(`cd "${rootDir}" && npm install --production`);
    }

    /**
     * Get wizard-friendly summary
     */
    getSummary() {
        return Object.values(this.results).map(r => ({
            name: r.name,
            icon: r.status === 'installed' ? '✅' : '❌',
            status: r.status,
            version: r.version || '',
            action: r.status === 'missing' ? `install-${r.name}` : null
        }));
    }

    _exec(cmd) {
        return new Promise((resolve, reject) => {
            exec(cmd, { timeout: 120000 }, (error, stdout) => {
                if (error) reject(error);
                else resolve(stdout);
            });
        });
    }
}

module.exports = { DependencyInstaller };
