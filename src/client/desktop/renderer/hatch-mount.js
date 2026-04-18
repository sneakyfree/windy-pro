/**
 * Wave 8 Grandma Ribbon — mount the Hatch-your-agent card on the home
 * placeholder and auto-start the ceremony if the installer opted in.
 *
 * Kept in a file (not inline in index.html) because the renderer CSP is
 * `script-src 'self'` — no unsafe-inline.
 */
(function () {
    if (typeof window.HatchCeremony !== 'function') return;
    const ceremony = new window.HatchCeremony();
    window.windyHatchCeremony = ceremony;
    const mount = document.getElementById('hatchCardMount');
    if (mount) ceremony.mountCard(mount);

    // If the installer wizard's "Hatch on launch" checkbox was checked,
    // auto-start the ceremony exactly once. The flag is marked "consumed"
    // after the first firing so we never auto-run again.
    try {
        const opt = localStorage.getItem('windy_hatch_on_launch');
        const alreadyHatched = !!localStorage.getItem('windy_agent_hatched_at');
        if (opt === 'yes' && !alreadyHatched) {
            setTimeout(() => ceremony.start(), 1200);
            localStorage.setItem('windy_hatch_on_launch', 'consumed');
        }
    } catch { /* localStorage disabled */ }
})();
