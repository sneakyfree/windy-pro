"""
Windy Pro — Video Recording & Clone Training Test Suite
Structural tests: Video Recording, Phone Camera Bridge, Clone Data Archive,
Backend API routes, IPC handlers, Preload bridges
"""
import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RENDERER = os.path.join(BASE_DIR, 'src', 'client', 'desktop', 'renderer')
MAIN = os.path.join(BASE_DIR, 'src', 'client', 'desktop', 'main.js')
PRELOAD = os.path.join(BASE_DIR, 'src', 'client', 'desktop', 'preload.js')
INDEX = os.path.join(BASE_DIR, 'src', 'client', 'desktop', 'renderer', 'index.html')
SERVER = os.path.join(BASE_DIR, 'account-server', 'server.js')

m = open(MAIN).read()
p = open(PRELOAD).read()
h = open(INDEX).read()
s = open(SERVER).read()

passed = failed = 0
def check(name, cond):
    global passed, failed
    if cond: print(f'  PASS {name}'); passed += 1
    else: print(f'  FAIL {name}'); failed += 1

# ═══ Feature 1: Video Recording ═══
vr = open(os.path.join(RENDERER, 'video-recording-manager.js')).read()
check('vr_file_exists', os.path.exists(os.path.join(RENDERER, 'video-recording-manager.js')))
check('vr_class', 'class VideoRecordingManager' in vr)
check('vr_camera_dropdown', 'vr-camera-select' in vr)
check('vr_camera_options', 'No Camera' in vr and 'Phone Camera' in vr)
check('vr_live_preview', 'vr-preview' in vr and 'startPreview' in vr)
check('vr_media_recorder', 'MediaRecorder' in vr)
check('vr_video_audio', 'getVideoTracks' in vr and 'getAudioTracks' in vr)
check('vr_quality_presets', '480p' in vr and '720p' in vr and '1080p' in vr)
check('vr_bundle_format', 'bundle_id' in vr and 'clone_training_ready' in vr)
check('vr_subtitle_sync', 'vr-subtitles' in vr and 'timeupdate' in vr)
check('vr_transcript_segments', 'transcriptSegments' in vr)
check('vr_save_bundle', 'saveCloneBundle' in vr)
check('vr_waveform', 'vr-audio-wave' in vr)
check('vr_recording_indicator', 'vr-rec-indicator' in vr)
check('vr_auto_record', 'auto-record' in vr)
check('vr_live_transcription', 'startLiveTranscription' in vr)
check('vr_mic_select', 'vr-mic-select' in vr)

# ═══ Feature 2: Phone Camera Bridge ═══
pcb = open(os.path.join(RENDERER, 'phone-camera-bridge.js')).read()
check('pcb_file_exists', os.path.exists(os.path.join(RENDERER, 'phone-camera-bridge.js')))
check('pcb_class', 'class PhoneCameraBridge' in pcb)
check('pcb_qr_code', 'pcb-qr' in pcb and 'generateQRPlaceholder' in pcb)
check('pcb_webrtc', 'RTCPeerConnection' in pcb)
check('pcb_signaling', '/api/v1/rtc/signal' in pcb)
check('pcb_session_token', 'sessionToken' in pcb)
check('pcb_switch_camera', 'switch-camera' in pcb)
check('pcb_quality_indicator', 'pcb-latency' in pcb and 'pcb-resolution' in pcb and 'pcb-fps' in pcb)
check('pcb_stun_servers', 'stun.l.google.com' in pcb)
check('pcb_ice_candidate', 'onicecandidate' in pcb)
check('pcb_connection_state', 'onconnectionstatechange' in pcb)
check('pcb_offer_answer', 'createOffer' in pcb and 'setRemoteDescription' in pcb)
check('pcb_disconnect', 'disconnect' in pcb)
check('pcb_get_stream', 'getStream' in pcb)

# ═══ Feature 3: Clone Data Archive ═══
cda = open(os.path.join(RENDERER, 'clone-data-archive.js')).read()
check('cda_file_exists', os.path.exists(os.path.join(RENDERER, 'clone-data-archive.js')))
check('cda_class', 'class CloneDataArchive' in cda)
check('cda_bundle_cards', 'renderBundleCard' in cda)
check('cda_filter_video', "value=\"video\"" in cda)
check('cda_filter_audio', "value=\"audio\"" in cda)
check('cda_filter_date', 'today' in cda and 'week' in cda and 'month' in cda)
check('cda_filter_source', 'desktop' in cda and 'mobile' in cda)
check('cda_bulk_export', 'exportCloneBundles' in cda)
check('cda_storage_stats', 'computeStats' in cda)
check('cda_training_button', 'startCloneTraining' in cda)
check('cda_training_validation', 'readyBundles' in cda and 'at least 3' in cda)
check('cda_select_all', 'cda-select-all' in cda)
check('cda_delete_bundle', 'deleteCloneBundle' in cda)

# ═══ Backend API Routes ═══
check('api_recordings_upload', "'/api/v1/recordings/upload'" in s)
check('api_recordings_video', "'/api/v1/recordings/:id/video'" in s)
check('api_rtc_signal_post', "app.post('/api/v1/rtc/signal'" in s)
check('api_rtc_signal_get', "app.get('/api/v1/rtc/signal'" in s)
check('api_clone_training_data', "'/api/v1/clone/training-data'" in s)
check('api_clone_start_training', "'/api/v1/clone/start-training'" in s)
check('api_video_upload_500mb', '500 * 1024 * 1024' in s)
check('api_range_requests', 'Content-Range' in s and '206' in s)
check('api_recordings_table', 'CREATE TABLE IF NOT EXISTS recordings' in s)
check('api_rtc_sessions_map', 'rtcSessions' in s)
check('api_training_validation', 'bundle_ids.length < 3' in s)

# ═══ IPC Handlers ═══
check('ipc_save_bundle', "ipcMain.handle('save-clone-bundle'" in m)
check('ipc_get_bundles', "ipcMain.handle('get-clone-bundles'" in m)
check('ipc_delete_bundle', "ipcMain.handle('delete-clone-bundle'" in m)
check('ipc_play_bundle', "ipcMain.handle('play-clone-bundle'" in m)
check('ipc_export_bundles', "ipcMain.handle('export-clone-bundles'" in m)
check('ipc_start_training', "ipcMain.handle('start-clone-training'" in m)
check('ipc_bundle_path_validation', "startsWith(path.resolve(bundlesDir))" in m)

# ═══ Preload Bridges ═══
check('preload_save_bundle', 'saveCloneBundle' in p)
check('preload_get_bundles', 'getCloneBundles' in p)
check('preload_delete_bundle', 'deleteCloneBundle' in p)
check('preload_play_bundle', 'playCloneBundle' in p)
check('preload_export_bundles', 'exportCloneBundles' in p)
check('preload_start_training', 'startCloneTraining' in p)

# ═══ HTML Integration ═══
check('html_vr_script', 'video-recording-manager.js' in h)
check('html_pcb_script', 'phone-camera-bridge.js' in h)
check('html_cda_script', 'clone-data-archive.js' in h)
check('html_video_css', 'video-clone-features.css' in h)

# ═══ CSS ═══
css = open(os.path.join(RENDERER, 'video-clone-features.css')).read()
check('css_vr_manager', '.vr-manager' in css)
check('css_pcb_overlay', '.pcb-overlay' in css)
check('css_cda_archive', '.cda-archive' in css)
check('css_recording_indicator', '.vr-recording-indicator' in css)
check('css_qr_grid', '.pcb-qr-grid' in css)
check('css_bundle_card', '.cda-bundle-card' in css)

# ═══ Bundle Format ═══
check('bundle_format_id', 'bundle_id' in vr)
check('bundle_format_duration', 'duration_seconds' in vr)
check('bundle_format_audio', "'format': 'opus'" in vr or "format: 'opus'" in vr)
check('bundle_format_video', "'format': 'vp9'" in vr or "format: 'vp9'" in vr)
check('bundle_format_transcript', "'segments'" in vr or "segments:" in vr)
check('bundle_format_device', "'platform': 'desktop'" in vr or "platform: 'desktop'" in vr)
check('bundle_format_sync', 'sync_status' in vr)
check('bundle_format_training', 'clone_training_ready' in vr)

print(f'\n{passed} passed, {failed} failed, {passed + failed} total')
