/**
 * Windy Chat — Voice & Video Calling (Mobile / React Native)
 * K5: Video and Voice Calling (DNA Strand K)
 *
 * Mobile-specific VoIP using WebRTC with Matrix signaling.
 * Handles native call UI, earpiece/speaker toggle, and haptics.
 *
 * K5.1 Voice calls, K5.2 Video calls, K5.3 Group calls,
 * K5.4 Translated subtitles, K5.5 Call history, K5.6 PiP
 */

// ── Types ──

export type CallState =
  | 'idle'
  | 'ringing_outgoing'
  | 'ringing_incoming'
  | 'connecting'
  | 'connected'
  | 'on_hold'
  | 'ended';

export type CallType = 'voice' | 'video';
export type CallDirection = 'incoming' | 'outgoing';
export type NetworkQuality = 'excellent' | 'good' | 'poor';
export type CallFilter = 'all' | 'missed' | 'incoming' | 'outgoing';
export type AudioOutput = 'earpiece' | 'speaker' | 'bluetooth';

export interface CallInfo {
  callId: string;
  roomId: string;
  type: CallType;
  direction: CallDirection;
  state: CallState;
  remoteName: string;
  remoteAvatar?: string;
  duration: number;
  networkQuality: NetworkQuality;
  isMuted: boolean;
  isCameraOn: boolean;
  audioOutput: AudioOutput;
}

export interface SubtitleData {
  original: string;
  translated: string;
  srcLang: string;
  tgtLang: string;
  speaker: string;
  timestamp: number;
}

export interface CallHistoryEntry {
  id: string;
  callId: string;
  roomId: string;
  type: CallType;
  direction: CallDirection;
  duration: number;
  endReason: string;
  timestamp: number;
  remoteName: string;
}

// ── Constants ──

export const CALL_TIMEOUT_MS = 30000;
export const MAX_GROUP_PARTICIPANTS = 25;

export const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

// ── K5.1 & K5.2: Mobile Call Manager ──

export class MobileCallManager {
  private state: CallState = 'idle';
  private callType: CallType | null = null;
  private callId: string | null = null;
  private roomId: string | null = null;
  private startTime: number = 0;
  private isMuted: boolean = false;
  private isCameraOn: boolean = true;
  private audioOutput: AudioOutput = 'earpiece';
  private callTimeout: ReturnType<typeof setTimeout> | null = null;

  // Callbacks
  onStateChange?: (state: CallState) => void;
  onRemoteStream?: (stream: any) => void;
  onSubtitle?: (data: SubtitleData) => void;
  onNetworkQuality?: (quality: NetworkQuality) => void;

  /**
   * Start an outgoing call.
   */
  async startCall(roomId: string, type: CallType): Promise<void> {
    if (this.state !== 'idle') {
      throw new Error(`Cannot start call in state: ${this.state}`);
    }

    this.roomId = roomId;
    this.callType = type;
    this.callId = `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.setState('ringing_outgoing');

    // In production:
    // 1. Request microphone (+ camera if video) permission
    // 2. Set up WebRTC via react-native-webrtc
    // 3. Send m.call.invite via Matrix client
    // 4. Handle ICE candidates
    // 5. Set up InCallManager for audio routing

    // import InCallManager from 'react-native-incall-manager';
    // InCallManager.start({ media: type === 'video' ? 'video' : 'audio' });
    // InCallManager.setForceSpeakerphoneOn(type === 'video');

    // Auto-decline timeout
    this.callTimeout = setTimeout(() => {
      if (this.state === 'ringing_outgoing') {
        this.endCall('no_answer');
      }
    }, CALL_TIMEOUT_MS);

    console.log(`📞 Outgoing ${type} call: ${this.callId}`);
  }

  /**
   * Answer an incoming call.
   * K5.1.2: Incoming Call UI (full-screen overlay, ringtone, vibration)
   */
  async answerCall(callId: string): Promise<void> {
    if (this.state !== 'ringing_incoming') {
      throw new Error('No incoming call to answer');
    }

    this.callId = callId;
    this.setState('connecting');

    // In production:
    // 1. Accept WebRTC offer, create answer
    // 2. Send m.call.answer via Matrix
    // 3. Establish peer connection

    // import { Vibration } from 'react-native';
    // Vibration.cancel(); // Stop incoming ring vibration

    this.startTime = Date.now();
    this.setState('connected');

    console.log(`📞 Answered call: ${this.callId}`);
  }

  /**
   * Handle an incoming call event.
   */
  handleIncomingCall(
    callId: string,
    callType: CallType,
    callerName: string,
  ): { callId: string; callType: CallType; caller: string } | null {
    if (this.state !== 'idle') {
      // Busy — reject
      console.log(`📞 Rejecting call from ${callerName} — busy`);
      return null;
    }

    this.setState('ringing_incoming');

    // In production:
    // import { Vibration } from 'react-native';
    // Vibration.vibrate([0, 500, 200, 500], true); // Ring pattern
    // Play ringtone via react-native-sound

    this.callTimeout = setTimeout(() => {
      if (this.state === 'ringing_incoming') {
        this.declineCall('timeout');
      }
    }, CALL_TIMEOUT_MS);

    return { callId, callType, caller: callerName };
  }

  /** Decline incoming call. */
  declineCall(reason: string = 'user_declined'): void {
    if (this.callTimeout) clearTimeout(this.callTimeout);
    // Send m.call.hangup
    this.setState('idle');
    this.cleanup();
  }

  /** End current call. */
  endCall(reason: string = 'user_hangup'): void {
    if (this.callTimeout) clearTimeout(this.callTimeout);
    const duration = this.startTime ? (Date.now() - this.startTime) / 1000 : 0;

    // In production: InCallManager.stop();

    MobileCallHistory.addEntry({
      id: `hist_${Date.now()}`,
      callId: this.callId || '',
      roomId: this.roomId || '',
      type: this.callType || 'voice',
      direction: 'outgoing', // Simplified
      duration,
      endReason: reason,
      timestamp: Date.now(),
      remoteName: '',
    });

    this.setState('ended');
    this.cleanup();
    this.setState('idle');
  }

  // ── K5.1.3: In-Call Controls ──

  /** Toggle mute. */
  toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    // In production: WebRTC audio track .enabled = !this.isMuted
    return this.isMuted;
  }

  /** Toggle camera. */
  toggleCamera(): boolean {
    this.isCameraOn = !this.isCameraOn;
    // In production: WebRTC video track .enabled = this.isCameraOn
    return this.isCameraOn;
  }

  /**
   * Switch front/rear camera.
   * K5.2.1: Camera Management (mobile)
   */
  async switchCamera(): Promise<void> {
    // In production:
    // import { mediaDevices } from 'react-native-webrtc';
    // localStream.getVideoTracks()[0]._switchCamera();
    console.log('📷 Camera switched');
  }

  /**
   * Cycle audio output: earpiece → speaker → bluetooth.
   * K5.1.3: Speaker/earpiece toggle
   */
  cycleAudioOutput(): AudioOutput {
    const outputs: AudioOutput[] = ['earpiece', 'speaker', 'bluetooth'];
    const idx = outputs.indexOf(this.audioOutput);
    this.audioOutput = outputs[(idx + 1) % outputs.length];

    // In production:
    // InCallManager.setForceSpeakerphoneOn(this.audioOutput === 'speaker');
    // For bluetooth: use react-native-bluetooth-audio

    return this.audioOutput;
  }

  /** Toggle hold. */
  toggleHold(): boolean {
    if (this.state === 'connected') {
      this.setState('on_hold');
      return true;
    } else if (this.state === 'on_hold') {
      this.setState('connected');
      return false;
    }
    return false;
  }

  /** Get call info. */
  getCallInfo(): CallInfo | null {
    if (this.state === 'idle') return null;

    return {
      callId: this.callId || '',
      roomId: this.roomId || '',
      type: this.callType || 'voice',
      direction: 'outgoing',
      state: this.state,
      remoteName: '',
      duration: this.startTime ? (Date.now() - this.startTime) / 1000 : 0,
      networkQuality: 'good',
      isMuted: this.isMuted,
      isCameraOn: this.isCameraOn,
      audioOutput: this.audioOutput,
    };
  }

  // ── Internal ──

  private setState(state: CallState): void {
    this.state = state;
    this.onStateChange?.(state);
  }

  private cleanup(): void {
    this.callId = null;
    this.roomId = null;
    this.callType = null;
    this.startTime = 0;
    this.isMuted = false;
    this.isCameraOn = true;
    this.audioOutput = 'earpiece';
  }
}

// ── K5.4: Translated Subtitles (Mobile) ──

/**
 * Real-time translated subtitles for mobile video calls.
 * Same architecture as desktop — all processing local.
 */
export class MobileSubtitleEngine {
  private isActive: boolean = false;
  private srcLang: string;
  private tgtLang: string;
  private translateFn: (text: string, src: string, tgt: string) => Promise<string>;

  onSubtitle?: (data: SubtitleData) => void;

  constructor(
    srcLang: string,
    tgtLang: string,
    translateFn: (text: string, src: string, tgt: string) => Promise<string>,
  ) {
    this.srcLang = srcLang;
    this.tgtLang = tgtLang;
    this.translateFn = translateFn;
  }

  start(): void {
    this.isActive = true;
    // In production: tap into WebRTC remote audio stream
    // Route to local Whisper STT → translate → emit subtitle
    console.log('🎬 Mobile subtitle engine started');
  }

  stop(): void {
    this.isActive = false;
    console.log('🎬 Mobile subtitle engine stopped');
  }

  toggle(): boolean {
    this.isActive = !this.isActive;
    return this.isActive;
  }

  /**
   * Process a subtitle from STT output.
   */
  async processTranscript(original: string, speaker: string): Promise<void> {
    if (!this.isActive || !original) return;

    try {
      const translated = await this.translateFn(original, this.srcLang, this.tgtLang);

      this.onSubtitle?.({
        original,
        translated,
        srcLang: this.srcLang,
        tgtLang: this.tgtLang,
        speaker,
        timestamp: Date.now(),
      });
    } catch (err) {
      console.error('Subtitle translation error:', err);
    }
  }
}

// ── K5.5: Call History (Mobile) ──

export class MobileCallHistory {
  private static entries: CallHistoryEntry[] = [];

  static addEntry(entry: CallHistoryEntry): void {
    MobileCallHistory.entries.unshift(entry);
    if (MobileCallHistory.entries.length > 100) {
      MobileCallHistory.entries = MobileCallHistory.entries.slice(0, 100);
    }
  }

  static getEntries(filter: CallFilter = 'all'): CallHistoryEntry[] {
    if (filter === 'all') return MobileCallHistory.entries;
    return MobileCallHistory.entries.filter(e => {
      switch (filter) {
        case 'missed': return e.endReason === 'no_answer' && e.direction === 'incoming';
        case 'incoming': return e.direction === 'incoming';
        case 'outgoing': return e.direction === 'outgoing';
        default: return true;
      }
    });
  }

  static getMissedCount(): number {
    return MobileCallHistory.entries.filter(e =>
      e.endReason === 'no_answer' && e.direction === 'incoming'
    ).length;
  }

  static clearHistory(): void {
    MobileCallHistory.entries = [];
  }
}

// ── K5.6: Picture-in-Picture (Mobile) ──

/**
 * PiP for mobile video calls.
 * iOS: AVPictureInPictureController
 * Android: PiP activity mode
 */
export class MobilePiP {
  static async enter(): Promise<boolean> {
    // In production:
    // iOS: Use react-native-pip or AVPictureInPictureController
    // Android: Use PiP API via react-native module
    //
    // import PIPModule from 'react-native-pip-android';
    // PIPModule.enterPipMode(300, 200); // width, height ratio
    console.log('🖼️ Entering PiP mode');
    return true;
  }

  static async exit(): Promise<boolean> {
    console.log('🖼️ Exiting PiP mode');
    return true;
  }
}

// ── Utility ──

export function formatCallDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
