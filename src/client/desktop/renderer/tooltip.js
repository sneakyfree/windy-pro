/**
 * Windy Tooltip — lightweight JS tooltip system.
 * Uses [data-tooltip] attributes. Appended to document.body
 * so it escapes all overflow:hidden containers.
 */
(function () {
  const el = document.createElement('div');
  el.className = 'windy-tooltip';
  document.body.appendChild(el);

  let showTimer = null;
  let current = null;

  function show(target) {
    const text = target.dataset.tooltip;
    if (!text) return;
    current = target;
    el.textContent = text;
    el.classList.add('visible');

    const r = target.getBoundingClientRect();
    const tipW = el.offsetWidth;
    const tipH = el.offsetHeight;
    const winW = window.innerWidth;

    // Default: centered above the element
    let left = r.left + r.width / 2 - tipW / 2;
    let top = r.top - tipH - 6;

    // If not enough room above, show below
    if (top < 4) {
      top = r.bottom + 6;
    }

    // Clamp horizontal so it doesn't overflow the window
    if (left < 4) left = 4;
    if (left + tipW > winW - 4) left = winW - tipW - 4;

    el.style.left = left + 'px';
    el.style.top = top + 'px';
  }

  function hide() {
    clearTimeout(showTimer);
    showTimer = null;
    current = null;
    el.classList.remove('visible');
  }

  document.addEventListener('mouseover', function (e) {
    const target = e.target.closest('[data-tooltip]');
    if (!target || target === current) return;
    hide();
    showTimer = setTimeout(function () { show(target); }, 300);
  });

  document.addEventListener('mouseout', function (e) {
    const target = e.target.closest('[data-tooltip]');
    if (target) hide();
  });

  // Hide on click or scroll
  document.addEventListener('mousedown', hide);
  document.addEventListener('scroll', hide, true);
})();
