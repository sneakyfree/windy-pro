/**
 * Windy Chat — Translation Middleware
 * 
 * Hooks into the chat message pipeline to auto-translate messages
 * using Windy Pro's on-device translation engines. All translation
 * happens locally — nothing leaves the user's device.
 * 
 * Uses a persistent WebSocket connection to the Python server
 * with request-id tracking and auto-reconnect.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

class ChatTranslator {
  constructor(store) {
    this.store = store;
    this.cache = new Map(); // LRU cache for repeated phrases
    this.maxCacheSize = 500;
    this._ws = null;
    this._wsReady = false;
    this._pending = new Map(); // requestId → { resolve, reject, timeout }
    this._requestCounter = 0;
    this._reconnectTimer = null;
    this._available = false; // Whether translation engine is reachable
  }

  /**
   * Check if translation engine is available
   */
  isAvailable() {
    return this._available && this._wsReady;
  }

  /**
   * Translate text using Windy's local translation engine
   * @param {string} text - Text to translate
   * @param {string} srcLang - Source language code (e.g., 'en')
   * @param {string} tgtLang - Target language code (e.g., 'es')
   * @returns {Promise<string>} Translated text
   */
  async translate(text, srcLang, tgtLang) {
    if (!text || !srcLang || !tgtLang || srcLang === tgtLang) {
      return text;
    }

    // Check cache first
    const cacheKey = `${srcLang}:${tgtLang}:${text}`;
    if (this.cache.has(cacheKey)) {
      const value = this.cache.get(cacheKey);
      // P2-M4: Move to end (most recently used) for proper LRU
      this.cache.delete(cacheKey);
      this.cache.set(cacheKey, value);
      return value;
    }

    try {
      const translated = await this._sendTranslationRequest(text, srcLang, tgtLang);
      this._available = true;
      
      // Cache the result (LRU eviction)
      if (this.cache.size >= this.maxCacheSize) {
        const firstKey = this.cache.keys().next().value;
        this.cache.delete(firstKey);
      }
      this.cache.set(cacheKey, translated);
      
      return translated;
    } catch (err) {
      console.error('[ChatTranslator] Translation failed:', err.message);
      this._available = false;
      // Throw with specific type so UI can show "translation unavailable" badge
      const unavailableErr = new Error(`Translation unavailable: ${err.message}`);
      unavailableErr.translationUnavailable = true;
      throw unavailableErr;
    }
  }

  /**
   * Send a translation request over the persistent WebSocket
   */
  async _sendTranslationRequest(text, srcLang, tgtLang) {
    const ws = await this._getWebSocket();
    const requestId = `tr_${++this._requestCounter}`;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this._pending.delete(requestId);
        reject(new Error('Translation timeout (10s)'));
      }, 10000);

      this._pending.set(requestId, { resolve, reject, timeout });

      ws.send(JSON.stringify({
        type: 'translate',
        request_id: requestId,
        text: text,
        source_lang: srcLang,
        target_lang: tgtLang
      }));
    });
  }

  /**
   * Get or create a persistent WebSocket connection
   */
  async _getWebSocket() {
    if (this._ws && this._wsReady) {
      return this._ws;
    }

    // If connection is in progress, wait for it
    if (this._connectPromise) {
      return this._connectPromise;
    }

    // P0-R1: Don't clear _connectPromise in finally — let close/error handlers clear it
    this._connectPromise = this._createWebSocket();
    return this._connectPromise;
  }

  /**
   * Create a new WebSocket connection with event handlers
   */
  _createWebSocket() {
    const serverHost = this.store.get('server.host', '127.0.0.1');
    const serverPort = this.store.get('server.port', 9876);
    const WebSocket = require('ws');

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://${serverHost}:${serverPort}`);
      let connectTimeout = setTimeout(() => {
        ws.close();
        reject(new Error('WebSocket connect timeout'));
      }, 5000);

      ws.on('open', () => {
        clearTimeout(connectTimeout);
        this._ws = ws;
        this._wsReady = true;
        this._available = true;
        resolve(ws);
      });

      ws.on('message', (data) => {
        try {
          const response = JSON.parse(data.toString());

          // Match response to pending request by request_id
          if (response.request_id && this._pending.has(response.request_id)) {
            const { resolve: res, timeout } = this._pending.get(response.request_id);
            this._pending.delete(response.request_id);
            clearTimeout(timeout);

            if (response.type === 'translation_result' && response.translated_text) {
              res(response.translated_text);
            }
            return;
          }

          // P1-R2: Removed unsafe FIFO fallback — unmatched responses are dropped
          // If server doesn't echo request_id, the request will timeout after 10s
        } catch (e) {
          console.debug('[ChatTranslator] Non-JSON message received');
        }
      });

      ws.on('error', (err) => {
        clearTimeout(connectTimeout);
        this._wsReady = false;
        this._connectPromise = null; // P0-R1: Allow reconnect on next call
        for (const [id, { reject: rej, timeout }] of this._pending) {
          clearTimeout(timeout);
          rej(err);
        }
        this._pending.clear();

        if (!this._ws) {
          reject(err); // Connection never established
        }
        this._ws = null;
        this._scheduleReconnect();
      });

      ws.on('close', () => {
        this._wsReady = false;
        this._connectPromise = null; // P0-R1: Allow reconnect on next call
        for (const [id, { reject: rej, timeout }] of this._pending) {
          clearTimeout(timeout);
          rej(new Error('WebSocket closed'));
        }
        this._pending.clear();
        this._ws = null;
        this._scheduleReconnect();
      });
    });
  }

  /**
   * Schedule a reconnect attempt after disconnect
   */
  _scheduleReconnect() {
    if (this._reconnectTimer) return;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      // Will reconnect on next translate() call
    }, 2000);
  }

  /**
   * Get the user's primary language from settings
   */
  getUserLanguage() {
    const languages = this.store.get('wizard.userLanguages', []);
    if (languages.length > 0) {
      return languages.sort((a, b) => (b.weight || 0) - (a.weight || 0))[0].code;
    }
    return 'en';
  }

  /**
   * Clear translation cache
   */
  clearCache() {
    this.cache.clear();
  }

  /**
   * Disconnect and cleanup
   */
  destroy() {
    if (this._ws) {
      try { this._ws.close(); } catch (e) { console.debug('[ChatTranslator] WS close error:', e.message); }
      this._ws = null;
    }
    this._wsReady = false;
    this._available = false;
    clearTimeout(this._reconnectTimer);
    for (const [id, { reject, timeout }] of this._pending) {
      clearTimeout(timeout);
      reject(new Error('Translator destroyed'));
    }
    this._pending.clear();
    this.cache.clear();
  }
}

module.exports = { ChatTranslator };
