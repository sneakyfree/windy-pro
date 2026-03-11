/**
 * Windy Pro v2.0 — Storage-Aware Engine Recommendations
 *
 * Detects available disk space and RAM, then:
 * 1. Auto-recommends engines based on storage/RAM thresholds
 * 2. Tracks running total as engines are checked/unchecked
 * 3. Warns at 90% capacity (yellow) or over capacity (red, disables install)
 * 4. Grays out engines that exceed RAM requirements
 * 5. Estimates download time based on measured network speed
 *
 * Works on all platforms: Linux, macOS, Windows desktop + mobile (Expo)
 */

const { ENGINE_CATALOG, getTotalSize, formatSize } = require('./models');

// ─── Storage Thresholds ───
// How much free space is needed to recommend each tier of engines
const STORAGE_THRESHOLDS = [
    { maxFreeMB: 500, maxEngineSizeMB: 150, label: 'Very low storage — only tiny engines' },
    { maxFreeMB: 2000, maxEngineSizeMB: 700, label: 'Limited storage — lightweight engines only' },
    { maxFreeMB: 5000, maxEngineSizeMB: 1800, label: 'Moderate storage — standard engines OK' },
    { maxFreeMB: 10000, maxEngineSizeMB: 4900, label: 'Good storage — large engines OK' },
    { maxFreeMB: Infinity, maxEngineSizeMB: Infinity, label: 'Plenty of storage — all engines available' }
];

// ─── RAM Requirements ───
// Engines are grayed out if the system doesn't meet RAM minimums
const RAM_GATES = [
    { minRAMGB: 2, tooltip: 'Requires 2GB+ RAM' },
    { minRAMGB: 4, tooltip: 'Requires 4GB+ RAM' },
    { minRAMGB: 8, tooltip: 'Requires 8GB+ RAM' },
    { minRAMGB: 16, tooltip: 'Requires 16GB+ RAM' },
    { minRAMGB: 24, tooltip: 'Requires 24GB+ RAM' }
];

// Reserve 10% of free space for recordings and OS overhead
const STORAGE_RESERVE_FACTOR = 0.10;
// Warn when selected models exceed this fraction of available space
const STORAGE_WARN_THRESHOLD = 0.90;

class StorageAwareEngines {
    constructor() {
        this.freeStorageMB = 0;
        this.totalRAMGB = 0;
        this.freeRAMGB = 0;
        this.networkSpeedMBps = 0;
        this.selectedEngineIds = [];
    }

    /**
     * Initialize with hardware profile from HardwareDetector.detect()
     * @param {object} hardwareProfile - Result from HardwareDetector.detect()
     */
    loadHardwareProfile(hardwareProfile) {
        if (!hardwareProfile) return;
        this.freeStorageMB = (hardwareProfile.disk?.freeGB || 0) * 1024;
        this.totalRAMGB = hardwareProfile.ram?.totalGB || 0;
        this.freeRAMGB = hardwareProfile.ram?.freeGB || 0;
        this.networkSpeedMBps = hardwareProfile.network?.speedMBps || 0;
    }

    /**
     * Get usable storage (free minus 10% reserve for recordings/OS)
     */
    getUsableStorageMB() {
        return Math.max(0, this.freeStorageMB * (1 - STORAGE_RESERVE_FACTOR));
    }

    /**
     * Format bytes for display
     */
    formatStorage(mb) {
        if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
        return `${Math.round(mb)} MB`;
    }

    /**
     * Get the current storage status display
     * @returns {{ freeStorage: string, selectedSize: string, usedPercent: number,
     *   status: 'ok'|'warning'|'error', message: string, canInstall: boolean }}
     */
    getStorageStatus() {
        const usable = this.getUsableStorageMB();
        const selectedMB = getTotalSize(this.selectedEngineIds);
        const usedPercent = usable > 0 ? selectedMB / usable : 1;

        let status = 'ok';
        let message = '';
        let canInstall = true;

        if (selectedMB > usable) {
            status = 'error';
            const deficit = selectedMB - usable;
            message = `Not enough storage. Deselect some engines or free up ${this.formatStorage(deficit)}.`;
            canInstall = false;
        } else if (usedPercent > STORAGE_WARN_THRESHOLD) {
            status = 'warning';
            message = 'Low storage — selected engines may not leave room for recordings.';
        }

        return {
            freeStorage: this.formatStorage(this.freeStorageMB),
            usableStorage: this.formatStorage(usable),
            selectedSize: formatSize(selectedMB),
            selectedMB,
            usableMB: usable,
            usedPercent: Math.min(usedPercent, 1),
            status,
            message,
            canInstall
        };
    }

    /**
     * Auto-recommend engines based on available storage and RAM
     * Returns array of engine IDs that fit the hardware profile
     */
    getRecommendedEngines() {
        const usable = this.getUsableStorageMB();
        const ram = this.totalRAMGB;

        // Find the appropriate storage threshold
        let maxEngineSize = 0;
        for (const t of STORAGE_THRESHOLDS) {
            if (usable < t.maxFreeMB) {
                maxEngineSize = t.maxEngineSizeMB;
                break;
            }
        }

        // Filter engines that fit both storage AND RAM
        const candidates = ENGINE_CATALOG.filter(e => {
            if (e.sizeMB > maxEngineSize) return false;
            if (e.ramGB > ram) return false;
            return true;
        });

        // Select the best engine per family, prioritizing quality
        const recommended = [];
        const families = ['gpu', 'cpu', 'translation'];
        let totalMB = 0;

        for (const family of families) {
            const familyEngines = candidates
                .filter(e => e.family === family)
                .sort((a, b) => b.quality - a.quality); // Best quality first

            for (const engine of familyEngines) {
                if (totalMB + engine.sizeMB <= usable) {
                    recommended.push(engine.id);
                    totalMB += engine.sizeMB;
                    break; // One per family
                }
            }
        }

        return recommended;
    }

    /**
     * Get per-engine status: whether it can be selected based on RAM/storage
     * @returns {Object.<string, { selectable: boolean, reason: string|null, ramOk: boolean }>}
     */
    getEngineStatuses() {
        const usable = this.getUsableStorageMB();
        const ram = this.totalRAMGB;
        const currentSelectedMB = getTotalSize(this.selectedEngineIds);
        const statuses = {};

        for (const engine of ENGINE_CATALOG) {
            const isSelected = this.selectedEngineIds.includes(engine.id);
            const ramOk = ram >= engine.ramGB;
            const fitsStorage = isSelected
                ? true // Already selected, don't block
                : (currentSelectedMB + engine.sizeMB) <= usable;

            let reason = null;
            let selectable = true;

            if (!ramOk) {
                selectable = false;
                reason = `Requires ${engine.ramGB}GB+ RAM (you have ${ram}GB)`;
            } else if (!fitsStorage && !isSelected) {
                selectable = false;
                reason = `Not enough storage (need ${formatSize(engine.sizeMB)} more)`;
            }

            statuses[engine.id] = { selectable, reason, ramOk, isSelected };
        }

        return statuses;
    }

    /**
     * Estimate download time for selected engines
     * @returns {{ totalMB: number, estimatedSeconds: number, estimatedDisplay: string }}
     */
    getDownloadEstimate() {
        const totalMB = getTotalSize(this.selectedEngineIds);
        const speed = this.networkSpeedMBps || 0;

        if (speed <= 0) {
            return { totalMB, estimatedSeconds: 0, estimatedDisplay: 'Measuring...' };
        }

        const seconds = Math.ceil(totalMB / speed);

        let display;
        if (seconds < 60) display = `~${seconds}s`;
        else if (seconds < 3600) display = `~${Math.ceil(seconds / 60)} min`;
        else display = `~${(seconds / 3600).toFixed(1)} hrs`;

        return { totalMB, estimatedSeconds: seconds, estimatedDisplay: display };
    }

    /**
     * Select/deselect an engine and return updated status
     * @param {string} engineId
     * @param {boolean} selected
     */
    toggleEngine(engineId, selected) {
        if (selected && !this.selectedEngineIds.includes(engineId)) {
            this.selectedEngineIds.push(engineId);
        } else if (!selected) {
            this.selectedEngineIds = this.selectedEngineIds.filter(id => id !== engineId);
        }
        return {
            storageStatus: this.getStorageStatus(),
            engineStatuses: this.getEngineStatuses(),
            downloadEstimate: this.getDownloadEstimate()
        };
    }

    /**
     * Set all selected engines at once
     * @param {string[]} engineIds
     */
    setSelectedEngines(engineIds) {
        this.selectedEngineIds = [...engineIds];
        return {
            storageStatus: this.getStorageStatus(),
            engineStatuses: this.getEngineStatuses(),
            downloadEstimate: this.getDownloadEstimate()
        };
    }

    /**
     * Get the full initial state for the engine selection screen
     * @returns {object} Complete state for rendering
     */
    getInitialState() {
        const recommended = this.getRecommendedEngines();
        this.selectedEngineIds = [...recommended];

        return {
            hardware: {
                freeStorageMB: this.freeStorageMB,
                freeStorageDisplay: this.formatStorage(this.freeStorageMB),
                totalRAMGB: this.totalRAMGB,
                freeRAMGB: this.freeRAMGB,
                networkSpeedMBps: this.networkSpeedMBps
            },
            recommendedEngines: recommended,
            storageStatus: this.getStorageStatus(),
            engineStatuses: this.getEngineStatuses(),
            downloadEstimate: this.getDownloadEstimate()
        };
    }
}

module.exports = { StorageAwareEngines, STORAGE_THRESHOLDS, RAM_GATES };
