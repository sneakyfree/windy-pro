/**
 * Windy Pro v2.0 — Hardware Detection
 * Detects everything: CPU, RAM, GPU (NVIDIA/AMD/Apple/Intel), VRAM, disk, battery,
 * OS version, architecture, network speed. Works on all platforms.
 */

const { exec } = require('child_process');
const os = require('os');
const https = require('https');
const http = require('http');

class HardwareDetector {
  constructor() {
    this.result = null;
  }

  /**
   * Full hardware scan — returns everything the wizard needs
   */
  async detect() {
    const [gpu, diskFree, battery, networkSpeed, osInfo] = await Promise.all([
      this.detectGPU(),
      this.detectDiskSpace(),
      this.detectBattery(),
      this.measureNetworkSpeed(),
      this.detectOS()
    ]);

    this.result = {
      cpu: {
        model: os.cpus()[0]?.model || 'Unknown',
        cores: os.cpus().length,
        speed: os.cpus()[0]?.speed || 0, // MHz
        arch: process.arch, // x64, arm64, etc.
      },
      ram: {
        totalGB: Math.round(os.totalmem() / (1024 ** 3) * 10) / 10,
        freeGB: Math.round(os.freemem() / (1024 ** 3) * 10) / 10,
      },
      gpu,
      disk: {
        freeGB: diskFree,
      },
      battery,
      network: networkSpeed,
      os: osInfo,
      platform: process.platform,
      timestamp: new Date().toISOString()
    };

    return this.result;
  }

  /**
   * Detect GPU — NVIDIA, AMD, Apple Silicon, Intel iGPU
   */
  async detectGPU() {
    const result = {
      type: 'none',
      name: 'No dedicated GPU detected',
      vramGB: 0,
      nvidia: false,
      amd: false,
      appleSilicon: false,
      intelIntegrated: false,
      cudaAvailable: false,
      metalAvailable: false,
      vulkanAvailable: false
    };

    // Apple Silicon
    if (process.platform === 'darwin' && process.arch === 'arm64') {
      result.type = 'apple-silicon';
      result.appleSilicon = true;
      result.metalAvailable = true;
      result.vramGB = Math.round(os.totalmem() / (1024 ** 3)); // Shared memory
      // Try to get chip name
      try {
        const chipInfo = await this.execAsync('sysctl -n machdep.cpu.brand_string');
        result.name = chipInfo.trim() || 'Apple Silicon';
      } catch (e) {
        result.name = 'Apple Silicon (M-series)';
      }
      return result;
    }

    // Intel Mac
    if (process.platform === 'darwin') {
      try {
        const gpuInfo = await this.execAsync('system_profiler SPDisplaysDataType 2>/dev/null | grep "Chipset Model"');
        if (gpuInfo.trim()) {
          result.name = gpuInfo.trim().replace('Chipset Model:', '').trim();
          result.type = 'intel-mac';
          result.intelIntegrated = true;
        }
      } catch (e) {}
      return result;
    }

    // NVIDIA (Linux/Windows)
    try {
      const nvOutput = await this.execAsync(
        'nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader,nounits'
      );
      if (nvOutput.trim()) {
        const parts = nvOutput.trim().split(',').map(s => s.trim());
        result.type = 'nvidia';
        result.nvidia = true;
        result.cudaAvailable = true;
        result.name = parts[0] || 'NVIDIA GPU';
        result.vramGB = Math.round(parseInt(parts[1] || '0') / 1024);
        result.driverVersion = parts[2] || 'Unknown';
        return result;
      }
    } catch (e) {}

    // AMD ROCm (Linux)
    try {
      const amdOutput = await this.execAsync('rocm-smi --showproductname 2>/dev/null');
      if (amdOutput && !amdOutput.includes('ERROR')) {
        result.type = 'amd';
        result.amd = true;
        result.name = 'AMD GPU (ROCm)';
        try {
          const vramOut = await this.execAsync('rocm-smi --showmeminfo vram 2>/dev/null');
          const match = vramOut.match(/Total Memory \(B\): (\d+)/);
          if (match) result.vramGB = Math.round(parseInt(match[1]) / (1024 ** 3));
        } catch (e2) {}
        return result;
      }
    } catch (e) {}

    // Intel integrated (Linux)
    try {
      const lspci = await this.execAsync('lspci 2>/dev/null | grep -i "vga\\|3d\\|display"');
      if (lspci.trim()) {
        const lines = lspci.trim().split('\n');
        for (const line of lines) {
          if (line.toLowerCase().includes('nvidia')) {
            result.type = 'nvidia';
            result.nvidia = true;
            result.name = line.split(':').pop().trim();
            return result;
          }
          if (line.toLowerCase().includes('amd') || line.toLowerCase().includes('radeon')) {
            result.type = 'amd';
            result.amd = true;
            result.name = line.split(':').pop().trim();
            return result;
          }
          if (line.toLowerCase().includes('intel')) {
            result.type = 'intel-integrated';
            result.intelIntegrated = true;
            result.name = line.split(':').pop().trim();
          }
        }
      }
    } catch (e) {}

    // Windows — WMIC fallback
    if (process.platform === 'win32') {
      try {
        const wmicOut = await this.execAsync('wmic path win32_VideoController get Name,AdapterRAM /format:csv');
        const lines = wmicOut.trim().split('\n').filter(l => l.trim() && !l.includes('Node'));
        for (const line of lines) {
          const parts = line.split(',');
          if (parts.length >= 3) {
            const vram = parseInt(parts[1] || '0');
            const name = parts[2]?.trim() || '';
            if (name.toLowerCase().includes('nvidia')) {
              result.type = 'nvidia';
              result.nvidia = true;
              result.name = name;
              result.vramGB = Math.round(vram / (1024 ** 3));
            } else if (name) {
              result.name = name;
              result.intelIntegrated = name.toLowerCase().includes('intel');
            }
          }
        }
      } catch (e) {}
    }

    return result;
  }

  /**
   * Disk space in GB
   */
  async detectDiskSpace() {
    try {
      if (process.platform === 'win32') {
        const drive = os.homedir().charAt(0);
        const output = await this.execAsync(
          `wmic logicaldisk where "DeviceID='${drive}:'" get FreeSpace /format:value`
        );
        const match = output.match(/FreeSpace=(\d+)/);
        return match ? Math.round(parseInt(match[1]) / (1024 ** 3) * 10) / 10 : 0;
      } else {
        const output = await this.execAsync(`df -B1 "${os.homedir()}" | tail -1`);
        const parts = output.trim().split(/\s+/);
        return parts.length >= 4 ? Math.round(parseInt(parts[3]) / (1024 ** 3) * 10) / 10 : 0;
      }
    } catch (e) {
      return 0;
    }
  }

  /**
   * Battery status (for laptops/phones)
   */
  async detectBattery() {
    const result = { hasBattery: false, level: 100, charging: true, powerSource: 'AC' };
    try {
      if (process.platform === 'linux') {
        const cap = await this.execAsync('cat /sys/class/power_supply/BAT0/capacity 2>/dev/null');
        const status = await this.execAsync('cat /sys/class/power_supply/BAT0/status 2>/dev/null');
        if (cap.trim()) {
          result.hasBattery = true;
          result.level = parseInt(cap.trim());
          result.charging = status.trim().toLowerCase() !== 'discharging';
          result.powerSource = result.charging ? 'AC' : 'Battery';
        }
      } else if (process.platform === 'darwin') {
        const pmset = await this.execAsync('pmset -g batt 2>/dev/null');
        if (pmset.includes('Battery')) {
          result.hasBattery = true;
          const match = pmset.match(/(\d+)%/);
          if (match) result.level = parseInt(match[1]);
          result.charging = pmset.includes('AC Power') || pmset.includes('charging');
          result.powerSource = result.charging ? 'AC' : 'Battery';
        }
      } else if (process.platform === 'win32') {
        const wmic = await this.execAsync('WMIC Path Win32_Battery Get EstimatedChargeRemaining /format:value 2>NUL');
        const match = wmic.match(/EstimatedChargeRemaining=(\d+)/);
        if (match) {
          result.hasBattery = true;
          result.level = parseInt(match[1]);
        }
      }
    } catch (e) {}
    return result;
  }

  /**
   * Measure network speed by downloading a small test payload
   */
  async measureNetworkSpeed() {
    const result = { speedMBps: 0, latencyMs: 0, quality: 'unknown' };

    try {
      // Use a small known file for speed test
      const testUrl = 'https://speed.cloudflare.com/__down?bytes=524288'; // 512KB
      const startTime = Date.now();
      let bytesReceived = 0;

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { resolve(); }, 10000);

        https.get(testUrl, { timeout: 8000 }, (res) => {
          const firstByteTime = Date.now();
          result.latencyMs = firstByteTime - startTime;

          res.on('data', (chunk) => { bytesReceived += chunk.length; });
          res.on('end', () => {
            clearTimeout(timeout);
            const elapsed = (Date.now() - firstByteTime) / 1000;
            if (elapsed > 0) {
              result.speedMBps = Math.round((bytesReceived / (1024 * 1024)) / elapsed * 100) / 100;
            }
            resolve();
          });
          res.on('error', () => { clearTimeout(timeout); resolve(); });
        }).on('error', () => { clearTimeout(timeout); resolve(); });
      });

      // Classify
      if (result.speedMBps >= 10) result.quality = 'fast';
      else if (result.speedMBps >= 2) result.quality = 'good';
      else if (result.speedMBps >= 0.5) result.quality = 'slow';
      else result.quality = 'very-slow';

    } catch (e) {
      result.quality = 'offline';
    }

    return result;
  }

  /**
   * OS version details
   */
  async detectOS() {
    const info = {
      platform: process.platform,
      arch: process.arch,
      release: os.release(),
      type: os.type(),
      name: 'Unknown',
      version: ''
    };

    try {
      if (process.platform === 'linux') {
        const lsb = await this.execAsync('cat /etc/os-release 2>/dev/null');
        const nameMatch = lsb.match(/PRETTY_NAME="?([^"\n]+)"?/);
        if (nameMatch) info.name = nameMatch[1];
        const versionMatch = lsb.match(/VERSION_ID="?([^"\n]+)"?/);
        if (versionMatch) info.version = versionMatch[1];
      } else if (process.platform === 'darwin') {
        const ver = await this.execAsync('sw_vers -productVersion 2>/dev/null');
        info.name = 'macOS';
        info.version = ver.trim();
      } else if (process.platform === 'win32') {
        info.name = 'Windows';
        const ver = await this.execAsync('ver 2>NUL');
        info.version = ver.trim();
      }
    } catch (e) {}

    return info;
  }

  execAsync(cmd) {
    return new Promise((resolve, reject) => {
      exec(cmd, { timeout: 10000 }, (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      });
    });
  }
}

module.exports = { HardwareDetector };
