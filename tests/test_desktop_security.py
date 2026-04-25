"""
Windy Pro — Desktop Security & Hardening Verification Tests (Phase 3)

Structural tests verifying all security fixes are present in:
  - main.js (IPC handlers, webPreferences, navigation guards)
  - index.html (CSP policy)
  - preload.js (context isolation)
"""
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def read(path):
    return open(os.path.join(ROOT, *path.split('/'))).read()

MAIN = None
def get_main():
    global MAIN
    if MAIN is None: MAIN = read('src/client/desktop/main.js')
    return MAIN

# ─── 1. Sandbox on ALL windows ────────────────────────────────

def test_main_window_has_sandbox():
    m = get_main()
    # All 4 windows should have sandbox: true (verified by count)
    assert m.count('sandbox: true') >= 4, f'Expected 4+ sandbox: true, found {m.count("sandbox: true")}'

def test_mini_window_has_sandbox():
    # Covered by count check in test_main_window_has_sandbox
    test_main_window_has_sandbox()

def test_video_window_has_sandbox():
    # Covered by count check
    test_main_window_has_sandbox()

def test_mini_translate_window_has_sandbox():
    # Covered by count check
    test_main_window_has_sandbox()

# ─── 2. Path Traversal Guard ──────────────────────────────────

def test_delete_archive_has_path_traversal_guard():
    m = get_main()
    idx = m.find("'delete-archive-entry'")
    block = m[idx:idx+800]
    assert 'path.resolve' in block, 'delete-archive-entry missing path.resolve'
    assert 'startsWith' in block, 'delete-archive-entry missing startsWith check'
    assert 'path outside archive' in block or 'Access denied' in block or 'getArchiveFolder' in block, 'Missing rejection message or folder lookup'

def test_delete_archive_uses_resolved_path():
    m = get_main()
    idx = m.find("'delete-archive-entry'")
    block = m[idx:idx+800]
    assert 'resolvedPath' in block, 'Should use resolvedPath, not raw filePath'
    assert 'resolvedBase' in block, 'Should use resolvedBase for comparison'

# ─── 3. URL Handler — No spawn/exec ──────────────────────────

def test_open_external_url_uses_shell():
    m = get_main()
    idx = m.find("'open-external-url'")
    block = m[idx:idx+3500]
    assert 'shell.openExternal' in block, 'Should use shell.openExternal'

def test_open_external_url_no_spawn():
    m = get_main()
    idx = m.find("'open-external-url'")
    block = m[idx:idx+600]
    assert 'spawn(' not in block, 'Should NOT use spawn() for URL opening'
    assert 'execSync' not in block, 'Should NOT use execSync for URL opening'

def test_open_external_url_validates_with_URL():
    m = get_main()
    idx = m.find("'open-external-url'")
    block = m[idx:idx+600]
    assert 'new URL(url)' in block or 'new URL(' in block, 'Should parse URL with URL constructor'

def test_open_external_url_blocks_non_https():
    m = get_main()
    idx = m.find("'open-external-url'")
    block = m[idx:idx+600]
    assert 'https:' in block, 'Should check for HTTPS protocol'

# ─── 4. Navigation Guard ─────────────────────────────────────

def test_will_navigate_handler_exists():
    m = get_main()
    assert 'will-navigate' in m, 'Missing will-navigate handler'

def test_will_navigate_blocks_non_file():
    m = get_main()
    # Find the GLOBAL will-navigate handler (in web-contents-created), not the per-window one
    idx = m.find('web-contents-created')
    block = m[idx:idx+900]
    assert 'file:' in block, 'will-navigate should check for file: protocol'
    assert 'preventDefault' in block, 'will-navigate should call preventDefault'

def test_window_open_handler_exists():
    m = get_main()
    assert 'setWindowOpenHandler' in m, 'Missing setWindowOpenHandler'

def test_window_open_handler_denies():
    m = get_main()
    idx = m.find('setWindowOpenHandler')
    block = m[idx:idx+300]
    assert "'deny'" in block or '"deny"' in block, 'setWindowOpenHandler should deny'

# ─── 5. Permission Handler ───────────────────────────────────

def test_permission_handler_exists():
    m = get_main()
    assert 'setPermissionRequestHandler' in m, 'Missing permission request handler'

def test_permission_handler_whitelists_media():
    m = get_main()
    idx = m.find('setPermissionRequestHandler')
    block = m[idx:idx+400]
    assert 'media' in block, 'Permission handler should allow media'

def test_permission_handler_whitelists_clipboard():
    m = get_main()
    assert 'clipboard-read' in m, 'Permission handler should include clipboard-read'

# ─── 6. CSP Tightening ───────────────────────────────────────

def test_csp_no_wildcard_wss():
    html = read('src/client/desktop/renderer/index.html')
    # Should not have bare 'wss:' (wildcard)
    csp_line = [l for l in html.split('\n') if 'Content-Security-Policy' in l or 'connect-src' in l]
    csp = ' '.join(csp_line)
    # wss: as standalone (not wss://something) is a wildcard
    assert not re.search(r'\bwss:\s', csp), 'CSP should not have wildcard wss:'

def test_csp_no_wildcard_https():
    html = read('src/client/desktop/renderer/index.html')
    csp_line = [l for l in html.split('\n') if 'Content-Security-Policy' in l or 'connect-src' in l]
    csp = ' '.join(csp_line)
    assert not re.search(r'\bhttps:\s', csp), 'CSP should not have wildcard https:'

def test_csp_has_windyword_proxy():
    """Cloud STT now goes through the windyword.ai proxy (commit dc54d08
    'Kill STT everywhere + remove competitor names + white-label vendor
    refs'). Direct vendor connect-src entries (api.deepgram.com,
    api.groq.com, api.openai.com) were intentionally removed."""
    html = read('src/client/desktop/renderer/index.html')
    assert 'windyword.ai' in html, 'CSP should include the windyword.ai cloud proxy'

def test_csp_has_no_vendor_refs():
    """Confirms the white-label refactor stuck — no direct vendor
    hostnames in the CSP. If anyone restores them, this test fails
    and forces them to update the white-label policy explicitly."""
    html = read('src/client/desktop/renderer/index.html')
    assert 'api.deepgram.com' not in html
    assert 'api.groq.com' not in html
    assert 'api.openai.com' not in html

def test_csp_has_img_src():
    html = read('src/client/desktop/renderer/index.html')
    assert 'img-src' in html, 'CSP should include img-src directive'

# ─── 7. Fundamentals Still Intact ─────────────────────────────

def test_context_isolation_true():
    m = get_main()
    assert m.count('contextIsolation: true') >= 4, 'All 4 windows should have contextIsolation: true'

def test_node_integration_false():
    m = get_main()
    assert m.count('nodeIntegration: false') >= 4, 'All 4 windows should have nodeIntegration: false'

def test_unhandled_rejection_handler():
    m = get_main()
    assert 'unhandledRejection' in m, 'Missing unhandledRejection handler'

def test_uncaught_exception_handler():
    m = get_main()
    assert 'uncaughtException' in m, 'Missing uncaughtException handler'

def test_crash_log_redacts_api_keys():
    """CR-006 (P15): redaction logic moved to lib/crash-summary.js
    so it's unit-testable. main.js delegates via writeCrashLog →
    safeErrorSummary. Verify both layers are wired correctly."""
    m = get_main()
    assert 'safeErrorSummary' in m, \
        'main.js should delegate crash-log redaction to crash-summary lib'
    lib = read('src/client/desktop/lib/crash-summary.js')
    assert '[REDACTED]' in lib, 'lib/crash-summary.js should perform redaction'
    assert 'Bearer' in lib, 'Bearer pattern should be in the secret allowlist'

def test_web_contents_created_handler():
    m = get_main()
    assert 'web-contents-created' in m, 'Missing web-contents-created handler'

def test_session_import_present():
    m = get_main()
    # Search for session in the electron require/import line (not hardcoded line number)
    import_line = [l for l in m.split('\n') if 'require(\'electron\')' in l or 'require("electron")' in l]
    assert any('session' in l for l in import_line), 'session should be in electron import'


# ─── Run all tests ────────────────────────────────────────────

if __name__ == '__main__':
    tests = [name for name, obj in list(globals().items()) if name.startswith('test_') and callable(obj)]
    passed = failed = 0
    for t in sorted(tests):
        try:
            globals()[t]()
            passed += 1
            print(f'  PASS {t}')
        except Exception as e:
            failed += 1
            print(f'  FAIL {t}: {e}')

    print(f'\n{passed} passed, {failed} failed, {len(tests)} total')
    exit(1 if failed else 0)
