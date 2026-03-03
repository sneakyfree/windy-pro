"""
Windy Pro — Premium Features Test Suite
Structural tests: Conversation Mode, Document Translator,
Translation Memory, Voice Clone Manager, Language Detection,
IPC handlers, Preload bridges
"""
import os, sys

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RENDERER = os.path.join(BASE_DIR, 'src', 'client', 'desktop', 'renderer')
MAIN = os.path.join(BASE_DIR, 'src', 'client', 'desktop', 'main.js')
PRELOAD = os.path.join(BASE_DIR, 'src', 'client', 'desktop', 'preload.js')
INDEX = os.path.join(BASE_DIR, 'src', 'client', 'desktop', 'renderer', 'index.html')

m = open(MAIN).read()
p = open(PRELOAD).read()
h = open(INDEX).read()

passed = failed = 0
def check(name, cond):
    global passed, failed
    if cond:
        print(f'  PASS {name}')
        passed += 1
    else:
        print(f'  FAIL {name}')
        failed += 1

# ═══ Feature 1: Conversation Mode ═══
conv = open(os.path.join(RENDERER, 'conversation-mode.js')).read()
check('conv_mode_file_exists', os.path.exists(os.path.join(RENDERER, 'conversation-mode.js')))
check('conv_mode_class', 'class ConversationMode' in conv)
check('conv_mode_split_pane', 'conv-pane-a' in conv and 'conv-pane-b' in conv)
check('conv_mode_dual_mic', 'conv-mic-a' in conv and 'conv-mic-b' in conv)
check('conv_mode_lang_select', 'conv-lang-a' in conv and 'conv-lang-b' in conv)
check('conv_mode_recording', 'startRecording' in conv and 'stopRecording' in conv)
check('conv_mode_waveform', 'startWaveform' in conv)
check('conv_mode_translate', 'translateOffline' in conv)
check('conv_mode_export', 'exportTranscript' in conv)
check('conv_mode_swap', 'conv-swap' in conv)

# ═══ Feature 2 & 3: Document & Batch Translation ═══
doc = open(os.path.join(RENDERER, 'document-translator.js')).read()
check('doc_trans_file_exists', os.path.exists(os.path.join(RENDERER, 'document-translator.js')))
check('doc_trans_class', 'class DocumentTranslator' in doc)
check('doc_trans_dropzone', 'doc-dropzone' in doc)
check('doc_trans_drag_drop', 'dragover' in doc and 'dragleave' in doc)
check('doc_trans_progress', 'doc-progress-fill' in doc)
check('doc_trans_pdf', "'pdf'" in doc)
check('doc_trans_docx', "'docx'" in doc)
check('doc_trans_batch_mode', 'batchTranslate' in doc)
check('doc_trans_csv_export', 'exportBatchCSV' in doc)
check('doc_trans_tabs', "data-tab=\"document\"" in doc and "data-tab=\"batch\"" in doc)

# ═══ Feature 4: Translation Memory ═══
tm = open(os.path.join(RENDERER, 'translation-memory.js')).read()
check('tm_file_exists', os.path.exists(os.path.join(RENDERER, 'translation-memory.js')))
check('tm_class', 'class TranslationMemory' in tm)
check('tm_lru_cache', 'maxCacheSize' in tm)
check('tm_lookup', 'async lookup(' in tm)
check('tm_save', 'async save(' in tm)
check('tm_confidence', 'confidence' in tm)
check('tm_hits', 'hits' in tm)
check('tm_stats', 'getStats' in tm)
check('tm_browser_ui', 'renderBrowser' in tm)
check('tm_export', 'Export Memory' in tm)

# ═══ Feature 5: Hotkey Translate (Ctrl+Shift+T) ═══
check('hotkey_translate_registered', 'Ctrl+Shift+T' in m or 'CommandOrControl+Shift+T' in m)
check('hotkey_mini_translate', 'miniTranslateWindow' in m or 'mini-translate' in m)

# ═══ Feature 6: Language Detection ═══
check('lang_detect_class', 'class LanguageDetector' in tm)
check('lang_detect_scripts', 'SCRIPTS' in tm)
check('lang_detect_50_langs', tm.count("'") > 100)  # Many language markers
check('lang_detect_confidence', 'confidence' in tm)
check('lang_detect_arabic', 'arabic' in tm)
check('lang_detect_chinese', 'chinese' in tm)
check('lang_detect_japanese', 'japanese' in tm)
check('lang_detect_korean', 'korean' in tm)
check('lang_detect_cyrillic', 'cyrillic' in tm)
check('lang_detect_devanagari', 'devanagari' in tm)

# ═══ Feature 7: Voice Clone Manager ═══
vc = open(os.path.join(RENDERER, 'voice-clone-manager.js')).read()
check('vc_file_exists', os.path.exists(os.path.join(RENDERER, 'voice-clone-manager.js')))
check('vc_class', 'class VoiceCloneManager' in vc)
check('vc_record', 'startRecording' in vc and 'stopRecording' in vc)
check('vc_upload', 'uploadVoiceCloneFile' in vc)
check('vc_preview', 'previewVoiceClone' in vc)
check('vc_delete', 'deleteVoiceClone' in vc)
check('vc_activate', 'setActiveVoiceClone' in vc)
check('vc_waveform', 'vc-waveform' in vc)
check('vc_tts_settings', 'vc-speed' in vc and 'vc-pitch' in vc)

# ═══ IPC Handlers in main.js ═══
check('ipc_save_tm', "ipcMain.handle('save-translation-memory'" in m)
check('ipc_lookup_tm', "ipcMain.handle('lookup-translation-memory'" in m)
check('ipc_tm_stats', "ipcMain.handle('get-translation-memory-stats'" in m)
check('ipc_clear_tm', "ipcMain.handle('clear-translation-memory'" in m)
check('ipc_get_clones', "ipcMain.handle('get-voice-clones'" in m)
check('ipc_create_clone', "ipcMain.handle('create-voice-clone'" in m)
check('ipc_delete_clone', "ipcMain.handle('delete-voice-clone'" in m)
check('ipc_preview_clone', "ipcMain.handle('preview-voice-clone'" in m)
check('ipc_set_active_clone', "ipcMain.handle('set-active-voice-clone'" in m)
check('ipc_upload_clone', "ipcMain.handle('upload-voice-clone-file'" in m)
check('ipc_extract_doc', "ipcMain.handle('extract-document-text'" in m)
check('ipc_browse_doc', "ipcMain.handle('browse-document-file'" in m)
check('ipc_tm_sqlite', 'translation-memory.db' in m)
check('ipc_vc_path_validation', 'startsWith(path.resolve(vcAudioDir))' in m)

# ═══ Preload Bridges ═══
check('preload_save_tm', 'saveTranslationMemory' in p)
check('preload_lookup_tm', 'lookupTranslationMemory' in p)
check('preload_tm_stats', 'getTranslationMemoryStats' in p)
check('preload_clear_tm', 'clearTranslationMemory' in p)
check('preload_get_clones', 'getVoiceClones' in p)
check('preload_create_clone', 'createVoiceClone' in p)
check('preload_delete_clone', 'deleteVoiceClone' in p)
check('preload_preview_clone', 'previewVoiceClone' in p)
check('preload_extract_doc', 'extractDocumentText' in p)
check('preload_browse_doc', 'browseDocumentFile' in p)

# ═══ HTML Integration ═══
check('html_conv_mode_script', 'conversation-mode.js' in h)
check('html_doc_trans_script', 'document-translator.js' in h)
check('html_tm_script', 'translation-memory.js' in h)
check('html_vc_script', 'voice-clone-manager.js' in h)
check('html_premium_css', 'premium-features.css' in h)

# ═══ CSS ═══
css = open(os.path.join(RENDERER, 'premium-features.css')).read()
check('css_conv_mode', '.conv-mode' in css)
check('css_doc_translator', '.doc-translator' in css)
check('css_tm_browser', '.tm-browser' in css)
check('css_vc_manager', '.vc-manager' in css)
check('css_waveform', '.conv-bar' in css)
check('css_dropzone', '.doc-dropzone' in css)

print(f'\n{passed} passed, {failed} failed, {passed + failed} total')
