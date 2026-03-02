/**
 * Windy Pro — Target Verticals Configuration (E5)
 * 
 * Industry-specific presets for transcription & translation.
 * Each vertical provides default settings, terminology boosts,
 * and UI customizations for its target industry.
 * 
 * DNA Strand: E5.1-E5.5
 */

const VERTICALS = {
    // ─── Healthcare (E5.1) ───
    healthcare: {
        id: 'healthcare',
        name: 'Healthcare',
        icon: '🏥',
        tagline: 'HIPAA-ready medical transcription',
        description: 'Optimized for clinical documentation, patient encounters, and medical dictation.',
        features: ['HIPAA compliance mode', 'Medical terminology boost', 'Speaker identification', 'SRT/caption export'],
        defaults: {
            engine: 'large-v3',          // Max accuracy for medical terms
            language: 'en',
            speakerDiarization: true,
            timestampGranularity: 'word',
            hotwords: ['mg', 'ml', 'mcg', 'PRN', 'BID', 'TID', 'QID', 'STAT', 'NPO', 'DNR'],
            exportFormat: 'structured',   // Structured with timestamps + speaker labels
            privacyMode: 'strict',        // Auto-redact PHI patterns (SSN, DOB, MRN)
            autoSave: true,
            captionExport: true,
        },
        terminologyBoost: [
            'blood pressure', 'heart rate', 'respiratory rate', 'oxygen saturation',
            'chief complaint', 'history of present illness', 'review of systems',
            'physical examination', 'assessment and plan', 'differential diagnosis',
            'prescription', 'electrocardiogram', 'magnetic resonance imaging',
            'computed tomography', 'complete blood count', 'basic metabolic panel'
        ],
        uiTheme: { accent: '#EF4444', badge: 'HIPAA' }
    },

    // ─── Education (E5.2) ───
    education: {
        id: 'education',
        name: 'Education',
        icon: '🎓',
        tagline: 'Lecture capture & accessibility',
        description: 'Perfect for lectures, study sessions, and classroom accessibility.',
        features: ['Lecture mode (long-form)', 'SRT/VTT caption export', 'Summary generation', 'Multi-language subtitles'],
        defaults: {
            engine: 'medium',
            language: 'auto',
            speakerDiarization: false,
            timestampGranularity: 'segment',
            exportFormat: 'srt',
            captionExport: true,
            autoSave: true,
            maxDuration: null,           // Unlimited for lectures
        },
        terminologyBoost: [
            'curriculum', 'syllabus', 'pedagogy', 'assessment', 'rubric',
            'thesis', 'hypothesis', 'methodology', 'bibliography', 'citation'
        ],
        uiTheme: { accent: '#3B82F6', badge: 'EDU' }
    },

    // ─── Legal (E5.3) ───
    legal: {
        id: 'legal',
        name: 'Legal',
        icon: '⚖️',
        tagline: 'Court-grade transcription',
        description: 'Designed for depositions, court proceedings, and legal documentation.',
        features: ['Speaker labels', 'Timestamped transcript', 'Confidentiality mode', 'Export to legal format'],
        defaults: {
            engine: 'large-v3',
            language: 'en',
            speakerDiarization: true,
            timestampGranularity: 'word',
            exportFormat: 'legal',       // With line numbers, timestamps, speaker IDs
            privacyMode: 'confidential',
            autoSave: true,
            punctuation: true,
        },
        terminologyBoost: [
            'plaintiff', 'defendant', 'objection', 'sustained', 'overruled',
            'deposition', 'affidavit', 'subpoena', 'stipulation', 'voir dire',
            'habeas corpus', 'amicus curiae', 'prima facie', 'pro bono'
        ],
        uiTheme: { accent: '#8B5CF6', badge: 'LEGAL' }
    },

    // ─── Travel (E5.4) ───
    travel: {
        id: 'travel',
        name: 'Travel',
        icon: '✈️',
        tagline: 'Real-time conversation translation',
        description: 'For travelers and hospitality — instant two-way translation.',
        features: ['Conversation mode default', 'Phrasebook', 'Offline language packs', 'Large text display'],
        defaults: {
            engine: 'small',             // Fast for real-time
            language: 'auto',
            conversationMode: true,
            largeFontMode: true,        // Big text for showing to others
            offlineFirst: true,
            exportFormat: 'plain',
        },
        terminologyBoost: [
            'airport', 'hotel', 'restaurant', 'taxi', 'train station',
            'passport', 'customs', 'boarding pass', 'reservation', 'check-in'
        ],
        phrasebook: {
            greetings: ['Hello', 'Thank you', 'Please', 'Excuse me', 'Sorry'],
            emergency: ['Help!', 'I need a doctor', 'Call the police', 'Where is the hospital?'],
            navigation: ['Where is...?', 'How much?', 'Turn left', 'Turn right', 'Straight ahead'],
        },
        uiTheme: { accent: '#F59E0B', badge: 'TRAVEL' }
    },

    // ─── Military/Government (E5.5) ───
    military: {
        id: 'military',
        name: 'Military / Gov',
        icon: '🛡️',
        tagline: 'Secure, offline-only transcription',
        description: 'Air-gapped operation with NATO phonetic alphabet support.',
        features: ['Offline-only mode', 'NATO phonetic alphabet', 'Classification labels', 'Audit logging'],
        defaults: {
            engine: 'large-v3',
            language: 'en',
            offlineOnly: true,           // Never connect to cloud
            speakerDiarization: true,
            timestampGranularity: 'word',
            exportFormat: 'structured',
            privacyMode: 'classified',
            auditLog: true,
            networkAccess: false,
        },
        terminologyBoost: [
            'alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot',
            'OPSEC', 'COMSEC', 'SIGINT', 'HUMINT', 'ROE', 'SITREP',
            'grid reference', 'sector', 'perimeter', 'exfil', 'infil'
        ],
        uiTheme: { accent: '#059669', badge: 'SEC' }
    }
};

/**
 * Get vertical config by ID
 * @param {string} id - Vertical identifier
 * @returns {object|null}
 */
function getVertical(id) {
    return VERTICALS[id] || null;
}

/**
 * List all available verticals
 * @returns {Array<{id, name, icon, tagline}>}
 */
function listVerticals() {
    return Object.values(VERTICALS).map(v => ({
        id: v.id, name: v.name, icon: v.icon, tagline: v.tagline
    }));
}

/**
 * Apply vertical defaults to a config object
 * @param {string} verticalId - Vertical to apply
 * @param {object} baseConfig - Existing config to merge with
 * @returns {object} Merged config with vertical defaults
 */
function applyVerticalDefaults(verticalId, baseConfig = {}) {
    const vertical = VERTICALS[verticalId];
    if (!vertical) return baseConfig;
    return { ...vertical.defaults, ...baseConfig, vertical: verticalId };
}

// Export for both Node.js and browser
if (typeof module !== 'undefined') {
    module.exports = { VERTICALS, getVertical, listVerticals, applyVerticalDefaults };
}
