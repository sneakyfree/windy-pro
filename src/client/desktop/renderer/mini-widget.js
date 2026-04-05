// ═══ Mini Widget — Voice-reactive animation + settings panel ═══
// THE GREEN STROBE NEVER LIES

const widget = document.getElementById('widget');
const glowRing = document.getElementById('glowRing');
const tornado = document.getElementById('tornado');
const panelContainer = document.getElementById('panelContainer');

let currentState = 'idle';
let animFrame = null;
let smoothLevel = 0;
let breathPhase = 0;
let lastVoiceLevelTime = 0;
let voiceLevelReceived = false;

// Persistent jitter position (Brownian walk)
let jitterX = 0, jitterY = 0;

// ═══ User-adjustable settings (loaded from main, persisted) ═══
let settings = {
  size: 56,
  restDrift: 15,      // 0-100
  voiceShake: 100,     // 0-200
  glowIntensity: 60,   // 0-100
  idleOpacity: 80,     // 20-100
  sensitivity: 50,     // 0-100
  glowColor: '#00FF88'
};

// ═══ Panel state ═══
let panelOpen = false;
let panelAutoHideTimer = null;

// ═══ Apply settings to CSS variables and animation params ═══
function applySettings() {
  const root = document.documentElement;
  root.style.setProperty('--widget-size', settings.size + 'px');
  root.style.setProperty('--glow-color', settings.glowColor);
  
  // Widget size
  widget.style.width = settings.size + 'px';
  widget.style.height = settings.size + 'px';
  
  // Idle opacity (only when not recording/processing)
  if (currentState === 'idle') {
    widget.style.opacity = (settings.idleOpacity / 100).toFixed(2);
  }

  // Update slider thumb colors
  document.querySelectorAll('input[type="range"]').forEach(el => {
    el.style.setProperty('--glow-color', settings.glowColor);
  });
}

// ═══ Parse glow color to RGB components ═══
function colorToRGB(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}

// ═══ IPC listeners ═══
if (window.windyMini) {
  // ── State changes ──
  window.windyMini.onStateChange((state) => {
    currentState = state;

    // Clear everything
    widget.className = 'widget';
    tornado.style.transform = '';
    tornado.style.filter = '';
    glowRing.style.boxShadow = 'none';
    glowRing.style.width = '80%';
    glowRing.style.height = '80%';
    widget.style.background = 'transparent';
    stopAnimation();

    if (state === 'recording') {
      widget.style.opacity = '1';
      widget.classList.add('jolt');
      setTimeout(() => {
        widget.classList.remove('jolt');
        widget.classList.add('recording');
        startVoiceAnimation();
      }, 250);
    } else if (state === 'processing') {
      widget.style.opacity = '1';
      widget.classList.add('processing');
    } else {
      // idle
      widget.style.opacity = (settings.idleOpacity / 100).toFixed(2);
    }
  });

  // ── Voice levels ──
  window.windyMini.onVoiceLevel((level) => {
    if (currentState !== 'recording') return;
    voiceLevelReceived = true;
    lastVoiceLevelTime = Date.now();
    smoothLevel += (level - smoothLevel) * 0.35;
  });

  // ── Resize ──
  window.windyMini.onResize((size) => {
    tornado.style.fontSize = Math.round(size * 0.5) + 'px';
  });

  // ── Widget change ──
  window.windyMini.onWidgetChange((data) => {
    if (data.type === 'stock' && data.svg) {
      tornado.innerHTML = '';
      tornado.style.fontSize = '0';
      const wrapper = document.createElement('div');
      wrapper.innerHTML = data.svg;
      wrapper.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;';
      const svg = wrapper.querySelector('svg');
      if (svg) {
        svg.style.width = '100%';
        svg.style.height = '100%';
        svg.style.color = settings.glowColor;
      }
      tornado.appendChild(wrapper);
      tornado.style.width = '100%';
      tornado.style.height = '100%';
    } else if (data.type === 'custom' && data.dataUrl) {
      tornado.innerHTML = '';
      tornado.style.fontSize = '0';
      const img = document.createElement('img');
      img.src = data.dataUrl;
      img.style.cssText = 'width:100%;height:100%;object-fit:contain;border-radius:50%;';
      tornado.appendChild(img);
      tornado.style.width = '100%';
      tornado.style.height = '100%';
    } else if (data.type === 'default') {
      tornado.innerHTML = '🌪️';
      tornado.style.fontSize = '';
      tornado.style.width = '';
      tornado.style.height = '';
    }
  });

  // ── Load saved settings ──
  window.windyMini.onLoadSettings((saved) => {
    if (saved) {
      Object.assign(settings, saved);
      syncSlidersFromSettings();
      applySettings();
    }
  });
}

// ═══ Voice-reactive animation loop ═══
function startVoiceAnimation() {
  smoothLevel = 0;
  breathPhase = 0;
  jitterX = 0;
  jitterY = 0;

  function frame() {
    if (currentState !== 'recording') return;

    // Derived multipliers from user settings
    const restMul = settings.restDrift / 100;        // 0.0 - 1.0
    const voiceMul = settings.voiceShake / 100;       // 0.0 - 2.0
    const glowMul = settings.glowIntensity / 100;     // 0.0 - 1.0
    const sensitivityThreshold = (100 - settings.sensitivity) / 2000; // lower = more sensitive

    let intensity = 0;
    let isSilent = true;

    if (voiceLevelReceived && (Date.now() - lastVoiceLevelTime < 1000)) {
      intensity = Math.min(smoothLevel * 2.5, 1.0);
      isSilent = smoothLevel < sensitivityThreshold;
    }

    // ── Jitter (Brownian random walk) ──
    const jitterForce = isSilent
      ? (0.05 * restMul)
      : ((0.8 + intensity * 3.5) * voiceMul);
    jitterX += (Math.random() - 0.5) * jitterForce;
    jitterY += (Math.random() - 0.5) * jitterForce;
    const springK = isSilent ? 0.12 : (0.18 + intensity * 0.1);
    jitterX *= (1 - springK);
    jitterY *= (1 - springK);

    // ── Scale ──
    breathPhase += isSilent ? 0.025 : 0.04;
    const breathComponent = Math.sin(breathPhase) * (isSilent ? 0.005 * restMul : 0.02 * voiceMul);
    const voiceScale = intensity * 0.12 * voiceMul;
    const sc = 1.0 + breathComponent + voiceScale;

    tornado.style.transform = `translate(${jitterX.toFixed(2)}px, ${jitterY.toFixed(2)}px) scale(${sc.toFixed(4)})`;

    // ── Glow color ──
    const c = colorToRGB(settings.glowColor);

    // ── Drop shadow on tornado/icon ──
    const shadowBlur = 3 + intensity * 18 * glowMul;
    const shadowAlpha = 0.15 + intensity * 0.6 * glowMul;
    tornado.style.filter = `drop-shadow(0 0 ${shadowBlur.toFixed(1)}px rgba(${c.r},${c.g},${c.b},${shadowAlpha.toFixed(3)}))`;

    // ── Circular expanding glow ring ──
    const ringSize = 75 + intensity * 55 * glowMul;
    glowRing.style.width = ringSize + '%';
    glowRing.style.height = ringSize + '%';

    const ringBlur = 6 + intensity * 20 * glowMul;
    const ringSpread = 2 + intensity * 10 * glowMul;
    const ringOpacity = 0.1 + intensity * 0.7 * glowMul;
    glowRing.style.boxShadow = `0 0 ${ringBlur.toFixed(0)}px ${ringSpread.toFixed(0)}px rgba(${c.r},${c.g},${c.b},${ringOpacity.toFixed(3)})`;

    // ── Background tint ──
    const bgAlpha = (0.03 + intensity * 0.12) * glowMul;
    widget.style.background = `radial-gradient(circle, rgba(${c.r},${c.g},${c.b},${bgAlpha.toFixed(3)}) 0%, transparent 65%)`;

    animFrame = requestAnimationFrame(frame);
  }
  animFrame = requestAnimationFrame(frame);
}

function stopAnimation() {
  if (animFrame) {
    cancelAnimationFrame(animFrame);
    animFrame = null;
  }
  smoothLevel = 0;
  breathPhase = 0;
  jitterX = 0;
  jitterY = 0;
  widget.style.background = 'transparent';
  glowRing.style.width = '80%';
  glowRing.style.height = '80%';
  glowRing.style.boxShadow = 'none';
  tornado.style.transform = '';
  tornado.style.filter = '';
}

// ═══ Preview mode — steady-state when panel is open ═══
// No cycling. Shows constant medium voice level so every slider
// instantly shows its effect. User can talk to test voice sliders.
let previewActive = false;
let previewPrevState = 'idle';

function startPreview() {
  if (previewActive) return;
  previewActive = true;
  // Save real state and pretend we're recording so the animation loop runs
  previewPrevState = currentState;
  currentState = 'recording';
  widget.className = 'widget recording';
  widget.style.opacity = '1';
  voiceLevelReceived = true;
  lastVoiceLevelTime = Date.now();
  startVoiceAnimation();
  // Continuously feed a medium voice level so all sliders show their effect.
  // Must be in the loop because startVoiceAnimation() resets smoothLevel to 0.
  function keepAlive() {
    if (!previewActive) return;
    smoothLevel = 0.3; // constant medium level — shows glow, jitter, etc.
    lastVoiceLevelTime = Date.now();
    requestAnimationFrame(keepAlive);
  }
  requestAnimationFrame(keepAlive);
}

function stopPreview() {
  if (!previewActive) return;
  previewActive = false;
  voiceLevelReceived = false;
  // Restore real state
  currentState = previewPrevState;
  if (currentState !== 'recording') {
    widget.className = 'widget';
    widget.style.opacity = (settings.idleOpacity / 100).toFixed(2);
    stopAnimation();
  }
}

// ═══ Panel toggle ═══
function togglePanel() {
  panelOpen = !panelOpen;
  panelContainer.classList.toggle('open', panelOpen);
  
  // Tell main process to resize window
  if (window.windyMini) {
    window.windyMini.togglePanel(panelOpen);
  }

  if (panelOpen) {
    resetPanelAutoHide();
    // Start preview if not already recording
    if (currentState !== 'recording') {
      startPreview();
    }
  } else {
    clearTimeout(panelAutoHideTimer);
    stopPreview();
  }
}

function resetPanelAutoHide() {
  clearTimeout(panelAutoHideTimer);
  panelAutoHideTimer = setTimeout(() => {
    if (panelOpen) {
      panelOpen = false;
      panelContainer.classList.remove('open');
      stopPreview();
      if (window.windyMini) window.windyMini.togglePanel(false);
    }
  }, 8000); // auto-hide after 8s of no interaction
}

// ═══ Slider wiring ═══
function syncSlidersFromSettings() {
  document.getElementById('sliderSize').value = settings.size;
  document.getElementById('sliderRest').value = settings.restDrift;
  document.getElementById('sliderVoice').value = settings.voiceShake;
  document.getElementById('sliderGlow').value = settings.glowIntensity;
  document.getElementById('sliderOpacity').value = settings.idleOpacity;
  document.getElementById('sliderSensitivity').value = settings.sensitivity;
  // Active color swatch
  document.querySelectorAll('.swatch').forEach(s => {
    s.classList.toggle('active', s.dataset.color === settings.glowColor);
  });
}

function saveAndApply() {
  applySettings();
  if (window.windyMini) {
    window.windyMini.saveWidgetSettings(settings);
  }
}

// Slider event listeners
document.getElementById('sliderSize').addEventListener('input', (e) => {
  settings.size = parseInt(e.target.value);
  saveAndApply();
  resetPanelAutoHide();
});
document.getElementById('sliderRest').addEventListener('input', (e) => {
  settings.restDrift = parseInt(e.target.value);
  saveAndApply();
  resetPanelAutoHide();
});
document.getElementById('sliderVoice').addEventListener('input', (e) => {
  settings.voiceShake = parseInt(e.target.value);
  saveAndApply();
  resetPanelAutoHide();
});
document.getElementById('sliderGlow').addEventListener('input', (e) => {
  settings.glowIntensity = parseInt(e.target.value);
  saveAndApply();
  resetPanelAutoHide();
});
document.getElementById('sliderOpacity').addEventListener('input', (e) => {
  settings.idleOpacity = parseInt(e.target.value);
  saveAndApply();
  resetPanelAutoHide();
  // Flash the widget at the idle opacity for 0.8s so user can preview it
  if (previewActive) {
    widget.style.opacity = (settings.idleOpacity / 100).toFixed(2);
    clearTimeout(window._opacityFlashTimer);
    window._opacityFlashTimer = setTimeout(() => {
      if (previewActive) widget.style.opacity = '1';
    }, 800);
  }
});
document.getElementById('sliderSensitivity').addEventListener('input', (e) => {
  settings.sensitivity = parseInt(e.target.value);
  saveAndApply();
  resetPanelAutoHide();
});

// Color swatches
document.querySelectorAll('.swatch').forEach(swatch => {
  swatch.addEventListener('click', (e) => {
    e.stopPropagation();
    settings.glowColor = swatch.dataset.color;
    document.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
    swatch.classList.add('active');
    saveAndApply();
    resetPanelAutoHide();
  });
});

// Prevent panel interactions from closing panel or dragging
document.getElementById('panel').addEventListener('mousedown', (e) => {
  e.stopPropagation();
});

// Save & Close button
document.getElementById('saveBtn').addEventListener('click', () => {
  saveAndApply();
  togglePanel(); // closes panel + stops preview
});

// ═══ Manual drag ═══
let isDragging = false;
let dragStartX = 0, dragStartY = 0;

widget.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  e.preventDefault();
  isDragging = true;
  dragStartX = e.screenX;
  dragStartY = e.screenY;
  widget.classList.add('dragging');
});

document.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  const dx = e.screenX - dragStartX;
  const dy = e.screenY - dragStartY;
  if (dx !== 0 || dy !== 0) {
    dragStartX = e.screenX;
    dragStartY = e.screenY;
    if (window.windyMini) window.windyMini.moveWindow(dx, dy);
  }
});

document.addEventListener('mouseup', () => {
  isDragging = false;
  widget.classList.remove('dragging');
});

// ═══ Right-click to open settings panel ═══
widget.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  togglePanel();
});

// Double-click to expand to main window
widget.addEventListener('dblclick', (e) => {
  e.preventDefault();
  // Close panel if open
  if (panelOpen) {
    panelOpen = false;
    panelContainer.classList.remove('open');
    if (window.windyMini) window.windyMini.togglePanel(false);
  }
  if (window.windyMini) window.windyMini.expandWindow();
});

// Initial apply
applySettings();
