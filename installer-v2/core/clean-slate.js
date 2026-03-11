/**
 * Windy Pro v2.0 — Clean Slate Module
 * 
 * MUST run BEFORE any installation begins.
 * Detects and completely removes any prior Windy Pro installation.
 * 
 * Grant's Rule: "If you don't completely kill and uninstall the prior
 * version, you have all kinds of issues. Stuff from both versions
 * conflicts, writing crashes, and it won't work."
 * 
 * This module:
 * 1. Kills any running Windy Pro processes (Electron + Python server)
 * 2. Removes the ~/.windy-pro directory (preserves models if user opts in)
 * 3. Cleans platform-specific artifacts (registry, shortcuts, services)
 * 4. Verifies clean state before returning
 */

const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const APP_DIR = path.join(os.homedir(), '.windy-pro');
const CONFIG_DIR = path.join(os.homedir(), '.config', 'windy-pro');
const MODELS_DIR = path.join(APP_DIR, 'models');

class CleanSlate {
  constructor(options = {}) {
    // If true, preserve downloaded models (they're huge and reusable)
    this.preserveModels = options.preserveModels !== false;
    this.onProgress = options.onProgress || (() => { });
    this.onLog = options.onLog || console.log;
    this.platform = process.platform; // win32, darwin, linux
  }

  /**
   * Main entry point. Returns { wasClean, removed, errors }
   */
  async run() {
    const result = { wasClean: true, removed: [], errors: [], preserved: [] };

    this.onProgress(0);
    this.onLog('[CleanSlate] Checking for prior Windy Pro installation...');

    // Step 1: Detect if anything exists
    const detection = this._detect();
    if (!detection.found) {
      this.onLog('[CleanSlate] No prior installation detected. Clean slate confirmed.');
      this.onProgress(100);
      return result;
    }

    result.wasClean = false;
    this.onLog(`[CleanSlate] Found prior installation: ${detection.details.join(', ')}`);
    this.onProgress(10);

    // Step 2: Kill running processes
    try {
      const killed = await this._killProcesses();
      result.removed.push(...killed.map(p => `process: ${p}`));
      this.onLog(`[CleanSlate] Killed ${killed.length} running processes`);
    } catch (e) {
      result.errors.push(`Kill processes: ${e.message}`);
      this.onLog(`[CleanSlate] Warning: ${e.message}`);
    }
    this.onProgress(30);

    // Step 3: Preserve models if requested
    let modelBackup = null;
    if (this.preserveModels && fs.existsSync(MODELS_DIR)) {
      const modelFiles = this._listModels();
      if (modelFiles.length > 0) {
        modelBackup = path.join(os.tmpdir(), 'windy-pro-models-backup');
        try {
          if (fs.existsSync(modelBackup)) {
            fs.rmSync(modelBackup, { recursive: true, force: true });
          }
          fs.renameSync(MODELS_DIR, modelBackup);
          result.preserved.push(...modelFiles);
          this.onLog(`[CleanSlate] Preserved ${modelFiles.length} model files to temp backup`);
        } catch (e) {
          this.onLog(`[CleanSlate] Could not preserve models: ${e.message}`);
          modelBackup = null;
        }
      }
    }
    this.onProgress(45);

    // Step 4: Remove ~/.windy-pro directory
    if (fs.existsSync(APP_DIR)) {
      try {
        fs.rmSync(APP_DIR, { recursive: true, force: true });
        result.removed.push('~/.windy-pro/');
        this.onLog('[CleanSlate] Removed ~/.windy-pro/');
      } catch (e) {
        result.errors.push(`Remove APP_DIR: ${e.message}`);
        this.onLog(`[CleanSlate] Warning: Could not fully remove ~/.windy-pro: ${e.message}`);
      }
    }
    this.onProgress(55);

    // Step 5: Remove ~/.config/windy-pro
    if (fs.existsSync(CONFIG_DIR)) {
      try {
        fs.rmSync(CONFIG_DIR, { recursive: true, force: true });
        result.removed.push('~/.config/windy-pro/');
        this.onLog('[CleanSlate] Removed ~/.config/windy-pro/');
      } catch (e) {
        result.errors.push(`Remove CONFIG_DIR: ${e.message}`);
      }
    }

    // Step 6: Platform-specific cleanup
    try {
      await this._platformCleanup(result);
    } catch (e) {
      result.errors.push(`Platform cleanup: ${e.message}`);
    }
    this.onProgress(75);

    // Step 7: Restore models if backed up
    if (modelBackup && fs.existsSync(modelBackup)) {
      try {
        fs.mkdirSync(APP_DIR, { recursive: true });
        fs.renameSync(modelBackup, MODELS_DIR);
        this.onLog(`[CleanSlate] Restored ${result.preserved.length} model files`);
      } catch (e) {
        this.onLog(`[CleanSlate] Warning: Could not restore models: ${e.message}`);
        // Try copy as fallback (cross-device move fails)
        try {
          this._copyDir(modelBackup, MODELS_DIR);
          fs.rmSync(modelBackup, { recursive: true, force: true });
          this.onLog('[CleanSlate] Restored models via copy fallback');
        } catch (e2) {
          result.errors.push(`Restore models: ${e2.message}`);
        }
      }
    }
    this.onProgress(90);

    // Step 8: Verify clean state
    const verify = this._verify();
    if (!verify.clean) {
      result.errors.push(`Verification failed: ${verify.issues.join(', ')}`);
      this.onLog(`[CleanSlate] Warning: Not fully clean: ${verify.issues.join(', ')}`);
    } else {
      this.onLog('[CleanSlate] Clean slate verified. Ready for fresh install.');
    }

    this.onProgress(100);
    return result;
  }

  /**
   * Detect any existing Windy Pro installation
   */
  _detect() {
    const details = [];
    let found = false;

    // Check for ~/.windy-pro directory
    if (fs.existsSync(APP_DIR)) {
      found = true;
      details.push('~/.windy-pro directory');
      // Check what's inside
      if (fs.existsSync(path.join(APP_DIR, 'venv'))) details.push('Python venv');
      if (fs.existsSync(path.join(APP_DIR, 'models'))) {
        const models = this._listModels();
        details.push(`${models.length} model files`);
      }
      if (fs.existsSync(path.join(APP_DIR, 'bin'))) details.push('bin directory');
      if (fs.existsSync(path.join(APP_DIR, 'python'))) details.push('bundled Python');
    }

    // Check for config directory
    if (fs.existsSync(CONFIG_DIR)) {
      found = true;
      details.push('config directory');
    }

    // Check for running processes
    try {
      const procs = this._findWindyProcesses();
      if (procs.length > 0) {
        found = true;
        details.push(`${procs.length} running processes`);
      }
    } catch (e) { /* ignore */ }

    // Platform-specific detection
    if (this.platform === 'win32') {
      try {
        execSync('reg query "HKCU\\Software\\WindyPro" 2>NUL', { stdio: 'pipe' });
        found = true;
        details.push('Windows registry entries');
      } catch (e) { /* not found = good */ }
    } else if (this.platform === 'darwin') {
      const appPath = '/Applications/Windy Pro.app';
      if (fs.existsSync(appPath)) {
        found = true;
        details.push('macOS application bundle');
      }
    } else {
      // Linux
      const desktopFile = path.join(os.homedir(), '.local', 'share', 'applications', 'windy-pro.desktop');
      if (fs.existsSync(desktopFile)) {
        found = true;
        details.push('Linux .desktop file');
      }
    }

    return { found, details };
  }

  /**
   * Find running Windy Pro processes
   */
  _findWindyProcesses() {
    const processes = [];
    try {
      if (this.platform === 'win32') {
        const output = execSync('tasklist /FI "IMAGENAME eq windy*" /FO CSV 2>NUL', {
          stdio: 'pipe', timeout: 5000
        }).toString();
        const lines = output.split('\n').filter(l => l.includes('windy'));
        lines.forEach(l => {
          const match = l.match(/"([^"]+)","(\d+)"/);
          if (match) processes.push({ name: match[1], pid: parseInt(match[2]) });
        });
        // Also check for our Python server
        const pythonOut = execSync('netstat -ano | findstr ":9876" 2>NUL', {
          stdio: 'pipe', timeout: 5000
        }).toString();
        const pidMatch = pythonOut.match(/LISTENING\s+(\d+)/);
        if (pidMatch) processes.push({ name: 'python-server', pid: parseInt(pidMatch[1]) });
      } else {
        // Unix-like (macOS, Linux)
        const output = execSync(
          "ps aux | grep -i '[w]indy.pro\\|[w]indy-pro\\|faster_whisper.*server' 2>/dev/null || true",
          { stdio: 'pipe', timeout: 5000 }
        ).toString();
        output.split('\n').filter(l => l.trim()).forEach(line => {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 2) {
            processes.push({ name: parts.slice(10).join(' '), pid: parseInt(parts[1]) });
          }
        });
        // Check port 9876 (Python server)
        try {
          const lsof = execSync('lsof -ti:9876 2>/dev/null || true', { stdio: 'pipe', timeout: 5000 }).toString().trim();
          if (lsof) {
            lsof.split('\n').forEach(pid => {
              if (pid && !processes.find(p => p.pid === parseInt(pid))) {
                processes.push({ name: 'port-9876', pid: parseInt(pid) });
              }
            });
          }
        } catch (e) { /* ignore */ }
      }
    } catch (e) { /* ignore errors */ }
    return processes;
  }

  /**
   * Kill all running Windy Pro processes
   */
  async _killProcesses() {
    const killed = [];
    const processes = this._findWindyProcesses();

    for (const proc of processes) {
      try {
        if (this.platform === 'win32') {
          execSync(`taskkill /PID ${proc.pid} /F 2>NUL`, { stdio: 'pipe', timeout: 5000 });
        } else {
          execSync(`kill -9 ${proc.pid} 2>/dev/null`, { stdio: 'pipe', timeout: 5000 });
        }
        killed.push(`${proc.name} (PID ${proc.pid})`);
      } catch (e) {
        // Process may have already exited
      }
    }

    // Wait briefly for processes to fully die
    if (killed.length > 0) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    return killed;
  }

  /**
   * Platform-specific cleanup
   */
  async _platformCleanup(result) {
    if (this.platform === 'win32') {
      await this._cleanupWindows(result);
    } else if (this.platform === 'darwin') {
      await this._cleanupMacOS(result);
    } else {
      await this._cleanupLinux(result);
    }
  }

  async _cleanupWindows(result) {
    // Remove registry entries
    try {
      execSync('reg delete "HKCU\\Software\\WindyPro" /f 2>NUL', { stdio: 'pipe', timeout: 5000 });
      result.removed.push('Windows registry: HKCU\\Software\\WindyPro');
    } catch (e) { /* not found */ }

    // Remove Start Menu shortcut
    const startMenuDir = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Windy Pro');
    if (fs.existsSync(startMenuDir)) {
      try {
        fs.rmSync(startMenuDir, { recursive: true, force: true });
        result.removed.push('Start Menu shortcut');
      } catch (e) { /* ignore */ }
    }

    // Remove Desktop shortcut
    const desktopShortcut = path.join(os.homedir(), 'Desktop', 'Windy Pro.lnk');
    if (fs.existsSync(desktopShortcut)) {
      try { fs.unlinkSync(desktopShortcut); result.removed.push('Desktop shortcut'); } catch (e) { /* ignore */ }
    }

    // Remove from system tray autostart
    try {
      execSync('reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v WindyPro /f 2>NUL', {
        stdio: 'pipe', timeout: 5000
      });
      result.removed.push('Autostart registry entry');
    } catch (e) { /* not found */ }

    // Remove Electron app data
    const electronData = path.join(process.env.APPDATA || os.homedir(), 'windy-pro');
    if (fs.existsSync(electronData)) {
      try {
        fs.rmSync(electronData, { recursive: true, force: true });
        result.removed.push('Electron app data');
      } catch (e) { /* ignore */ }
    }
  }

  async _cleanupMacOS(result) {
    // Remove /Applications/Windy Pro.app
    const appBundle = '/Applications/Windy Pro.app';
    if (fs.existsSync(appBundle)) {
      try {
        fs.rmSync(appBundle, { recursive: true, force: true });
        result.removed.push('macOS application bundle');
      } catch (e) {
        // May need sudo — try with osascript
        try {
          execSync(`osascript -e 'do shell script "rm -rf /Applications/Windy\\\\ Pro.app" with administrator privileges'`, {
            stdio: 'pipe', timeout: 30000
          });
          result.removed.push('macOS application bundle (admin)');
        } catch (e2) {
          result.errors.push('Could not remove /Applications/Windy Pro.app');
        }
      }
    }

    // Remove LaunchAgent (autostart)
    const launchAgent = path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.windypro.app.plist');
    if (fs.existsSync(launchAgent)) {
      try {
        execSync(`launchctl unload "${launchAgent}" 2>/dev/null`, { stdio: 'pipe', timeout: 5000 });
        fs.unlinkSync(launchAgent);
        result.removed.push('LaunchAgent plist');
      } catch (e) { /* ignore */ }
    }

    // Remove Application Support data
    const appSupport = path.join(os.homedir(), 'Library', 'Application Support', 'windy-pro');
    if (fs.existsSync(appSupport)) {
      try {
        fs.rmSync(appSupport, { recursive: true, force: true });
        result.removed.push('Application Support data');
      } catch (e) { /* ignore */ }
    }

    // Remove Caches
    const caches = path.join(os.homedir(), 'Library', 'Caches', 'windy-pro');
    if (fs.existsSync(caches)) {
      try { fs.rmSync(caches, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    }
  }

  async _cleanupLinux(result) {
    // Remove .desktop file
    const desktopFile = path.join(os.homedir(), '.local', 'share', 'applications', 'windy-pro.desktop');
    if (fs.existsSync(desktopFile)) {
      try {
        fs.unlinkSync(desktopFile);
        result.removed.push('Linux .desktop file');
      } catch (e) { /* ignore */ }
    }

    // Remove autostart entry
    const autostartFile = path.join(os.homedir(), '.config', 'autostart', 'windy-pro.desktop');
    if (fs.existsSync(autostartFile)) {
      try { fs.unlinkSync(autostartFile); result.removed.push('Autostart entry'); } catch (e) { /* ignore */ }
    }

    // Remove systemd user service if exists
    const systemdService = path.join(os.homedir(), '.config', 'systemd', 'user', 'windy-pro.service');
    if (fs.existsSync(systemdService)) {
      try {
        execSync('systemctl --user stop windy-pro.service 2>/dev/null', { stdio: 'pipe', timeout: 5000 });
        execSync('systemctl --user disable windy-pro.service 2>/dev/null', { stdio: 'pipe', timeout: 5000 });
        fs.unlinkSync(systemdService);
        result.removed.push('systemd user service');
      } catch (e) { /* ignore */ }
    }

    // Remove from /usr/local/bin if symlinked
    try {
      const symlink = '/usr/local/bin/windy-pro';
      if (fs.existsSync(symlink)) {
        const target = fs.readlinkSync(symlink);
        if (target.includes('windy-pro')) {
          fs.unlinkSync(symlink);
          result.removed.push('/usr/local/bin/windy-pro symlink');
        }
      }
    } catch (e) { /* ignore */ }

    // Remove XDG data directory
    const xdgData = path.join(os.homedir(), '.local', 'share', 'windy-pro');
    if (fs.existsSync(xdgData)) {
      try { fs.rmSync(xdgData, { recursive: true, force: true }); result.removed.push('XDG data dir'); } catch (e) { /* ignore */ }
    }
  }

  /**
   * Verify the clean state
   */
  _verify() {
    const issues = [];

    // Check APP_DIR is gone (except models if preserved)
    if (fs.existsSync(APP_DIR)) {
      const contents = fs.readdirSync(APP_DIR);
      const nonModel = contents.filter(f => f !== 'models');
      if (nonModel.length > 0) {
        issues.push(`~/.windy-pro still has: ${nonModel.join(', ')}`);
      }
    }

    // Check no processes running
    const procs = this._findWindyProcesses();
    if (procs.length > 0) {
      issues.push(`${procs.length} processes still running`);
    }

    // Check port 9876 is free
    try {
      if (this.platform !== 'win32') {
        const lsof = execSync('lsof -ti:9876 2>/dev/null || true', { stdio: 'pipe', timeout: 3000 }).toString().trim();
        if (lsof) issues.push('Port 9876 still in use');
      }
    } catch (e) { /* ignore */ }

    return { clean: issues.length === 0, issues };
  }

  /**
   * List model files in the models directory
   */
  _listModels() {
    if (!fs.existsSync(MODELS_DIR)) return [];
    try {
      return fs.readdirSync(MODELS_DIR).filter(f => {
        const fullPath = path.join(MODELS_DIR, f);
        const stat = fs.statSync(fullPath);
        // Models are directories (e.g., windy-stt-nano/) or large files
        return stat.isDirectory() || stat.size > 1000;
      });
    } catch (e) {
      return [];
    }
  }

  /**
   * Recursively copy a directory (fallback for cross-device moves)
   */
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

module.exports = { CleanSlate };
