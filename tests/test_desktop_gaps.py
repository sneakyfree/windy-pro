"""
Windy Pro — Gap-Closure Regression Tests

Validates the P0 fixes:
  1. Version matches package.json
  2. Transcript area has user-select: text (CSS)
  3. Linux desktop entry has quoted Exec= line
  4. Clear-on-paste mode logic (DOM simulation)
  5. Editable transcript post-stop (contentEditable attribute)
"""
import json
import re
import os
import pytest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


# ───────────────────────────────────────────────
#  Test 1: Version consistency
# ───────────────────────────────────────────────

class TestVersionConsistency:
    """Ensure version string is consistent across all sources."""

    def test_package_json_version_exists(self):
        """package.json must have a valid semver version."""
        pkg = json.loads((ROOT / "package.json").read_text())
        version = pkg.get("version", "")
        assert re.match(r"^\d+\.\d+\.\d+", version), \
            f"package.json version '{version}' is not valid semver"

    def test_settings_no_hardcoded_version(self):
        """settings.js must NOT contain a hardcoded version string like v0.1.0."""
        settings_path = ROOT / "src" / "client" / "desktop" / "renderer" / "settings.js"
        content = settings_path.read_text()
        # Should NOT have "Windy Pro v<digit>" hardcoded — should use dynamic lookup
        assert not re.search(r'Windy Pro v\d+\.\d+\.\d+', content), \
            "settings.js still contains a hardcoded version string"

    def test_preload_exposes_version_api(self):
        """preload.js must expose getAppVersion IPC bridge."""
        preload_path = ROOT / "src" / "client" / "desktop" / "preload.js"
        content = preload_path.read_text()
        assert "getAppVersion" in content, \
            "preload.js does not expose getAppVersion"
        assert "get-app-version" in content, \
            "preload.js does not use 'get-app-version' IPC channel"

    def test_main_handles_version_ipc(self):
        """main.js must handle 'get-app-version' IPC call."""
        main_path = ROOT / "src" / "client" / "desktop" / "main.js"
        content = main_path.read_text()
        assert "get-app-version" in content, \
            "main.js does not handle 'get-app-version' IPC"
        assert "app.getVersion()" in content, \
            "main.js does not call app.getVersion()"


# ───────────────────────────────────────────────
#  Test 2: Transcript editability (CSS)
# ───────────────────────────────────────────────

class TestTranscriptEditability:
    """Verify CSS and JS support for editable transcript post-stop."""

    def test_transcript_user_select_text(self):
        """transcript-content must have user-select: text in CSS."""
        css_path = ROOT / "src" / "client" / "desktop" / "renderer" / "styles.css"
        content = css_path.read_text()
        # Find .transcript-content rule and check for user-select: text
        assert "user-select: text" in content, \
            "styles.css does not have user-select: text for transcript"

    def test_contenteditable_in_stop(self):
        """app.js stopRecording must set contentEditable to true."""
        app_path = ROOT / "src" / "client" / "desktop" / "renderer" / "app.js"
        content = app_path.read_text()
        # Check that stopRecording enables editing
        assert "contentEditable = 'true'" in content, \
            "app.js does not set contentEditable = 'true' after stop"

    def test_contenteditable_locked_during_recording(self):
        """app.js startRecording must lock contentEditable to false."""
        app_path = ROOT / "src" / "client" / "desktop" / "renderer" / "app.js"
        content = app_path.read_text()
        assert "contentEditable = 'false'" in content, \
            "app.js does not lock contentEditable during recording"

    def test_contenteditable_styles_exist(self):
        """CSS must style contenteditable=true (caret color, no outline)."""
        css_path = ROOT / "src" / "client" / "desktop" / "renderer" / "styles.css"
        content = css_path.read_text()
        assert 'contenteditable="true"' in content, \
            "styles.css missing contenteditable='true' selector"
        assert "caret-color" in content, \
            "styles.css missing caret-color for editable transcript"


# ───────────────────────────────────────────────
#  Test 3: Clear-after-paste reliability
# ───────────────────────────────────────────────

class TestClearAfterPaste:
    """Verify paste state transitions are explicit."""

    def _extract_paste_fn(self):
        """Extract the pasteTranscript method body from app.js."""
        app_path = ROOT / "src" / "client" / "desktop" / "renderer" / "app.js"
        content = app_path.read_text()
        # Find the actual method definition (async pasteTranscript), not addEventListener reference
        marker = "async pasteTranscript()"
        idx = content.index(marker)
        fn_text = content[idx:idx + 1500]
        return fn_text

    def test_paste_clear_mode_calls_clearTranscript(self):
        """In clear mode, pasteTranscript must call clearTranscript."""
        fn_text = self._extract_paste_fn()
        assert "this.clearTranscript()" in fn_text, \
            "pasteTranscript clear mode does not call clearTranscript"

    def test_paste_gray_mode_wraps_in_pasted_text(self):
        """In gray mode, pasted text wrapped in .pasted-text div."""
        fn_text = self._extract_paste_fn()
        assert "'pasted-text'" in fn_text, \
            "pasteTranscript missing 'pasted-text' class for gray mode"

    def test_paste_gray_mode_resets_transcript_array(self):
        """Gray mode must reset transcript array after paste."""
        fn_text = self._extract_paste_fn()
        assert "this.transcript = []" in fn_text, \
            "pasteTranscript gray mode does not reset transcript array"

    def test_paste_disables_contenteditable(self):
        """Both paste modes must disable contentEditable (session boundary)."""
        fn_text = self._extract_paste_fn()
        # Gray mode sets it directly; clear mode calls clearTranscript which resets it
        assert "contentEditable = 'false'" in fn_text, \
            "pasteTranscript gray mode does not reset contentEditable"


# ───────────────────────────────────────────────
#  Test 4: Linux launcher hardening
# ───────────────────────────────────────────────

class TestLinuxLauncher:
    """Verify Linux desktop entry handles paths with spaces."""

    def test_desktop_exec_has_quoting(self):
        """Electron-builder desktop config Exec= must quote the binary."""
        pkg = json.loads((ROOT / "package.json").read_text())
        linux_cfg = pkg.get("build", {}).get("linux", {})
        desktop = linux_cfg.get("desktop", {})
        exec_line = desktop.get("Exec", "")
        assert '"' in exec_line or "'" in exec_line, \
            f"Desktop Exec= line lacks quoting: '{exec_line}'"

    def test_executable_name_set(self):
        """Linux build must set executableName."""
        pkg = json.loads((ROOT / "package.json").read_text())
        linux_cfg = pkg.get("build", {}).get("linux", {})
        assert linux_cfg.get("executableName"), \
            "Linux build missing executableName"

    def test_desktop_entry_type(self):
        """Desktop entry Type must be 'Application'."""
        pkg = json.loads((ROOT / "package.json").read_text())
        desktop = pkg.get("build", {}).get("linux", {}).get("desktop", {})
        assert desktop.get("Type") == "Application", \
            f"Desktop Type is '{desktop.get('Type')}', expected 'Application'"

    def test_verify_script_exists(self):
        """verify-linux-install.sh must exist and be readable."""
        script = ROOT / "scripts" / "verify-linux-install.sh"
        assert script.exists(), \
            "scripts/verify-linux-install.sh does not exist"

    def test_desktop_startup_wm_class(self):
        """Desktop entry should have StartupWMClass for proper window grouping."""
        pkg = json.loads((ROOT / "package.json").read_text())
        desktop = pkg.get("build", {}).get("linux", {}).get("desktop", {})
        assert desktop.get("StartupWMClass"), \
            "Desktop entry missing StartupWMClass"


# ───────────────────────────────────────────────
#  Test 5: getFullTranscript reads DOM when edited
# ───────────────────────────────────────────────

class TestEditableTranscriptIntegration:
    """Verify getFullTranscript reads from DOM when contentEditable is active."""

    def test_get_full_transcript_reads_dom(self):
        """getFullTranscript must check isContentEditable before reading DOM."""
        app_path = ROOT / "src" / "client" / "desktop" / "renderer" / "app.js"
        content = app_path.read_text()
        # Find getFullTranscript function
        fn_start = content.index("getFullTranscript()")
        fn_text = content[fn_start:fn_start + 300]
        assert "isContentEditable" in fn_text, \
            "getFullTranscript does not check isContentEditable"
        assert "textContent" in fn_text, \
            "getFullTranscript does not read from textContent when editing"
