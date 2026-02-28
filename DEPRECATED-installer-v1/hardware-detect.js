/**
 * Windy Pro - Hardware Detection Module
 * Detects GPU, RAM, and disk space to recommend optimal Whisper model.
 * 
 * DNA Strand: B4.1
 */

const { exec } = require('child_process');
const os = require('os');
const path = require('path');

class HardwareDetector {
    /**
     * Detect all hardware capabilities
     * @returns {Promise<{gpu: object, ram: number, diskFree: number, platform: string}>}
     */
    async detect() {
        const [gpu, diskFree] = await Promise.all([
            this.detectGPU(),
            this.detectDiskSpace()
        ]);

        return {
            gpu,
            ram: Math.round(os.totalmem() / (1024 ** 3) * 10) / 10,  // GB
            diskFree,
            platform: process.platform,
            arch: process.arch,
            cpuCores: os.cpus().length,
            cpuModel: os.cpus()[0]?.model || 'Unknown'
        };
    }

    /**
     * Detect GPU capabilities
     */
    async detectGPU() {
        const result = {
            nvidia: false,
            amd: false,
            appleSilicon: false,
            name: 'No GPU detected',
            vram: 0
        };

        // Apple Silicon check
        if (process.platform === 'darwin' && process.arch === 'arm64') {
            result.appleSilicon = true;
            result.name = 'Apple Silicon (M-series)';
            // Apple Silicon shares system RAM for GPU
            result.vram = Math.round(os.totalmem() / (1024 ** 3));
            return result;
        }

        // NVIDIA GPU check
        try {
            const nvOutput = await this.execAsync(
                'nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits'
            );
            if (nvOutput.trim()) {
                const [name, vramMB] = nvOutput.trim().split(', ');
                result.nvidia = true;
                result.name = name.trim();
                result.vram = Math.round(parseInt(vramMB) / 1024);  // Convert MB to GB
                return result;
            }
        } catch (e) {
            // No NVIDIA GPU
        }

        // AMD ROCm check
        try {
            const amdOutput = await this.execAsync('rocm-smi --showmeminfo vram');
            if (amdOutput.includes('Total')) {
                result.amd = true;
                result.name = 'AMD GPU (ROCm)';
                const match = amdOutput.match(/Total Memory \(B\): (\d+)/);
                if (match) {
                    result.vram = Math.round(parseInt(match[1]) / (1024 ** 3));
                }
                return result;
            }
        } catch (e) {
            // No AMD ROCm
        }

        return result;
    }

    /**
     * Detect available disk space in home directory
     * @returns {Promise<number>} Free disk space in GB
     */
    async detectDiskSpace() {
        try {
            if (process.platform === 'win32') {
                const drive = os.homedir().charAt(0);
                const output = await this.execAsync(
                    `wmic logicaldisk where "DeviceID='${drive}:'" get FreeSpace /format:value`
                );
                const match = output.match(/FreeSpace=(\d+)/);
                if (match) {
                    return Math.round(parseInt(match[1]) / (1024 ** 3) * 10) / 10;
                }
            } else {
                const output = await this.execAsync(`df -B1 "${os.homedir()}" | tail -1`);
                const parts = output.trim().split(/\s+/);
                if (parts.length >= 4) {
                    return Math.round(parseInt(parts[3]) / (1024 ** 3) * 10) / 10;
                }
            }
        } catch (e) {
            // Fallback
        }
        return 0;
    }

    execAsync(cmd) {
        return new Promise((resolve, reject) => {
            exec(cmd, { timeout: 5000 }, (error, stdout) => {
                if (error) reject(error);
                else resolve(stdout);
            });
        });
    }
}


/**
 * Model Selection Logic
 * Recommends optimal Whisper model based on hardware capabilities.
 * 
 * DNA Strand: B4.2
 */
class ModelSelector {
    /**
     * Model specifications (download size, VRAM needed, quality)
     */
    static MODELS = {
        tiny: { size: 0.075, vram: 1, quality: 'Basic', speed: 'Fastest' },
        base: { size: 0.15, vram: 1, quality: 'Good', speed: 'Fast' },
        small: { size: 0.5, vram: 2, quality: 'Accurate', speed: 'Moderate' },
        medium: { size: 1.5, vram: 5, quality: 'High', speed: 'Slower' },
        'large-v3': { size: 3.0, vram: 10, quality: 'Best', speed: 'Slowest' }
    };

    /**
     * Recommend the best model for the detected hardware
     * @param {object} hardware - Output from HardwareDetector.detect()
     * @returns {{model: string, compute: string, reason: string, specs: object}}
     */
    static recommend(hardware) {
        const { gpu, ram, diskFree } = hardware;

        // NVIDIA GPU with good VRAM
        if (gpu.nvidia && gpu.vram >= 10) {
            return {
                model: 'large-v3', compute: 'float16',
                reason: `${gpu.name} with ${gpu.vram}GB VRAM can run the best model.`,
                specs: this.MODELS['large-v3']
            };
        }
        if (gpu.nvidia && gpu.vram >= 5) {
            return {
                model: 'medium', compute: 'float16',
                reason: `${gpu.name} with ${gpu.vram}GB VRAM — medium model for great accuracy.`,
                specs: this.MODELS.medium
            };
        }
        if (gpu.nvidia && gpu.vram >= 2) {
            return {
                model: 'small', compute: 'int8',
                reason: `${gpu.name} with ${gpu.vram}GB VRAM — small model with int8 for speed.`,
                specs: this.MODELS.small
            };
        }
        if (gpu.nvidia) {
            return {
                model: 'base', compute: 'int8',
                reason: `${gpu.name} with limited VRAM — base model recommended.`,
                specs: this.MODELS.base
            };
        }

        // Apple Silicon
        if (gpu.appleSilicon) {
            if (ram >= 16) {
                return {
                    model: 'medium', compute: 'float16',
                    reason: `Apple Silicon with ${ram}GB unified memory can handle medium model.`,
                    specs: this.MODELS.medium
                };
            }
            return {
                model: 'small', compute: 'float16',
                reason: `Apple Silicon with ${ram}GB — small model for good accuracy.`,
                specs: this.MODELS.small
            };
        }

        // CPU-only fallback
        if (ram >= 16) {
            return {
                model: 'base', compute: 'int8',
                reason: `CPU-only with ${ram}GB RAM — base model with int8 quantization.`,
                specs: this.MODELS.base
            };
        }

        return {
            model: 'tiny', compute: 'int8',
            reason: `Limited hardware (${ram}GB RAM, no GPU) — tiny model for reliable performance.`,
            specs: this.MODELS.tiny
        };
    }
}

module.exports = { HardwareDetector, ModelSelector };
