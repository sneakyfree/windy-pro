"""
Windy Pro Desktop Core Features — Structural Verification Tests

Verifies that the translation/favorites/history routes, bar-waveform,
mini-translate files, updater 6h interval, and IPC handlers exist.
"""
import os
import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ─── Section 1: Backend API Endpoints ─────────────────────────

def test_server_has_translations_table():
    server = open(os.path.join(ROOT, 'account-server', 'server.js')).read()
    assert 'CREATE TABLE IF NOT EXISTS translations' in server

def test_server_has_favorites_table():
    server = open(os.path.join(ROOT, 'account-server', 'server.js')).read()
    assert 'CREATE TABLE IF NOT EXISTS favorites' in server

def test_server_has_translate_speech_route():
    server = open(os.path.join(ROOT, 'account-server', 'server.js')).read()
    assert "/api/v1/translate/speech" in server

def test_server_has_translate_text_route():
    server = open(os.path.join(ROOT, 'account-server', 'server.js')).read()
    assert "/api/v1/translate/text" in server

def test_server_has_translate_languages_route():
    server = open(os.path.join(ROOT, 'account-server', 'server.js')).read()
    assert "/api/v1/translate/languages" in server

def test_server_has_user_history_route():
    server = open(os.path.join(ROOT, 'account-server', 'server.js')).read()
    assert "/api/v1/user/history" in server

def test_server_has_user_favorites_route():
    server = open(os.path.join(ROOT, 'account-server', 'server.js')).read()
    assert "/api/v1/user/favorites" in server

def test_server_uses_multer():
    server = open(os.path.join(ROOT, 'account-server', 'server.js')).read()
    assert "require('multer')" in server

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
    translate = open(os.path.join(ROOT, 'src', 'client', 'desktop', 'renderer', 'translate.js')).read()
    assert 'data.audioData' in translate
    assert 'URL.createObjectURL' in translate

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
    updater = open(os.path.join(ROOT, 'src', 'client', 'desktop', 'updater.js')).read()
    assert 'sixHoursMs' in updater or '6 * 60 * 60' in updater
    assert 'within last 6h' in updater

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
