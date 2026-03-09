/**
 * Windy Pro — Widget Engine (Strand I1)
 * 
 * Replaces the hardcoded tornado with a selectable widget system.
 * 6 stock widgets (SVG/CSS) + custom uploaded images.
 * Voice-reactive animation via read-only tap on existing AnalyserNode.
 * 
 * DNA Strand: I1 (Widget Engine)
 */

class WidgetEngine {
    constructor() {
        this._currentWidget = 'tornado';
        this._customPath = null;
        this._size = parseInt(localStorage.getItem('windy_tornadoSize') || '56', 10);
        this._container = null;
        this._state = 'idle'; // idle, recording, processing, error, injecting
        this._animFrame = null;
        this._analyser = null;

        this._loadSettings();
    }

    _loadSettings() {
        try {
            const saved = localStorage.getItem('windy_widget');
            if (saved) {
                const s = JSON.parse(saved);
                this._currentWidget = s.id || 'tornado';
                this._customPath = s.customPath || null;
            }
        } catch (_) { }
    }

    _saveSettings() {
        try {
            localStorage.setItem('windy_widget', JSON.stringify({
                id: this._currentWidget,
                customPath: this._customPath
            }));
        } catch (_) { }
    }

    // ── Stock Widget SVGs ──

    static STOCK_WIDGETS = {
        tornado: {
            name: '🌪️ Tornado',
            description: 'Classic tornado animation',
            svg: `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 16 Q32 8 52 16" stroke="currentColor" stroke-width="3" stroke-linecap="round" opacity="0.9">
          <animate attributeName="d" values="M12 16 Q32 8 52 16;M14 16 Q32 12 50 16;M12 16 Q32 8 52 16" dur="2s" repeatCount="indefinite"/>
        </path>
        <path d="M16 26 Q32 18 48 26" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" opacity="0.75">
          <animate attributeName="d" values="M16 26 Q32 18 48 26;M18 26 Q32 22 46 26;M16 26 Q32 18 48 26" dur="1.8s" repeatCount="indefinite"/>
        </path>
        <path d="M20 36 Q32 28 44 36" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.6">
          <animate attributeName="d" values="M20 36 Q32 28 44 36;M22 36 Q32 32 42 36;M20 36 Q32 28 44 36" dur="1.5s" repeatCount="indefinite"/>
        </path>
        <path d="M26 46 Q32 40 38 46" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.45">
          <animate attributeName="d" values="M26 46 Q32 40 38 46;M27 46 Q32 43 37 46;M26 46 Q32 40 38 46" dur="1.2s" repeatCount="indefinite"/>
        </path>
        <circle cx="32" cy="54" r="2" fill="currentColor" opacity="0.3"/>
      </svg>`
        },

        strobe: {
            name: '💚 Green Strobe',
            description: 'Pulsing green circle — matches website branding',
            svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <circle cx="32" cy="32" r="20" fill="#22C55E" opacity="0.2">
          <animate attributeName="r" values="16;22;16" dur="1.5s" repeatCount="indefinite"/>
          <animate attributeName="opacity" values="0.15;0.35;0.15" dur="1.5s" repeatCount="indefinite"/>
        </circle>
        <circle cx="32" cy="32" r="12" fill="#22C55E" opacity="0.5">
          <animate attributeName="r" values="10;14;10" dur="1.5s" repeatCount="indefinite"/>
          <animate attributeName="opacity" values="0.4;0.7;0.4" dur="1.5s" repeatCount="indefinite"/>
        </circle>
        <circle cx="32" cy="32" r="6" fill="#22C55E" opacity="0.9"/>
      </svg>`
        },

        lightning: {
            name: '⚡ Lightning Bolt',
            description: 'Crackles with voice energy',
            svg: `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <polygon points="36,4 18,36 28,36 22,60 46,24 34,24" fill="#FBBF24" opacity="0.9">
          <animate attributeName="opacity" values="0.9;1;0.7;1;0.9" dur="0.8s" repeatCount="indefinite"/>
        </polygon>
        <polygon points="36,4 18,36 28,36 22,60 46,24 34,24" fill="none" stroke="#F59E0B" stroke-width="1" opacity="0.5"/>
      </svg>`
        },

        logo: {
            name: '🌀 Windy Pro Logo',
            description: 'Professional brand mark',
            svg: `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="32" cy="32" r="26" stroke="currentColor" stroke-width="2" opacity="0.3"/>
        <path d="M20 32 Q26 18 32 24 Q38 30 32 32 Q26 34 38 40 Q44 46 44 32" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" fill="none">
          <animate attributeName="stroke-dashoffset" from="100" to="0" dur="3s" repeatCount="indefinite"/>
        </path>
        <text x="32" y="56" text-anchor="middle" fill="currentColor" font-size="7" font-family="sans-serif" font-weight="700" opacity="0.5">WP</text>
      </svg>`
        },

        compass: {
            name: '🧭 Compass',
            description: 'Spins during recording, points north on stop',
            svg: `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="32" cy="32" r="26" stroke="currentColor" stroke-width="1.5" opacity="0.3"/>
        <circle cx="32" cy="32" r="22" stroke="currentColor" stroke-width="0.5" opacity="0.2"/>
        <polygon points="32,10 35,30 32,34 29,30" fill="#EF4444" opacity="0.9"/>
        <polygon points="32,54 35,34 32,30 29,34" fill="currentColor" opacity="0.4"/>
        <circle cx="32" cy="32" r="3" fill="currentColor" opacity="0.6"/>
        <text x="32" y="8" text-anchor="middle" fill="currentColor" font-size="5" opacity="0.4">N</text>
      </svg>`
        },

        soundwave: {
            name: '〰️ Sound Wave',
            description: 'Real-time waveform visualization',
            svg: `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <line x1="10" y1="32" x2="10" y2="32" stroke="#22C55E" stroke-width="3" stroke-linecap="round">
          <animate attributeName="y1" values="28;22;28" dur="0.8s" repeatCount="indefinite"/>
          <animate attributeName="y2" values="36;42;36" dur="0.8s" repeatCount="indefinite"/>
        </line>
        <line x1="18" y1="32" x2="18" y2="32" stroke="#22C55E" stroke-width="3" stroke-linecap="round">
          <animate attributeName="y1" values="24;16;24" dur="0.6s" repeatCount="indefinite"/>
          <animate attributeName="y2" values="40;48;40" dur="0.6s" repeatCount="indefinite"/>
        </line>
        <line x1="26" y1="32" x2="26" y2="32" stroke="#22C55E" stroke-width="3" stroke-linecap="round">
          <animate attributeName="y1" values="20;10;20" dur="0.7s" repeatCount="indefinite"/>
          <animate attributeName="y2" values="44;54;44" dur="0.7s" repeatCount="indefinite"/>
        </line>
        <line x1="34" y1="32" x2="34" y2="32" stroke="#22C55E" stroke-width="3" stroke-linecap="round">
          <animate attributeName="y1" values="18;8;18" dur="0.5s" repeatCount="indefinite"/>
          <animate attributeName="y2" values="46;56;46" dur="0.5s" repeatCount="indefinite"/>
        </line>
        <line x1="42" y1="32" x2="42" y2="32" stroke="#22C55E" stroke-width="3" stroke-linecap="round">
          <animate attributeName="y1" values="22;14;22" dur="0.65s" repeatCount="indefinite"/>
          <animate attributeName="y2" values="42;50;42" dur="0.65s" repeatCount="indefinite"/>
        </line>
        <line x1="50" y1="32" x2="50" y2="32" stroke="#22C55E" stroke-width="3" stroke-linecap="round">
          <animate attributeName="y1" values="26;20;26" dur="0.75s" repeatCount="indefinite"/>
          <animate attributeName="y2" values="38;44;38" dur="0.75s" repeatCount="indefinite"/>
        </line>
      </svg>`
        }
    };

    // ── Rendering ──

    setWidget(id, customPath) {
        this._currentWidget = id;
        this._customPath = customPath || null;
        this._saveSettings();
        this._render();
    }

    setSize(px) {
        this._size = px;
        if (this._container) {
            this._container.style.width = px + 'px';
            this._container.style.height = px + 'px';
        }
    }

    setState(state) {
        this._state = state;
        if (this._container) {
            this._container.dataset.state = state;
            // State color glow
            const glowColors = {
                recording: '0 0 15px rgba(34, 197, 94, 0.6)',
                processing: '0 0 15px rgba(245, 158, 11, 0.6)',
                error: '0 0 15px rgba(239, 68, 68, 0.6)',
                injecting: '0 0 15px rgba(59, 130, 246, 0.8)',
                idle: 'none'
            };
            this._container.style.filter = state === 'recording' ? 'drop-shadow(0 0 8px #22C55E)' : '';
            this._container.style.boxShadow = glowColors[state] || 'none';
        }
    }

    /**
     * Attach to existing AnalyserNode for voice-reactive animation (read-only)
     */
    setAnalyser(analyser) {
        this._analyser = analyser;
        if (analyser && !this._animFrame) {
            this._startVoiceReactive();
        }
    }

    _startVoiceReactive() {
        if (!this._analyser || !this._container) return;

        const data = new Uint8Array(this._analyser.frequencyBinCount);
        let lastUpdate = 0;

        const animate = (time) => {
            this._animFrame = requestAnimationFrame(animate);

            // Throttle to ~30fps
            if (time - lastUpdate < 33) return;
            lastUpdate = time;

            if (this._state !== 'recording') {
                this._container.style.transform = '';
                return;
            }

            this._analyser.getByteFrequencyData(data);
            const avg = data.reduce((sum, v) => sum + v, 0) / data.length;
            const level = avg / 255; // 0-1

            // Scale: 1.0 to 1.15
            const scale = 1 + level * 0.15;
            // Micro-rotation: ±3°
            const rotate = (Math.random() - 0.5) * level * 6;
            this._container.style.transform = `scale(${scale}) rotate(${rotate}deg)`;
        };

        this._animFrame = requestAnimationFrame(animate);
    }

    _stopVoiceReactive() {
        if (this._animFrame) {
            cancelAnimationFrame(this._animFrame);
            this._animFrame = null;
        }
        if (this._container) {
            this._container.style.transform = '';
        }
    }

    /**
     * Mount the widget into the existing widget container
     */
    mount(containerId) {
        this._container = document.getElementById(containerId);
        if (!this._container) return;
        this._render();
    }

    _render() {
        if (!this._container) return;

        this._container.style.width = this._size + 'px';
        this._container.style.height = this._size + 'px';
        this._container.style.transition = 'all 0.3s ease';
        this._container.style.borderRadius = '50%';

        if (this._customPath) {
            // Custom uploaded image
            this._container.innerHTML = `<img src="${this._customPath}" alt="Custom widget" style="width:100%;height:100%;object-fit:contain;border-radius:50%;">`;
        } else {
            const stock = WidgetEngine.STOCK_WIDGETS[this._currentWidget];
            if (stock) {
                this._container.innerHTML = stock.svg;
                // Make SVG fill container
                const svg = this._container.querySelector('svg');
                if (svg) {
                    svg.style.width = '100%';
                    svg.style.height = '100%';
                    svg.style.color = '#22C55E';
                }
            }
        }
    }

    getStockList() {
        return Object.entries(WidgetEngine.STOCK_WIDGETS).map(([id, w]) => ({
            id,
            name: w.name,
            description: w.description,
            svg: w.svg
        }));
    }

    getCurrentWidget() {
        return this._currentWidget;
    }

    destroy() {
        this._stopVoiceReactive();
    }
}
