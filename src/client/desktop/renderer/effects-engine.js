/**
 * Windy Pro — Effects Engine (Strand I)
 * 
 * PURE OBSERVER: Listens to recording state events, never sends commands back.
 * COMPLETE ISOLATION: Own AudioContext (output-only), own CSS overlay layer.
 * If this file is deleted, recording/transcription works identically.
 * 
 * DNA Strand: I2 (Effects Engine), I4 (Dynamic Scaling)
 */

// ═══ Sound Manager ═══
// Uses its OWN AudioContext, completely separate from mic.
// OUTPUT-ONLY (speakers). Zero connection to mic input.

class SoundManager {
    constructor() {
        this._ctx = null;
        this._masterVolume = 0.7;
        this._cache = {};
    }

    _ensureCtx() {
        if (!this._ctx || this._ctx.state === 'closed') {
            this._ctx = new AudioContext();
        }
        if (this._ctx.state === 'suspended') this._ctx.resume();
        return this._ctx;
    }

    setMasterVolume(vol) {
        this._masterVolume = Math.max(0, Math.min(1, vol));
    }

    /**
     * Play a synthesized tone (no audio files needed)
     * @param {Object} opts - { frequency, duration, type, sweep, volume }
     */
    playTone(opts = {}) {
        if (this._masterVolume === 0) return;
        try {
            const ctx = this._ensureCtx();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);

            const freq = opts.frequency || 440;
            const dur = opts.duration || 0.1;
            const vol = (opts.volume || 0.3) * this._masterVolume;
            osc.type = opts.type || 'sine';

            if (opts.sweep) {
                osc.frequency.setValueAtTime(opts.sweep.from || freq, ctx.currentTime);
                osc.frequency.linearRampToValueAtTime(opts.sweep.to || freq * 1.5, ctx.currentTime + dur);
            } else {
                osc.frequency.value = freq;
            }

            gain.gain.setValueAtTime(vol, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + dur);
        } catch (_) { /* fail silently */ }
    }

    /**
     * Play a sequence of tones (for complex effects)
     * @param {Array} tones - array of tone opts, each with optional `delay`
     */
    playSequence(tones = []) {
        tones.forEach((tone, i) => {
            const delay = tone.delay || (i * 0.12);
            setTimeout(() => this.playTone(tone), delay * 1000);
        });
    }

    /**
     * Play an audio file from a data URL (base64)
     * Converts to Blob URL for reliable Electron playback
     * @param {string} dataUrl - base64 data URL of audio file
     * @param {number} volume - volume multiplier (0-1)
     */
    async playAudioFile(dataUrl, volume = 0.5) {
        if (this._masterVolume === 0 || !dataUrl) return;
        try {
            // Convert data URL to Blob URL for reliable playback
            let url = dataUrl;
            if (dataUrl.startsWith('data:')) {
                const resp = await fetch(dataUrl);
                const blob = await resp.blob();
                url = URL.createObjectURL(blob);
            }
            const audio = new Audio();
            audio.volume = Math.min(1, Math.max(0.05, volume * this._masterVolume));
            audio.src = url;
            audio.onended = () => { try { URL.revokeObjectURL(url); } catch (_) { } };
            audio.onerror = (e) => { console.warn('Audio playback error:', e); };
            await audio.play();
        } catch (e) { console.warn('playAudioFile failed:', e); }
    }

    dispose() {
        if (this._ctx && this._ctx.state !== 'closed') {
            this._ctx.close().catch(() => { });
        }
        this._ctx = null;
    }
}

// ═══ Visual Overlay ═══
// CSS overlay layer on TOP of recording UI.
// pointer-events: none — effects don't block UI interaction.

class VisualOverlay {
    constructor() {
        this._overlay = document.getElementById('effectsOverlay');
        if (!this._overlay) {
            this._overlay = document.createElement('div');
            this._overlay.id = 'effectsOverlay';
            this._overlay.className = 'effects-overlay';
            document.body.appendChild(this._overlay);
        }
    }

    /**
     * Render a visual effect
     * @param {string} type - 'flash', 'particles', 'shake', 'border-glow'
     * @param {Object} opts - { color, intensity, duration }
     */
    renderEffect(type, opts = {}) {
        const dur = opts.duration || 500;
        const intensity = Math.min(opts.intensity || 0.5, 1);

        switch (type) {
            case 'flash':
                this._flash(opts.color || '#fff', intensity, dur);
                break;
            case 'particles':
                this._particles(opts.color || '#22C55E', opts.count || 15, dur);
                break;
            case 'shake':
                this._shake(intensity, dur);
                break;
            case 'border-glow':
                this._borderGlow(opts.color || '#22C55E', intensity, dur);
                break;
        }
    }

    _flash(color, intensity, duration) {
        const el = document.createElement('div');
        el.className = 'effect-flash';
        el.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: ${color}; opacity: ${intensity * 0.3};
      pointer-events: none; z-index: 9990;
      animation: effectFadeOut ${duration}ms ease-out forwards;
    `;
        this._overlay.appendChild(el);
        setTimeout(() => el.remove(), duration + 50);
    }

    _particles(color, count, duration) {
        const clamped = Math.min(count, 30);
        for (let i = 0; i < clamped; i++) {
            const p = document.createElement('div');
            p.className = 'effect-particle';
            const x = Math.random() * 100;
            const delay = Math.random() * 200;
            p.style.cssText = `
        position: fixed; bottom: 0; left: ${x}%;
        width: ${3 + Math.random() * 5}px; height: ${3 + Math.random() * 5}px;
        background: ${color}; border-radius: 50%;
        pointer-events: none; z-index: 9990;
        opacity: ${0.4 + Math.random() * 0.6};
        animation: effectParticleRise ${duration}ms ease-out ${delay}ms forwards;
      `;
            this._overlay.appendChild(p);
            setTimeout(() => p.remove(), duration + delay + 50);
        }
    }

    _shake(intensity, duration) {
        const window_el = document.querySelector('.window');
        if (!window_el) return;
        const px = Math.round(intensity * 4);
        window_el.style.animation = `effectShake ${Math.min(duration, 500)}ms ease-in-out`;
        window_el.style.setProperty('--shake-px', `${px}px`);
        setTimeout(() => {
            window_el.style.animation = '';
            window_el.style.removeProperty('--shake-px');
        }, duration);
    }

    _borderGlow(color, intensity, duration) {
        const window_el = document.querySelector('.window');
        if (!window_el) return;
        const spread = Math.round(intensity * 15);
        window_el.style.boxShadow = `0 0 ${spread}px ${color}, inset 0 0 ${spread / 2}px ${color}44`;
        setTimeout(() => {
            window_el.style.boxShadow = '';
        }, duration);
    }

    clear() {
        this._overlay.innerHTML = '';
    }
}

// ═══ Effects Engine ═══
// Orchestrates SoundManager + VisualOverlay based on active theme pack.

class EffectsEngine {
    constructor() {
        this.sound = new SoundManager();
        this.visual = new VisualOverlay();

        // Current configuration
        this._mode = 'silent';        // 'silent' | 'single' | 'surprise'
        this._activePack = null;      // ThemePack manifest object
        this._packs = {};             // id → manifest
        this._favorites = [];
        this._surpriseCategory = 'all';
        this._shuffleBag = [];
        this._dynamicScaling = true;

        // Per-hook-point settings
        this._hookPoints = {
            start: { enabled: false, volume: 70 },
            during: { enabled: false, volume: 30 },
            stop: { enabled: false, volume: 70 },
            process: { enabled: false, volume: 30 },
            warning: { enabled: false, volume: 80 },
            paste: { enabled: false, volume: 100 }
        };

        this._loadSettings();
        this._loadPacks();
    }

    // ── Settings Persistence ──

    _loadSettings() {
        try {
            const saved = localStorage.getItem('windy_effects');
            if (saved) {
                const s = JSON.parse(saved);
                this._mode = s.mode || 'silent';
                this._dynamicScaling = s.dynamicScaling !== false;
                this._surpriseCategory = s.surpriseCategory || 'all';
                this._favorites = s.favorites || [];
                if (s.hookPoints) {
                    for (const [k, v] of Object.entries(s.hookPoints)) {
                        if (this._hookPoints[k]) Object.assign(this._hookPoints[k], v);
                    }
                }
                if (s.activePack) this._activePackId = s.activePack;
            }
        } catch (_) { }

        // Sync master volume with SFX slider
        const sfxVol = parseInt(localStorage.getItem('windy_sfxVolume') || '70', 10);
        this.sound.setMasterVolume(sfxVol / 100);
    }

    _saveSettings() {
        try {
            localStorage.setItem('windy_effects', JSON.stringify({
                mode: this._mode,
                activePack: this._activePack?.id || this._activePackId || null,
                surpriseCategory: this._surpriseCategory,
                dynamicScaling: this._dynamicScaling,
                favorites: this._favorites,
                hookPoints: this._hookPoints
            }));
        } catch (_) { }
    }

    // ── Pack Management ──

    _loadPacks() {
        // Built-in packs (synthesized — no audio files)
        this._packs = {};

        // Silent (system default)
        this._registerPack({
            id: '_silent', name: '🔇 Silent', category: 'system',
            description: 'No sounds, no visuals',
            hooks: {
                start: null, during: null, stop: null, process: null, paste: null
            }
        });

        // Classic Beep (restore original behavior)
        this._registerPack({
            id: 'classic-beep', name: '🔔 Classic ★', category: 'system',
            description: 'Same as Default beeps, with volume control',
            hooks: {
                start: { sound: { frequency: 880, duration: 0.08, type: 'sine', volume: 0.6 } },
                during: { sound: { frequency: 660, duration: 0.04, type: 'sine', volume: 0.35 } },
                stop: { sound: { frequency: 440, duration: 0.1, type: 'sine', volume: 0.6 } },
                process: { sound: { frequency: 550, duration: 0.2, type: 'sine', volume: 0.6 } },
                warning: { sound: [{ frequency: 800, duration: 0.12, type: 'sine', volume: 0.7 }, { frequency: 600, duration: 0.15, type: 'sine', volume: 0.7, delay: 0.15 }] },
                paste: { sound: { sweep: { from: 600, to: 900 }, duration: 0.15, type: 'sine', volume: 0.6 } }
            }
        });

        // Soft Chime
        this._registerPack({
            id: 'soft-chime', name: '🔔 Soft Chime', category: 'utilitarian',
            description: 'Gentle chime tones for a calm workflow',
            hooks: {
                start: { sound: { frequency: 523, duration: 0.2, type: 'sine', volume: 0.6 }, visual: { type: 'border-glow', color: '#22C55E', duration: 400 } },
                during: { sound: { frequency: 440, duration: 0.15, type: 'sine', volume: 0.35 }, visual: { type: 'border-glow', color: '#22C55E', duration: 300, intensity: 0.2 } },
                stop: { sound: { frequency: 392, duration: 0.25, type: 'sine', volume: 0.6 }, visual: { type: 'border-glow', color: '#F59E0B', duration: 400 } },
                process: { sound: { frequency: 466, duration: 0.2, type: 'sine', volume: 0.5 }, visual: { type: 'border-glow', color: '#F59E0B', duration: 800, intensity: 0.3 } },
                paste: { sound: [{ frequency: 523, duration: 0.12, type: 'sine', volume: 0.6 }, { frequency: 659, duration: 0.12, type: 'sine', volume: 0.6, delay: 0.12 }, { frequency: 784, duration: 0.15, type: 'sine', volume: 0.5, delay: 0.24 }], visual: { type: 'flash', color: '#4ECDC4', duration: 300 } }
            }
        });

        // Wizard
        this._registerPack({
            id: 'wizard', name: '⚡ Wizard', category: 'epic',
            description: 'Arcane energy and lightning for creative sessions',
            hooks: {
                start: { sound: { sweep: { from: 200, to: 800 }, duration: 0.3, type: 'sawtooth', volume: 0.5 }, visual: { type: 'border-glow', color: '#8B5CF6', duration: 600 } },
                during: { sound: { frequency: 350, duration: 0.08, type: 'sawtooth', volume: 0.3 }, visual: { type: 'border-glow', color: '#A78BFA', duration: 400, intensity: 0.15 } },
                stop: { sound: { sweep: { from: 800, to: 200 }, duration: 0.4, type: 'sawtooth', volume: 0.5 }, visual: { type: 'flash', color: '#8B5CF6', duration: 300 } },
                process: { sound: { sweep: { from: 300, to: 500 }, duration: 0.2, type: 'sawtooth', volume: 0.45 }, visual: { type: 'particles', color: '#C084FC', count: 8, duration: 1500 } },
                paste: { sound: [{ sweep: { from: 100, to: 1200 }, duration: 0.3, type: 'sawtooth', volume: 0.6 }, { frequency: 1200, duration: 0.15, type: 'square', volume: 0.4, delay: 0.25 }], visual: { type: 'particles', color: '#A78BFA', count: 20, duration: 2000 } }
            }
        });

        // Battle Royale
        this._registerPack({
            id: 'battle-royale', name: '🎮 Battle Royale', category: 'gamer',
            description: 'Weapon rack, airstrike, victory horn',
            hooks: {
                start: { sound: [{ frequency: 220, duration: 0.05, type: 'square', volume: 0.7 }, { frequency: 330, duration: 0.05, type: 'square', volume: 0.6, delay: 0.06 }], visual: { type: 'flash', color: '#EF4444', duration: 200 } },
                during: { sound: { frequency: 180, duration: 0.04, type: 'square', volume: 0.35 }, visual: { type: 'border-glow', color: '#EF4444', duration: 300, intensity: 0.15 } },
                stop: { sound: { sweep: { from: 600, to: 100 }, duration: 0.3, type: 'sawtooth', volume: 0.6 }, visual: { type: 'shake', intensity: 0.4, duration: 300 } },
                process: { sound: { frequency: 280, duration: 0.25, type: 'square', volume: 0.55 }, visual: { type: 'border-glow', color: '#F59E0B', duration: 1000, intensity: 0.4 } },
                paste: { sound: [{ frequency: 440, duration: 0.15, type: 'square', volume: 0.6 }, { frequency: 554, duration: 0.15, type: 'square', volume: 0.6, delay: 0.15 }, { frequency: 659, duration: 0.25, type: 'square', volume: 0.7, delay: 0.3 }], visual: { type: 'particles', color: '#F59E0B', count: 25, duration: 1500 } }
            }
        });

        // Tokyo Nights
        this._registerPack({
            id: 'tokyo-nights', name: '🏙️ Tokyo Nights', category: 'cultural',
            description: 'Lo-fi tones, koto-inspired flourishes',
            hooks: {
                start: { sound: { frequency: 698, duration: 0.3, type: 'sine', volume: 0.5 }, visual: { type: 'border-glow', color: '#EC4899', duration: 500 } },
                during: { sound: { frequency: 523, duration: 0.12, type: 'sine', volume: 0.3 }, visual: { type: 'border-glow', color: '#EC4899', duration: 400, intensity: 0.15 } },
                stop: { sound: [{ frequency: 523, duration: 0.15, type: 'sine', volume: 0.5 }, { frequency: 392, duration: 0.2, type: 'sine', volume: 0.45, delay: 0.15 }], visual: { type: 'border-glow', color: '#6366F1', duration: 600 } },
                process: { sound: { frequency: 587, duration: 0.25, type: 'sine', volume: 0.5 }, visual: { type: 'border-glow', color: '#F472B6', duration: 1000, intensity: 0.3 } },
                paste: { sound: [{ frequency: 784, duration: 0.1, type: 'sine', volume: 0.5 }, { frequency: 988, duration: 0.08, type: 'sine', volume: 0.45, delay: 0.1 }, { frequency: 1175, duration: 0.12, type: 'sine', volume: 0.4, delay: 0.18 }, { frequency: 784, duration: 0.2, type: 'sine', volume: 0.35, delay: 0.3 }], visual: { type: 'particles', color: '#F9A8D4', count: 12, duration: 1800 } }
            }
        });

        // Set active pack
        if (this._activePackId && this._packs[this._activePackId]) {
            this._activePack = this._packs[this._activePackId];
        } else if (this._mode === 'single') {
            this._activePack = this._packs['classic-beep'];
        }
    }

    _registerPack(manifest) {
        this._packs[manifest.id] = manifest;
    }

    getPackList() {
        return Object.values(this._packs);
    }

    getPacksByCategory(category) {
        return Object.values(this._packs).filter(p => p.category === category);
    }

    // ── Mode Management ──

    setMode(mode) {
        this._mode = mode;
        if (mode === 'surprise') this._shuffleBag = [];
        this._saveSettings();
    }

    setActivePack(packId) {
        if (this._packs[packId]) {
            this._activePack = this._packs[packId];
            this._activePackId = packId;
            this._saveSettings();
        }
    }

    setHookEnabled(hook, enabled) {
        if (this._hookPoints[hook]) {
            this._hookPoints[hook].enabled = enabled;
            this._saveSettings();
        }
    }

    setHookVolume(hook, volume) {
        if (this._hookPoints[hook]) {
            this._hookPoints[hook].volume = Math.max(0, Math.min(100, volume));
            this._saveSettings();
        }
    }

    setDynamicScaling(enabled) {
        this._dynamicScaling = enabled;
        this._saveSettings();
    }

    toggleFavorite(packId) {
        const idx = this._favorites.indexOf(packId);
        if (idx >= 0) {
            this._favorites.splice(idx, 1);
        } else {
            this._favorites.push(packId);
        }
        this._saveSettings();
    }

    // ── Surprise Me: Shuffle Bag ──

    _getNextSurprisePack() {
        if (this._shuffleBag.length === 0) {
            let pool;
            if (this._surpriseCategory === 'favorites') {
                pool = this._favorites.map(id => this._packs[id]).filter(Boolean);
            } else if (this._surpriseCategory === 'all') {
                pool = Object.values(this._packs).filter(p => p.id !== '_silent');
            } else {
                pool = Object.values(this._packs).filter(p => p.category === this._surpriseCategory);
            }
            if (pool.length === 0) return this._packs['classic-beep'];
            // Shuffle
            this._shuffleBag = [...pool].sort(() => Math.random() - 0.5);
        }
        return this._shuffleBag.pop();
    }

    // ── Effect Triggering ──

    /**
     * Trigger an effect for a specific hook point
     * @param {string} hook - 'start' | 'during' | 'stop' | 'process' | 'paste'
     * @param {Object} metadata - { wordCount, recordingDuration }
     */
    trigger(hook, metadata = {}) {
        console.debug(`[EffectsEngine] trigger(${hook}): mode=${this._mode}, hookEnabled=${this._hookPoints[hook]?.enabled}, hookVol=${this._hookPoints[hook]?.volume}`);
        if (this._mode === 'silent' || this._mode === 'default') return;

        const hp = this._hookPoints[hook];
        if (!hp || !hp.enabled) { console.debug(`[EffectsEngine] Hook ${hook} skipped: hp=${!!hp}, enabled=${hp?.enabled}`); return; }

        // Hook-point volume (0-100 → 0-1)
        const hookVolMul = hp.volume / 100;

        // ── Custom Mode: each hook has its own chosen sound ──
        if (this._mode === 'custom') {
            try {
                const customCfg = JSON.parse(localStorage.getItem('windy_customSounds') || '{}');
                const hookCfg = customCfg[hook];
                console.debug(`[EffectsEngine] Custom trigger: hook=${hook}, hookCfg=`, hookCfg);
                if (!hookCfg) { console.debug(`[EffectsEngine] No custom config for hook: ${hook}`); return; }

                if (hookCfg.type === 'shuffle') {
                    // Shuffle mode: pick a random sound from the pool
                    const lib = JSON.parse(localStorage.getItem('windy_soundLibrary') || '[]');
                    const pool = hookCfg.pool === 'all' ? lib : lib.filter(s => s.starred !== false);
                    console.debug(`[EffectsEngine] Shuffle mode: pool=${hookCfg.pool}, poolSize=${pool.length}`);
                    if (pool.length > 0) {
                        const pick = pool[Math.floor(Math.random() * pool.length)];
                        console.debug(`[EffectsEngine] Shuffle picked: "${pick.name}", dataUrlLen=${pick.dataUrl?.length || 0}`);
                        if (pick?.dataUrl) this.sound.playAudioFile(pick.dataUrl, hookVolMul);
                    }
                } else if (hookCfg.type === 'library' && hookCfg.libId) {
                    // Look up from shared sound library
                    const lib = JSON.parse(localStorage.getItem('windy_soundLibrary') || '[]');
                    const entry = lib.find(s => s.id === hookCfg.libId);
                    console.debug(`[EffectsEngine] Library lookup: libId=${hookCfg.libId}, found=${!!entry}, hasDataUrl=${!!entry?.dataUrl}, dataUrlLen=${entry?.dataUrl?.length || 0}`);
                    if (entry?.dataUrl) this.sound.playAudioFile(entry.dataUrl, hookVolMul);
                } else if (hookCfg.type === 'file' && hookCfg.dataUrl) {
                    // Legacy: inline data URL
                    this.sound.playAudioFile(hookCfg.dataUrl, hookVolMul);
                } else if (hookCfg.type === 'stock' && hookCfg.packId && hookCfg.hook) {
                    const pack = this._packs[hookCfg.packId];
                    if (pack) {
                        const hookDef = pack.hooks?.[hookCfg.hook];
                        if (hookDef?.sound) {
                            if (Array.isArray(hookDef.sound)) {
                                this.sound.playSequence(hookDef.sound.map(t => ({ ...t, volume: (t.volume || 0.3) * hookVolMul })));
                            } else {
                                this.sound.playTone({ ...hookDef.sound, volume: (hookDef.sound.volume || 0.3) * hookVolMul });
                            }
                        }
                    }
                }
            } catch (e) { console.error('[EffectsEngine] Custom trigger error:', e); }
            return;
        }

        // Get active pack (or pick from shuffle bag for Surprise Me)
        let pack = this._activePack;
        if (this._mode === 'surprise') {
            // On 'start', pick new pack for this session
            if (hook === 'start') {
                pack = this._getNextSurprisePack();
                this._activePack = pack;
            }
        }
        if (!pack) return;

        const hookDef = pack.hooks?.[hook];
        if (!hookDef) return;

        // Calculate intensity (dynamic scaling for paste)
        let intensity = 1.0;
        if (hook === 'paste' && this._dynamicScaling && metadata.wordCount) {
            if (metadata.wordCount < 50) intensity = 0.3;
            else if (metadata.wordCount < 200) intensity = 0.7;
            else intensity = 1.0;
        }

        // (hookVolMul already declared above)

        // Play sound
        if (hookDef.sound) {
            if (Array.isArray(hookDef.sound)) {
                const tones = hookDef.sound.map(t => ({
                    ...t,
                    volume: (t.volume || 0.3) * hookVolMul * intensity
                }));
                this.sound.playSequence(tones);
            } else {
                this.sound.playTone({
                    ...hookDef.sound,
                    volume: (hookDef.sound.volume || 0.3) * hookVolMul * intensity
                });
            }
        }

        // Show visual
        if (hookDef.visual) {
            const vis = hookDef.visual;
            this.visual.renderEffect(vis.type, {
                color: vis.color,
                intensity: (vis.intensity || 0.5) * intensity,
                duration: vis.duration || 500,
                count: vis.count ? Math.round(vis.count * intensity) : undefined
            });
        }
    }

    /**
     * Preview a specific hook point of a pack (for Settings UI)
     */
    previewEffect(packId, hook) {
        const pack = this._packs[packId];
        if (!pack) return;
        const hookDef = pack.hooks?.[hook];
        if (!hookDef) return;

        // Use hook-point volume when previewing so users hear the difference
        const hp = this._hookPoints[hook];
        const hookVolMul = hp ? hp.volume / 100 : 1;

        if (hookDef.sound) {
            if (Array.isArray(hookDef.sound)) {
                const tones = hookDef.sound.map(t => ({
                    ...t,
                    volume: (t.volume || 0.3) * hookVolMul
                }));
                this.sound.playSequence(tones);
            } else {
                this.sound.playTone({
                    ...hookDef.sound,
                    volume: (hookDef.sound.volume || 0.3) * hookVolMul
                });
            }
        }
        if (hookDef.visual) {
            this.visual.renderEffect(hookDef.visual.type, hookDef.visual);
        }
    }

    /**
     * Update master volume from SFX slider
     */
    setMasterVolume(vol) {
        this.sound.setMasterVolume(vol);
    }

    destroy() {
        this.sound.dispose();
        this.visual.clear();
    }
}
