const widget = document.getElementById('widget');
const glowRing = document.getElementById('glowRing');
const tornado = document.getElementById('tornado');
let currentState = 'idle';
let animFrame = null;
let smoothLevel = 0;
let breathPhase = 0;
let lastVoiceLevelTime = 0;
let voiceLevelReceived = false;

if (window.windyMini) {
  // ═══ State changes ═══
  window.windyMini.onStateChange((state) => {

    currentState = state;

    // Clear everything
    widget.className = 'widget';
    tornado.style.transform = '';
    tornado.style.filter = '';
    glowRing.style.boxShadow = 'none';
    stopAnimation();

    if (state === 'recording') {
      widget.classList.add('jolt');
      setTimeout(() => {
        widget.classList.remove('jolt');
        widget.classList.add('recording');
        startVoiceAnimation();
      }, 250);
    } else if (state === 'processing') {
      widget.classList.add('processing');
    }
  });

  // ═══ Voice levels ═══
  window.windyMini.onVoiceLevel((level) => {
    if (currentState !== 'recording') return;
    voiceLevelReceived = true;
    lastVoiceLevelTime = Date.now();
    smoothLevel += (level - smoothLevel) * 0.35;
  });

  // ═══ Resize ═══
  window.windyMini.onResize((size) => {
    tornado.style.fontSize = Math.round(size * 0.5) + 'px';
  });

  // ═══ Widget change ═══
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
        svg.style.color = '#22C55E';
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
      // Reset to original tornado emoji
      tornado.innerHTML = '🌪️';
      tornado.style.fontSize = '';
      tornado.style.width = '';
      tornado.style.height = '';
    }
  });
}

// ═══ Voice-reactive animation loop ═══
function startVoiceAnimation() {

  smoothLevel = 0;
  breathPhase = 0;

  function frame() {
    if (currentState !== 'recording') return;

    // If no voice level data in last 1 second, gentle breathing
    if (!voiceLevelReceived || (Date.now() - lastVoiceLevelTime > 1000)) {
      breathPhase += 0.03;
      const breathScale = 1.0 + Math.sin(breathPhase) * 0.015;
      tornado.style.transform = `scale(${breathScale})`;
      tornado.style.filter = 'drop-shadow(0 0 4px rgba(0,255,136,0.3))';
      glowRing.style.boxShadow = 'none';
      animFrame = requestAnimationFrame(frame);
      return;
    }

    const lv = smoothLevel;

    if (lv < 0.05) {
      breathPhase += 0.03;
      const breathScale = 1.0 + Math.sin(breathPhase) * 0.01;
      tornado.style.transform = `scale(${breathScale})`;
      tornado.style.filter = 'drop-shadow(0 0 2px rgba(0,255,136,0.15))';
      glowRing.style.boxShadow = 'none';
    } else {
      // Voice active: vibrate + scale + glow
      breathPhase = 0;
      const intensity = Math.min(lv * 2, 1.0);
      const jx = (Math.random() - 0.5) * intensity * 6;
      const jy = (Math.random() - 0.5) * intensity * 6;
      const sc = 1.0 + intensity * 0.1;

      tornado.style.transform = `translate(${jx}px, ${jy}px) scale(${sc})`;

      const glowBlur = 4 + intensity * 14;
      const glowOpacity = 0.2 + intensity * 0.8;
      tornado.style.filter = `drop-shadow(0 0 ${glowBlur}px rgba(0,255,136,${glowOpacity}))`;

      const ringBlur = 4 + intensity * 16;
      const ringSpread = intensity * 6;
      const ringOpacity = 0.15 + intensity * 0.6;
      glowRing.style.boxShadow = `0 0 ${ringBlur}px ${ringSpread}px rgba(0,255,136,${ringOpacity})`;
    }

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
}

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

// Double-click to expand
widget.addEventListener('dblclick', (e) => {
  e.preventDefault();
  if (window.windyMini) window.windyMini.expandWindow();
});
