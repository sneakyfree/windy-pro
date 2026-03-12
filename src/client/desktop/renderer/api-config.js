/**
 * Windy Pro — Centralized API Configuration
 *
 * Single source of truth for all API endpoints.
 * All renderer modules should import from here instead of hardcoding URLs.
 */

const API_CONFIG = {
  // Base URLs (can be overridden via settings or localStorage)
  get baseUrl() {
    return localStorage.getItem('windy_cloud_api_url') || 'https://windypro.thewindstorm.uk';
  },
  get wsUrl() {
    const base = this.baseUrl;
    return base.replace(/^http/, 'ws');
  },

  // API endpoints
  get health()          { return `${this.baseUrl}/health`; },
  get analytics()       { return `${this.baseUrl}/api/v1/analytics`; },
  get languages()       { return `${this.baseUrl}/api/v1/translate/languages`; },
  get translateText()   { return `${this.baseUrl}/api/v1/translate/text`; },
  get userHistory()     { return `${this.baseUrl}/api/v1/user/history`; },
  get userFavorites()   { return `${this.baseUrl}/api/v1/user/favorites`; },
  get dashboard()       { return `${this.baseUrl}/dashboard`; },
  get upgrade()         { return `${this.baseUrl}/upgrade`; },

  // Override base URL (called from settings)
  setBaseUrl(url) {
    if (url && url.startsWith('http')) {
      localStorage.setItem('windy_cloud_api_url', url.replace(/\/$/, ''));
    }
  }
};

// Make available globally
window.API_CONFIG = API_CONFIG;
