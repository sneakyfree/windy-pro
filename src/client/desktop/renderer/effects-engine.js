/**
 * Windy Word — Effects Engine (Strand I)
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
        // Noise-based sounds ({noise: 'thunder-roll'|...}) route transparently,
        // so pack hook defs and playSequence() can mix tones and noise freely.
        if (opts.noise) { this.playNoise(opts); return; }
        try {
            const ctx = this._ensureCtx();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);

            const freq = opts.frequency || 440;
            const dur = opts.duration || 0.1;
            // Clamp: the intensity dial can push volume multipliers past 1.0
            const vol = Math.min(1, (opts.volume || 0.3) * this._masterVolume);
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

    // ── Noise synthesis ─────────────────────────────────────────────────
    // Oscillator beeps can't do weather. A filtered-noise layer gives packs
    // real texture — rolling thunder, thunderclaps, whooshes — with zero
    // bundled audio assets (same no-files rule as playTone).

    _noiseBuffer(ctx, seconds = 3) {
        const key = `noise${seconds}`;
        if (this._cache[key] && this._cache[key].sampleRate === ctx.sampleRate) return this._cache[key];
        const len = Math.floor(ctx.sampleRate * seconds);
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = buf.getChannelData(0);
        // Brown-ish noise (integrated white) — deep rumble base, not TV static
        let last = 0;
        for (let i = 0; i < len; i++) {
            const white = Math.random() * 2 - 1;
            last = (last + 0.02 * white) / 1.02;
            data[i] = last * 3.5;
        }
        this._cache[key] = buf;
        return buf;
    }

    /**
     * Play a synthesized noise effect.
     * @param {Object} opts - { noise: 'thunder-roll'|'thunder-crack'|'whoosh', duration, volume }
     */
    playNoise(opts = {}) {
        if (this._masterVolume === 0) return;
        try {
            const ctx = this._ensureCtx();
            const vol = Math.min(1, (opts.volume || 0.5) * this._masterVolume);
            const t0 = ctx.currentTime;
            const src = ctx.createBufferSource();
            const filter = ctx.createBiquadFilter();
            const gain = ctx.createGain();
            src.connect(filter); filter.connect(gain); gain.connect(ctx.destination);

            const kind = opts.noise || 'thunder-roll';
            if (kind === 'thunder-roll') {
                // Distant rolling thunder: slow swells of deep filtered rumble.
                const dur = opts.duration || 2.8;
                src.buffer = this._noiseBuffer(ctx, Math.max(3, dur));
                filter.type = 'lowpass';
                filter.frequency.setValueAtTime(320, t0);
                filter.frequency.linearRampToValueAtTime(140, t0 + dur);
                gain.gain.setValueAtTime(0.0001, t0);
                // Three swells: rise, ebb, rise, fade — the "rolling" shape
                gain.gain.exponentialRampToValueAtTime(vol, t0 + dur * 0.18);
                gain.gain.exponentialRampToValueAtTime(vol * 0.4, t0 + dur * 0.42);
                gain.gain.exponentialRampToValueAtTime(vol * 0.85, t0 + dur * 0.62);
                gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
                src.start(t0); src.stop(t0 + dur);
            } else if (kind === 'thunder-crack') {
                // Close strike: instant sharp crack, then a rumble tail.
                const dur = opts.duration || 1.4;
                src.buffer = this._noiseBuffer(ctx, Math.max(3, dur));
                filter.type = 'lowpass';
                filter.frequency.setValueAtTime(3200, t0);            // bright CRACK
                filter.frequency.exponentialRampToValueAtTime(160, t0 + dur * 0.5);
                gain.gain.setValueAtTime(vol, t0);                     // no attack — instant hit
                gain.gain.exponentialRampToValueAtTime(vol * 0.5, t0 + 0.12);
                gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
                src.start(t0); src.stop(t0 + dur);
            } else if (kind === 'drum') {
                // War-drum thump: deep noise burst, instant hit, fast decay.
                const dur = opts.duration || 0.25;
                src.buffer = this._noiseBuffer(ctx, Math.max(3, dur));
                filter.type = 'lowpass';
                filter.frequency.setValueAtTime(150, t0);
                filter.frequency.exponentialRampToValueAtTime(60, t0 + dur);
                gain.gain.setValueAtTime(vol, t0);
                gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
                src.start(t0); src.stop(t0 + dur);
            } else if (kind === 'crowd') {
                // Stadium/colosseum roar: broad mid-band noise swelling up then away.
                const dur = opts.duration || 2.0;
                src.buffer = this._noiseBuffer(ctx, Math.max(3, dur));
                filter.type = 'bandpass'; filter.Q.value = 0.5;
                filter.frequency.setValueAtTime(700, t0);
                filter.frequency.linearRampToValueAtTime(1100, t0 + dur * 0.4);
                filter.frequency.linearRampToValueAtTime(600, t0 + dur);
                gain.gain.setValueAtTime(0.0001, t0);
                gain.gain.exponentialRampToValueAtTime(vol, t0 + dur * 0.35);
                gain.gain.exponentialRampToValueAtTime(vol * 0.6, t0 + dur * 0.7);
                gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
                src.start(t0); src.stop(t0 + dur);
            } else { // 'whoosh'
                const dur = opts.duration || 0.5;
                src.buffer = this._noiseBuffer(ctx, Math.max(3, dur));
                filter.type = 'bandpass'; filter.Q.value = 1.2;
                filter.frequency.setValueAtTime(300, t0);
                filter.frequency.exponentialRampToValueAtTime(2400, t0 + dur);
                gain.gain.setValueAtTime(0.0001, t0);
                gain.gain.exponentialRampToValueAtTime(vol, t0 + dur * 0.4);
                gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
                src.start(t0); src.stop(t0 + dur);
            }
        } catch (_) { /* fail silently */ }
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

// ═══ Visual Effects Library ═══
// The catalog of hand-selectable visual effects. Mirrors the sound library:
// packs reference these by `type`, and users can override any hook's visual
// in Settings → Theme Packs & Effects via the per-stage visual dropdowns.
// `defaults._all` are the opts used when a user hand-selects the effect.

// Visual-intensity slider (0-100, continuous — Grant: "a gradual dial", not
// three pills). Multiplier 0.4×–1.6× applied to VISUALS ONLY: the four
// amplitudes a user controls are (1) which visuals, (2) how big — this
// slider, (3) which sounds, (4) how loud — Master volume. Zone names come
// from the active pack (`intensityNames`, e.g. Apprentice/Sorcerer/Archmage)
// and label the slider live as it moves.
const INTENSITY_DEFAULT_NAMES = ['🌱 Subtle', '🎯 Balanced', '🌋 Maximum'];
const intensityMul = (value) => 0.4 + (Math.max(0, Math.min(100, value)) / 100) * 1.2;

const VISUAL_LIBRARY = [
    { id: 'flash', name: '💡 Screen Flash', desc: 'Quick full-window color flash', defaults: { _all: { color: '#4ECDC4', duration: 350, intensity: 0.6 } } },
    { id: 'border-glow', name: '🌟 Border Glow', desc: 'Soft glow around the window edge', defaults: { _all: { color: '#22C55E', duration: 600, intensity: 0.6 } } },
    { id: 'particles', name: '🎈 Rising Particles', desc: 'Dots float up from the bottom', defaults: { _all: { color: '#22C55E', count: 18, duration: 1600, intensity: 0.8 } } },
    { id: 'sparkles', name: '✨ Sparkles', desc: 'Twinkling stars across the window', defaults: { _all: { color: '#FCD34D', count: 16, duration: 1200, intensity: 0.8 } } },
    { id: 'fireworks', name: '🎆 Fireworks', desc: 'Radial celebration bursts', defaults: { _all: { color: '#F59E0B', count: 3, duration: 1400, intensity: 0.8 } } },
    { id: 'lightning', name: '⚡ Lightning', desc: 'Jagged bolts with a sky flash', defaults: { _all: { color: '#A78BFA', count: 2, duration: 900, intensity: 0.8 } } },
    { id: 'shake', name: '💥 Window Shake', desc: 'Impact shake on the window', defaults: { _all: { duration: 350, intensity: 0.6 } } },
    { id: 'rain', name: '🌧️ Rain', desc: 'Falling streaks — pairs with thunder', defaults: { _all: { color: '#93C5FD', count: 26, duration: 1800, intensity: 0.7 } } },
    { id: 'confetti', name: '🎊 Confetti', desc: 'Falling celebration pieces', defaults: { _all: { count: 24, duration: 1800, intensity: 0.8 } } }
];

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
     * @param {string} type - 'flash', 'particles', 'sparkles', 'fireworks', 'lightning', 'shake', 'border-glow'
     * @param {Object} opts - { color, intensity, duration, count }
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
            case 'sparkles':
                this._sparkles(opts.color || '#FCD34D', opts.count || 14, dur);
                break;
            case 'fireworks':
                this._fireworks(opts.color || '#F59E0B', opts.count || 3, dur);
                break;
            case 'lightning':
                this._lightning(opts.color || '#A78BFA', opts.count || 2, dur, intensity);
                break;
            case 'shake':
                this._shake(intensity, dur);
                break;
            case 'border-glow':
                this._borderGlow(opts.color || '#22C55E', intensity, dur);
                break;
            case 'rain':
                this._rain(opts.color || '#93C5FD', opts.count || 26, dur, intensity);
                break;
            case 'confetti':
                this._confetti(opts.count || 24, dur);
                break;
        }
    }

    _rain(color, count, duration, intensity = 0.7) {
        for (let i = 0; i < count; i++) {
            const drop = document.createElement('div');
            const fall = 600 + Math.random() * 500;
            drop.style.cssText =
                `position:absolute;top:-24px;left:${Math.random() * 100}%;width:1.5px;` +
                `height:${10 + Math.random() * 14}px;background:${color};opacity:${0.25 + 0.5 * intensity};` +
                `transform:translateY(0);transition:transform ${fall}ms linear;pointer-events:none;`;
            this._overlay.appendChild(drop);
            const delay = Math.random() * Math.max(0, duration - fall);
            setTimeout(() => { drop.style.transform = `translateY(${this._overlay.clientHeight + 60}px)`; }, delay);
            setTimeout(() => drop.remove(), delay + fall + 100);
        }
    }

    _confetti(count, duration) {
        const colors = ['#F59E0B', '#22C55E', '#3B82F6', '#EC4899', '#A78BFA', '#FCD34D'];
        for (let i = 0; i < count; i++) {
            const piece = document.createElement('div');
            const fall = 900 + Math.random() * 700;
            const drift = (Math.random() - 0.5) * 120;
            const spin = 360 + Math.random() * 540;
            piece.style.cssText =
                `position:absolute;top:-16px;left:${Math.random() * 100}%;` +
                `width:${5 + Math.random() * 5}px;height:${8 + Math.random() * 6}px;` +
                `background:${colors[i % colors.length]};border-radius:2px;opacity:0.9;` +
                `transform:translate(0,0) rotate(0deg);transition:transform ${fall}ms ease-in, opacity 300ms;pointer-events:none;`;
            this._overlay.appendChild(piece);
            const delay = Math.random() * Math.max(0, duration - fall);
            setTimeout(() => {
                piece.style.transform = `translate(${drift}px, ${this._overlay.clientHeight + 40}px) rotate(${spin}deg)`;
            }, delay);
            setTimeout(() => { piece.style.opacity = '0'; }, delay + fall - 200);
            setTimeout(() => piece.remove(), delay + fall + 150);
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
        const clamped = Math.min(count, 60);
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

    _sparkles(color, count, duration) {
        // Twinkling stars scattered across the window (distinct from rising particles)
        const clamped = Math.min(count, 40);
        for (let i = 0; i < clamped; i++) {
            const s = document.createElement('div');
            s.className = 'effect-sparkle';
            const x = Math.random() * 100;
            const y = Math.random() * 100;
            const size = 8 + Math.random() * 10;
            const delay = Math.random() * (duration * 0.4);
            s.textContent = '✦';
            s.style.cssText = `
        position: fixed; left: ${x}%; top: ${y}%;
        font-size: ${size}px; color: ${color};
        text-shadow: 0 0 ${Math.round(size / 2)}px ${color};
        pointer-events: none; z-index: 9990; opacity: 0;
        animation: effectSparkleTwinkle ${Math.max(400, Math.round(duration * 0.6))}ms ease-in-out ${delay}ms forwards;
      `;
            this._overlay.appendChild(s);
            setTimeout(() => s.remove(), duration + delay + 100);
        }
    }

    _fireworks(color, bursts, duration) {
        // Radial bursts at random positions; burst count scales with intensity
        const nBursts = Math.max(1, Math.min(bursts, 6));
        const palette = [color, '#FCD34D', '#F87171', '#60A5FA', '#34D399'];
        for (let b = 0; b < nBursts; b++) {
            const cx = 15 + Math.random() * 70; // % of width
            const cy = 15 + Math.random() * 50; // upper 2/3 of window
            const bDelay = b * 180 + Math.random() * 120;
            const sparks = 14;
            for (let i = 0; i < sparks; i++) {
                const p = document.createElement('div');
                p.className = 'effect-firework-spark';
                const angle = (i / sparks) * Math.PI * 2 + Math.random() * 0.4;
                const dist = 40 + Math.random() * 70;
                const c = palette[Math.floor(Math.random() * palette.length)];
                p.style.cssText = `
          position: fixed; left: ${cx}%; top: ${cy}%;
          width: 4px; height: 4px; border-radius: 50%;
          background: ${c}; box-shadow: 0 0 6px ${c};
          pointer-events: none; z-index: 9990; opacity: 0;
          --fx-dx: ${Math.round(Math.cos(angle) * dist)}px;
          --fx-dy: ${Math.round(Math.sin(angle) * dist + 30)}px;
          animation: effectFireworkBurst ${Math.max(500, Math.round(duration * 0.7))}ms cubic-bezier(0.1, 0.8, 0.3, 1) ${bDelay}ms forwards;
        `;
                this._overlay.appendChild(p);
                setTimeout(() => p.remove(), duration + bDelay + 150);
            }
        }
    }

    _lightning(color, bolts, duration, intensity = 0.8) {
        // Jagged SVG bolts from the top of the window + a brief sky flash.
        // Bolt count scales with intensity (via the caller's count scaling).
        const nBolts = Math.max(1, Math.min(bolts, 5));
        const w = window.innerWidth;
        const h = window.innerHeight;
        const svgNS = 'http://www.w3.org/2000/svg';
        for (let b = 0; b < nBolts; b++) {
            const delay = b * 130 + Math.random() * 80;
            // Build a jagged polyline top → mid/lower window
            const x0 = w * (0.15 + Math.random() * 0.7);
            const segs = 7 + Math.floor(Math.random() * 4);
            const endY = h * (0.5 + Math.random() * 0.35);
            let pts = `${Math.round(x0)},0`;
            let x = x0;
            for (let i = 1; i <= segs; i++) {
                x += (Math.random() - 0.5) * (w * 0.12);
                pts += ` ${Math.round(x)},${Math.round((endY / segs) * i)}`;
            }
            const svg = document.createElementNS(svgNS, 'svg');
            svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
            svg.setAttribute('class', 'effect-lightning');
            svg.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        pointer-events: none; z-index: 9991; opacity: 0;
        animation: effectLightningFlicker ${Math.max(350, Math.round(duration * 0.5))}ms ease-out ${delay}ms forwards;
      `;
            const glow = document.createElementNS(svgNS, 'polyline');
            glow.setAttribute('points', pts);
            glow.setAttribute('fill', 'none');
            glow.setAttribute('stroke', color);
            glow.setAttribute('stroke-width', '6');
            glow.setAttribute('stroke-linejoin', 'round');
            glow.style.filter = `drop-shadow(0 0 8px ${color})`;
            const core = document.createElementNS(svgNS, 'polyline');
            core.setAttribute('points', pts);
            core.setAttribute('fill', 'none');
            core.setAttribute('stroke', '#FFFFFF');
            core.setAttribute('stroke-width', '2');
            core.setAttribute('stroke-linejoin', 'round');
            svg.appendChild(glow);
            svg.appendChild(core);
            this._overlay.appendChild(svg);
            // Sky flash behind the first bolt
            if (b === 0) this._flash(color, Math.min(0.5, 0.25 + intensity * 0.3), Math.max(250, Math.round(duration * 0.4)));
            setTimeout(() => svg.remove(), duration + delay + 120);
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

        // Current configuration — ship with the friendly Classic sounds ON by default
        // (a soft tick when recording starts, while transcribing, and on paste — genuinely
        // useful when you've looked away during a local-model transcription). Fully
        // user-adjustable: change volume, swap packs, or go Silent in Settings. This is only
        // the FRESH-INSTALL default; any saved preference in localStorage('windy_effects')
        // overrides it, so existing users keep their choice.
        this._mode = 'default';       // 'silent' | 'default' | 'single' | 'surprise' | 'custom'
        this._activePack = null;      // ThemePack manifest object
        this._activePackId = 'classic-beep'; // 🔔 Classic ★ — the nice default pack
        this._packs = {};             // id → manifest
        this._favorites = [];
        this._surpriseCategory = 'all';
        this._shuffleBag = [];
        this._dynamicScaling = true;

        // Visual-intensity slider value (0-100, continuous). See intensityMul().
        this._visualIntensity = 55;

        // Per-hook-point settings — ALL 6 stages ON by default at clearly audible volumes,
        // so a new user immediately hears every cue (start, the during/processing confirmation
        // beeps, stop, the time-limit warning, and paste). The quiet 30% beeps were nearly
        // inaudible after the master×pack×hook multiply; bumped so they actually register.
        // Fully adjustable (or mutable) per hook in Settings → Theme Packs & Effects.
        this._hookPoints = {
            start: { enabled: true, volume: 90 },
            during: { enabled: true, volume: 70 },
            stop: { enabled: true, volume: 90 },
            process: { enabled: true, volume: 75 },
            warning: { enabled: true, volume: 85 },
            paste: { enabled: true, volume: 100 }
        };

        // Per-hook VISUAL overrides — parallel to the sound dropdowns.
        // 'auto' = follow the active pack's visual, 'none' = no visual,
        // or a VISUAL_LIBRARY id ('lightning', 'sparkles', …) hand-picked by the user.
        // Honored in EVERY non-silent mode (unlike custom sounds, which are custom-mode only).
        this._visualHooks = {
            start: 'auto', during: 'auto', stop: 'auto',
            process: 'auto', warning: 'auto', paste: 'auto'
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
                // Keep the saved mode (incl. 'default', which now plays the Classic pack since
                // the trigger() bug is fixed). Missing mode → 'default' (audible), not silent.
                this._mode = s.mode || 'default';
                this._dynamicScaling = s.dynamicScaling !== false;
                this._surpriseCategory = s.surpriseCategory || 'all';
                this._favorites = s.favorites || [];
                // One-time heal (schemaVersion < 2): builds before the audible-defaults fix
                // shipped every hook DISABLED (during/process volume 30) and persisted that,
                // which silenced Default mode for everyone who ran them. For those legacy
                // profiles, DROP the stale muted hookPoints and keep the audible constructor
                // defaults (start 90 / during 70 / stop 90 / process 75 / warning 85 / paste 100,
                // all enabled). v2+ profiles honor the user's saved per-hook mutes/volumes.
                const isLegacy = !s.schemaVersion || s.schemaVersion < 2;
                if (s.hookPoints && !isLegacy) {
                    for (const [k, v] of Object.entries(s.hookPoints)) {
                        if (this._hookPoints[k]) Object.assign(this._hookPoints[k], v);
                    }
                }
                if (s.activePack) this._activePackId = s.activePack;
                if (typeof s.intensityValue === 'number') this._visualIntensity = Math.max(0, Math.min(100, s.intensityValue));
                // Migrate the short-lived 3-pill dial (subtle/standard/max strings)
                else if (s.intensityLevel === 'subtle') this._visualIntensity = 25;
                else if (s.intensityLevel === 'max') this._visualIntensity = 90;
                // Visual overrides (added later; absent key = all 'auto', fully backward compatible)
                if (s.visualHooks) {
                    for (const [k, v] of Object.entries(s.visualHooks)) {
                        if (this._visualHooks[k] !== undefined && typeof v === 'string') this._visualHooks[k] = v;
                    }
                }
                // Persist the heal once so it sticks and never re-fires (stamps schemaVersion 2).
                if (isLegacy) this._saveSettings();
            }
        } catch (_) { }

        // Sync master volume with SFX slider (default 85% so the cues are clearly audible).
        const sfxVol = parseInt(localStorage.getItem('windy_sfxVolume') || '85', 10);
        this.sound.setMasterVolume(sfxVol / 100);
    }

    _saveSettings() {
        try {
            localStorage.setItem('windy_effects', JSON.stringify({
                schemaVersion: 2,
                mode: this._mode,
                activePack: this._activePack?.id || this._activePackId || null,
                surpriseCategory: this._surpriseCategory,
                dynamicScaling: this._dynamicScaling,
                intensityValue: this._visualIntensity,
                favorites: this._favorites,
                hookPoints: this._hookPoints,
                visualHooks: this._visualHooks
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

        // Classic Beep (restore original behavior) — now with MINIMAL visuals:
        // subtle glows and a small particle rise on paste. Understated on purpose;
        // Wizard is the maximal end of the spectrum. Per-hook visual dropdowns
        // let users mix, match, or turn any of these off.
        this._registerPack({
            id: 'classic-beep', name: '🔔 Classic ★', category: 'system',
            description: 'Same as Default beeps, with volume control + subtle visuals',
            hooks: {
                start: { sound: { frequency: 880, duration: 0.08, type: 'sine', volume: 0.6 }, visual: { type: 'border-glow', color: '#22C55E', duration: 400, intensity: 0.3 } },
                during: { sound: { frequency: 660, duration: 0.04, type: 'sine', volume: 0.35 } },
                stop: { sound: { frequency: 440, duration: 0.1, type: 'sine', volume: 0.6 }, visual: { type: 'border-glow', color: '#F59E0B', duration: 400, intensity: 0.3 } },
                process: { sound: { frequency: 550, duration: 0.2, type: 'sine', volume: 0.6 } },
                warning: { sound: [{ frequency: 800, duration: 0.12, type: 'sine', volume: 0.7 }, { frequency: 600, duration: 0.15, type: 'sine', volume: 0.7, delay: 0.15 }], visual: { type: 'flash', color: '#F59E0B', duration: 250, intensity: 0.3 } },
                paste: { sound: { sweep: { from: 600, to: 900 }, duration: 0.15, type: 'sine', volume: 0.6 }, visual: { type: 'particles', color: '#22C55E', count: 12, duration: 1200, intensity: 0.5 } }
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

        // Wizard — MAXIMUM SORCERY. Lightning at every dramatic beat, sparkles
        // for ambient magic, and a full storm (bolts + sparkles + fireworks) on
        // paste. All of it scales linearly with recording length (I4).
        this._registerPack({
            id: 'wizard', name: '⚡ Wizard', category: 'epic',
            description: 'Rolling thunder while it transcribes, a thunderclap storm on paste',
            intensityNames: ['🧙 Apprentice', '🔮 Sorcerer', '⚡ Archmage'],
            hooks: {
                start: { sound: { sweep: { from: 200, to: 800 }, duration: 0.3, type: 'sawtooth', volume: 0.5 }, visual: [{ type: 'border-glow', color: '#8B5CF6', duration: 600 }, { type: 'lightning', color: '#A78BFA', count: 1, duration: 500, intensity: 0.4 }] },
                during: { sound: { frequency: 350, duration: 0.08, type: 'sawtooth', volume: 0.3 }, visual: { type: 'sparkles', color: '#C084FC', count: 5, duration: 900, intensity: 0.4 } },
                stop: { sound: [{ sweep: { from: 800, to: 200 }, duration: 0.4, type: 'sawtooth', volume: 0.5 }, { noise: 'thunder-roll', duration: 1.6, volume: 0.35, delay: 0.3 }], visual: [{ type: 'lightning', color: '#8B5CF6', count: 2, duration: 700, intensity: 0.7 }, { type: 'shake', intensity: 0.3, duration: 300 }] },
                // The storm builds while it transcribes — distant rolling thunder + rain
                process: { sound: { noise: 'thunder-roll', duration: 2.8, volume: 0.55 }, visual: [{ type: 'rain', color: '#93C5FD', count: 20, duration: 2400, intensity: 0.6 }, { type: 'sparkles', color: '#C084FC', count: 8, duration: 1500, intensity: 0.5 }] },
                warning: { sound: [{ frequency: 800, duration: 0.12, type: 'sawtooth', volume: 0.7 }, { frequency: 600, duration: 0.15, type: 'sawtooth', volume: 0.7, delay: 0.15 }], visual: { type: 'lightning', color: '#F87171', count: 1, duration: 500, intensity: 0.6 } },
                // Paste = the strike: instant CRACK, megabolts, then the rumble rolls away
                paste: { sound: [{ noise: 'thunder-crack', duration: 1.4, volume: 0.75 }, { noise: 'thunder-roll', duration: 2.4, volume: 0.45, delay: 0.5 }], visual: [{ type: 'lightning', color: '#A78BFA', count: 4, duration: 1100, intensity: 1.0 }, { type: 'rain', color: '#93C5FD', count: 26, duration: 2000, intensity: 0.7 }, { type: 'sparkles', color: '#C084FC', count: 22, duration: 1800, intensity: 0.8 }, { type: 'fireworks', color: '#8B5CF6', count: 3, duration: 1500, intensity: 0.8 }] }
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
                paste: { sound: [{ frequency: 440, duration: 0.15, type: 'square', volume: 0.6 }, { frequency: 554, duration: 0.15, type: 'square', volume: 0.6, delay: 0.15 }, { frequency: 659, duration: 0.25, type: 'square', volume: 0.7, delay: 0.3 }], visual: { type: 'fireworks', color: '#F59E0B', count: 4, duration: 1500, intensity: 0.8 } }
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
                paste: { sound: [{ frequency: 784, duration: 0.1, type: 'sine', volume: 0.5 }, { frequency: 988, duration: 0.08, type: 'sine', volume: 0.45, delay: 0.1 }, { frequency: 1175, duration: 0.12, type: 'sine', volume: 0.4, delay: 0.18 }, { frequency: 784, duration: 0.2, type: 'sine', volume: 0.35, delay: 0.3 }], visual: { type: 'sparkles', color: '#F9A8D4', count: 14, duration: 1800, intensity: 0.7 } }
            }
        });

        // Valhalla — war horns, shield drums, a berserker roar on paste
        this._registerPack({
            id: 'valhalla', name: '🛡️ Valhalla', category: 'epic',
            description: 'War horns and shield-drums — a raiding party on paste',
            intensityNames: ['🛶 Raider', '🪓 Berserker', '⚔️ Valhalla'],
            hooks: {
                start: { sound: [{ sweep: { from: 98, to: 147 }, duration: 0.8, type: 'sawtooth', volume: 0.55 }, { noise: 'drum', volume: 0.6, delay: 0.1 }], visual: { type: 'border-glow', color: '#B45309', duration: 700, intensity: 0.5 } },
                during: { sound: { noise: 'drum', volume: 0.35, duration: 0.2 }, visual: { type: 'border-glow', color: '#B45309', duration: 350, intensity: 0.15 } },
                stop: { sound: [{ noise: 'drum', volume: 0.6 }, { noise: 'drum', volume: 0.6, delay: 0.22 }, { sweep: { from: 147, to: 98 }, duration: 0.6, type: 'sawtooth', volume: 0.5, delay: 0.4 }], visual: [{ type: 'shake', intensity: 0.35, duration: 300 }, { type: 'border-glow', color: '#D97706', duration: 600 }] },
                process: { sound: [{ noise: 'drum', volume: 0.45 }, { noise: 'drum', volume: 0.45, delay: 0.3 }, { noise: 'drum', volume: 0.5, delay: 0.6 }, { noise: 'drum', volume: 0.5, delay: 0.9 }], visual: { type: 'border-glow', color: '#F59E0B', duration: 1400, intensity: 0.4 } },
                warning: { sound: [{ sweep: { from: 196, to: 147 }, duration: 0.4, type: 'sawtooth', volume: 0.7 }], visual: { type: 'flash', color: '#F87171', duration: 300, intensity: 0.5 } },
                paste: { sound: [{ sweep: { from: 98, to: 196 }, duration: 0.9, type: 'sawtooth', volume: 0.65 }, { noise: 'drum', volume: 0.7, delay: 0.15 }, { noise: 'drum', volume: 0.7, delay: 0.45 }, { noise: 'crowd', duration: 1.8, volume: 0.5, delay: 0.6 }], visual: [{ type: 'shake', intensity: 0.5, duration: 400 }, { type: 'fireworks', color: '#F59E0B', count: 3, duration: 1400, intensity: 0.8 }, { type: 'confetti', count: 18, duration: 1600, intensity: 0.7 }] }
            }
        });

        // Arcade — pure chiptune; square waves ARE the genre
        this._registerPack({
            id: 'arcade', name: '🕹️ Arcade', category: 'gamer',
            description: '8-bit blips with a level-up fanfare on paste',
            intensityNames: ['🎮 Casual', '🕹️ Pro Gamer', '👾 High Score'],
            hooks: {
                start: { sound: [{ frequency: 523, duration: 0.06, type: 'square', volume: 0.5 }, { frequency: 784, duration: 0.08, type: 'square', volume: 0.5, delay: 0.07 }], visual: { type: 'flash', color: '#22D3EE', duration: 200, intensity: 0.4 } },
                during: { sound: { frequency: 659, duration: 0.04, type: 'square', volume: 0.3 }, visual: { type: 'border-glow', color: '#22D3EE', duration: 300, intensity: 0.15 } },
                stop: { sound: [{ frequency: 784, duration: 0.06, type: 'square', volume: 0.5 }, { frequency: 523, duration: 0.09, type: 'square', volume: 0.5, delay: 0.08 }], visual: { type: 'border-glow', color: '#818CF8', duration: 500 } },
                process: { sound: [{ frequency: 440, duration: 0.05, type: 'square', volume: 0.35 }, { frequency: 494, duration: 0.05, type: 'square', volume: 0.35, delay: 0.1 }, { frequency: 523, duration: 0.05, type: 'square', volume: 0.35, delay: 0.2 }], visual: { type: 'sparkles', color: '#22D3EE', count: 8, duration: 1200, intensity: 0.5 } },
                warning: { sound: [{ frequency: 330, duration: 0.12, type: 'square', volume: 0.65 }, { frequency: 330, duration: 0.12, type: 'square', volume: 0.65, delay: 0.18 }], visual: { type: 'flash', color: '#F87171', duration: 250, intensity: 0.5 } },
                paste: { sound: [{ frequency: 523, duration: 0.09, type: 'square', volume: 0.55 }, { frequency: 659, duration: 0.09, type: 'square', volume: 0.55, delay: 0.1 }, { frequency: 784, duration: 0.09, type: 'square', volume: 0.55, delay: 0.2 }, { frequency: 1047, duration: 0.25, type: 'square', volume: 0.6, delay: 0.3 }], visual: [{ type: 'confetti', count: 26, duration: 1800, intensity: 0.8 }, { type: 'sparkles', color: '#22D3EE', count: 16, duration: 1500, intensity: 0.7 }] }
            }
        });

        // Colosseum — the crowd is the instrument
        this._registerPack({
            id: 'colosseum', name: '🏛️ Colosseum', category: 'epic',
            description: 'Murmuring crowd, clashing steel, an eruption on paste',
            intensityNames: ['🌾 Plebeian', '🛡️ Centurion', '👑 Emperor'],
            hooks: {
                start: { sound: [{ sweep: { from: 220, to: 330 }, duration: 0.5, type: 'sawtooth', volume: 0.5 }], visual: { type: 'border-glow', color: '#D4A574', duration: 600, intensity: 0.5 } },
                during: { sound: { noise: 'crowd', duration: 0.8, volume: 0.15 }, visual: { type: 'border-glow', color: '#D4A574', duration: 400, intensity: 0.12 } },
                stop: { sound: [{ frequency: 1319, duration: 0.08, type: 'triangle', volume: 0.5 }, { frequency: 988, duration: 0.1, type: 'triangle', volume: 0.45, delay: 0.09 }], visual: { type: 'flash', color: '#FDE68A', duration: 300, intensity: 0.4 } },
                process: { sound: { noise: 'crowd', duration: 2.2, volume: 0.35 }, visual: { type: 'particles', color: '#D4A574', count: 12, duration: 1600, intensity: 0.5 } },
                warning: { sound: [{ sweep: { from: 330, to: 262 }, duration: 0.35, type: 'sawtooth', volume: 0.65 }], visual: { type: 'flash', color: '#F87171', duration: 300, intensity: 0.5 } },
                paste: { sound: [{ noise: 'crowd', duration: 2.6, volume: 0.65 }, { sweep: { from: 262, to: 392 }, duration: 0.7, type: 'sawtooth', volume: 0.5, delay: 0.2 }, { noise: 'drum', volume: 0.6, delay: 0.5 }], visual: [{ type: 'fireworks', color: '#FDE68A', count: 4, duration: 1500, intensity: 0.8 }, { type: 'confetti', count: 22, duration: 1800, intensity: 0.8 }, { type: 'shake', intensity: 0.4, duration: 350 }] }
            }
        });

        // Zen Garden — the calm end of the spectrum, so maximalism stays a choice
        this._registerPack({
            id: 'zen-garden', name: '🧘 Zen Garden', category: 'calm',
            description: 'Chimes and water — barely-there cues, a soft bloom on paste',
            intensityNames: ['🍃 Breeze', '🧘 Zen', '🌸 Bloom'],
            hooks: {
                start: { sound: { frequency: 880, duration: 0.5, type: 'sine', volume: 0.35 }, visual: { type: 'border-glow', color: '#6EE7B7', duration: 800, intensity: 0.3 } },
                during: { sound: { frequency: 1320, duration: 0.15, type: 'sine', volume: 0.15 }, visual: null },
                stop: { sound: [{ frequency: 880, duration: 0.4, type: 'sine', volume: 0.3 }, { frequency: 660, duration: 0.5, type: 'sine', volume: 0.25, delay: 0.3 }], visual: { type: 'border-glow', color: '#6EE7B7', duration: 700, intensity: 0.25 } },
                process: { sound: { noise: 'whoosh', duration: 1.2, volume: 0.2 }, visual: { type: 'particles', color: '#A7F3D0', count: 6, duration: 2000, intensity: 0.3 } },
                warning: { sound: [{ frequency: 660, duration: 0.3, type: 'sine', volume: 0.4 }, { frequency: 660, duration: 0.3, type: 'sine', volume: 0.4, delay: 0.4 }], visual: { type: 'border-glow', color: '#FCA5A5', duration: 500, intensity: 0.3 } },
                paste: { sound: [{ frequency: 880, duration: 0.3, type: 'sine', volume: 0.35 }, { frequency: 1109, duration: 0.3, type: 'sine', volume: 0.3, delay: 0.2 }, { frequency: 1319, duration: 0.5, type: 'sine', volume: 0.25, delay: 0.4 }], visual: { type: 'sparkles', color: '#A7F3D0', count: 10, duration: 1600, intensity: 0.4 } }
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

    // The "🔔 Default" button — a true RESET to the friendly all-on audible default.
    // Re-enables all 6 hooks, restores the Classic pack, bumps the master, and clears any
    // previously-muted/quieted state in one click (the legacy Default button only set a
    // broken mode and never touched the hooks).
    resetToDefaults() {
        this._mode = 'default';
        this._activePackId = 'classic-beep';
        this._activePack = this._packs['classic-beep'] || null;
        this._hookPoints = {
            start: { enabled: true, volume: 90 },
            during: { enabled: true, volume: 70 },
            stop: { enabled: true, volume: 90 },
            process: { enabled: true, volume: 75 },
            warning: { enabled: true, volume: 85 },
            paste: { enabled: true, volume: 100 },
        };
        this._visualHooks = {
            start: 'auto', during: 'auto', stop: 'auto',
            process: 'auto', warning: 'auto', paste: 'auto'
        };
        this.sound.setMasterVolume(0.85);
        try { localStorage.setItem('windy_sfxVolume', '85'); } catch (_) { /* best-effort */ }
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

    // ── Visual Hook Overrides ──

    getVisualLibrary() {
        return VISUAL_LIBRARY;
    }

    /**
     * Set the visual for a hook: 'auto' (pack default), 'none', or a VISUAL_LIBRARY id.
     */
    setVisualHook(hook, value) {
        if (this._visualHooks[hook] === undefined) return;
        const valid = value === 'auto' || value === 'none' || VISUAL_LIBRARY.some(v => v.id === value);
        if (!valid) return;
        this._visualHooks[hook] = value;
        this._saveSettings();
    }

    /**
     * Preview a visual effect at full intensity (for Settings UI).
     * @param {string|null} effectId - VISUAL_LIBRARY id, or null to preview the
     *                                 active pack's visual for the given hook.
     * @param {string} hook - hook key (used when effectId is null)
     */
    previewVisual(effectId, hook) {
        try {
            if (!effectId) {
                const hookDef = this._activePack?.hooks?.[hook];
                const list = hookDef?.visual ? (Array.isArray(hookDef.visual) ? hookDef.visual : [hookDef.visual]) : [];
                for (const vis of list) this.visual.renderEffect(vis.type, vis);
                return;
            }
            const entry = VISUAL_LIBRARY.find(v => v.id === effectId);
            if (entry) this.visual.renderEffect(entry.id, entry.defaults?._all || {});
        } catch (_) { /* effects must never break the app */ }
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
        if (this._mode === 'silent') return; // 'default' is normalized to 'single' on load — never silence it

        const hp = this._hookPoints[hook];
        if (!hp || !hp.enabled) { console.debug(`[EffectsEngine] Hook ${hook} skipped: hp=${!!hp}, enabled=${hp?.enabled}`); return; }

        // Hook-point volume (0-100 → 0-1)
        const hookVolMul = hp.volume / 100;

        // ── Linear dynamic scaling (I4) ──
        // Bigger recordings = bigger effects, as a smooth linear ramp instead of
        // the old 3-step function. wordCount is exact (paste); durationSec is the
        // proxy for stop/process where the transcript isn't known yet (~2.2 words/s).
        // 300+ words ≈ full storm; floor of 0.15 keeps short tests visible.
        let intensity = 1.0;
        if (this._dynamicScaling && (hook === 'paste' || hook === 'stop' || hook === 'process')) {
            const words = (typeof metadata.wordCount === 'number' && metadata.wordCount > 0)
                ? metadata.wordCount
                : ((typeof metadata.durationSec === 'number' && metadata.durationSec > 0) ? metadata.durationSec * 2.2 : null);
            if (words !== null) intensity = Math.max(0.15, Math.min(1, 0.15 + words / 300));
        }


        // ── Per-hook sound override (the "— Pack default —" dropdowns) ──
        // Honored in EVERY non-silent mode, mirroring the visual dropdowns:
        // a set dropdown replaces the pack's sound for that stage; unset falls
        // through to the pack default. Custom mode has no pack, so unset there
        // simply plays no sound (visuals still render either way — an unset
        // custom hook used to skip visuals too, which contradicted the
        // "visual overrides work in all modes" contract).
        let soundOverridePlayed = false;
        try {
            const customCfg = JSON.parse(localStorage.getItem('windy_customSounds') || '{}');
            soundOverridePlayed = this._playSoundOverride(customCfg[hook], hookVolMul * Math.min(1, intensity));
        } catch (e) { console.error('[EffectsEngine] Sound override error:', e); }

        if (this._mode === 'custom' || soundOverridePlayed) {
            this._renderHookVisual(hook, intensity);
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

        const hookDef = pack?.hooks?.[hook];

        // Play sound (intensity computed above — linear scaling)
        if (hookDef?.sound) {
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

        // Show visual (honors per-hook user override; works even with no pack)
        this._renderHookVisual(hook, intensity);
    }

    /**
     * Play a user-selected per-hook sound override (shuffle / library / legacy
     * file / stock). Returns true if a sound was (or will be) played.
     */
    _playSoundOverride(hookCfg, volMul) {
        if (!hookCfg) return false;
        if (hookCfg.type === 'shuffle') {
            const lib = JSON.parse(localStorage.getItem('windy_soundLibrary') || '[]');
            const pool = hookCfg.pool === 'all' ? lib : lib.filter(s => s.starred !== false);
            if (pool.length === 0) return false;
            const pick = pool[Math.floor(Math.random() * pool.length)];
            if (!pick?.dataUrl) return false;
            this.sound.playAudioFile(pick.dataUrl, volMul);
            return true;
        }
        if (hookCfg.type === 'library' && hookCfg.libId) {
            const lib = JSON.parse(localStorage.getItem('windy_soundLibrary') || '[]');
            const entry = lib.find(s => s.id === hookCfg.libId);
            if (!entry?.dataUrl) return false;
            this.sound.playAudioFile(entry.dataUrl, volMul);
            return true;
        }
        if (hookCfg.type === 'file' && hookCfg.dataUrl) {
            this.sound.playAudioFile(hookCfg.dataUrl, volMul);
            return true;
        }
        if (hookCfg.type === 'stock' && hookCfg.packId && hookCfg.hook) {
            const hookDef = this._packs[hookCfg.packId]?.hooks?.[hookCfg.hook];
            if (!hookDef?.sound) return false;
            if (Array.isArray(hookDef.sound)) {
                this.sound.playSequence(hookDef.sound.map(t => ({ ...t, volume: (t.volume || 0.3) * volMul })));
            } else {
                this.sound.playTone({ ...hookDef.sound, volume: (hookDef.sound.volume || 0.3) * volMul });
            }
            return true;
        }
        return false;
    }

    /**
     * Preview the ACTIVE pack as configured: cycle the real stages through the
     * real trigger pipeline (pack + per-stage overrides + intensity + canvas),
     * so what previews is exactly what the user will get — on whichever canvas
     * they chose. Wired to pack cards, canvas pills, and Preview Sounds.
     */
    previewPackCycle() {
        const seq = [['start', 0], ['during', 700], ['stop', 1500], ['process', 2300], ['paste', 3700]];
        for (const [hook, ms] of seq) {
            setTimeout(() => { try { this.trigger(hook, { wordCount: 300 }); } catch (_) { } }, ms);
        }
    }

    // ── Visual-intensity slider ──

    getIntensityValue() { return this._visualIntensity; }

    setIntensityValue(value) {
        const v = Number(value);
        if (!Number.isFinite(v)) return;
        this._visualIntensity = Math.max(0, Math.min(100, v));
        this._saveSettings();
    }

    /** Zone names for the slider, themed by the active pack when it provides them. */
    getIntensityNames() {
        const names = this._activePack?.intensityNames;
        return (Array.isArray(names) && names.length === 3) ? names : INTENSITY_DEFAULT_NAMES;
    }

    /** The themed zone name for a slider value (thirds). */
    getIntensityZoneName(value = this._visualIntensity) {
        const names = this.getIntensityNames();
        return value < 34 ? names[0] : (value < 67 ? names[1] : names[2]);
    }

    /**
     * Route a visual to the user's chosen canvas: the app window, the
     * whole-screen overlay window (via main), or both. Whole screen is the
     * default on mac/win — effects shouldn't die because the app is hidden
     * behind the window being dictated into. Linux defaults to app-window
     * (Wayland overlay windows risk focus steals — see WAYLAND guide).
     */
    renderVisual(type, opts = {}) {
        let canvas = localStorage.getItem('windy_fxCanvas');
        if (!canvas) canvas = /Mac|Win/i.test(navigator.platform) ? 'screen' : 'app';
        const canForward = !!(window.windyAPI && window.windyAPI.fxOverlayRender);
        if ((canvas === 'screen' || canvas === 'both') && !canForward && !this._warnedNoOverlay) {
            // Once per session — diagnosable from the main-process log relay
            this._warnedNoOverlay = true;
            console.warn('[Effects] whole-screen canvas selected but overlay bridge missing — rendering app-only');
        }
        if ((canvas === 'screen' || canvas === 'both') && canForward) {
            try { window.windyAPI.fxOverlayRender(type, opts); } catch (e) { console.warn('[Effects] overlay forward failed:', e.message); }
        }
        if (canvas === 'app' || canvas === 'both' || !canForward) {
            this.visual.renderEffect(type, opts);
        }
    }

    /**
     * Resolve and render the visual(s) for a hook, honoring the user's per-hook
     * override ('auto' | 'none' | VISUAL_LIBRARY id) and scaling with intensity.
     * Pack visuals may be a single {type,...} object or an ARRAY of them (combos).
     */
    _renderHookVisual(hook, intensity = 1.0) {
        try {
            const override = this._visualHooks?.[hook] || 'auto';
            if (override === 'none') return;

            let visuals = null;
            if (override === 'auto') {
                visuals = this._activePack?.hooks?.[hook]?.visual || null;
            } else {
                const entry = VISUAL_LIBRARY.find(v => v.id === override);
                if (entry) visuals = { type: entry.id, ...(entry.defaults?._all || {}) };
            }
            if (!visuals) return;

            const list = Array.isArray(visuals) ? visuals : [visuals];
            // Word-count ramp × the visual-intensity slider (0.4×–1.6×)
            const vMul = intensity * intensityMul(this._visualIntensity);
            for (const vis of list) {
                this.renderVisual(vis.type, {
                    color: vis.color,
                    intensity: (vis.intensity || 0.5) * vMul,
                    duration: vis.duration || 500,
                    count: vis.count ? Math.max(1, Math.round(vis.count * vMul)) : undefined
                });
            }
        } catch (_) { /* effects must never break the app */ }
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
            const list = Array.isArray(hookDef.visual) ? hookDef.visual : [hookDef.visual];
            for (const vis of list) this.renderVisual(vis.type, vis);
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
