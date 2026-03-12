# Fix Plan — Windy Chat Desktop Audit

**Scope:** Complete chat subsystem — 6 files, 2,231 lines total  
**Date:** 2026-03-12

---

## Files Under Review

| File | Lines | Purpose |
|------|-------|---------|
| `src/client/desktop/chat/chat-client.js` | 569 | Matrix SDK wrapper (auth, sync, messaging, presence, DM creation) |
| `src/client/desktop/chat/chat-translate.js` | 243 | Local translation middleware (WebSocket, request-id tracking, LRU cache) |
| `src/client/desktop/chat/chat-preload.js` | 65 | IPC bridge (17 invoke APIs + 7 event listeners) |
| `src/client/desktop/renderer/chat.html` | 767 | Chat UI (login, registration, contacts, messages, settings, profile) |
| `src/client/desktop/renderer/chat.css` | 587 | Chat styling (dark theme, animations, responsive layout) |
| `src/client/desktop/main.js` | ~180 | Chat IPC handlers (lines 1372–1548) |

---

## AUDIT 1 — MATRIX PROTOCOL COMPLIANCE

### P1-C1: Event listeners attached per `_startSync()` but never removed

**File:** `chat-client.js` lines 191–275  
**Current code:**
```js
async _startSync() {
  this.client.on('Room.timeline', async (event, room, toStartOfTimeline) => { ... });
  this.client.on('User.presence', (event, user) => { ... });
  this.client.on('RoomMember.typing', (event, member) => { ... });
  this.client.on('Room.myMembership', (room, membership) => { ... });
  await this.client.startClient({ initialSyncLimit: 20 });
}
```

**Problem:** Each call to `_startSync()` attaches new listeners without removing old ones. If `login()` → `logout()` → `login()` occurs, the second login creates a **new** Matrix client (line 68/94), so old listeners on the old client are orphaned. But if `resumeSession()` is called multiple times with the same client object, listeners double-register.

**Fix:**
```js
async _startSync() {
  if (!this.client) return;

  // Remove any prior listeners from a previous sync
  this.client.removeAllListeners('Room.timeline');
  this.client.removeAllListeners('User.presence');
  this.client.removeAllListeners('RoomMember.typing');
  this.client.removeAllListeners('Room.myMembership');

  // Attach fresh listeners
  this.client.on('Room.timeline', ...);
  // ...
}
```

---

### P2-C2: DM room detection uses member count of 2 — false positives on self-DMs

**File:** `chat-client.js` line 346  
**Current code:**
```js
_findExistingDM(userId) {
  for (const room of rooms) {
    const members = room.getJoinedMembers();
    if (members.length === 2 && members.some(m => m.userId === userId)) {
      return room;
    }
  }
}
```

**Problem:** Per Matrix spec, the `m.direct` account data event should be used to identify DM rooms, not member count. A 2-member group room would be incorrectly identified as a DM.

**Fix:**
```js
_findExistingDM(userId) {
  if (!this.client) return null;
  // Use Matrix m.direct account data
  const directEvent = this.client.getAccountData('m.direct');
  if (directEvent) {
    const directMap = directEvent.getContent(); // { userId: [roomId, ...] }
    const dmRoomIds = directMap[userId] || [];
    for (const roomId of dmRoomIds) {
      const room = this.client.getRoom(roomId);
      if (room) return room;
    }
  }
  // Fallback to member-count heuristic
  const rooms = this.client.getRooms();
  for (const room of rooms) {
    const members = room.getJoinedMembers();
    if (members.length === 2 && members.some(m => m.userId === userId)) {
      return room;
    }
  }
  return null;
}
```

---

### P2-C3: `createDM()` doesn't update `m.direct` account data

**File:** `chat-client.js` lines 321–338  
**Problem:** After creating a DM room with `createRoom({ is_direct: true })`, the Matrix spec requires updating the user's `m.direct` account data to mark this room as a DM. Without this, `_findExistingDM` (once fixed to use `m.direct`) won't find the room.

**Fix — add after room creation:**
```js
// After createRoom() succeeds:
const directEvent = this.client.getAccountData('m.direct');
const directMap = directEvent ? { ...directEvent.getContent() } : {};
if (!directMap[userId]) directMap[userId] = [];
directMap[userId].push(room.room_id);
await this.client.setAccountData('m.direct', directMap);
```

---

### P2-C4: Registration uses deprecated `register()` API

**File:** `chat-client.js` line 159  
**Current code:**
```js
const regResponse = await tempClient.register(username, password, null, {
  type: 'm.login.dummy'
});
```

**Problem:** `client.register()` in matrix-js-sdk v31+ is deprecated in favor of `client.registerRequest()`. Most homeservers require a User-Interactive Authentication (UIA) flow, and this code doesn't handle `M_USER_IN_USE` or rate limiting errors, only the CAPTCHA flow (line 173).

**Fix:**
```js
try {
  // Attempt registration with UIA dummy flow
  const regResponse = await tempClient.registerRequest({
    username,
    password,
    auth: { type: 'm.login.dummy' },
    initial_device_display_name: 'Windy Pro Desktop'
  });
  // ...
} catch (err) {
  if (err.httpStatus === 429) {
    return { success: false, error: 'Too many requests. Please wait and try again.' };
  }
  if (err.errcode === 'M_USER_IN_USE') {
    return { success: false, error: 'Username already taken. Please choose another.' };
  }
  // ... existing CAPTCHA handling
}
```

---

### P1-C5: `sendMessage()` doesn't set `m.relates_to` or `format` for rich content

**File:** `chat-client.js` lines 282–306  
**Problem:** Matrix spec defines `format` and `formatted_body` for formatted messages. If a user sends markdown or URLs, no formatting happens. This is a **feature gap**, not a bug — but worth noting.

**Fix — Future enhancement:** Add markdown → HTML conversion and set `format: 'org.matrix.custom.html'` + `formatted_body`.

---

### P2-C6: `setPresence()` uses deprecated API in SDK v31+

**File:** `chat-client.js` line 455  
**Current code:**
```js
await this.client.setPresence({ presence: status });
```

**Problem:** In matrix-js-sdk v31+, the method signature changed to `client.setPresence(presence, statusMsg)`. The `{ presence }` object form may not work.

**Fix:**
```js
await this.client.setPresence(status); // 'online', 'offline', 'unavailable'
```

---

### P1-C7: Encryption enabled but SDK not configured for E2EE

**File:** `chat-client.js` line 328–332  
**Current code:**
```js
initial_state: [{
  type: 'm.room.encryption',
  state_key: '',
  content: { algorithm: 'm.megolm.v1.aes-sha2' }
}]
```

**Problem:** The room requests E2EE with Megolm, but the Matrix client is created without `cryptoStore`, `olmDevice`, or any Olm setup. Messages in this room will **fail to decrypt** on both sides. The encryption state event makes the room "encrypted" but the SDK cannot actually perform encryption without Olm configuration.

**Fix — Option A (Recommended): Remove encryption until properly configured:**
```js
// Remove initial_state encryption block entirely until Olm/Vodozemac is set up:
const room = await this.client.createRoom({
  is_direct: true,
  invite: [userId],
  preset: 'trusted_private_chat',
  visibility: 'private'
  // No encryption — until Olm/Vodozemac is properly integrated
});
```

**Fix — Option B (Full E2EE): Add proper crypto initialization:**
```js
// During client creation:
const sdk = await this._getSDK();
this.client = sdk.createClient({
  baseUrl: this.homeserverUrl,
  accessToken: ...,
  userId: ...,
  deviceId: ...,
  timelineSupport: true,
  cryptoStore: new sdk.MemoryCryptoStore(), // Or IndexedDBCryptoStore
});
await this.client.initCrypto(); // Or initRustCrypto() for v31+
```

---

## AUDIT 2 — MEMORY LEAKS

### P1-M1: Matrix client event listeners not cleaned up on logout

**File:** `chat-client.js` lines 530–547  
**Current code:**
```js
async logout() {
  if (this.client) {
    try {
      this.client.stopClient();  // Stops sync loop
      await this.client.logout(); // Invalidates token
    } catch (err) { ... }
    this.client = null;  // Drops reference but listeners remain on old object
  }
  this.isConnected = false;
  this.presenceMap.clear();
  // ...
}
```

**Problem:** `stopClient()` stops the sync loop but doesn't remove event listeners. If the old client object is referenced elsewhere (Matrix SDK internals), the listeners and their closures keep the old `WindyChatClient` context alive.

**Fix:**
```js
async logout() {
  if (this.client) {
    try {
      this.client.removeAllListeners(); // Clean up ALL event listeners
      this.client.stopClient();
      await this.client.logout();
    } catch (err) { ... }
    this.client = null;
  }
  // Also clean up the translator
  if (chatTranslator) chatTranslator.clearCache();
  this.isConnected = false;
  this.presenceMap.clear();
}
```

---

### P1-M2: `WindyChatClient` extends `EventEmitter` — own listeners never cleaned

**File:** `chat-client.js` line 20  
**Problem:** `WindyChatClient` emits `'message'`, `'presence'`, `'typing'`, `'invite'`, `'connected'`, `'disconnected'`. Listeners are attached in `getChatClient()` (main.js:1384–1408) but never removed on window close.

**Fix — In `main.js`, clean up on chat window close:**
```js
chatWindow.on('closed', () => {
  chatWindow = null;
  // Don't destroy chatClient — it persists for badge updates
  // But remove the webContents.send listeners since the window is gone
});
```

Current code already guards with `if (chatWindow && !chatWindow.isDestroyed())`, so this is **low risk** but the EventEmitter will accumulate listeners if `getChatClient()` is called multiple times. Add a `once` guard:

```js
function getChatClient() {
  if (!chatClient) {
    chatClient = new WindyChatClient(store);
    chatTranslator = new ChatTranslator(store);
    chatClient.translateFn = (text, src, tgt) => chatTranslator.translate(text, src, tgt);

    // Only register listeners once
    chatClient.on('message', (msg) => { ... });
    chatClient.on('presence', (data) => { ... });
    // ...
  }
  return chatClient;
}
```

**Verdict:** Already guarded by `if (!chatClient)`. ✅ Low risk.

---

### P2-M3: `chat-preload.js` — IPC listeners registered without cleanup

**File:** `chat-preload.js` lines 39–58  
**Current code:**
```js
onMessage: (callback) => {
  ipcRenderer.on('chat-new-message', (event, msg) => callback(msg));
},
```

**Problem:** Each call to `windyChat.onMessage(cb)` adds a **new** listener. If `init()` in `chat.html` runs multiple times (hot reload, navigation back), listeners accumulate. There is no `removeListener` API exposed.

**Fix — Use `once` pattern or track and remove:**
```js
onMessage: (callback) => {
  // Remove any prior listener before adding new one
  ipcRenderer.removeAllListeners('chat-new-message');
  ipcRenderer.on('chat-new-message', (event, msg) => callback(msg));
},
```

Apply same pattern to all 7 `on*` methods (onMessage, onPresence, onTyping, onInvite, onConnected, onDisconnected, onUnreadUpdate).

---

### P2-M4: Translation cache grows unbounded within session

**File:** `chat-translate.js` lines 49–53  
**Current code:**
```js
if (this.cache.size >= this.maxCacheSize) {
  const firstKey = this.cache.keys().next().value;
  this.cache.delete(firstKey);
}
this.cache.set(cacheKey, translated);
```

**Problem:** The LRU eviction only deletes the oldest entry when max size (500) is reached. For a Map, `.keys().next().value` gives insertion-order first (correct for LRU). But **accessed entries are not moved to the end**, so frequently-used translations get evicted.

**Fix — Move accessed entries to end:**
```js
// In translate():
if (this.cache.has(cacheKey)) {
  const value = this.cache.get(cacheKey);
  // Move to end (most recently used)
  this.cache.delete(cacheKey);
  this.cache.set(cacheKey, value);
  return value;
}
```

---

## AUDIT 3 — RACE CONDITIONS

### P0-R1: `_connectPromise` cleared in `finally` block — concurrent callers get stale `null`

**File:** `chat-translate.js` lines 96–108  
**Current code:**
```js
async _getWebSocket() {
  if (this._ws && this._wsReady) return this._ws;

  if (this._connectPromise) return this._connectPromise;

  this._connectPromise = this._createWebSocket();
  try {
    const ws = await this._connectPromise;
    return ws;
  } finally {
    this._connectPromise = null;  // ← CLEARED before concurrent waiters resolve
  }
}
```

**Problem:** If two `translate()` calls arrive simultaneously:
1. Call A enters `_getWebSocket()`, sets `this._connectPromise` (line 101)
2. Call B enters `_getWebSocket()`, sees `this._connectPromise` (line 97), and `return`s it
3. Call A's `finally` runs, sets `this._connectPromise = null` (line 106)
4. Call C arrives → sees `_connectPromise` as null, creates **another** WebSocket

This creates a **duplicate WebSocket connection**. The old one remains open but unused.

**Fix — Don't clear the promise in `finally`; clear it when WS closes:**
```js
async _getWebSocket() {
  if (this._ws && this._wsReady) return this._ws;
  if (this._connectPromise) return this._connectPromise;

  this._connectPromise = this._createWebSocket();
  return this._connectPromise;
  // Don't clear _connectPromise here — let close/error handlers clear it
}

// In _createWebSocket():
ws.on('close', () => {
  this._connectPromise = null;  // Allow reconnect on next call
  // ... existing close handling
});
ws.on('error', (err) => {
  this._connectPromise = null;
  // ... existing error handling
});
```

---

### P1-R2: Translation responses can return out of order via FIFO fallback

**File:** `chat-translate.js` lines 148–156  
**Current code:**
```js
// Fallback: if server doesn't echo request_id, resolve the oldest pending
if (response.type === 'translation_result' && response.translated_text) {
  const oldest = this._pending.entries().next().value;
  if (oldest) {
    const [id, { resolve: res, timeout }] = oldest;
    this._pending.delete(id);
    clearTimeout(timeout);
    res(response.translated_text);
  }
}
```

**Problem:** If the translation server doesn't echo `request_id`, the **oldest pending request** is resolved with the response — even if it was for a different translation. This means:
- Request A: "Hello" → ES
- Request B: "Goodbye" → FR
- Response arrives for B (without request_id) → Resolves A with B's translation

**Fix — Remove the FIFO fallback entirely, or add sequence tracking:**
```js
// OPTION A: Remove fallback (strict mode — requires server to echo request_id)
if (response.request_id && this._pending.has(response.request_id)) {
  // ... handle matched response
}
// No fallback — unmatched responses are dropped

// OPTION B: Add a single-request mode if server doesn't support request_id
// Only allow one in-flight request at a time (serialize)
```

---

### P1-R3: Login can be triggered twice — no UI guard

**File:** `chat.html` lines 321–344  
**Current code:**
```js
async function handleLogin() {
  const username = ..., password = ...;
  // No button disable or state guard
  const result = await windyChat.login(username, password);
  // ...
}
```

**Problem:** User can click "Connect" multiple times before the first `login()` resolves. Each click calls `getChatClient()` → `chatClient.login()`, which creates a new Matrix client and starts a new sync loop. Multiple sync loops running simultaneously causes duplicate messages and memory leaks.

**Fix:**
```js
let _loginInProgress = false;

async function handleLogin() {
  if (_loginInProgress) return;
  _loginInProgress = true;

  const btn = document.querySelector('.login-form button');
  btn.disabled = true;
  btn.textContent = '⏳ Connecting...';

  try {
    const result = await windyChat.login(username, password);
    // ... existing success/error handling
  } finally {
    _loginInProgress = false;
    btn.disabled = false;
    btn.textContent = '🌪️ Connect to Windy Chat';
  }
}
```

Apply same pattern to `handleRegister()`.

---

### P2-R4: Messages can arrive before UI is ready

**File:** `chat.html` lines 278–318  
**Current code:**
```js
async function init() {
  const session = await windyChat.getSession();  // ← Triggers sync
  if (session && session.success) {
    showChatInterface();
    loadContacts();
  }

  windyChat.onMessage((msg) => { ... });  // ← Listeners registered AFTER sync starts
}
```

**Problem:** `getSession()` calls `resumeSession()` → `_startSync()` → `startClient()`. Messages may arrive between `startClient()` and the `onMessage()` listener registration on line 289. These messages would be lost (the Matrix client receives them, but the UI isn't listening yet).

**Fix — Register listeners BEFORE attempting session resume:**
```js
async function init() {
  // Register event listeners FIRST
  windyChat.onMessage((msg) => { ... });
  windyChat.onPresence((data) => { ... });
  windyChat.onTyping((data) => { ... });
  windyChat.onInvite((data) => { ... });
  windyChat.onConnected(() => { ... });

  // THEN attempt session resume
  const session = await windyChat.getSession();
  if (session && session.success) {
    showChatInterface();
    loadContacts();
  }
}
```

---

### P2-R5: Auto-accepting all invites without user confirmation

**File:** `chat.html` lines 309–313  
**Current code:**
```js
windyChat.onInvite((data) => {
  windyChat.acceptInvite(data.roomId);  // Auto-accept everything!
  setTimeout(loadContacts, 1000);
});
```

**Problem:** Every room invite is silently auto-accepted. This means spam invites, unsolicited group adds, or invites from unknown users are accepted without user knowledge.

**Fix — Show a confirmation UI:**
```js
windyChat.onInvite((data) => {
  showInviteNotification(data);
});

function showInviteNotification(data) {
  const container = document.getElementById('contact-list');
  const inviteHtml = `
    <div class="invite-card" id="invite-${data.roomId}" style="...">
      <div>📩 <strong>${escapeHtml(data.roomName || data.inviterId)}</strong> invited you</div>
      <div style="display:flex; gap:8px; margin-top:8px;">
        <button onclick="acceptInvite('${data.roomId}')">✅ Accept</button>
        <button onclick="declineInvite('${data.roomId}')">❌ Decline</button>
      </div>
    </div>`;
  container.insertAdjacentHTML('afterbegin', inviteHtml);
}
```

---

### P2-R6: `appendMessage()` uses `innerHTML +=` — DOM thrashing

**File:** `chat.html` line 532  
**Current code:**
```js
function appendMessage(msg) {
  const container = document.getElementById('chat-messages');
  container.innerHTML += buildMessageHtml(...);
}
```

**Problem:** `innerHTML +=` re-parses and re-renders the **entire** message list for every new message. With 50+ messages, this causes visible stuttering and destroys any event listeners on existing message elements.

**Fix — Use `insertAdjacentHTML`:**
```js
function appendMessage(msg) {
  const container = document.getElementById('chat-messages');
  const isOwn = msg.senderId === myUserId;
  container.insertAdjacentHTML('beforeend', buildMessageHtml({
    ...msg, isOwn
  }));
}
```

---

### P2-R7: XSS via `escapeAttr()` — incomplete escaping

**File:** `chat.html` lines 757–759  
**Current code:**
```js
function escapeAttr(text) {
  return text.replace(/'/g, "\\'").replace(/"/g, '\\"');
}
```

**Problem:** This only escapes quotes but not backticks, angle brackets, or other dangerous characters in `onclick` attribute contexts. A username like `'); alert('xss` could break out.

**Fix — Use safer encoding or avoid inline handlers:**
```js
function escapeAttr(text) {
  if (!text) return '';
  return text.replace(/&/g, '&amp;').replace(/'/g, '&#39;')
             .replace(/"/g, '&quot;').replace(/</g, '&lt;')
             .replace(/>/g, '&gt;').replace(/\\/g, '\\\\');
}
```

Better fix: Use `data-*` attributes + `addEventListener` instead of `onclick` with string interpolation.

---

## AUDIT 4 — TESTING GAPS

No tests currently exist for the chat subsystem. The following test cases should be implemented:

### Unit Tests — `chat-client.js`

| # | Test Case | Type |
|---|-----------|------|
| T1 | `login()` — successful Matrix login returns `{ success: true, userId }` | Unit |
| T2 | `login()` — wrong password returns `{ success: false, error }` | Unit |
| T3 | `login()` — plain username gets `@user:domain` prefix | Unit |
| T4 | `resumeSession()` — decrypts safeStorage token and reconnects | Unit |
| T5 | `resumeSession()` — returns `{ success: false }` when no stored token | Unit |
| T6 | `register()` — successful registration returns login result | Unit |
| T7 | `register()` — CAPTCHA-required returns helpful message | Unit |
| T8 | `register()` — `M_USER_IN_USE` returns helpful message | Unit |
| T9 | `sendMessage()` — sends `m.room.message` with windy metadata | Unit |
| T10 | `sendMessage()` — throws when not connected | Unit |
| T11 | `createDM()` — reuses existing DM room if found | Unit |
| T12 | `createDM()` — creates new room with correct preset | Unit |
| T13 | `getContacts()` — returns sorted contacts with presence | Unit |
| T14 | `getMessages()` — returns filtered timeline with metadata | Unit |
| T15 | `logout()` — stops client, clears store, emits disconnected | Unit |
| T16 | `_startSync()` — registers all 4 event listeners | Unit |
| T17 | `_getUserLanguage()` — falls back to 'en' when no languages set | Unit |
| T18 | `sendTyping()` — sends typing indicator with timeout | Unit |

### Unit Tests — `chat-translate.js`

| # | Test Case | Type |
|---|-----------|------|
| T19 | `translate()` — returns cached result for duplicate request | Unit |
| T20 | `translate()` — returns original text when src === tgt | Unit |
| T21 | `translate()` — returns original text on failure | Unit |
| T22 | `translate()` — evicts oldest cache entry when full (500) | Unit |
| T23 | `_sendTranslationRequest()` — sends JSON with request_id | Unit |
| T24 | `_sendTranslationRequest()` — rejects after 10s timeout | Unit |
| T25 | `_getWebSocket()` — reuses existing connection | Unit |
| T26 | `_getWebSocket()` — creates new connection when none exists | Unit |
| T27 | `_getWebSocket()` — multiple concurrent calls share same promise | Unit |
| T28 | `_createWebSocket()` — rejects all pending on error | Unit |
| T29 | `_createWebSocket()` — rejects all pending on close | Unit |
| T30 | `destroy()` — closes WS, clears pending, clears cache | Unit |

### Integration Tests — IPC Bridge

| # | Test Case | Type |
|---|-----------|------|
| T31 | `chat-login` IPC — creates client singleton, returns result | Integration |
| T32 | `chat-get-session` IPC — resumes session, returns userId | Integration |
| T33 | `chat-send-message` IPC — forwards to client.sendMessage | Integration |
| T34 | `chat-set-settings` IPC — persists homeserver + displayName | Integration |
| T35 | `chat-get-settings` IPC — returns stored chat settings | Integration |
| T36 | `chat-logout` IPC — calls logout, clears state | Integration |
| T37 | Event forwarding: client 'message' event → chatWindow.webContents.send | Integration |
| T38 | Event forwarding: client 'presence' event → chatWindow.webContents.send | Integration |
| T39 | Guard: event not sent when chatWindow is destroyed | Integration |

### UI Tests — `chat.html`

| # | Test Case | Type |
|---|-----------|------|
| T40 | Login form validates empty fields | E2E |
| T41 | Login error displays on failure | E2E |
| T42 | Register validates password match | E2E |
| T43 | Contact list renders with presence dots | E2E |
| T44 | Contact search filters correctly | E2E |
| T45 | Opening conversation loads messages | E2E |
| T46 | Sending message shows optimistic UI | E2E |
| T47 | Typing indicator shows/hides correctly | E2E |
| T48 | Theme toggle works | E2E |
| T49 | New chat modal creates DM | E2E |
| T50 | Logout clears state and shows login | E2E |
| T51 | Double-click login doesn't create duplicate connections | E2E |
| T52 | `escapeHtml()` prevents XSS in message display | E2E |

### Security Tests

| # | Test Case | Type |
|---|-----------|------|
| T53 | Access token encrypted via safeStorage | Security |
| T54 | Plaintext token deleted after migration | Security |
| T55 | XSS via malicious username in contact list | Security |
| T56 | XSS via malicious message body | Security |
| T57 | XSS via malicious display name | Security |

---

## Summary of Findings

| Severity | Count | Key Items |
|----------|-------|-----------|
| **P0** | 1 | WebSocket `_connectPromise` race condition creates duplicate connections |
| **P1** | 5 | Matrix listeners not removed on re-sync; E2EE declared but not configured; FIFO translation fallback misordering; login double-click guard; message listener registered after sync starts |
| **P2** | 8 | DM detection not spec-compliant; `m.direct` not updated; deprecated register/setPresence APIs; auto-accept invites; `innerHTML +=` DOM thrash; `escapeAttr()` incomplete; LRU cache doesn't refresh access order; preload listeners accumulate |

### Recommended Priority Order

1. **P0-R1** — Fix `_connectPromise` race condition
2. **P1-C7** — Remove E2EE from DM creation (prevents broken rooms)
3. **P1-C1** — Remove old Matrix event listeners in `_startSync()`
4. **P1-R3** — Add login double-click guard
5. **P2-R4** — Register UI listeners before session resume
6. **P2-R6** — Replace `innerHTML +=` with `insertAdjacentHTML`
7. **P2-R7** — Fix `escapeAttr()` for XSS prevention
8. **P1-R2** — Remove FIFO translation fallback
9. **P2-R5** — Replace auto-accept invites with UI confirmation

**Estimated effort:** ~6 hours for P0+P1, ~4 hours for P2, ~8 hours for full test suite.

---

*Audit completed: 2026-03-12*  
*Auditor: Automated (Antigravity)*
