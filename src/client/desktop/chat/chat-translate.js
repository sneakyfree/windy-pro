/**
 * Windy Chat — Translation Middleware
 * 
 * Hooks into the chat message pipeline to auto-translate messages
 * using Windy Pro's on-device translation engines. All translation
 * happens locally — nothing leaves the user's device.
 */

const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');

class ChatTranslator {
  constructor(store) {
    this.store = store;
    this.cache = new Map(); // LRU cache for repeated phrases
    this.maxCacheSize = 500;
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
      return this.cache.get(cacheKey);
    }

    try {
      const translated = await this._callTranslationEngine(text, srcLang, tgtLang);
      
      // Cache the result
      if (this.cache.size >= this.maxCacheSize) {
        // Remove oldest entry
        const firstKey = this.cache.keys().next().value;
        this.cache.delete(firstKey);
      }
      this.cache.set(cacheKey, translated);
      
      return translated;
    } catch (err) {
      console.error('[ChatTranslator] Translation failed:', err.message);
      return text; // Return original on failure
    }
  }

  /**
   * Call the local Windy translation engine via the Python server
   */
  async _callTranslationEngine(text, srcLang, tgtLang) {
    const serverHost = this.store.get('server.host', '127.0.0.1');
    const serverPort = this.store.get('server.port', 9876);

    // Use the existing WebSocket connection to the Python server
    // The translation request is sent as a JSON-RPC style message
    return new Promise((resolve, reject) => {
      const WebSocket = require('ws');
      const ws = new WebSocket(`ws://${serverHost}:${serverPort}`);
      let settled = false;

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          ws.close();
          reject(new Error('Translation timeout'));
        }
      }, 10000);

      ws.on('open', () => {
        ws.send(JSON.stringify({
          type: 'translate',
          text: text,
          source_lang: srcLang,
          target_lang: tgtLang
        }));
      });

      ws.on('message', (data) => {
        if (settled) return;
        try {
          const response = JSON.parse(data.toString());
          if (response.type === 'translation_result' && response.translated_text) {
            settled = true;
            clearTimeout(timeout);
            ws.close();
            resolve(response.translated_text);
          }
        } catch (e) {
          // Not a translation response, ignore
        }
      });

      ws.on('error', (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(err);
        }
      });

      ws.on('close', () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(new Error('WebSocket closed before response'));
        }
      });
    });
  }

  /**
   * Get the user's primary language from settings
   */
  getUserLanguage() {
    const languages = this.store.get('wizard.userLanguages', []);
    if (languages.length > 0) {
      // Return the highest-weight language
      return languages.sort((a, b) => (b.weight || 0) - (a.weight || 0))[0].code;
    }
    return 'en'; // Default to English
  }

  /**
   * Clear translation cache
   */
  clearCache() {
    this.cache.clear();
  }
}

module.exports = { ChatTranslator };
