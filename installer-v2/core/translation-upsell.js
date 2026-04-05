/**
 * Windy Pro Installer — Translation Upsell Screen (F2)
 * 
 * Wizard step shown after language profiling if the user selected
 * a non-English language. Presents the Translate tier upgrade.
 */

class TranslationUpsell {
    constructor(languageProfile) {
        this.profile = languageProfile;
    }

    /**
     * Should this screen be shown?
     * Only shown when user selected a non-English transcription language
     */
    shouldShow() {
        return this.profile?.transcriptionLanguage !== 'en';
    }

    /**
     * Get wizard HTML for the upsell step
     */
    getHTML() {
        const lang = this.profile?.transcriptionLanguage || 'en';
        const langNames = {
            es: 'Spanish', fr: 'French', de: 'German', zh: 'Chinese',
            ja: 'Japanese', ko: 'Korean', pt: 'Portuguese', hi: 'Hindi',
            ar: 'Arabic', ru: 'Russian', it: 'Italian', tr: 'Turkish',
        };
        const langName = langNames[lang] || lang;

        return `
<div class="wizard-step upsell-screen">
    <div style="text-align:center;padding:20px 0;">
        <div style="font-size:48px;margin-bottom:12px;">🌍</div>
        <h2 style="color:#22C55E;margin-bottom:8px;">
            Unlock Real-Time Translation
        </h2>
        <p style="color:#94A3B8;max-width:400px;margin:0 auto 24px;">
            You selected <strong style="color:#E2E8F0;">${langName}</strong> as your language.
            Upgrade to Windy Ultra for real-time bilingual conversations.
        </p>
    </div>

    <!-- Comparison Cards -->
    <div style="display:flex;gap:16px;justify-content:center;flex-wrap:wrap;">
        <!-- Pro Card -->
        <div style="background:#1E293B;border:1px solid #334155;border-radius:12px;
            padding:20px;width:220px;text-align:center;">
            <div style="color:#8B5CF6;font-weight:700;font-size:13px;margin-bottom:8px;">WINDY PRO</div>
            <div style="color:#E2E8F0;font-size:28px;font-weight:800;">$4.99<span style="font-size:14px;">/mo</span></div>
            <div style="color:#64748B;font-size:12px;margin-bottom:16px;">$49/yr · $99 lifetime</div>
            <ul style="text-align:left;color:#94A3B8;font-size:13px;list-style:none;padding:0;line-height:2;">
                <li>✓ 15 engines</li>
                <li>✓ ${langName} transcription</li>
                <li>✓ 15-min cloud recordings</li>
                <li>✓ Batch mode + LLM polish</li>
                <li style="color:#475569;">✗ Real-time translation</li>
                <li style="color:#475569;">✗ Conversation mode</li>
            </ul>
        </div>

        <!-- Ultra Card (highlighted) -->
        <div style="background:#064E3B;border:2px solid #22C55E;border-radius:12px;
            padding:20px;width:220px;text-align:center;position:relative;">
            <div style="position:absolute;top:-10px;left:50%;transform:translateX(-50%);
                background:#22C55E;color:#000;font-size:11px;font-weight:800;
                padding:2px 12px;border-radius:10px;">RECOMMENDED</div>
            <div style="color:#22C55E;font-weight:700;font-size:13px;margin-bottom:8px;">WINDY ULTRA</div>
            <div style="color:#E2E8F0;font-size:28px;font-weight:800;">$8.99<span style="font-size:14px;">/mo</span></div>
            <div style="color:#64748B;font-size:12px;margin-bottom:16px;">$79/yr · $199 lifetime</div>
            <ul style="text-align:left;color:#34D399;font-size:13px;list-style:none;padding:0;line-height:2;">
                <li>✓ Everything in Pro</li>
                <li>✓ Real-time translation</li>
                <li>✓ Conversation mode</li>
                <li>✓ 5 language pairs</li>
                <li>✓ 30-min cloud recordings</li>
                <li>✓ 5 devices</li>
            </ul>
        </div>
    </div>

    <div style="text-align:center;margin-top:24px;">
        <button id="upsell-accept" style="background:#22C55E;color:#000;border:none;
            border-radius:8px;padding:12px 32px;font-size:15px;font-weight:700;
            cursor:pointer;margin-right:12px;">
            Upgrade to Ultra →
        </button>
        <button id="upsell-skip" style="background:transparent;color:#64748B;border:1px solid #334155;
            border-radius:8px;padding:12px 24px;font-size:14px;cursor:pointer;">
            Continue with Free
        </button>
    </div>
</div>`;
    }
}

module.exports = { TranslationUpsell };
