# Windy Pro — Antigravity Mega-Prompt
## Batch Mode + Quality Engine Overhaul

You are working on **Windy Pro**, an Electron desktop app for voice-to-text transcription. The project is at `/home/sneakyfree/windy-pro/`.

## Project Structure
```
src/
  client/desktop/
    main.js          — Electron main process
    preload.js       — IPC bridge
    renderer/
      app.js         — Main app class (WindyApp)
      settings.js    — Settings panel
      index.html     — UI
  engine/
    server.py        — Local Python WebSocket server (faster-whisper)
    transcriber.py   — Local transcription engine
  cloud/
    api.py           — Cloud API server (runs on Veron GPU server)
```

## Current State
- The app has multiple transcription engines: Local (faster-whisper), WindyPro Cloud, Deepgram, Groq, OpenAI
- Local and Cloud engines stream audio in chunks and transcribe in real-time
- Cloud server runs on Veron (RTX 5090, 32GB VRAM) at `wss://windypro.thewindstorm.uk`
- The real-time streaming quality is mediocre because Whisper is a batch model being forced into streaming mode
- Users want Wispr-Flow-level quality: perfect sentences, punctuation, paragraph structure

## YOUR TASK: Implement "Batch Mode" — The Flagship Feature

### 1. Add "Batch Mode" Recording Option

In `settings.js`, add a new setting in the SIMPLE MODE section:

```
Recording Mode:
  ○ Live — words appear as you speak (lower quality)
  ○ Batch — record first, get polished text on stop (highest quality) ← DEFAULT
```

When Batch mode is selected:
- During recording: Show a **pulsing green strobe** and recording timer. Do NOT show any transcribed text.
- Show a subtle message like "🎙️ Recording... text will appear when you stop"
- On stop: Show "✨ Processing..." state, send audio to cloud, display polished result

### 2. Add Max Duration Setting

Below the recording mode:

```
Max Recording: [5 min ▾] [10 min ▾] [15 min ▾] [30 min ▾]
```

Use radio buttons or a select dropdown. Default: 10 minutes.
When the timer hits the max, auto-stop and process.
Show a countdown warning at 30 seconds before max ("⏰ 30s remaining...").

### 3. Implement Batch Audio Capture

In `app.js`, add a new method `startBatchRecording()`:

```javascript
async startBatchRecording() {
  // 1. Get mic access
  const stream = await navigator.mediaDevices.getUserMedia({ 
    audio: { 
      channelCount: 1, 
      sampleRate: 16000,
      echoCancellation: true,
      noiseSuppression: true 
    } 
  });
  
  // 2. Use MediaRecorder to capture full audio
  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') 
    ? 'audio/webm;codecs=opus' : 'audio/webm';
  this._batchRecorder = new MediaRecorder(stream, { mimeType });
  this._batchChunks = [];
  
  this._batchRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) this._batchChunks.push(e.data);
  };
  
  // 3. Record continuously (timeslice = 1000ms for smooth data flow)
  this._batchRecorder.start(1000);
  
  // 4. Set up max duration auto-stop
  const maxMin = parseInt(localStorage.getItem('windy_maxRecordingMin') || '10');
  this._batchMaxTimer = setTimeout(() => {
    this.showReconnectToast('⏰ Max recording time reached. Processing...');
    this.stopBatchRecording();
  }, maxMin * 60 * 1000);
  
  // 5. Warning at 30s before max
  this._batchWarnTimer = setTimeout(() => {
    this.showReconnectToast(`⏰ ${maxMin} min limit in 30 seconds...`);
  }, (maxMin * 60 - 30) * 1000);
  
  // 6. UI state
  this.isRecording = true;
  this.setState('listening');
  this._batchStream = stream;
  this.recordingStartedAt = new Date().toISOString();
  this.transcriptContent.innerHTML = '<p class="batch-recording-hint" style="color:#888;text-align:center;padding:20px;">🎙️ Recording... text will appear when you stop</p>';
}
```

### 4. Implement Batch Stop + Cloud Processing

```javascript
async stopBatchRecording() {
  // Clear timers
  clearTimeout(this._batchMaxTimer);
  clearTimeout(this._batchWarnTimer);
  this.isRecording = false;
  
  // Stop recorder
  return new Promise((resolve) => {
    this._batchRecorder.onstop = async () => {
      // Stop mic
      this._batchStream.getTracks().forEach(t => t.stop());
      
      // Build audio blob
      const audioBlob = new Blob(this._batchChunks, { type: this._batchRecorder.mimeType });
      this._batchChunks = [];
      
      // Show processing state
      this.setState('buffering');
      this.transcriptContent.innerHTML = '<p style="color:#4ECDC4;text-align:center;padding:20px;">✨ Processing your recording...<br><span style="font-size:12px;color:#888;">This may take a moment for longer recordings</span></p>';
      
      try {
        // Choose engine
        const engine = localStorage.getItem('windy_engine') || this.transcriptionEngine;
        let result;
        
        if (engine === 'cloud' || engine === 'local') {
          // Use WindyPro Cloud batch endpoint
          result = await this._batchTranscribeCloud(audioBlob);
        } else if (engine === 'groq') {
          result = await this._transcribeWithApi('groq', localStorage.getItem('windy_groqApiKey'), audioBlob);
        } else if (engine === 'openai') {
          result = await this._transcribeWithApi('openai', localStorage.getItem('windy_openaiApiKey'), audioBlob);
        } else {
          // Default to cloud
          result = await this._batchTranscribeCloud(audioBlob);
        }
        
        // Display polished result
        this._displayBatchResult(result);
      } catch (err) {
        console.error('[Batch] Transcription failed:', err);
        this.showReconnectToast(`⚠️ Processing failed: ${err.message}`);
        this.setState('error');
      }
      
      resolve();
    };
    
    this._batchRecorder.stop();
  });
}
```

### 5. Cloud Batch Transcription Endpoint

Add a new REST endpoint to the cloud API (`src/cloud/api.py`):

```python
@app.post("/api/v1/transcribe/batch")
async def batch_transcribe(
    request: Request,
    authorization: str = Header(None)
):
    """
    Batch transcription — upload complete audio, get polished text back.
    Supports up to 30 minutes of audio.
    Uses large-v3 on GPU + LLM cleanup for highest quality.
    """
    # Auth
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing auth")
    user = decode_token(authorization.replace("Bearer ", ""))
    
    # Get audio from request body
    body = await request.body()
    if len(body) > 100_000_000:  # 100MB max
        raise HTTPException(status_code=413, detail="Audio too large (100MB max)")
    
    # Save to temp file
    import tempfile
    with tempfile.NamedTemporaryFile(suffix='.webm', delete=False) as tmp:
        tmp.write(body)
        tmp_path = tmp.name
    
    try:
        # Transcribe with large-v3 on GPU
        model = await get_cloud_model()
        
        # Use ffmpeg to convert to proper format if needed
        import subprocess
        wav_path = tmp_path + '.wav'
        subprocess.run([
            'ffmpeg', '-y', '-i', tmp_path,
            '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav_path
        ], capture_output=True, check=True)
        
        # Transcribe the full audio
        segments, info = model.transcribe(
            wav_path,
            language="en",
            beam_size=5,
            best_of=5,
            vad_filter=True,
            condition_on_previous_text=True,
            word_timestamps=True,
            no_speech_threshold=0.6
        )
        
        # Collect all segments
        full_segments = list(segments)
        raw_text = " ".join(seg.text.strip() for seg in full_segments if seg.text.strip())
        
        # LLM cleanup pass (optional — use a small local model)
        polished_text = await _llm_cleanup(raw_text)
        
        return {
            "text": polished_text,
            "raw_text": raw_text,
            "duration": info.duration,
            "language": info.language,
            "segments": [
                {
                    "text": seg.text.strip(),
                    "start": seg.start,
                    "end": seg.end,
                    "words": [{"word": w.word, "start": w.start, "end": w.end} for w in (seg.words or [])]
                }
                for seg in full_segments if seg.text.strip()
            ]
        }
    finally:
        import os
        os.unlink(tmp_path)
        if os.path.exists(wav_path):
            os.unlink(wav_path)


async def _llm_cleanup(raw_text: str) -> str:
    """
    Use a small LLM to clean up transcription:
    - Fix punctuation and capitalization
    - Add paragraph breaks at natural points
    - Fix common transcription errors
    - Remove filler words (um, uh, like, you know)
    
    Uses the Veron GPU's spare capacity.
    If no LLM is available, falls back to rule-based cleanup.
    """
    # Try using a local LLM via Ollama or vLLM if available
    try:
        import httpx
        # Try Ollama first (commonly installed)
        response = await httpx.AsyncClient().post(
            "http://localhost:11434/api/generate",
            json={
                "model": "llama3.2:3b",  # Small, fast model
                "prompt": f"""Clean up this voice transcription. Fix punctuation, capitalization, and paragraph structure. Remove filler words (um, uh, like, you know). Keep the original meaning exactly. Do not add or change any words. Only fix formatting.

Transcription:
{raw_text}

Cleaned text:""",
                "stream": False,
                "options": {"temperature": 0.1}
            },
            timeout=30.0
        )
        if response.status_code == 200:
            data = response.json()
            cleaned = data.get("response", "").strip()
            if cleaned and len(cleaned) > len(raw_text) * 0.5:
                return cleaned
    except Exception:
        pass
    
    # Fallback: rule-based cleanup
    import re
    text = raw_text
    # Capitalize first letter of sentences
    text = re.sub(r'(?<=[.!?]\s)(\w)', lambda m: m.group(1).upper(), text)
    if text:
        text = text[0].upper() + text[1:]
    # Add period at end if missing
    if text and text[-1] not in '.!?':
        text += '.'
    # Remove common fillers
    for filler in [' um ', ' uh ', ' like, ', ' you know, ', ' I mean, ']:
        text = text.replace(filler, ' ')
    # Clean up multiple spaces
    text = re.sub(r' +', ' ', text)
    return text.strip()
```

### 6. Client-side Batch Cloud Upload

In `app.js`, add:

```javascript
async _batchTranscribeCloud(audioBlob) {
  const token = this.cloudToken || localStorage.getItem('windy_cloudToken');
  const cloudUrl = (this.cloudUrl || localStorage.getItem('windy_cloudUrl') || 'https://windypro.thewindstorm.uk')
    .replace('wss://', 'https://');
  
  if (!token) {
    throw new Error('Not signed in to WindyPro Cloud. Open Settings to sign in.');
  }
  
  const response = await fetch(`${cloudUrl}/api/v1/transcribe/batch`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/octet-stream'
    },
    body: audioBlob
  });
  
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Cloud error ${response.status}: ${err}`);
  }
  
  const data = await response.json();
  return data.text || data.raw_text || '';
}
```

### 7. Display Batch Result

```javascript
_displayBatchResult(text) {
  if (!text || !text.trim()) {
    this.transcriptContent.innerHTML = '<p style="color:#888;text-align:center;">No speech detected in recording.</p>';
    this.setState('idle');
    return;
  }
  
  // Split into paragraphs (respect existing line breaks, or add them every ~3 sentences)
  const paragraphs = text.split(/\n+/).filter(p => p.trim());
  
  // Build formatted HTML
  let html = '';
  paragraphs.forEach(p => {
    html += `<p class="transcript-para" style="margin:0 0 12px 0;line-height:1.5;">${p.trim()}</p>`;
  });
  
  this.transcriptContent.innerHTML = html;
  this.transcriptContent.contentEditable = 'true';
  
  // Update transcript array for copy/paste
  this.transcript = [{ text: text.trim(), partial: false, start: 0, end: 0, confidence: 1, words: [] }];
  this.updateWordCount();
  this.setState('idle');
  
  // Archive
  if (window.windyAPI?.archiveTranscript) {
    const route = this.archiveRouteSelect?.value || 'local';
    if (route !== 'off') {
      window.windyAPI.archiveTranscript({
        text: text.trim(),
        startedAt: this.recordingStartedAt,
        endedAt: new Date().toISOString(),
        route
      });
    }
  }
  this.recordingStartedAt = null;
}
```

### 8. Update toggleRecording

Modify `toggleRecording()` in `app.js` to check recording mode:

```javascript
toggleRecording() {
  const engine = localStorage.getItem('windy_engine') || this.transcriptionEngine;
  const recordingMode = localStorage.getItem('windy_recordingMode') || 'batch';
  
  if (this.isRecording) {
    // Stop based on current mode
    if (this._batchRecorder) {
      this.stopBatchRecording();
    } else if (['deepgram', 'groq', 'openai'].includes(engine) && this._apiMediaRecorder) {
      this.stopApiRecording();
    } else {
      this.stopRecording();
    }
  } else {
    // Start based on mode
    if (recordingMode === 'batch') {
      this.startBatchRecording();
    } else if (['deepgram', 'groq', 'openai'].includes(engine)) {
      this.startApiRecording(engine);
    } else {
      this.startRecording();
    }
  }
}
```

### 9. Settings UI for Recording Mode

Add this in `settings.js` HTML, in the SIMPLE MODE section after "Show live words while recording":

```html
<div class="setting-row">
  <label>Recording Mode</label>
  <select id="recordingModeSelect">
    <option value="batch" selected>✨ Batch — polished text on stop (best quality)</option>
    <option value="live">📝 Live — words appear as you speak (faster, lower quality)</option>
  </select>
</div>
<p class="settings-hint" id="recordingModeHint">Records audio, then processes everything at once for the best possible quality. Like Wispr Flow but with longer recordings (up to 30 min).</p>

<div class="setting-row" id="maxDurationRow">
  <label>Max Recording</label>
  <select id="maxRecordingSelect">
    <option value="5">5 minutes</option>
    <option value="10" selected>10 minutes</option>
    <option value="15">15 minutes</option>
    <option value="30">30 minutes</option>
  </select>
</div>
<p class="settings-hint">Longer recordings = more context = better quality. Processing time increases with length.</p>
```

Add change handlers in the `setupEventListeners()` method:

```javascript
// Recording mode
const recordingModeSelect = this.panel.querySelector('#recordingModeSelect');
if (recordingModeSelect) {
  recordingModeSelect.addEventListener('change', (e) => {
    this.saveSetting('recordingMode', e.target.value);
    const hint = this.panel.querySelector('#recordingModeHint');
    const maxRow = this.panel.querySelector('#maxDurationRow');
    if (e.target.value === 'batch') {
      hint.textContent = 'Records audio, then processes everything at once for the best possible quality. Like Wispr Flow but with longer recordings.';
      if (maxRow) maxRow.style.display = 'flex';
    } else {
      hint.textContent = 'Words appear in real-time as you speak. Faster feedback but lower quality.';
      if (maxRow) maxRow.style.display = 'none';
    }
  });
}

// Max recording duration
const maxRecordingSelect = this.panel.querySelector('#maxRecordingSelect');
if (maxRecordingSelect) {
  maxRecordingSelect.addEventListener('change', (e) => {
    this.saveSetting('maxRecordingMin', e.target.value);
  });
}
```

### 10. Settings Restore

In the settings restore section, add:

```javascript
if (settings.recordingMode) {
  const modeSelect = this.panel.querySelector('#recordingModeSelect');
  if (modeSelect) modeSelect.value = settings.recordingMode;
  // Trigger change to update hints
  modeSelect?.dispatchEvent(new Event('change'));
}
if (settings.maxRecordingMin) {
  const maxSelect = this.panel.querySelector('#maxRecordingSelect');
  if (maxSelect) maxSelect.value = settings.maxRecordingMin;
}
```

## IMPORTANT NOTES

1. **Default should be Batch mode** — it gives the best first impression
2. **Default engine should be Local** — works out of the box, no setup
3. **The cloud batch endpoint is separate from the WebSocket endpoint** — it's a POST that receives the full audio file
4. **The LLM cleanup is optional** — if Ollama isn't running on Veron, fall back to rule-based cleanup
5. **Test with real audio** — make sure MediaRecorder produces audio that ffmpeg can convert
6. **The processing state should feel premium** — maybe add a subtle animation or progress indicator
7. **Batch mode + Cloud engine = the premium experience** — this is what we sell
8. **The `saveSetting` method saves to both IPC store AND localStorage** with `windy_` prefix — use `localStorage.getItem('windy_recordingMode')` to read in app.js

## Files to Modify
- `src/client/desktop/renderer/app.js` — Add batch recording/processing methods
- `src/client/desktop/renderer/settings.js` — Add recording mode + max duration UI
- `src/cloud/api.py` — Add `/api/v1/transcribe/batch` endpoint (ON VERON SERVER)

## DO NOT
- Remove any existing engine options (local, cloud, deepgram, groq, openai)
- Change the existing WebSocket streaming behavior
- Break the existing live transcription modes
- Remove the settings panel structure
