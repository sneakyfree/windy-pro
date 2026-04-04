/**
 * FirstRunExperience — Multi-step welcome overlay for new users
 * Shows on first launch when localStorage('windy_first_run_complete') is not set.
 * Self-contained with inline styles.
 */
class FirstRunExperience {
  constructor(app) {
    this.app = app;
    this.currentStep = 1;
    this.totalSteps = 4;
    this.overlay = null;
    this.selectedModel = 'small';
    this.selectedModelName = 'Windy Lite';
    this.hardwareInfo = { cores: 0, ram: 0 };
    this.micStream = null;
    this.audioCtx = null;
    this.analyser = null;
    this.animFrame = null;
    this.micTestPassed = false;
  }

  show() {
    if (localStorage.getItem('windy_first_run_complete')) return;
    this._createOverlay();
    this._renderStep(1);
  }

  _createOverlay() {
    this.overlay = document.createElement('div');
    Object.assign(this.overlay.style, {
      position: 'fixed',
      top: '0', left: '0', right: '0', bottom: '0',
      zIndex: '99999',
      background: 'rgba(0, 0, 0, 0.85)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      opacity: '0',
      transition: 'opacity 0.3s ease'
    });

    this.card = document.createElement('div');
    Object.assign(this.card.style, {
      background: '#0F1219',
      border: '1px solid rgba(139, 92, 246, 0.3)',
      borderRadius: '16px',
      maxWidth: '480px',
      width: '90%',
      padding: '40px',
      boxShadow: '0 24px 80px rgba(0, 0, 0, 0.6), 0 0 60px rgba(139, 92, 246, 0.15)',
      color: '#E2E8F0',
      position: 'relative',
      transform: 'translateY(20px)',
      transition: 'transform 0.3s ease'
    });

    this.overlay.appendChild(this.card);
    document.body.appendChild(this.overlay);

    // Animate in
    requestAnimationFrame(() => {
      this.overlay.style.opacity = '1';
      this.card.style.transform = 'translateY(0)';
    });
  }

  _renderStep(step) {
    this.currentStep = step;
    this.card.innerHTML = '';

    // Progress dots
    const progress = document.createElement('div');
    Object.assign(progress.style, {
      display: 'flex', gap: '8px', justifyContent: 'center', marginBottom: '32px'
    });
    for (let i = 1; i <= this.totalSteps; i++) {
      const dot = document.createElement('div');
      Object.assign(dot.style, {
        width: i === step ? '24px' : '8px',
        height: '8px',
        borderRadius: '4px',
        background: i === step
          ? 'linear-gradient(135deg, #8B5CF6, #6366F1)'
          : i < step ? '#8B5CF6' : 'rgba(255,255,255,0.15)',
        transition: 'all 0.3s ease'
      });
      progress.appendChild(dot);
    }
    this.card.appendChild(progress);

    switch (step) {
      case 1: this._renderWelcome(); break;
      case 2: this._renderHardwareScan(); break;
      case 3: this._renderMicTest(); break;
      case 4: this._renderSummary(); break;
    }
  }

  _renderWelcome() {
    this.card.innerHTML += `
      <div style="text-align:center;">
        <div style="font-size:48px;margin-bottom:16px;">&#127786;&#65039;</div>
        <h1 style="font-size:24px;font-weight:700;margin:0 0 8px 0;color:#F8FAFC;">
          Welcome to Windy Word
        </h1>
        <p style="font-size:15px;color:#A78BFA;font-weight:600;margin:0 0 24px 0;">
          Stop typing through a straw.
        </p>
        <p style="font-size:14px;color:#94A3B8;line-height:1.7;margin:0 0 8px 0;">
          Your voice is the fastest input device you own.
        </p>
        <p style="font-size:14px;color:#94A3B8;line-height:1.7;margin:0 0 36px 0;">
          Windy Word turns your speech into text &mdash; instantly, privately, on your machine.
        </p>
      </div>
    `;
    this._addButton('Get Started \u2192', () => this._renderStep(2));
  }

  _renderHardwareScan() {
    const cores = navigator.hardwareConcurrency || 4;
    const ram = navigator.deviceMemory || null; // May be undefined in Electron

    this.hardwareInfo = { cores, ram };

    // Auto-select model based on hardware
    let model = 'small';
    let modelName = 'Windy Lite';

    if (ram !== null) {
      if (ram < 4 || cores < 4) {
        model = 'tiny'; modelName = 'Windy Nano';
      } else if (ram >= 4 && ram <= 8) {
        model = 'small'; modelName = 'Windy Lite';
      } else if (ram > 8 && ram <= 16) {
        model = 'base'; modelName = 'Windy Core';
      } else if (ram > 16) {
        model = 'medium'; modelName = 'Windy Edge';
      }
    } else {
      // No RAM info — use core count as heuristic
      if (cores < 4) {
        model = 'tiny'; modelName = 'Windy Nano';
      } else if (cores <= 6) {
        model = 'small'; modelName = 'Windy Lite';
      } else if (cores <= 10) {
        model = 'base'; modelName = 'Windy Core';
      } else {
        model = 'medium'; modelName = 'Windy Edge';
      }
    }

    this.selectedModel = model;
    this.selectedModelName = modelName;

    // GPU detection
    let gpuInfo = 'Checking...';
    const gpuEl = document.createElement('span');
    gpuEl.textContent = gpuInfo;

    if (navigator.gpu) {
      navigator.gpu.requestAdapter().then(adapter => {
        gpuEl.textContent = adapter ? 'GPU detected (WebGPU)' : 'No dedicated GPU found';
      }).catch(() => {
        gpuEl.textContent = 'GPU info unavailable';
      });
    } else {
      gpuEl.textContent = 'Standard graphics';
    }

    const ramDisplay = ram ? `${ram}GB RAM` : 'RAM info unavailable';

    this.card.innerHTML += `
      <div style="text-align:center;">
        <div style="font-size:36px;margin-bottom:12px;">&#128300;</div>
        <h2 style="font-size:20px;font-weight:700;margin:0 0 8px 0;color:#F8FAFC;">
          Hardware Scan
        </h2>
        <p style="font-size:13px;color:#64748B;margin:0 0 28px 0;">
          Finding the best engine for your machine
        </p>

        <div style="background:rgba(139,92,246,0.08);border:1px solid rgba(139,92,246,0.2);border-radius:12px;padding:20px;text-align:left;margin-bottom:24px;">
          <div style="display:flex;justify-content:space-between;margin-bottom:12px;">
            <span style="color:#94A3B8;font-size:13px;">CPU Cores</span>
            <span style="color:#E2E8F0;font-weight:600;font-size:13px;">${cores} cores</span>
          </div>
          <div style="display:flex;justify-content:space-between;margin-bottom:12px;">
            <span style="color:#94A3B8;font-size:13px;">Memory</span>
            <span style="color:#E2E8F0;font-weight:600;font-size:13px;">${ramDisplay}</span>
          </div>
          <div style="display:flex;justify-content:space-between;">
            <span style="color:#94A3B8;font-size:13px;">Graphics</span>
            <span id="frGpuInfo" style="color:#E2E8F0;font-weight:600;font-size:13px;"></span>
          </div>
        </div>

        <div style="background:linear-gradient(135deg,rgba(139,92,246,0.15),rgba(99,102,241,0.15));border:1px solid rgba(139,92,246,0.3);border-radius:12px;padding:16px;margin-bottom:8px;">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#A78BFA;margin-bottom:6px;">Recommended Engine</div>
          <div style="font-size:18px;font-weight:700;color:#F8FAFC;">${modelName}</div>
          <div style="font-size:12px;color:#94A3B8;margin-top:4px;">Model: ${model}</div>
        </div>
      </div>
    `;

    // Insert GPU info element
    const gpuSlot = this.card.querySelector('#frGpuInfo');
    if (gpuSlot) gpuSlot.appendChild(gpuEl);

    this._addButton('Continue \u2192', () => {
      // Save model selection
      localStorage.setItem('windy_model', this.selectedModel);
      if (window.windyAPI?.updateSettings) {
        window.windyAPI.updateSettings({ model: this.selectedModel });
      }
      this._renderStep(3);
    });
  }

  _renderMicTest() {
    this.micTestPassed = false;

    this.card.innerHTML += `
      <div style="text-align:center;">
        <div style="font-size:36px;margin-bottom:12px;">&#127908;</div>
        <h2 style="font-size:20px;font-weight:700;margin:0 0 8px 0;color:#F8FAFC;">
          Microphone Test
        </h2>
        <p style="font-size:14px;color:#94A3B8;margin:0 0 28px 0;">
          Say something to test your microphone
        </p>

        <div id="frMicStatus" style="margin-bottom:24px;">
          <div style="background:rgba(255,255,255,0.05);border-radius:8px;height:40px;overflow:hidden;position:relative;">
            <div id="frMicBar" style="
              height:100%;
              width:0%;
              background:linear-gradient(90deg,#8B5CF6,#6366F1,#818CF8);
              border-radius:8px;
              transition:width 0.1s ease;
            "></div>
            <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:12px;color:#94A3B8;" id="frMicLabel">
              Requesting microphone access...
            </div>
          </div>
        </div>

        <div id="frMicResult" style="min-height:32px;margin-bottom:16px;"></div>
      </div>
    `;

    const continueBtn = this._addButton('Continue \u2192', () => {
      this._stopMicTest();
      this._renderStep(4);
    });

    this._startMicTest();
  }

  async _startMicTest() {
    const bar = document.getElementById('frMicBar');
    const label = document.getElementById('frMicLabel');
    const result = document.getElementById('frMicResult');

    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (label) label.textContent = 'Listening...';

      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = this.audioCtx.createMediaStreamSource(this.micStream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 256;
      source.connect(this.analyser);

      const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
      let audioDetectedTime = 0;

      const tick = () => {
        if (!this.analyser) return;
        this.analyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        const pct = Math.min(100, (avg / 128) * 100);

        if (bar) bar.style.width = pct + '%';

        if (avg > 10) {
          audioDetectedTime += 1 / 60; // ~60fps
        }

        if (audioDetectedTime >= 3 && !this.micTestPassed) {
          this.micTestPassed = true;
          if (label) label.textContent = '';
          if (result) {
            result.innerHTML = '<span style="font-size:16px;color:#34D399;font-weight:600;">Your voice is working! &#9989;</span>';
          }
        }

        this.animFrame = requestAnimationFrame(tick);
      };

      this.animFrame = requestAnimationFrame(tick);
    } catch (err) {
      console.warn('[FirstRun] Mic access denied:', err.message);
      if (label) label.textContent = '';
      if (result) {
        result.innerHTML = `
          <span style="font-size:13px;color:#FBBF24;">
            Microphone not available &mdash; you can still use cloud transcription
          </span>
        `;
      }
    }
  }

  _stopMicTest() {
    if (this.animFrame) {
      cancelAnimationFrame(this.animFrame);
      this.animFrame = null;
    }
    if (this.analyser) {
      this.analyser.disconnect();
      this.analyser = null;
    }
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach(t => t.stop());
      this.micStream = null;
    }
  }

  _renderSummary() {
    const engine = localStorage.getItem('windy_engine') || 'local';
    const modeMap = { local: 'Local', cloud: 'Cloud', windytune: 'Auto (WindyTune)' };
    const mode = modeMap[engine] || engine;

    this.card.innerHTML += `
      <div style="text-align:center;">
        <div style="font-size:36px;margin-bottom:12px;">&#127881;</div>
        <h2 style="font-size:22px;font-weight:700;margin:0 0 8px 0;color:#F8FAFC;">
          You're all set!
        </h2>
        <p style="font-size:14px;color:#94A3B8;margin:0 0 28px 0;">
          Windy Word is ready to go
        </p>

        <div style="background:rgba(139,92,246,0.08);border:1px solid rgba(139,92,246,0.2);border-radius:12px;padding:20px;text-align:left;margin-bottom:24px;">
          <div style="display:flex;justify-content:space-between;margin-bottom:12px;">
            <span style="color:#94A3B8;font-size:13px;">Voice Engine</span>
            <span style="color:#E2E8F0;font-weight:600;font-size:13px;">${this.selectedModelName}</span>
          </div>
          <div style="display:flex;justify-content:space-between;">
            <span style="color:#94A3B8;font-size:13px;">Mode</span>
            <span style="color:#E2E8F0;font-weight:600;font-size:13px;">${mode}</span>
          </div>
        </div>

        <div style="background:rgba(99,102,241,0.08);border-radius:10px;padding:14px;margin-bottom:8px;">
          <span style="font-size:13px;color:#A78BFA;">
            &#128161; Tip: Open the Chat tab to talk to your AI agent
          </span>
        </div>
      </div>
    `;

    this._addButton('Start Using Windy Pro', () => {
      localStorage.setItem('windy_first_run_complete', 'true');
      this._dismiss();
    });
  }

  _addButton(label, onClick) {
    const btn = document.createElement('button');
    btn.textContent = label;
    Object.assign(btn.style, {
      display: 'block',
      width: '100%',
      padding: '14px 24px',
      marginTop: '24px',
      border: 'none',
      borderRadius: '10px',
      background: 'linear-gradient(135deg, #8B5CF6, #6366F1)',
      color: '#FFFFFF',
      fontSize: '15px',
      fontWeight: '600',
      cursor: 'pointer',
      fontFamily: 'inherit',
      transition: 'transform 0.15s ease, box-shadow 0.15s ease',
      boxShadow: '0 4px 16px rgba(139, 92, 246, 0.3)'
    });
    btn.addEventListener('mouseenter', () => {
      btn.style.transform = 'translateY(-1px)';
      btn.style.boxShadow = '0 6px 24px rgba(139, 92, 246, 0.45)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.transform = 'translateY(0)';
      btn.style.boxShadow = '0 4px 16px rgba(139, 92, 246, 0.3)';
    });
    btn.addEventListener('click', onClick);
    this.card.appendChild(btn);
    return btn;
  }

  _dismiss() {
    this._stopMicTest();
    if (this.overlay) {
      this.overlay.style.opacity = '0';
      this.card.style.transform = 'translateY(20px)';
      setTimeout(() => {
        if (this.overlay && this.overlay.parentNode) {
          this.overlay.parentNode.removeChild(this.overlay);
        }
        this.overlay = null;
        this.card = null;
      }, 300);
    }
  }
}
