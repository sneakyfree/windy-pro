/**
 * Windy Pro v2.0 — Storage-Aware Model Recommendations
 * 
 * Detects available disk space and RAM, then:
 * 1. Auto-recommends models based on storage/RAM thresholds
 * 2. Tracks running total as models are checked/unchecked
 * 3. Warns at 90% capacity (yellow) or over capacity (red, disables install)
 * 4. Grays out models that exceed RAM requirements
 * 5. Estimates download time based on measured network speed
 * 
 * Works on all platforms: Linux, macOS, Windows desktop + mobile (Expo)
 */

const { MODEL_CATALOG, getTotalSize, formatSize } = require('./models');

// ─── Storage Thresholds ───
// How much free space is needed to recommend each tier of models
const STORAGE_THRESHOLDS = [
    { maxFreeMB: 500, maxModelSizeMB: 100, label: 'Very low storage — only tiny models' },
    { maxFreeMB: 2000, maxModelSizeMB: 200, label: 'Limited storage — lightweight models only' },
    { maxFreeMB: 5000, maxModelSizeMB: 600, label: 'Moderate storage — standard models OK' },
    { maxFreeMB: 10000, maxModelSizeMB: 1600, label: 'Good storage — large models OK' },
    { maxFreeMB: Infinity, maxModelSizeMB: Infinity, label: 'Plenty of storage — all models available' }
];

// ─── RAM Requirements ───
// Models are grayed out if the system doesn't meet RAM minimums
const RAM_GATES = [
    { minRAMGB: 4, tooltip: 'Requires 4GB+ RAM' },
    { minRAMGB: 8, tooltip: 'Requires 8GB+ RAM' },
    { minRAMGB: 16, tooltip: 'Requires 16GB+ RAM' },
    { minRAMGB: 24, tooltip: 'Requires 24GB+ RAM' }
];

// Reserve 10% of free space for recordings and OS overhead
const STORAGE_RESERVE_FACTOR = 0.10;
// Warn when selected models exceed this fraction of available space
const STORAGE_WARN_THRESHOLD = 0.90;

class StorageAwareModels {
    constructor() {
        this.freeStorageMB = 0;
        this.totalRAMGB = 0;
        this.freeRAMGB = 0;
        this.networkSpeedMBps = 0;
        this.selectedModelIds = [];
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
        const selectedMB = getTotalSize(this.selectedModelIds);
        const usedPercent = usable > 0 ? selectedMB / usable : 1;

        let status = 'ok';
        let message = '';
        let canInstall = true;

        if (selectedMB > usable) {
            status = 'error';
            const deficit = selectedMB - usable;
            message = `Not enough storage. Deselect some models or free up ${this.formatStorage(deficit)}.`;
            canInstall = false;
        } else if (usedPercent > STORAGE_WARN_THRESHOLD) {
            status = 'warning';
            message = 'Low storage — selected models may not leave room for recordings.';
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
     * Auto-recommend models based on available storage and RAM
     * Returns array of model IDs that fit the hardware profile
     */
    getRecommendedModels() {
        const usable = this.getUsableStorageMB();
        const ram = this.totalRAMGB;

        // Find the appropriate storage threshold
        let maxModelSize = 0;
        for (const t of STORAGE_THRESHOLDS) {
            if (usable < t.maxFreeMB) {
                maxModelSize = t.maxModelSizeMB;
                break;
            }
        }

        // Filter models that fit both storage AND RAM
        const candidates = MODEL_CATALOG.filter(m => {
            if (m.sizeMB > maxModelSize) return false;
            if (m.ramGB > ram) return false;
            return true;
        });

        // Select the best model per family, prioritizing quality
        const recommended = [];
        const families = ['edge', 'core', 'lingua'];
        let totalMB = 0;

        for (const family of families) {
            const familyModels = candidates
                .filter(m => m.family === family)
                .sort((a, b) => b.sizeMB - a.sizeMB); // Largest (best quality) first

            for (const model of familyModels) {
                if (totalMB + model.sizeMB <= usable) {
                    recommended.push(model.id);
                    totalMB += model.sizeMB;
                    break; // One per family
                }
            }
        }

        return recommended;
    }

    /**
     * Get per-model status: whether it can be selected based on RAM/storage
     * @returns {Object.<string, { selectable: boolean, reason: string|null, ramOk: boolean }>}
     */
    getModelStatuses() {
        const usable = this.getUsableStorageMB();
        const ram = this.totalRAMGB;
        const currentSelectedMB = getTotalSize(this.selectedModelIds);
        const statuses = {};

        for (const model of MODEL_CATALOG) {
            const isSelected = this.selectedModelIds.includes(model.id);
            const ramOk = ram >= model.ramGB;
            const fitsStorage = isSelected
                ? true // Already selected, don't block
                : (currentSelectedMB + model.sizeMB) <= usable;

            let reason = null;
            let selectable = true;

            if (!ramOk) {
                selectable = false;
                reason = `Requires ${model.ramGB}GB+ RAM (you have ${ram}GB)`;
            } else if (!fitsStorage && !isSelected) {
                selectable = false;
                reason = `Not enough storage (need ${formatSize(model.sizeMB)} more)`;
            }

            statuses[model.id] = { selectable, reason, ramOk, isSelected };
        }

        return statuses;
    }

    /**
     * Estimate download time for selected models
     * @returns {{ totalMB: number, estimatedSeconds: number, estimatedDisplay: string }}
     */
    getDownloadEstimate() {
        const totalMB = getTotalSize(this.selectedModelIds);
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
     * Select/deselect a model and return updated status
     * @param {string} modelId
     * @param {boolean} selected
     */
    toggleModel(modelId, selected) {
        if (selected && !this.selectedModelIds.includes(modelId)) {
            this.selectedModelIds.push(modelId);
        } else if (!selected) {
            this.selectedModelIds = this.selectedModelIds.filter(id => id !== modelId);
        }
        return {
            storageStatus: this.getStorageStatus(),
            modelStatuses: this.getModelStatuses(),
            downloadEstimate: this.getDownloadEstimate()
        };
    }

    /**
     * Set all selected models at once
     * @param {string[]} modelIds
     */
    setSelectedModels(modelIds) {
        this.selectedModelIds = [...modelIds];
        return {
            storageStatus: this.getStorageStatus(),
            modelStatuses: this.getModelStatuses(),
            downloadEstimate: this.getDownloadEstimate()
        };
    }

    /**
     * Get the full initial state for the model selection screen
     * @returns {object} Complete state for rendering
     */
    getInitialState() {
        const recommended = this.getRecommendedModels();
        this.selectedModelIds = [...recommended];

        return {
            hardware: {
                freeStorageMB: this.freeStorageMB,
                freeStorageDisplay: this.formatStorage(this.freeStorageMB),
                totalRAMGB: this.totalRAMGB,
                freeRAMGB: this.freeRAMGB,
                networkSpeedMBps: this.networkSpeedMBps
            },
            recommendedModels: recommended,
            storageStatus: this.getStorageStatus(),
            modelStatuses: this.getModelStatuses(),
            downloadEstimate: this.getDownloadEstimate()
        };
    }
}

module.exports = { StorageAwareModels, STORAGE_THRESHOLDS, RAM_GATES };
