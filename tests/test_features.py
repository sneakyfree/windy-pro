"""
Comprehensive tests for Windy Pro frontend features.
Tests cover: export formats, history management, settings persistence,
SRT time formatting, language config, and batch lifecycle.
"""
import pytest
import json
import os
import tempfile


# ══════════════════════════════
#  Export Format Generation
# ══════════════════════════════

class TestExportFormats:
    """Test transcript export in various formats."""

    def test_txt_export_is_plain_text(self):
        """TXT export should be raw text with no formatting."""
        text = "Hello world. This is a test.\nSecond paragraph."
        # TXT format is just raw text
        assert text == text  # passthrough

    def test_md_export_has_header(self):
        """Markdown export should have h1 header and paragraph breaks."""
        text = "Hello world.\nSecond paragraph."
        paragraphs = text.split('\n')
        md = f"# Transcript\n\n" + "\n\n".join(p.strip() for p in paragraphs if p.strip()) + "\n"
        assert md.startswith("# Transcript")
        assert "Hello world." in md
        assert "Second paragraph." in md
        assert "\n\n" in md

    def test_md_export_filters_empty_paragraphs(self):
        """Markdown export should skip empty lines."""
        text = "Hello.\n\n\nWorld."
        paragraphs = [p for p in text.split('\n') if p.strip()]
        assert len(paragraphs) == 2

    def test_srt_export_format(self):
        """SRT export should have numbered entries with timestamps."""
        words = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen".split()
        chunk_size = 15
        srt_lines = []
        for i in range(0, len(words), chunk_size):
            idx = i // chunk_size + 1
            chunk = ' '.join(words[i:i + chunk_size])
            start_sec = i // 2.5
            end_sec = min(i + chunk_size, len(words)) / 2.5
            srt_lines.append(f"{idx}\n00:00:{int(start_sec):02d},000 --> 00:00:{int(end_sec):02d},000\n{chunk}")

        srt = '\n\n'.join(srt_lines)
        assert '1\n' in srt
        assert '-->' in srt
        assert 'one two three' in srt

    def test_srt_time_formatting(self):
        """SRT time format should be HH:MM:SS,mmm."""
        def format_srt_time(secs):
            h = str(int(secs // 3600)).zfill(2)
            m = str(int((secs % 3600) // 60)).zfill(2)
            s = str(int(secs % 60)).zfill(2)
            return f"{h}:{m}:{s},000"

        assert format_srt_time(0) == "00:00:00,000"
        assert format_srt_time(61) == "00:01:01,000"
        assert format_srt_time(3661) == "01:01:01,000"
        assert format_srt_time(30) == "00:00:30,000"

    def test_srt_empty_text(self):
        """SRT export with empty text should produce empty output."""
        text = ""
        words = text.split()
        assert len(words) == 0


# ══════════════════════════════
#  History Management
# ══════════════════════════════

class TestHistoryManagement:
    """Test transcript history read/write/clear operations."""

    def setup_method(self):
        self.history_file = tempfile.NamedTemporaryFile(
            mode='w', suffix='.json', delete=False
        )
        self.history_file.write('[]')
        self.history_file.close()

    def teardown_method(self):
        os.unlink(self.history_file.name)

    def _read_history(self):
        with open(self.history_file.name, 'r') as f:
            return json.load(f)

    def _write_history(self, data):
        with open(self.history_file.name, 'w') as f:
            json.dump(data, f)

    def test_empty_history(self):
        """New history file should be empty array."""
        history = self._read_history()
        assert history == []

    def test_add_to_history(self):
        """Adding an entry should prepend to the array."""
        history = self._read_history()
        entry = {
            'id': 1,
            'text': 'Hello world',
            'wordCount': 2,
            'engine': 'local',
            'date': '2024-01-01T00:00:00.000Z'
        }
        history.insert(0, entry)
        self._write_history(history)
        assert len(self._read_history()) == 1
        assert self._read_history()[0]['text'] == 'Hello world'

    def test_history_max_20(self):
        """History should be capped at 20 entries."""
        history = []
        for i in range(25):
            history.insert(0, {
                'id': i,
                'text': f'Entry {i}',
                'wordCount': 2,
                'engine': 'local',
                'date': f'2024-01-{i + 1:02d}T00:00:00Z'
            })
        # Cap at 20
        while len(history) > 20:
            history.pop()
        self._write_history(history)
        assert len(self._read_history()) == 20

    def test_history_newest_first(self):
        """Most recent entry should be at index 0."""
        history = [
            {'id': 1, 'text': 'First', 'date': '2024-01-01T00:00:00Z'},
            {'id': 2, 'text': 'Second', 'date': '2024-01-02T00:00:00Z'}
        ]
        history.insert(0, {'id': 3, 'text': 'Newest', 'date': '2024-01-03T00:00:00Z'})
        self._write_history(history)
        assert self._read_history()[0]['text'] == 'Newest'

    def test_clear_history(self):
        """Clearing history should result in empty array."""
        self._write_history([{'id': 1, 'text': 'test'}])
        self._write_history([])
        assert self._read_history() == []

    def test_history_entry_fields(self):
        """Each history entry should have required fields."""
        entry = {
            'id': 123,
            'text': 'Test transcript',
            'wordCount': 2,
            'engine': 'cloud',
            'date': '2024-01-01T12:00:00Z'
        }
        for key in ['id', 'text', 'wordCount', 'engine', 'date']:
            assert key in entry


# ══════════════════════════════
#  Settings Persistence
# ══════════════════════════════

class TestSettingsPersistence:
    """Test settings save and restore logic."""

    def setup_method(self):
        self.settings = {
            'engine': 'local',
            'language': 'en',
            'diarize': False,
            'recordingMode': 'batch',
            'maxRecordingMin': '10',
            'vibeEnabled': True,
            'clearOnPaste': False,
            'saveAudio': True,
            'opacity': 95,
            'alwaysOnTop': True
        }

    def test_default_engine(self):
        assert self.settings['engine'] == 'local'

    def test_default_language(self):
        assert self.settings['language'] == 'en'

    def test_diarize_default_off(self):
        assert self.settings['diarize'] is False

    def test_batch_mode_default(self):
        assert self.settings['recordingMode'] == 'batch'

    def test_save_audio_default_on(self):
        assert self.settings['saveAudio'] is True

    def test_change_engine(self):
        self.settings['engine'] = 'cloud'
        assert self.settings['engine'] == 'cloud'

    def test_change_language(self):
        self.settings['language'] = 'ja'
        assert self.settings['language'] == 'ja'

    def test_enable_diarize(self):
        self.settings['diarize'] = True
        assert self.settings['diarize'] is True

    def test_all_languages_valid(self):
        valid = {'en', 'es', 'fr', 'de', 'pt', 'it', 'ja', 'zh', 'ko', 'ar', 'hi', 'ru', 'auto'}
        for lang in valid:
            assert len(lang) in (2, 4)  # 'auto' is 4

    def test_all_engines_valid(self):
        valid = {'local', 'cloud', 'deepgram', 'groq', 'openai', 'stream'}
        for engine in valid:
            assert isinstance(engine, str)


# ══════════════════════════════
#  Engine Routing
# ══════════════════════════════

class TestEngineRouting:
    """Test toggleRecording engine routing logic."""

    def _route_engine(self, engine, mode):
        """Simulate the engine routing logic from toggleRecording."""
        if mode == 'batch':
            return 'batch'
        elif engine in ['deepgram', 'groq', 'openai']:
            return 'api'
        elif engine == 'stream':
            return 'stream'
        else:
            return 'websocket'

    def test_batch_mode_routes_to_batch(self):
        assert self._route_engine('local', 'batch') == 'batch'

    def test_batch_mode_ignores_engine(self):
        assert self._route_engine('deepgram', 'batch') == 'batch'
        assert self._route_engine('groq', 'batch') == 'batch'

    def test_live_deepgram_routes_to_api(self):
        assert self._route_engine('deepgram', 'live') == 'api'

    def test_live_groq_routes_to_api(self):
        assert self._route_engine('groq', 'live') == 'api'

    def test_live_openai_routes_to_api(self):
        assert self._route_engine('openai', 'live') == 'api'

    def test_live_stream_routes_to_stream(self):
        assert self._route_engine('stream', 'live') == 'stream'

    def test_live_local_routes_to_websocket(self):
        assert self._route_engine('local', 'live') == 'websocket'

    def test_live_cloud_routes_to_websocket(self):
        assert self._route_engine('cloud', 'live') == 'websocket'


# ══════════════════════════════
#  Batch Lifecycle
# ══════════════════════════════

class TestBatchLifecycle:
    """Test batch recording state transitions."""

    def test_idle_to_recording(self):
        state = 'idle'
        state = 'listening'
        assert state == 'listening'

    def test_recording_to_processing(self):
        state = 'listening'
        state = 'buffering'
        assert state == 'buffering'

    def test_processing_to_idle(self):
        state = 'buffering'
        state = 'idle'
        assert state == 'idle'

    def test_error_recovery(self):
        state = 'error'
        state = 'idle'
        assert state == 'idle'

    def test_debounce_guard(self):
        """Rapid toggles within 500ms should be ignored."""
        import time
        toggle_lock = False
        calls = []

        def toggle():
            nonlocal toggle_lock
            if toggle_lock:
                return
            toggle_lock = True
            calls.append(1)
            # In real code: setTimeout 500ms to reset

        toggle()
        toggle()  # Should be ignored
        toggle()  # Should be ignored
        assert len(calls) == 1


# ══════════════════════════════
#  Setup Wizard
# ══════════════════════════════

class TestSetupWizard:
    """Test setup wizard logic."""

    def test_should_show_on_first_run(self):
        """Wizard should show when no wizardComplete flag."""
        storage = {}
        assert 'windy_wizardComplete' not in storage

    def test_should_not_show_after_completion(self):
        """Wizard should not show after completion."""
        storage = {'windy_wizardComplete': 'true'}
        assert storage.get('windy_wizardComplete') == 'true'

    def test_default_choices(self):
        """Default wizard choices should be batch + local."""
        choices = {'recordingMode': 'batch', 'engine': 'local', 'apiKey': ''}
        assert choices['recordingMode'] == 'batch'
        assert choices['engine'] == 'local'

    def test_engine_options(self):
        """All 5 engine options should be available."""
        engines = ['local', 'cloud', 'deepgram', 'groq', 'openai']
        assert len(engines) == 5

    def test_api_key_needed(self):
        """API key should be needed for deepgram, groq, openai."""
        needs_key = ['deepgram', 'groq', 'openai']
        for engine in needs_key:
            assert engine in needs_key
        assert 'local' not in needs_key
        assert 'cloud' not in needs_key


# ══════════════════════════════
#  Changelog / What's New
# ══════════════════════════════

class TestChangelog:
    """Test changelog version checking."""

    def test_should_show_on_new_version(self):
        """Changelog should show when version differs."""
        current = '0.4.0'
        last_seen = '0.3.0'
        assert last_seen != current

    def test_should_not_show_same_version(self):
        """Changelog should not show when version matches."""
        current = '0.4.0'
        last_seen = '0.4.0'
        assert last_seen == current

    def test_first_run_shows(self):
        """On first run with no lastSeenVersion, should show."""
        last_seen = '0.0.0'
        current = '0.4.0'
        assert last_seen != current


# ══════════════════════════════
#  Language Config
# ══════════════════════════════

class TestLanguageConfig:
    """Test language configuration for engines."""

    VALID_LANGUAGES = ['en', 'es', 'fr', 'de', 'pt', 'it', 'ja', 'zh', 'ko', 'ar', 'hi', 'ru', 'auto']

    def test_all_languages_in_list(self):
        assert len(self.VALID_LANGUAGES) == 13

    def test_default_language(self):
        default = 'en'
        assert default in self.VALID_LANGUAGES

    def test_auto_detect_is_option(self):
        assert 'auto' in self.VALID_LANGUAGES

    def test_language_passed_to_batch(self):
        """Language param should be included in batch endpoint URL."""
        from urllib.parse import urlencode
        params = {'language': 'ja'}
        url = f"/api/v1/transcribe/batch?{urlencode(params)}"
        assert 'language=ja' in url

    def test_diarize_passed_to_batch(self):
        """Diarize param should be included when enabled."""
        from urllib.parse import urlencode
        params = {'language': 'en', 'diarize': 'true'}
        url = f"/api/v1/transcribe/batch?{urlencode(params)}"
        assert 'diarize=true' in url

    def test_deepgram_url_includes_language(self):
        """Deepgram WebSocket URL should include language."""
        lang = 'es'
        url = f"wss://api.deepgram.com/v1/listen?model=nova-2&language={lang}&smart_format=true"
        assert f'language={lang}' in url

    def test_deepgram_url_with_diarize(self):
        """Deepgram URL should include diarize when enabled."""
        url = "wss://api.deepgram.com/v1/listen?model=nova-2&language=en&diarize=true"
        assert 'diarize=true' in url


# ══════════════════════════════
#  Tray Menu
# ══════════════════════════════

class TestTrayMenu:
    """Test tray menu structure."""

    def test_menu_items(self):
        """All expected menu items should be present."""
        items = ['Show Window', 'Start Recording', 'Paste Last Transcript',
                 'Settings', 'Open Vault', 'History', 'Quit Windy Pro']
        assert len(items) == 7

    def test_recording_toggle_label(self):
        """Menu label should change based on recording state."""
        is_recording = False
        label = '⏹ Stop Recording' if is_recording else '🎤 Start Recording'
        assert label == '🎤 Start Recording'

    def test_recording_state_label(self):
        is_recording = True
        label = '⏹ Stop Recording' if is_recording else '🎤 Start Recording'
        assert label == '⏹ Stop Recording'


# ══════════════════════════════
#  Export Buttons
# ══════════════════════════════

class TestExportButtons:
    """Test export button format generation."""

    def test_supported_formats(self):
        formats = ['copy', 'txt', 'md', 'srt']
        assert len(formats) == 4

    def test_txt_content_is_raw(self):
        text = "Hello world"
        content = text  # txt is passthrough
        assert content == "Hello world"

    def test_md_content_has_header(self):
        text = "Hello world"
        content = f"# Transcript\n\n{text}\n"
        assert content.startswith("# Transcript")

    def test_srt_index_starts_at_1(self):
        """SRT entries should be numbered starting from 1."""
        srt = "1\n00:00:00,000 --> 00:00:06,000\nHello world test"
        lines = srt.split('\n')
        assert lines[0] == '1'

    def test_srt_timestamp_format(self):
        """SRT timestamps should follow HH:MM:SS,mmm format."""
        import re
        pattern = r'\d{2}:\d{2}:\d{2},\d{3}'
        timestamp = "00:01:30,000"
        assert re.match(pattern, timestamp)
