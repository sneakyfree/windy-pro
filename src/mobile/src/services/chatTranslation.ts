/**
 * Windy Chat — Translation Integration (Mobile / React Native)
 * K9: Translation Integration — The Killer Feature (DNA Strand K)
 *
 * K9.1 Auto-translate incoming messages
 * K9.2 Original + translated display
 * K9.3 Per-conversation translation settings
 * K9.4 Translated voice messages (cross-ref K4.3.3)
 * K9.5 Real-time translation in video calls (cross-ref K5.4)
 * K9.6 Group chat multi-language (THE HOLY GRAIL)
 * K9.7 LOCAL by default — zero cloud
 *
 * CRITICAL INVARIANT: Translation is LOCAL by default.
 * User must EXPLICITLY opt-in to cloud fallback.
 * "Your conversations are translated on YOUR device.
 *  We never see your messages. Not even the translations."
 */

import { createLogger } from './LogService';
const log = createLogger('ChatTranslation');

// ── Types ──

export type TranslationMode = 'local_only' | 'local_cloud' | 'off';
export type OriginalDisplayMode = 'always' | 'on_tap' | 'never';

export interface TranslationResult {
  originalText: string;
  translatedText: string;
  srcLang: string;
  tgtLang: string;
  engine: 'local' | 'cloud' | 'cache';
  latencyMs: number;
}

export interface TranslationSettings {
  mode: TranslationMode;
  primaryLanguage: string;
  originalDisplay: OriginalDisplayMode;
}

export interface ConversationTranslationOverride {
  roomId: string;
  targetLanguage: string | null;  // null = use primary
  enabled: boolean;               // false = "Don't translate this chat"
}

export interface GroupLanguageSummary {
  roomId: string;
  languages: Array<{ code: string; flag: string; count: number }>;
  totalLanguages: number;
  translatingFor: number;
}

// ── Translation Cache ──

class TranslationCache {
  private cache: Map<string, string> = new Map();
  private maxSize: number = 1000;

  /**
   * Key format: eventId:targetLang or textHash:srcLang:tgtLang
   */
  get(key: string): string | null {
    const value = this.cache.get(key);
    if (value) {
      // LRU: move to end
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value || null;
  }

  set(key: string, value: string): void {
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  clear(): void {
    this.cache.clear();
  }

  get hitRate(): number {
    return 0; // Track in production
  }
}

// ── K9: Mobile Chat Translation Service ──

export class ChatTranslationService {
  private cache: TranslationCache = new TranslationCache();
  private settings: TranslationSettings = {
    mode: 'local_only',
    primaryLanguage: 'en',
    originalDisplay: 'on_tap',
  };
  private conversationOverrides: Map<string, ConversationTranslationOverride> = new Map();
  private languageDetection: Map<string, string> = new Map(); // senderId → detected language

  // Translation engine references
  private localTranslateFn: ((text: string, src: string, tgt: string) => Promise<string>) | null = null;
  private cloudTranslateFn: ((text: string, src: string, tgt: string) => Promise<string>) | null = null;

  constructor(primaryLanguage: string = 'en') {
    this.settings.primaryLanguage = primaryLanguage;
  }

  /**
   * Set the local translation engine function.
   */
  setLocalEngine(fn: (text: string, src: string, tgt: string) => Promise<string>): void {
    this.localTranslateFn = fn;
  }

  /**
   * Set the cloud translation function (opt-in only).
   */
  setCloudEngine(fn: (text: string, src: string, tgt: string) => Promise<string>): void {
    this.cloudTranslateFn = fn;
  }

  /**
   * Auto-translate an incoming message.
   * K9.1: Auto-Translate Incoming Messages
   *
   * Translation chain (K9.1.2):
   *   1. Local offline engine (Strand E — NLLB/CTranslate2)
   *   2. Cloud API (only if user permits — K9.7)
   *   3. Show original untranslated (never fail silently)
   */
  async translateMessage(
    text: string,
    srcLang: string,
    eventId: string,
    roomId?: string,
  ): Promise<TranslationResult> {
    const startTime = Date.now();

    // Determine target language (per-conversation override or primary)
    const tgtLang = this.getTargetLanguage(roomId);

    // Skip if same language or translation disabled
    if (srcLang === tgtLang || this.settings.mode === 'off') {
      return {
        originalText: text,
        translatedText: text,
        srcLang,
        tgtLang,
        engine: 'cache',
        latencyMs: 0,
      };
    }

    // Check conversation override
    if (roomId) {
      const override = this.conversationOverrides.get(roomId);
      if (override && !override.enabled) {
        return {
          originalText: text,
          translatedText: text,
          srcLang,
          tgtLang,
          engine: 'cache',
          latencyMs: 0,
        };
      }
    }

    // Check cache (keyed by eventId + targetLang)
    const cacheKey = `${eventId}:${tgtLang}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return {
        originalText: text,
        translatedText: cached,
        srcLang,
        tgtLang,
        engine: 'cache',
        latencyMs: Date.now() - startTime,
      };
    }

    // K9.1.2: Translation Engine Priority
    let translatedText: string | null = null;
    let engine: 'local' | 'cloud' = 'local';

    // Priority 1: Local offline engine
    if (this.localTranslateFn) {
      try {
        translatedText = await this.localTranslateFn(text, srcLang, tgtLang);
        engine = 'local';
      } catch (err) {
        log.warn('translateMessage', `local translation failed: ${err}`);
      }
    }

    // Priority 2: Cloud API (ONLY if user permits — K9.7)
    if (!translatedText && this.settings.mode === 'local_cloud' && this.cloudTranslateFn) {
      try {
        translatedText = await this.cloudTranslateFn(text, srcLang, tgtLang);
        engine = 'cloud';
      } catch (err) {
        log.warn('translateMessage', `cloud translation failed: ${err}`);
      }
    }

    // Priority 3: Show original untranslated (never fail silently)
    if (!translatedText) {
      return {
        originalText: text,
        translatedText: text,
        srcLang,
        tgtLang,
        engine: 'local',
        latencyMs: Date.now() - startTime,
      };
    }

    // Cache result
    this.cache.set(cacheKey, translatedText);

    return {
      originalText: text,
      translatedText,
      srcLang,
      tgtLang,
      engine,
      latencyMs: Date.now() - startTime,
    };
  }

  /**
   * Batch translate multiple messages (for group chat scroll).
   * K9.6.3: Performance — lazy translation, batch processing
   */
  async translateBatch(
    messages: Array<{ text: string; srcLang: string; eventId: string }>,
    roomId?: string,
  ): Promise<TranslationResult[]> {
    const results = await Promise.all(
      messages.map(m => this.translateMessage(m.text, m.srcLang, m.eventId, roomId))
    );
    return results;
  }

  // ── K9.2: Display Modes ──

  /**
   * Get the display mode for original text.
   * K9.2.1: Compact mode (default) — original collapsed
   * K9.2.2: Bilingual mode — both shown
   */
  getOriginalDisplayMode(): OriginalDisplayMode {
    return this.settings.originalDisplay;
  }

  setOriginalDisplayMode(mode: OriginalDisplayMode): void {
    this.settings.originalDisplay = mode;
  }

  // ── K9.3: Per-Conversation Settings ──

  /**
   * Set translation override for a conversation.
   * K9.3.1: Conversation Language Override
   */
  setConversationOverride(roomId: string, override: Partial<ConversationTranslationOverride>): void {
    const existing = this.conversationOverrides.get(roomId) || {
      roomId,
      targetLanguage: null,
      enabled: true,
    };
    this.conversationOverrides.set(roomId, { ...existing, ...override, roomId });
  }

  /**
   * Get the target language for a room (override or primary).
   */
  getTargetLanguage(roomId?: string): string {
    if (roomId) {
      const override = this.conversationOverrides.get(roomId);
      if (override?.targetLanguage) return override.targetLanguage;
    }
    return this.settings.primaryLanguage;
  }

  /**
   * Auto-detect sender's language from message text.
   * K9.3.2: Uses fasttext language ID (~1MB model)
   */
  detectLanguage(text: string, senderId: string): string {
    // In production: use fasttext-lid model
    // const detected = fasttext.detect(text);
    // After 3 consistent detections, cache per sender

    const cached = this.languageDetection.get(senderId);
    if (cached) return cached;

    // Stub: return 'unknown' — real implementation uses fasttext
    return 'unknown';
  }

  /**
   * Manually set a sender's language.
   * K9.3.2: "Grant speaks: [Spanish ▾]"
   */
  setSenderLanguage(senderId: string, langCode: string): void {
    this.languageDetection.set(senderId, langCode);
  }

  // ── K9.6: Group Chat Multi-Language ──

  /**
   * Get language summary for a group chat.
   * K9.6.2: "🌍 5 languages in this chat"
   */
  getGroupLanguageSummary(
    roomId: string,
    members: Array<{ userId: string; languages: string[] }>,
  ): GroupLanguageSummary {
    const langFlags: Record<string, string> = {
      en: '🇺🇸', es: '🇪🇸', fr: '🇫🇷', de: '🇩🇪', it: '🇮🇹',
      pt: '🇧🇷', ru: '🇷🇺', zh: '🇨🇳', ja: '🇯🇵', ko: '🇰🇷',
      ar: '🇸🇦', hi: '🇮🇳', tr: '🇹🇷', nl: '🇳🇱', sv: '🇸🇪',
    };

    const langCount: Record<string, number> = {};
    for (const member of members) {
      const lang = member.languages[0] || 'en';
      langCount[lang] = (langCount[lang] || 0) + 1;
    }

    const languages = Object.entries(langCount)
      .map(([code, count]) => ({
        code,
        flag: langFlags[code] || '🌐',
        count,
      }))
      .sort((a, b) => b.count - a.count);

    const userLang = this.settings.primaryLanguage;
    const translatingFor = members.filter(
      m => (m.languages[0] || 'en') !== userLang
    ).length;

    return {
      roomId,
      languages,
      totalLanguages: languages.length,
      translatingFor,
    };
  }

  // ── Settings ──

  updateSettings(settings: Partial<TranslationSettings>): void {
    Object.assign(this.settings, settings);
  }

  getSettings(): TranslationSettings {
    return { ...this.settings };
  }

  clearCache(): void {
    this.cache.clear();
  }
}
