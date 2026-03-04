"""
Windy Pro — Final QA Test Suite
Comprehensive structural tests covering ALL features:
Video Recording, Phone Camera Bridge, Auto-Sync,
Premium Features, IPC Handlers, Preload Bridges,
Backend API Routes, HTML/CSS Integration
"""
import os, sys, json

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RENDERER = os.path.join(BASE_DIR, 'src', 'client', 'desktop', 'renderer')
MAIN = os.path.join(BASE_DIR, 'src', 'client', 'desktop', 'main.js')
PRELOAD = os.path.join(BASE_DIR, 'src', 'client', 'desktop', 'preload.js')
INDEX = os.path.join(RENDERER, 'index.html')
SERVER = os.path.join(BASE_DIR, 'account-server', 'server.js')

m = open(MAIN).read()
p = open(PRELOAD).read()
h = open(INDEX).read()
s = open(SERVER).read()

results = []
def check(name, cond):
    results.append((name, bool(cond)))
    print(f'  {"PASS" if cond else "FAIL"} {name}')

print('\n═══ 1. VIDEO RECORDING MANAGER ═══')
vr = open(os.path.join(RENDERER, 'video-recording-manager.js')).read()
check('vr_class_exists', 'class VideoRecordingManager' in vr)
check('vr_camera_dropdown', 'vr-camera-select' in vr)
check('vr_no_camera_option', 'No Camera' in vr)
check('vr_phone_camera_option', 'Phone Camera' in vr)
check('vr_quality_480', '480p' in vr)
check('vr_quality_720', '720p' in vr)
check('vr_quality_1080', '1080p' in vr)
check('vr_getUserMedia', 'getUserMedia' in vr)
check('vr_MediaRecorder', 'MediaRecorder' in vr)
check('vr_vp9_opus', 'vp9,opus' in vr)
check('vr_live_preview', 'startPreview' in vr)
check('vr_recording_indicator', 'vr-rec-indicator' in vr)
check('vr_timer', 'vr-timer' in vr)
check('vr_waveform', 'startAudioWaveform' in vr)
check('vr_live_transcription', 'startLiveTranscription' in vr)
check('vr_transcript_segments', 'transcriptSegments' in vr)
check('vr_subtitle_sync', 'timeupdate' in vr)
check('vr_bundle_format', 'bundle_id' in vr and 'duration_seconds' in vr)
check('vr_clone_training_ready', 'clone_training_ready' in vr)
check('vr_save_bundle', 'saveCloneBundle' in vr)
check('vr_discard', 'discardRecording' in vr)
check('vr_auto_record_toggle', 'auto-record' in vr)
check('vr_settings_quality', 'QUALITY_PRESETS' in vr)
check('vr_cleanup', 'cleanup' in vr)

print('\n═══ 2. PHONE CAMERA BRIDGE ═══')
pcb = open(os.path.join(RENDERER, 'phone-camera-bridge.js')).read()
check('pcb_class_exists', 'class PhoneCameraBridge' in pcb)
check('pcb_qr_generation', 'generateQRPlaceholder' in pcb)
check('pcb_session_token', 'sessionToken' in pcb and 'randomUUID' in pcb)
check('pcb_webrtc_peer', 'RTCPeerConnection' in pcb)
check('pcb_stun_servers', 'stun.l.google.com' in pcb)
check('pcb_create_offer', 'createOffer' in pcb)
check('pcb_set_remote_desc', 'setRemoteDescription' in pcb)
check('pcb_ice_candidates', 'onicecandidate' in pcb and 'addIceCandidate' in pcb)
check('pcb_connection_state', 'onconnectionstatechange' in pcb)
check('pcb_signal_endpoint', '/api/v1/rtc/signal' in pcb)
check('pcb_switch_camera', 'switch-camera' in pcb)
check('pcb_quality_latency', 'pcb-latency' in pcb)
check('pcb_quality_resolution', 'pcb-resolution' in pcb)
check('pcb_quality_fps', 'pcb-fps' in pcb)
check('pcb_getStats', 'getStats' in pcb)
check('pcb_disconnect', 'disconnect' in pcb)
check('pcb_get_stream', 'getStream' in pcb)
check('pcb_manual_code', 'pcb-code' in pcb)
check('pcb_poll_for_answer', 'pollForAnswer' in pcb)

print('\n═══ 3. CLONE DATA ARCHIVE ═══')
cda = open(os.path.join(RENDERER, 'clone-data-archive.js')).read()
check('cda_class_exists', 'class CloneDataArchive' in cda)
check('cda_render_bundle_card', 'renderBundleCard' in cda)
check('cda_filter_video', "value=\"video\"" in cda)
check('cda_filter_audio', "value=\"audio\"" in cda)
check('cda_filter_today', "'today'" in cda)
check('cda_filter_week', "'week'" in cda)
check('cda_filter_desktop', "'desktop'" in cda)
check('cda_filter_mobile', "'mobile'" in cda)
check('cda_bulk_export', 'exportCloneBundles' in cda)
check('cda_storage_stats', 'computeStats' in cda)
check('cda_start_training', 'startCloneTraining' in cda)
check('cda_min_3_bundles', 'readyBundles.length < 3' in cda)
check('cda_select_all', 'selectedBundles' in cda)
check('cda_delete_bundle', 'deleteCloneBundle' in cda)
check('cda_play_bundle', 'playCloneBundle' in cda)

print('\n═══ 4. AUTO-SYNC MANAGER ═══')
asm = open(os.path.join(RENDERER, 'auto-sync-manager.js')).read()
check('asm_class_exists', 'class AutoSyncManager' in asm)
check('asm_poll_interval', 'pollFrequencyMs' in asm and '5 * 60 * 1000' in asm)
check('asm_start_polling', 'startPolling' in asm)
check('asm_check_new_bundles', 'checkForNewBundles' in asm)
check('asm_download_queue', 'downloadQueue' in asm)
check('asm_upload_queue', 'uploadQueue' in asm)
check('asm_offline_support', "navigator.onLine" in asm)
check('asm_online_listener', "'online'" in asm)
check('asm_offline_listener', "'offline'" in asm)
check('asm_tray_notification', 'showSyncNotification' in asm)
check('asm_download_progress', 'downloadProgress' in asm)
check('asm_process_downloads', 'processDownloads' in asm)
check('asm_process_queues', 'processQueues' in asm)
check('asm_max_retries', 'max_retries' in asm)
check('asm_save_state', 'saveSyncState' in asm)
check('asm_device_tracking', 'devices' in asm and 'device_id' in asm)
check('asm_storage_management', 'deleteLocalCopies' in asm)
check('asm_sync_dashboard', 'renderDashboard' in asm)
check('asm_force_sync', 'sync-force-sync' in asm)
check('asm_retry_uploads', 'sync-retry-uploads' in asm)
check('asm_clean_local', 'sync-clean-local' in asm)
check('asm_format_bytes', 'formatBytes' in asm)

print('\n═══ 5. PREMIUM FEATURES (Previous) ═══')
conv = open(os.path.join(RENDERER, 'conversation-mode.js')).read()
doc = open(os.path.join(RENDERER, 'document-translator.js')).read()
tm = open(os.path.join(RENDERER, 'translation-memory.js')).read()
vc = open(os.path.join(RENDERER, 'voice-clone-manager.js')).read()
check('conv_class', 'class ConversationMode' in conv)
check('doc_class', 'class DocumentTranslator' in doc)
check('tm_class', 'class TranslationMemory' in tm)
check('lang_detect_class', 'class LanguageDetector' in tm)
check('vc_class', 'class VoiceCloneManager' in vc)

print('\n═══ 6. BACKEND API ROUTES ═══')
check('api_register', "'/api/v1/auth/register'" in s)
check('api_login', "'/api/v1/auth/login'" in s)
check('api_me', "'/api/v1/auth/me'" in s)
check('api_devices', "'/api/v1/auth/devices'" in s)
check('api_translate_text', "'/api/v1/translate/text'" in s)
check('api_translate_speech', "'/api/v1/translate/speech'" in s)
check('api_translate_languages', "'/api/v1/translate/languages'" in s)
check('api_user_history', "'/api/v1/user/history'" in s)
check('api_recordings_upload', "'/api/v1/recordings/upload'" in s)
check('api_recordings_video', "'/api/v1/recordings/:id/video'" in s)
check('api_recordings_list', "'/api/v1/recordings/list'" in s)
check('api_recordings_check', "'/api/v1/recordings/check'" in s)
check('api_recordings_sync', "'/api/v1/recordings/sync'" in s)
check('api_rtc_signal_post', "app.post('/api/v1/rtc/signal'" in s)
check('api_rtc_signal_get', "app.get('/api/v1/rtc/signal'" in s)
check('api_clone_training_data', "'/api/v1/clone/training-data'" in s)
check('api_clone_start_training', "'/api/v1/clone/start-training'" in s)
check('api_admin_stats', "'/api/v1/admin/stats'" in s)
check('api_admin_revenue', "'/api/v1/admin/revenue'" in s)
check('api_multer_500mb', '500 * 1024 * 1024' in s)
check('api_range_requests', 'Content-Range' in s)
check('api_recordings_table', 'CREATE TABLE IF NOT EXISTS recordings' in s)
check('api_sync_queue_table', 'CREATE TABLE IF NOT EXISTS sync_queue' in s)
check('api_device_id_column', 'device_id' in s)
check('api_rtc_sessions', 'rtcSessions' in s)
check('api_device_model_column', 'device_model' in s)
check('api_tags_json_column', 'tags_json' in s)
check('api_quality_score_column', 'quality_score' in s)
check('api_engine_used_column', 'engine_used' in s)

print('\n═══ 7. IPC HANDLERS (main.js) ═══')
ipc_handlers = [
    'save-translation-memory', 'lookup-translation-memory',
    'get-translation-memory-stats', 'clear-translation-memory',
    'get-voice-clones', 'create-voice-clone', 'delete-voice-clone',
    'preview-voice-clone', 'set-active-voice-clone', 'upload-voice-clone-file',
    'extract-document-text', 'browse-document-file',
    'save-clone-bundle', 'get-clone-bundles', 'delete-clone-bundle',
    'play-clone-bundle', 'export-clone-bundles', 'start-clone-training',
    'get-sync-state', 'save-sync-state', 'fetch-remote-bundles',
    'download-remote-bundle', 'upload-bundle-to-cloud',
    'show-sync-notification', 'get-storage-stats', 'delete-local-bundle-copy',
]
for handler in ipc_handlers:
    check(f'ipc_{handler}', f"ipcMain.handle('{handler}'" in m)

print('\n═══ 8. PRELOAD BRIDGES ═══')
preload_apis = [
    'saveTranslationMemory', 'lookupTranslationMemory', 'getTranslationMemoryStats',
    'clearTranslationMemory', 'getVoiceClones', 'createVoiceClone', 'deleteVoiceClone',
    'previewVoiceClone', 'extractDocumentText', 'browseDocumentFile',
    'saveCloneBundle', 'getCloneBundles', 'deleteCloneBundle', 'playCloneBundle',
    'exportCloneBundles', 'startCloneTraining',
    'getSyncState', 'saveSyncState', 'fetchRemoteBundles',
    'downloadRemoteBundle', 'uploadBundleToCloud', 'showSyncNotification',
    'getStorageStats', 'deleteLocalBundleCopy',
]
for api in preload_apis:
    check(f'preload_{api}', api in p)

print('\n═══ 9. HTML INTEGRATION ═══')
scripts = [
    'conversation-mode.js', 'document-translator.js', 'translation-memory.js',
    'voice-clone-manager.js', 'video-recording-manager.js', 'phone-camera-bridge.js',
    'clone-data-archive.js', 'auto-sync-manager.js',
]
for script in scripts:
    check(f'html_{script}', script in h)
css_files = ['premium-features.css', 'video-clone-features.css', 'auto-sync.css']
for css in css_files:
    check(f'html_{css}', css in h)

print('\n═══ 10. CSS FILES ═══')
for css_name in ['premium-features.css', 'video-clone-features.css', 'auto-sync.css']:
    css_path = os.path.join(RENDERER, css_name)
    check(f'css_{css_name}_exists', os.path.exists(css_path))
    if os.path.exists(css_path):
        css_content = open(css_path).read()
        check(f'css_{css_name}_not_empty', len(css_content) > 100)

print('\n═══ 11. SECURITY ═══')
check('sec_path_validation_vc', 'startsWith(path.resolve(vcAudioDir))' in m)
check('sec_path_validation_bundles', 'startsWith(path.resolve(bundlesDir))' in m)
check('sec_csp_header', 'Content-Security-Policy' in h)
check('sec_input_truncation', 'substring(0, 500)' in m)
check('sec_auth_middleware', 'authenticateToken' in s)

print('\n═══ 12. BUNDLE FORMAT ═══')
check('bundle_id', 'bundle_id' in vr)
check('bundle_created_at', 'created_at' in vr)
check('bundle_duration', 'duration_seconds' in vr)
check('bundle_audio_format', "'aac'" in vr and "'wav'" in vr)
check('bundle_audio_size', 'size_bytes' in vr)
check('bundle_video_format', "format: 'h264'" in vr)
check('bundle_transcript_language', "language: 'en'" in vr)
check('bundle_transcript', 'transcript' in vr and 'segments' in vr)
check('bundle_device_model', "model:" in vr)
check('bundle_device_platform', "platform: 'desktop'" in vr)
check('bundle_sync_status', "sync_status: 'pending'" in vr)
check('bundle_training_ready', 'clone_training_ready' in vr)
check('bundle_tags', 'tags: []' in vr)

print('\n═══ 13. CROSS-PLATFORM FIELD MAPPING ═══')
# Upload handler accepts mobile field names
check('upload_accepts_transcript', 'req.body.transcript_text || req.body.transcript' in s)
check('upload_accepts_segments_json', 'req.body.transcript_segments || req.body.segments_json' in s)
check('upload_accepts_id_as_bundle', 'req.body.bundle_id || req.body.id' in s)

# Sync handler accepts both naming conventions
check('sync_accepts_mobile_fields', 'b.transcript_text || b.transcript' in s or "b.transcript?.text || b.transcript_text || b.transcript" in s)
check('sync_accepts_segments_json', 'b.segments_json' in s)

# List handler returns mobile-friendly field names
check('list_returns_transcript', "transcript: r.transcript_text" in s)
check('list_returns_segments_json', "segments_json: r.transcript_segments" in s)
check('list_returns_duration', "duration: r.duration_seconds" in s)

# Field mapping comment block
check('field_mapping_comment', 'CROSS-PLATFORM FIELD MAPPING' in s)

# ═══ Summary ═══
passed = sum(1 for _, ok in results if ok)
failed = sum(1 for _, ok in results if not ok)
print(f'\n{"="*50}')
print(f'  {passed} passed, {failed} failed, {passed + failed} total')
print(f'{"="*50}')

if failed > 0:
    print('\nFailed tests:')
    for name, ok in results:
        if not ok:
            print(f'  ✗ {name}')

if __name__ == '__main__':
    sys.exit(0 if failed == 0 else 1)
