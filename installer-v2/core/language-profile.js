/**
 * Windy Pro Installer — Language Profiling Screen (F1)
 * 
 * Wizard step that detects the user's system language and lets them
 * choose their preferred transcription and UI languages.
 * Feeds into the hardware-detect + model-recommend pipeline to select
 * the optimal engine (e.g., lingua-es for Spanish).
 */

const os = require('os');

class LanguageProfiler {
    constructor() {
        this.systemLocale = this._detectSystemLocale();
        this.selectedTranscriptionLang = 'en';
        this.selectedUILang = 'en';
        this.additionalLangs = [];
    }

    /**
     * Detect system language from OS locale
     */
    _detectSystemLocale() {
        try {
            // Process environment vars (most reliable)
            const envLang = process.env.LANG || process.env.LC_ALL || process.env.LANGUAGE || '';
            if (envLang) {
                return envLang.split('.')[0].split('_')[0].toLowerCase();
            }
            // Fallback to Node.js Intl
            return Intl.DateTimeFormat().resolvedOptions().locale.split('-')[0];
        } catch {
            return 'en';
        }
    }

    /**
     * Get the wizard HTML for the language step
     */
    getHTML() {
        const languages = [
            { code: 'en', name: 'English', flag: '🇺🇸', engines: ['edge-standard', 'core-standard', 'core-pro'] },
            { code: 'es', name: 'Español', flag: '🇪🇸', engines: ['lingua-es'] },
            { code: 'fr', name: 'Français', flag: '🇫🇷', engines: ['lingua-fr'] },
            { code: 'de', name: 'Deutsch', flag: '🇩🇪', engines: ['core-global'] },
            { code: 'zh', name: '中文', flag: '🇨🇳', engines: ['core-global'] },
            { code: 'ja', name: '日本語', flag: '🇯🇵', engines: ['core-global'] },
            { code: 'ko', name: '한국어', flag: '🇰🇷', engines: ['core-global'] },
            { code: 'pt', name: 'Português', flag: '🇧🇷', engines: ['core-global'] },
            { code: 'hi', name: 'हिन्दी', flag: '🇮🇳', engines: ['lingua-hi'] },
            { code: 'ar', name: 'العربية', flag: '🇸🇦', engines: ['core-global'] },
            { code: 'ru', name: 'Русский', flag: '🇷🇺', engines: ['core-global'] },
            { code: 'it', name: 'Italiano', flag: '🇮🇹', engines: ['core-global'] },
            { code: 'tr', name: 'Türkçe', flag: '🇹🇷', engines: ['core-global'] },
            { code: 'vi', name: 'Tiếng Việt', flag: '🇻🇳', engines: ['core-global'] },
            { code: 'th', name: 'ไทย', flag: '🇹🇭', engines: ['core-global'] },
            { code: 'nl', name: 'Nederlands', flag: '🇳🇱', engines: ['core-global'] },
            { code: 'pl', name: 'Polski', flag: '🇵🇱', engines: ['core-global'] },
            { code: 'uk', name: 'Українська', flag: '🇺🇦', engines: ['core-global'] },
            { code: 'sv', name: 'Svenska', flag: '🇸🇪', engines: ['core-global'] },
            { code: 'id', name: 'Indonesia', flag: '🇮🇩', engines: ['core-global'] },
        ];

        const detected = languages.find(l => l.code === this.systemLocale) || languages[0];

        return `
<div class="wizard-step language-profile">
    <h2 style="color:#22C55E;margin-bottom:8px;">🌍 Language Setup</h2>
    <p style="color:#94A3B8;margin-bottom:20px;">
        We detected <strong style="color:#E2E8F0;">${detected.flag} ${detected.name}</strong> from your system.
        Choose your preferred languages below.
    </p>

    <div style="margin-bottom:16px;">
        <label style="color:#94A3B8;font-size:13px;display:block;margin-bottom:6px;">
            Transcription Language (what you speak)
        </label>
        <select id="transcription-lang" style="width:100%;background:#1E293B;color:#E2E8F0;
            border:1px solid #334155;border-radius:8px;padding:10px;font-size:15px;">
            ${languages.map(l =>
            `<option value="${l.code}" ${l.code === detected.code ? 'selected' : ''}>
                    ${l.flag} ${l.name}
                </option>`
        ).join('')}
        </select>
    </div>

    <div style="margin-bottom:16px;">
        <label style="color:#94A3B8;font-size:13px;display:block;margin-bottom:6px;">
            UI Language (menus and buttons)
        </label>
        <select id="ui-lang" style="width:100%;background:#1E293B;color:#E2E8F0;
            border:1px solid #334155;border-radius:8px;padding:10px;font-size:15px;">
            ${languages.map(l =>
            `<option value="${l.code}" ${l.code === detected.code ? 'selected' : ''}>
                    ${l.flag} ${l.name}
                </option>`
        ).join('')}
        </select>
    </div>

    <div style="background:#0F172A;border:1px solid #1E293B;border-radius:8px;padding:12px;margin-top:16px;">
        <div style="color:#94A3B8;font-size:12px;">Recommended Engine</div>
        <div style="color:#22C55E;font-weight:700;font-size:15px;margin-top:4px;">
            ${detected.engines[0]} 
            <span style="color:#64748B;font-weight:400;">— optimized for ${detected.name}</span>
        </div>
    </div>
</div>`;
    }

    /**
     * Get profile result from wizard selections
     */
    getProfile(transcriptionLang, uiLang) {
        return {
            transcriptionLanguage: transcriptionLang || this.systemLocale,
            uiLanguage: uiLang || this.systemLocale,
            systemLocale: this.systemLocale,
            recommendedEngine: this._getRecommendedEngine(transcriptionLang || this.systemLocale)
        };
    }

    _getRecommendedEngine(lang) {
        const langEngines = {
            'en': 'core-standard',
            'es': 'lingua-es',
            'fr': 'lingua-fr',
            'hi': 'lingua-hi',
        };
        return langEngines[lang] || 'core-global';
    }
}

module.exports = { LanguageProfiler };
