"""
Windy Word Desktop Core Features — Structural Verification Tests

Verifies that the translation/favorites/history routes, bar-waveform,
mini-translate files, updater 6h interval, and IPC handlers exist.
"""
import os
import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ─── Section 1: Backend API Endpoints ─────────────────────────

# NOTE: account-server/server.js was refactored into a thin delegating shim
# (see account-server/CLAUDE.md). These structural checks now point at each
# feature's real current home in the TypeScript tree. The capabilities are
# unchanged — only the file locations moved.
_SCHEMA = os.path.join(ROOT, 'account-server', 'src', 'db', 'schema.ts')
_TRANSLATIONS = os.path.join(ROOT, 'account-server', 'src', 'routes', 'translations.ts')
_SERVER_TS = os.path.join(ROOT, 'account-server', 'src', 'server.ts')

def test_server_has_translations_table():
    schema = open(_SCHEMA).read()
    assert 'CREATE TABLE IF NOT EXISTS translations' in schema

def test_server_has_favorites_table():
    schema = open(_SCHEMA).read()
    assert 'CREATE TABLE IF NOT EXISTS favorites' in schema

def test_server_has_translate_speech_route():
    # router.post('/speech') mounted at app.use('/api/v1/translate', ...)
    routes = open(_TRANSLATIONS).read()
    assert "'/speech'" in routes

def test_server_has_translate_text_route():
    routes = open(_TRANSLATIONS).read()
    assert "'/text'" in routes

def test_server_has_translate_languages_route():
    routes = open(_TRANSLATIONS).read()
    assert "'/languages'" in routes

def test_server_has_user_history_route():
    # app.get('/api/v1/user/history', authenticateToken, historyHandler)
    server = open(_SERVER_TS).read()
    assert "/api/v1/user/history" in server

def test_server_has_user_favorites_route():
    # app.post('/api/v1/user/favorites', authenticateToken, favoritesHandler)
    server = open(_SERVER_TS).read()
    assert "/api/v1/user/favorites" in server

def test_server_uses_multer():
    # multer is the upload middleware for the /speech audio upload
    routes = open(_TRANSLATIONS).read()
    assert "import multer" in routes and "multer(" in routes

# ─── Section 2: Speech Translation UI ─────────────────────────

def test_translate_js_has_bar_waveform():
    translate = open(os.path.join(ROOT, 'src', 'client', 'desktop', 'renderer', 'translate.js')).read()
    assert 'getByteFrequencyData' in translate
    assert 'barCount' in translate
    assert 'roundRect' in translate

def test_translate_js_tracks_translation_id():
    translate = open(os.path.join(ROOT, 'src', 'client', 'desktop', 'renderer', 'translate.js')).read()
    assert '_lastTranslationId = data.id' in translate

def test_translate_js_has_audio_playback():
    # Audio playback of the translated text now uses the Web Speech API TTS
    # path (the 🔊 translatePlayBtn → _speakLastTranslation → speechSynthesis),
    # which replaced the older server-audio Blob/object-URL approach.
    translate = open(os.path.join(ROOT, 'src', 'client', 'desktop', 'renderer', 'translate.js')).read()
    assert 'translatePlayBtn' in translate
    assert 'speechSynthesis' in translate

def test_css_has_pulse_ring():
    css = open(os.path.join(ROOT, 'src', 'client', 'desktop', 'renderer', 'styles.css')).read()
    assert '@keyframes pulse-ring' in css
    assert '.translate-mic-btn.recording::before' in css

# ─── Section 3: System Tray + Global Hotkey ───────────────────

def test_mini_translate_html_exists():
    assert os.path.isfile(os.path.join(ROOT, 'src', 'client', 'desktop', 'renderer', 'mini-translate.html'))

def test_mini_translate_preload_exists():
    assert os.path.isfile(os.path.join(ROOT, 'src', 'client', 'desktop', 'mini-translate-preload.js'))

def test_main_js_has_quick_translate_tray():
    main = open(os.path.join(ROOT, 'src', 'client', 'desktop', 'main.js')).read()
    assert 'Quick Translate' in main

def test_main_js_has_ctrl_shift_t_hotkey():
    main = open(os.path.join(ROOT, 'src', 'client', 'desktop', 'main.js')).read()
    assert "CommandOrControl+Shift+T" in main

def test_main_js_has_mini_translate_window():
    main = open(os.path.join(ROOT, 'src', 'client', 'desktop', 'main.js')).read()
    assert 'showMiniTranslateWindow' in main
    assert 'mini-translate-preload.js' in main

def test_main_js_has_mini_translate_ipc():
    main = open(os.path.join(ROOT, 'src', 'client', 'desktop', 'main.js')).read()
    assert 'mini-translate-close' in main
    assert 'mini-translate-text' in main

def test_preload_has_open_translate():
    preload = open(os.path.join(ROOT, 'src', 'client', 'desktop', 'preload.js')).read()
    assert 'onOpenTranslate' in preload or 'open-translate' in preload

# ─── Section 4: Auto-Update ───────────────────────────────────

def test_updater_6h_interval():
    # 6h dedup window: `const sixHoursMs = 6 * 60 * 60 * 1000` guards re-checks
    # via `if (Date.now() - lastCheck < sixHoursMs)`.
    updater = open(os.path.join(ROOT, 'src', 'client', 'desktop', 'updater.js')).read()
    assert 'sixHoursMs' in updater or '6 * 60 * 60' in updater
    assert 'lastCheck' in updater

def test_updater_has_install_update():
    updater = open(os.path.join(ROOT, 'src', 'client', 'desktop', 'updater.js')).read()
    assert 'installUpdate' in updater

def test_main_js_has_install_update_ipc():
    main = open(os.path.join(ROOT, 'src', 'client', 'desktop', 'main.js')).read()
    assert "'install-update'" in main

def test_main_js_has_periodic_update_timer():
    main = open(os.path.join(ROOT, 'src', 'client', 'desktop', 'main.js')).read()
    assert '6 * 60 * 60 * 1000' in main

def test_preload_has_install_update():
    preload = open(os.path.join(ROOT, 'src', 'client', 'desktop', 'preload.js')).read()
    assert 'installUpdate' in preload
    assert 'install-update' in preload
