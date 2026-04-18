/**
 * Wave 8 — Grandma Ribbon ceremony.
 *
 * A self-contained home card + hatching overlay. Vanilla JS by convention
 * of this renderer (the codebase is not React); the module is organised as
 * a class so a future React port is a copy-paste, not a rewrite.
 *
 * UX beat-by-beat (see docs/bootcamp-demo.md):
 *   1. Card on home — "🪰 Hatch Your Agent". Big, friendly, one click.
 *   2. Click opens a full-screen overlay with the birth-certificate frame.
 *   3. POST /api/v1/agent/hatch opens an SSE stream. Each event flips a
 *      check mark from spinner → green tick.
 *   4. On certificate.ready we fill the birth-certificate fields.
 *   5. On ceremony.complete we swap in two big CTAs: "Talk to My Agent"
 *      (deep-links windychat://) and "Done".
 *
 * The overlay uses the same visual grammar as FirstRunExperience so the
 * two don't feel like they were built by different people.
 */
class HatchCeremony {
    constructor(opts = {}) {
        this.baseUrl = (opts.baseUrl || (window.API_CONFIG && window.API_CONFIG.baseUrl) || '').replace(/\/$/, '');
        this.getAuthToken = opts.getAuthToken || (() => localStorage.getItem('windy_access_token'));
        this.overlay = null;
        this.log = null;          // <ul> of ceremony events
        this.certFrame = null;
        this.ctaRow = null;
        this.abortController = null;
        this.stepsByType = {};     // type → { el, label }
        this.lastSeq = 0;
        this.passportNumber = null;
        this.dmRoomId = null;
        this.agentName = null;
    }

    // ─── Home card ─────────────────────────────────────────────
    //
    // Call once at app init. If the user has already hatched (a saved
    // session_id exists in localStorage) the card renders in "meet your
    // agent" mode instead of "hatch".
    mountCard(container) {
        if (!container) return;
        if (container.querySelector('.hatch-card')) return;

        const card = document.createElement('div');
        card.className = 'hatch-card';
        const alreadyHatched = !!localStorage.getItem('windy_agent_hatched_at');

        card.innerHTML = `
            <div class="hatch-card-art" aria-hidden="true">🪰</div>
            <div class="hatch-card-body">
                <div class="hatch-card-title">${alreadyHatched ? 'Your agent is ready' : 'Hatch Your Agent'}</div>
                <div class="hatch-card-sub">${alreadyHatched
                    ? 'Say hi — it already has an email, a chat room, and a passport.'
                    : 'In 60 seconds, your own AI agent is born. No API keys. No config.'}</div>
            </div>
            <button class="hatch-card-cta" type="button">${alreadyHatched ? 'Open' : 'Hatch'}</button>
        `;
        card.querySelector('.hatch-card-cta').addEventListener('click', () => {
            if (alreadyHatched) this._openExisting();
            else this.start();
        });
        container.prepend(card);
    }

    _openExisting() {
        // If we have a saved certificate, show it; otherwise just deep-link
        // to the DM room.
        const saved = this._loadSaved();
        if (saved && saved.certificate) {
            this._buildOverlay();
            this._hydrateFromSaved(saved);
            this._showCtas(saved.certificate);
        } else if (saved && saved.dm_room_id) {
            this._deepLinkChat(saved.dm_room_id);
        } else {
            this.start();
        }
    }

    _loadSaved() {
        try { return JSON.parse(localStorage.getItem('windy_agent_saved') || 'null'); }
        catch { return null; }
    }

    _saveState(partial) {
        const prev = this._loadSaved() || {};
        localStorage.setItem('windy_agent_saved', JSON.stringify({ ...prev, ...partial }));
    }

    _deepLinkChat(roomId) {
        // windychat:// custom scheme is registered by Windy Chat. If the
        // user hasn't installed it the browser will show its own "open
        // with…" prompt, which is the desired fallback.
        const url = `windychat://room/${encodeURIComponent(roomId)}`;
        try { window.open(url); } catch { /* some Electron configs block this */ }
    }

    // ─── Start the SSE ceremony ────────────────────────────────
    async start() {
        if (this.overlay) return; // already running
        this._buildOverlay();

        const token = this.getAuthToken();
        if (!token) {
            this._pushLog({ type: 'ceremony.failed', status: 'failed', label: 'You need to be signed in to hatch an agent.' });
            return;
        }
        const url = `${this.baseUrl}/api/v1/agent/hatch`;
        this.abortController = new AbortController();
        let resp;
        try {
            resp = await fetch(url, {
                method: 'POST',
                headers: {
                    'Accept': 'text/event-stream',
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({}),
                signal: this.abortController.signal,
            });
        } catch (err) {
            this._pushLog({ type: 'ceremony.failed', status: 'failed', label: `Could not reach Pro: ${err.message || err}` });
            return;
        }
        if (!resp.ok || !resp.body) {
            this._pushLog({ type: 'ceremony.failed', status: 'failed', label: `Pro returned ${resp.status}.` });
            return;
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        // eslint-disable-next-line no-constant-condition
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            // SSE frames are \n\n delimited. Keep the trailing partial.
            const frames = buf.split('\n\n');
            buf = frames.pop() || '';
            for (const frame of frames) this._onFrame(frame);
        }
    }

    _onFrame(frame) {
        if (!frame || frame.startsWith(':')) return;  // heartbeat
        const lines = frame.split('\n');
        let dataLine = '';
        for (const l of lines) if (l.startsWith('data: ')) dataLine += l.slice(6);
        if (!dataLine) return;
        let ev;
        try { ev = JSON.parse(dataLine); } catch { return; }
        if (typeof ev.seq === 'number') this.lastSeq = ev.seq;
        this._pushLog(ev);

        if (ev.type === 'certificate.ready' && ev.data) {
            this.passportNumber = ev.data.passport_number || this.passportNumber;
            this.dmRoomId = ev.data.chat?.dm_room_id || this.dmRoomId;
            this.agentName = ev.data.agent_name || this.agentName;
            this._renderCertificate(ev.data);
        }
        if (ev.type === 'ceremony.complete' || ev.type === 'ceremony.resumed') {
            this._saveState({
                hatched_at: new Date().toISOString(),
                passport_number: this.passportNumber,
                dm_room_id: this.dmRoomId,
                agent_name: this.agentName,
                certificate: this._lastCert,
            });
            localStorage.setItem('windy_agent_hatched_at', new Date().toISOString());
            this._showCtas(this._lastCert);
        }
    }

    // ─── Overlay construction ──────────────────────────────────
    _buildOverlay() {
        this.overlay = document.createElement('div');
        this.overlay.className = 'hatch-overlay';
        this.overlay.innerHTML = `
            <div class="hatch-modal" role="dialog" aria-label="Hatch your agent">
                <button class="hatch-close" type="button" aria-label="Close">×</button>
                <div class="hatch-header">
                    <div class="hatch-title">🪰 Your agent is being born</div>
                    <div class="hatch-sub">This takes about 30 seconds. Let it play.</div>
                </div>
                <div class="hatch-body">
                    <ul class="hatch-log" aria-live="polite"></ul>
                    <pre class="hatch-cert" aria-label="Birth certificate" hidden>
  CERTIFICATE OF BIRTH
  Certificate No: <span data-cert="certificate_no">—</span>

  <span data-cert="agent_name">—</span>
  Eternitas Passport: <span data-cert="passport_number">—</span>

  Born: <span data-cert="born_at">—</span>
  Creator: <span data-cert="creator">—</span>
  Email: <span data-cert="email">—</span>
  Phone: <span data-cert="phone">—</span>
  Cloud Storage: <span data-cert="cloud">—</span>
  Brain: <span data-cert="brain">—</span>

  🪰
                    </pre>
                </div>
                <div class="hatch-ctas" hidden></div>
            </div>
        `;
        this.log = this.overlay.querySelector('.hatch-log');
        this.certFrame = this.overlay.querySelector('.hatch-cert');
        this.ctaRow = this.overlay.querySelector('.hatch-ctas');
        this.overlay.querySelector('.hatch-close').addEventListener('click', () => this._close());
        document.body.appendChild(this.overlay);
        requestAnimationFrame(() => this.overlay.classList.add('visible'));
    }

    _close() {
        try { this.abortController?.abort(); } catch { /* noop */ }
        if (this.overlay) {
            this.overlay.classList.remove('visible');
            setTimeout(() => this.overlay?.remove(), 250);
            this.overlay = null;
        }
    }

    // ─── Log rendering ─────────────────────────────────────────
    _pushLog(ev) {
        if (!this.log) return;
        // Re-use an existing row for ".provisioning → .provisioned"-style
        // pairs so we get spinner → tick animations instead of two rows.
        const baseType = (ev.type || '').replace(/\.(issuing|provisioning|hatching)$/, '').replace(/\.(issued|provisioned|hatched)$/, '');
        let row = this.stepsByType[baseType];
        if (!row) {
            const li = document.createElement('li');
            li.className = 'hatch-step pending';
            li.innerHTML = `<span class="hatch-dot" aria-hidden="true"></span><span class="hatch-step-label"></span>`;
            this.log.appendChild(li);
            row = { el: li };
            this.stepsByType[baseType] = row;
        }
        row.el.querySelector('.hatch-step-label').textContent = ev.label || ev.type;
        row.el.classList.remove('pending', 'ok', 'failed');
        row.el.classList.add(ev.status || 'ok');
    }

    _renderCertificate(data) {
        if (!this.certFrame) return;
        this._lastCert = data;
        const fmt = (v) => (v === null || v === undefined || v === '') ? '—' : String(v);
        const cloud = data.cloud_storage_bytes
            ? `${Math.round(data.cloud_storage_bytes / (1024 * 1024 * 1024))} GB`
            : '—';
        const brain = data.brain ? `${data.brain.model || '—'} · ${data.brain.provider || ''}`.trim() : '—';
        const set = (key, val) => {
            const el = this.certFrame.querySelector(`[data-cert="${key}"]`);
            if (el) el.textContent = fmt(val);
        };
        set('certificate_no', data.certificate_no);
        set('agent_name', data.agent_name);
        set('passport_number', data.passport_number);
        set('born_at', data.born_at ? new Date(data.born_at).toLocaleString() : '');
        set('creator', data.creator);
        set('email', data.email);
        set('phone', data.phone);
        set('cloud', cloud);
        set('brain', brain);
        this.certFrame.hidden = false;
    }

    _hydrateFromSaved(saved) {
        if (saved.certificate) this._renderCertificate(saved.certificate);
    }

    _showCtas(cert) {
        if (!this.ctaRow) return;
        this.ctaRow.hidden = false;
        this.ctaRow.innerHTML = '';

        const chat = document.createElement('button');
        chat.type = 'button';
        chat.className = 'hatch-cta primary';
        chat.textContent = '💬 Talk to My Agent';
        chat.addEventListener('click', () => {
            const room = this.dmRoomId || cert?.chat?.dm_room_id;
            if (room) this._deepLinkChat(room);
        });
        this.ctaRow.appendChild(chat);

        const done = document.createElement('button');
        done.type = 'button';
        done.className = 'hatch-cta';
        done.textContent = 'Done';
        done.addEventListener('click', () => this._close());
        this.ctaRow.appendChild(done);
    }
}

if (typeof window !== 'undefined') {
    window.HatchCeremony = HatchCeremony;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = HatchCeremony;
}
