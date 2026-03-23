/**
 * Windy Pro — License Enforcement (E4)
 * 
 * Controls access to features based on license tier.
 * 
 * Tiers:
 *   free     — 3 engines, 1 language, 5-min recordings, local only
 *   pro      — 15 engines, 99 languages, unlimited local / 15-min cloud, batch mode, LLM polish
 *   translate — Everything in Pro + real-time translation, conversation mode
 */

const TIERS = {
    free: {
        name: 'Free',
        price: 0,
        maxEngines: 3,
        maxLanguages: 1,
        maxRecordingMinutes: 5,
        features: ['local_transcription', 'tornado_widget', 'crash_recovery'],
        restrictedFeatures: ['cloud_transcription', 'batch_mode', 'llm_polish', 'translation', 'conversation_mode', 'soul_file', 'vault_sync']
    },
    pro: {
        name: 'Pro',
        price: 49,
        maxEngines: 15,
        maxLanguages: 99,
        maxRecordingMinutes: 30,
        features: ['local_transcription', 'cloud_transcription', 'tornado_widget', 'crash_recovery', 'batch_mode', 'llm_polish', 'soul_file', 'vault_sync', 'clone_capture'],
        restrictedFeatures: ['translation', 'conversation_mode']
    },
    translate: {
        name: 'Ultra',
        price: 79,
        maxEngines: 15,
        maxLanguages: 99,
        maxRecordingMinutes: 30,
        features: ['local_transcription', 'cloud_transcription', 'tornado_widget', 'crash_recovery', 'batch_mode', 'llm_polish', 'soul_file', 'vault_sync', 'clone_capture', 'translation', 'conversation_mode'],
        restrictedFeatures: []
    },
    translate_pro: {
        name: 'Max',
        price: 149,
        maxEngines: 15,
        maxLanguages: 99,
        maxRecordingMinutes: 60,
        features: ['local_transcription', 'cloud_transcription', 'tornado_widget', 'crash_recovery', 'batch_mode', 'llm_polish', 'soul_file', 'vault_sync', 'clone_capture', 'translation', 'conversation_mode', 'tts', 'medical_glossary', 'legal_glossary', 'priority_cloud'],
        restrictedFeatures: []
    }
}

class LicenseManager {
    constructor() {
        this.tier = localStorage.getItem('windy_license_tier') || 'free'
        this.licenseKey = localStorage.getItem('windy_license_key') || null
        this.activatedAt = localStorage.getItem('windy_license_activated') || null
    }

    /**
     * Get current tier info
     */
    getTier() {
        return TIERS[this.tier] || TIERS.free
    }

    /**
     * Check if a feature is available
     */
    hasFeature(feature) {
        const tier = this.getTier()
        return tier.features.includes(feature)
    }

    /**
     * Check if user can use more engines
     */
    canUseEngine(engineIndex) {
        return engineIndex < this.getTier().maxEngines
    }

    /**
     * Check recording time limit
     */
    getMaxRecordingSeconds() {
        return this.getTier().maxRecordingMinutes * 60
    }

    /**
     * Activate a license key
     * In production, this would validate against the account server.
     * For now, it accepts any key and upgrades to pro.
     */
    async activate(key) {
        try {
            const token = localStorage.getItem('windy_token') || localStorage.getItem('windy_cloud_token')
            const res = await fetch('/api/v1/license/activate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                },
                body: JSON.stringify({ key })
            })

            if (res.ok) {
                const data = await res.json()
                this.tier = data.tier || 'pro'
                this.licenseKey = key
                this.activatedAt = new Date().toISOString()
                this._save()
                return { success: true, tier: this.tier }
            }

            // Fallback: offline activation for valid key format
            if (/^WP-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(key)) {
                this.tier = key.startsWith('WP-T') ? 'translate' : 'pro'
                this.licenseKey = key
                this.activatedAt = new Date().toISOString()
                this._save()
                return { success: true, tier: this.tier, offline: true }
            }

            return { success: false, error: 'Invalid license key' }
        } catch {
            // Offline: accept valid-format keys
            if (/^WP-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(key)) {
                this.tier = key.startsWith('WP-T') ? 'translate' : 'pro'
                this.licenseKey = key
                this.activatedAt = new Date().toISOString()
                this._save()
                return { success: true, tier: this.tier, offline: true }
            }
            return { success: false, error: 'Activation failed — check your internet connection' }
        }
    }

    /**
     * Get upgrade prompt info for a restricted feature
     */
    getUpgradeInfo(feature) {
        if (this.hasFeature(feature)) return null

        const needed = feature === 'translation' || feature === 'conversation_mode' ? 'translate' : 'pro'
        const tier = TIERS[needed]
        return {
            requiredTier: needed,
            tierName: tier.name,
            price: tier.price,
            message: `${tier.name} license required for this feature.`
        }
    }

    _save() {
        localStorage.setItem('windy_license_tier', this.tier)
        if (this.licenseKey) localStorage.setItem('windy_license_key', this.licenseKey)
        if (this.activatedAt) localStorage.setItem('windy_license_activated', this.activatedAt)
    }
}

// Singleton
export const license = new LicenseManager()
export { TIERS }
export default license
