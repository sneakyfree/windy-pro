/**
 * Windy Pro — In-App i18n System (G3)
 * 
 * Two-tier translation architecture:
 * - Tier 1: Built-in strings for top 10 languages (shipped with the app)
 * - Tier 2: Dynamic translation via translate-api for 80+ languages
 * 
 * Usage:
 *   import { t, setLocale, getLocale } from './i18n'
 *   t('nav.dashboard')  // Returns translated string
 */

// Tier 1: Built-in translations for top languages
const BUILT_IN = {
    en: {
        'nav.home': 'Home',
        'nav.dashboard': 'Dashboard',
        'nav.transcribe': 'Transcribe',
        'nav.vault': 'Vault',
        'nav.translate': 'Translate',
        'nav.soulFile': 'Soul File',
        'nav.settings': 'Settings',
        'nav.signOut': 'Sign Out',
        'nav.signIn': 'Sign In',
        'action.record': 'Record',
        'action.stop': 'Stop',
        'action.copy': 'Copy',
        'action.export': 'Export',
        'action.delete': 'Delete',
        'action.search': 'Search',
        'action.save': 'Save',
        'action.cancel': 'Cancel',
        'status.connected': 'Connected',
        'status.reconnecting': 'Reconnecting...',
        'status.offline': 'Offline',
        'status.recording': 'Recording',
        'status.idle': 'Idle',
        'transcript.empty': 'No transcripts yet',
        'transcript.emptyDesc': 'Start recording with Windy Word desktop app and your transcripts will appear here.',
        'transcript.words': 'words',
        'pricing.free': 'Free',
        'pricing.pro': 'Pro',
        'pricing.translate': 'Translate',
        'auth.login': 'Sign In',
        'auth.register': 'Create Account',
        'auth.email': 'Email',
        'auth.password': 'Password',
        'auth.name': 'Name',
    },
    es: {
        'nav.home': 'Inicio',
        'nav.dashboard': 'Panel',
        'nav.transcribe': 'Transcribir',
        'nav.vault': 'Bóveda',
        'nav.translate': 'Traducir',
        'nav.soulFile': 'Archivo Soul',
        'nav.settings': 'Configuración',
        'nav.signOut': 'Cerrar Sesión',
        'nav.signIn': 'Iniciar Sesión',
        'action.record': 'Grabar',
        'action.stop': 'Detener',
        'action.copy': 'Copiar',
        'action.export': 'Exportar',
        'action.delete': 'Eliminar',
        'action.search': 'Buscar',
        'action.save': 'Guardar',
        'action.cancel': 'Cancelar',
        'status.connected': 'Conectado',
        'status.reconnecting': 'Reconectando...',
        'status.offline': 'Sin conexión',
        'status.recording': 'Grabando',
        'status.idle': 'Inactivo',
        'transcript.empty': 'Sin transcripciones aún',
        'transcript.emptyDesc': 'Comience a grabar con la app Windy Word y sus transcripciones aparecerán aquí.',
        'transcript.words': 'palabras',
        'pricing.free': 'Gratis',
        'pricing.pro': 'Pro',
        'pricing.translate': 'Traducir',
        'auth.login': 'Iniciar Sesión',
        'auth.register': 'Crear Cuenta',
        'auth.email': 'Correo electrónico',
        'auth.password': 'Contraseña',
        'auth.name': 'Nombre',
    },
    fr: {
        'nav.home': 'Accueil',
        'nav.dashboard': 'Tableau de bord',
        'nav.transcribe': 'Transcrire',
        'nav.vault': 'Coffre',
        'nav.translate': 'Traduire',
        'nav.soulFile': 'Fichier Soul',
        'nav.settings': 'Paramètres',
        'nav.signOut': 'Déconnexion',
        'nav.signIn': 'Connexion',
        'action.record': 'Enregistrer',
        'action.stop': 'Arrêter',
        'action.copy': 'Copier',
        'action.export': 'Exporter',
        'action.delete': 'Supprimer',
        'action.search': 'Rechercher',
        'action.save': 'Enregistrer',
        'action.cancel': 'Annuler',
        'status.connected': 'Connecté',
        'status.reconnecting': 'Reconnexion...',
        'status.offline': 'Hors ligne',
        'transcript.empty': 'Pas encore de transcriptions',
        'transcript.words': 'mots',
        'auth.login': 'Connexion',
        'auth.register': 'Créer un compte',
    },
    de: {
        'nav.home': 'Startseite',
        'nav.dashboard': 'Dashboard',
        'nav.transcribe': 'Transkribieren',
        'nav.vault': 'Tresor',
        'nav.translate': 'Übersetzen',
        'nav.signOut': 'Abmelden',
        'nav.signIn': 'Anmelden',
        'action.record': 'Aufnehmen',
        'action.stop': 'Stoppen',
        'action.copy': 'Kopieren',
        'action.search': 'Suchen',
        'status.connected': 'Verbunden',
        'status.offline': 'Offline',
        'transcript.empty': 'Noch keine Transkripte',
        'transcript.words': 'Wörter',
    },
    zh: {
        'nav.home': '首页',
        'nav.dashboard': '仪表盘',
        'nav.transcribe': '转录',
        'nav.vault': '保管库',
        'nav.translate': '翻译',
        'nav.signOut': '退出',
        'nav.signIn': '登录',
        'action.record': '录音',
        'action.stop': '停止',
        'action.copy': '复制',
        'action.search': '搜索',
        'status.connected': '已连接',
        'status.offline': '离线',
        'transcript.empty': '暂无转录',
        'transcript.words': '字',
    },
    ja: {
        'nav.home': 'ホーム',
        'nav.dashboard': 'ダッシュボード',
        'nav.transcribe': '文字起こし',
        'nav.vault': '保管庫',
        'nav.translate': '翻訳',
        'nav.signOut': 'ログアウト',
        'nav.signIn': 'ログイン',
        'action.record': '録音',
        'action.stop': '停止',
        'action.copy': 'コピー',
        'action.search': '検索',
        'transcript.empty': '文字起こしはまだありません',
        'transcript.words': '語',
    },
    ko: {
        'nav.home': '홈',
        'nav.dashboard': '대시보드',
        'nav.transcribe': '전사',
        'nav.vault': '보관함',
        'nav.translate': '번역',
        'nav.signOut': '로그아웃',
        'nav.signIn': '로그인',
        'action.record': '녹음',
        'action.stop': '중지',
        'action.copy': '복사',
        'action.search': '검색',
        'transcript.empty': '아직 전사가 없습니다',
        'transcript.words': '단어',
    },
    pt: {
        'nav.home': 'Início',
        'nav.dashboard': 'Painel',
        'nav.transcribe': 'Transcrever',
        'nav.vault': 'Cofre',
        'nav.translate': 'Traduzir',
        'nav.signOut': 'Sair',
        'nav.signIn': 'Entrar',
        'action.record': 'Gravar',
        'action.stop': 'Parar',
        'action.copy': 'Copiar',
        'action.search': 'Pesquisar',
        'transcript.empty': 'Nenhuma transcrição ainda',
        'transcript.words': 'palavras',
    },
    hi: {
        'nav.home': 'होम',
        'nav.dashboard': 'डैशबोर्ड',
        'nav.transcribe': 'ट्रांसक्राइब',
        'nav.vault': 'वॉल्ट',
        'nav.translate': 'अनुवाद',
        'nav.signOut': 'साइन आउट',
        'nav.signIn': 'साइन इन',
        'action.record': 'रिकॉर्ड',
        'action.stop': 'रोकें',
        'action.copy': 'कॉपी',
        'transcript.empty': 'अभी तक कोई ट्रांसक्रिप्ट नहीं',
        'transcript.words': 'शब्द',
    },
    ar: {
        'nav.home': 'الرئيسية',
        'nav.dashboard': 'لوحة التحكم',
        'nav.transcribe': 'نسخ',
        'nav.vault': 'الخزنة',
        'nav.translate': 'ترجمة',
        'nav.signOut': 'تسجيل خروج',
        'nav.signIn': 'تسجيل دخول',
        'action.record': 'تسجيل',
        'action.stop': 'إيقاف',
        'action.copy': 'نسخ',
        'transcript.empty': 'لا توجد نصوص بعد',
        'transcript.words': 'كلمات',
    },
}

// Current locale
let currentLocale = localStorage.getItem('windy_locale') || navigator.language?.split('-')[0] || 'en'

// Tier 2 cache (dynamically translated strings)
const dynamicCache = {}

/**
 * Translate a key to the current locale
 * @param {string} key - Dot-separated key (e.g., 'nav.dashboard')
 * @param {string} fallback - Optional fallback text
 * @returns {string} Translated text
 */
export function t(key, fallback) {
    // Tier 1: Check built-in translations
    const lang = BUILT_IN[currentLocale]
    if (lang && lang[key]) return lang[key]

    // English fallback
    if (BUILT_IN.en[key]) return fallback || BUILT_IN.en[key]

    // Tier 2: Check dynamic cache
    if (dynamicCache[`${currentLocale}:${key}`]) {
        return dynamicCache[`${currentLocale}:${key}`]
    }

    return fallback || key
}

/**
 * Set the active locale
 */
export function setLocale(locale) {
    currentLocale = locale
    localStorage.setItem('windy_locale', locale)
    // Trigger re-render for React apps
    window.dispatchEvent(new CustomEvent('windy-locale-change', { detail: { locale } }))
}

/**
 * Get the current locale
 */
export function getLocale() {
    return currentLocale
}

/**
 * Get list of built-in (Tier 1) languages
 */
export function getBuiltInLanguages() {
    return Object.keys(BUILT_IN)
}

/**
 * Dynamically translate a string using the translate-api (Tier 2)
 * Results are cached locally for the session
 */
export async function translateDynamic(text, targetLang) {
    const cacheKey = `${targetLang}:${text}`
    if (dynamicCache[cacheKey]) return dynamicCache[cacheKey]

    try {
        const token = localStorage.getItem('windy_token') || ''
        const res = await fetch('/api/v1/translate/text', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { 'Authorization': `Bearer ${token}` } : {})
            },
            body: JSON.stringify({ text, sourceLang: 'en', targetLang })
        })
        if (res.ok) {
            const data = await res.json()
            dynamicCache[cacheKey] = data.translatedText
            return data.translatedText
        }
    } catch { }
    return text // Fallback to English
}

export default { t, setLocale, getLocale, getBuiltInLanguages, translateDynamic }
