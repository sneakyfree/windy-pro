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
        'transcript.emptyDesc': 'Start recording with Windy Pro desktop app and your transcripts will appear here.',
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
        'transcript.emptyDesc': 'Comience a grabar con la app Windy Pro y sus transcripciones aparecerán aquí.',
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
        'status.recording': 'Enregistrement',
        'status.idle': 'Inactif',
        'transcript.empty': 'Pas encore de transcriptions',
        'transcript.emptyDesc': 'Commencez à enregistrer avec Windy Pro et vos transcriptions apparaîtront ici.',
        'transcript.words': 'mots',
        'pricing.free': 'Gratuit',
        'pricing.pro': 'Pro',
        'pricing.translate': 'Traduire',
        'auth.login': 'Connexion',
        'auth.register': 'Créer un compte',
        'auth.email': 'E-mail',
        'auth.password': 'Mot de passe',
        'auth.name': 'Nom',
    },
    de: {
        'nav.home': 'Startseite',
        'nav.dashboard': 'Dashboard',
        'nav.transcribe': 'Transkribieren',
        'nav.vault': 'Tresor',
        'nav.translate': 'Übersetzen',
        'nav.soulFile': 'Soul-Datei',
        'nav.settings': 'Einstellungen',
        'nav.signOut': 'Abmelden',
        'nav.signIn': 'Anmelden',
        'action.record': 'Aufnehmen',
        'action.stop': 'Stoppen',
        'action.copy': 'Kopieren',
        'action.export': 'Exportieren',
        'action.delete': 'Löschen',
        'action.search': 'Suchen',
        'action.save': 'Speichern',
        'action.cancel': 'Abbrechen',
        'status.connected': 'Verbunden',
        'status.reconnecting': 'Verbindung wird wiederhergestellt...',
        'status.offline': 'Offline',
        'status.recording': 'Aufnahme',
        'status.idle': 'Bereit',
        'transcript.empty': 'Noch keine Transkripte',
        'transcript.emptyDesc': 'Starten Sie die Aufnahme mit Windy Pro und Ihre Transkripte erscheinen hier.',
        'transcript.words': 'Wörter',
        'pricing.free': 'Kostenlos',
        'pricing.pro': 'Pro',
        'pricing.translate': 'Übersetzen',
        'auth.login': 'Anmelden',
        'auth.register': 'Konto erstellen',
        'auth.email': 'E-Mail',
        'auth.password': 'Passwort',
        'auth.name': 'Name',
    },
    zh: {
        'nav.home': '首页',
        'nav.dashboard': '仪表盘',
        'nav.transcribe': '转录',
        'nav.vault': '保管库',
        'nav.translate': '翻译',
        'nav.soulFile': '灵魂档案',
        'nav.settings': '设置',
        'nav.signOut': '退出',
        'nav.signIn': '登录',
        'action.record': '录音',
        'action.stop': '停止',
        'action.copy': '复制',
        'action.export': '导出',
        'action.delete': '删除',
        'action.search': '搜索',
        'action.save': '保存',
        'action.cancel': '取消',
        'status.connected': '已连接',
        'status.reconnecting': '重新连接中...',
        'status.offline': '离线',
        'status.recording': '录音中',
        'status.idle': '待命',
        'transcript.empty': '暂无转录',
        'transcript.emptyDesc': '使用 Windy Pro 开始录音，您的转录将显示在这里。',
        'transcript.words': '字',
        'pricing.free': '免费',
        'pricing.pro': '专业版',
        'pricing.translate': '翻译',
        'auth.login': '登录',
        'auth.register': '创建账户',
        'auth.email': '电子邮件',
        'auth.password': '密码',
        'auth.name': '姓名',
    },
    ja: {
        'nav.home': 'ホーム',
        'nav.dashboard': 'ダッシュボード',
        'nav.transcribe': '文字起こし',
        'nav.vault': '保管庫',
        'nav.translate': '翻訳',
        'nav.soulFile': 'ソウルファイル',
        'nav.settings': '設定',
        'nav.signOut': 'ログアウト',
        'nav.signIn': 'ログイン',
        'action.record': '録音',
        'action.stop': '停止',
        'action.copy': 'コピー',
        'action.export': 'エクスポート',
        'action.delete': '削除',
        'action.search': '検索',
        'action.save': '保存',
        'action.cancel': 'キャンセル',
        'status.connected': '接続済み',
        'status.reconnecting': '再接続中...',
        'status.offline': 'オフライン',
        'status.recording': '録音中',
        'status.idle': '待機中',
        'transcript.empty': '文字起こしはまだありません',
        'transcript.emptyDesc': 'Windy Pro で録音を開始すると、文字起こしがここに表示されます。',
        'transcript.words': '語',
        'pricing.free': '無料',
        'pricing.pro': 'プロ',
        'pricing.translate': '翻訳',
        'auth.login': 'ログイン',
        'auth.register': 'アカウント作成',
        'auth.email': 'メールアドレス',
        'auth.password': 'パスワード',
        'auth.name': '名前',
    },
    ko: {
        'nav.home': '홈',
        'nav.dashboard': '대시보드',
        'nav.transcribe': '전사',
        'nav.vault': '보관함',
        'nav.translate': '번역',
        'nav.soulFile': '소울 파일',
        'nav.settings': '설정',
        'nav.signOut': '로그아웃',
        'nav.signIn': '로그인',
        'action.record': '녹음',
        'action.stop': '중지',
        'action.copy': '복사',
        'action.export': '내보내기',
        'action.delete': '삭제',
        'action.search': '검색',
        'action.save': '저장',
        'action.cancel': '취소',
        'status.connected': '연결됨',
        'status.reconnecting': '재연결 중...',
        'status.offline': '오프라인',
        'status.recording': '녹음 중',
        'status.idle': '대기 중',
        'transcript.empty': '아직 전사가 없습니다',
        'transcript.emptyDesc': 'Windy Pro 데스크톱 앱으로 녹음을 시작하면 전사가 여기에 나타납니다.',
        'transcript.words': '단어',
        'pricing.free': '무료',
        'pricing.pro': '프로',
        'pricing.translate': '번역',
        'auth.login': '로그인',
        'auth.register': '계정 만들기',
        'auth.email': '이메일',
        'auth.password': '비밀번호',
        'auth.name': '이름',
    },
    pt: {
        'nav.home': 'Início',
        'nav.dashboard': 'Painel',
        'nav.transcribe': 'Transcrever',
        'nav.vault': 'Cofre',
        'nav.translate': 'Traduzir',
        'nav.soulFile': 'Arquivo Soul',
        'nav.settings': 'Configurações',
        'nav.signOut': 'Sair',
        'nav.signIn': 'Entrar',
        'action.record': 'Gravar',
        'action.stop': 'Parar',
        'action.copy': 'Copiar',
        'action.export': 'Exportar',
        'action.delete': 'Excluir',
        'action.search': 'Pesquisar',
        'action.save': 'Salvar',
        'action.cancel': 'Cancelar',
        'status.connected': 'Conectado',
        'status.reconnecting': 'Reconectando...',
        'status.offline': 'Offline',
        'status.recording': 'Gravando',
        'status.idle': 'Inativo',
        'transcript.empty': 'Nenhuma transcrição ainda',
        'transcript.emptyDesc': 'Comece a gravar com o app Windy Pro e suas transcrições aparecerão aqui.',
        'transcript.words': 'palavras',
        'pricing.free': 'Grátis',
        'pricing.pro': 'Pro',
        'pricing.translate': 'Traduzir',
        'auth.login': 'Entrar',
        'auth.register': 'Criar Conta',
        'auth.email': 'E-mail',
        'auth.password': 'Senha',
        'auth.name': 'Nome',
    },
    hi: {
        'nav.home': 'होम',
        'nav.dashboard': 'डैशबोर्ड',
        'nav.transcribe': 'ट्रांसक्राइब',
        'nav.vault': 'वॉल्ट',
        'nav.translate': 'अनुवाद',
        'nav.soulFile': 'सोल फ़ाइल',
        'nav.settings': 'सेटिंग्स',
        'nav.signOut': 'साइन आउट',
        'nav.signIn': 'साइन इन',
        'action.record': 'रिकॉर्ड',
        'action.stop': 'रोकें',
        'action.copy': 'कॉपी',
        'action.export': 'निर्यात',
        'action.delete': 'हटाएं',
        'action.search': 'खोजें',
        'action.save': 'सहेजें',
        'action.cancel': 'रद्द करें',
        'status.connected': 'कनेक्टेड',
        'status.reconnecting': 'फिर से कनेक्ट हो रहा है...',
        'status.offline': 'ऑफ़लाइन',
        'status.recording': 'रिकॉर्डिंग',
        'status.idle': 'निष्क्रिय',
        'transcript.empty': 'अभी तक कोई ट्रांसक्रिप्ट नहीं',
        'transcript.emptyDesc': 'Windy Pro डेस्कटॉप ऐप से रिकॉर्डिंग शुरू करें और आपके ट्रांसक्रिप्ट यहां दिखाई देंगे।',
        'transcript.words': 'शब्द',
        'pricing.free': 'मुफ्त',
        'pricing.pro': 'प्रो',
        'pricing.translate': 'अनुवाद',
        'auth.login': 'साइन इन',
        'auth.register': 'खाता बनाएं',
        'auth.email': 'ईमेल',
        'auth.password': 'पासवर्ड',
        'auth.name': 'नाम',
    },
    ar: {
        'nav.home': 'الرئيسية',
        'nav.dashboard': 'لوحة التحكم',
        'nav.transcribe': 'نسخ',
        'nav.vault': 'الخزنة',
        'nav.translate': 'ترجمة',
        'nav.soulFile': 'ملف الروح',
        'nav.settings': 'الإعدادات',
        'nav.signOut': 'تسجيل خروج',
        'nav.signIn': 'تسجيل دخول',
        'action.record': 'تسجيل',
        'action.stop': 'إيقاف',
        'action.copy': 'نسخ',
        'action.export': 'تصدير',
        'action.delete': 'حذف',
        'action.search': 'بحث',
        'action.save': 'حفظ',
        'action.cancel': 'إلغاء',
        'status.connected': 'متصل',
        'status.reconnecting': 'إعادة الاتصال...',
        'status.offline': 'غير متصل',
        'status.recording': 'جارٍ التسجيل',
        'status.idle': 'خامل',
        'transcript.empty': 'لا توجد نصوص بعد',
        'transcript.emptyDesc': 'ابدأ التسجيل باستخدام تطبيق Windy Pro وستظهر نصوصك هنا.',
        'transcript.words': 'كلمات',
        'pricing.free': 'مجاني',
        'pricing.pro': 'احترافي',
        'pricing.translate': 'ترجمة',
        'auth.login': 'تسجيل الدخول',
        'auth.register': 'إنشاء حساب',
        'auth.email': 'البريد الإلكتروني',
        'auth.password': 'كلمة المرور',
        'auth.name': 'الاسم',
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
