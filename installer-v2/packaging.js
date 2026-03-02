/**
 * Windy Pro — Packaging Configuration (B4.6)
 * 
 * Electron Builder config for NSIS (Windows), DMG (macOS), and AppImage (Linux).
 * Import this from electron-builder or use via `npx electron-builder --config packaging.js`
 */

module.exports = {
    appId: 'com.windstorm.windypro',
    productName: 'Windy Pro',
    copyright: 'Copyright © 2026 The Windstorm',

    // ── Output ──────────────────────────────────────
    directories: {
        output: 'dist-packages',
        buildResources: 'build'
    },

    files: [
        'src/**/*',
        'node_modules/**/*',
        'package.json',
        '!src/engine/**/*.pyc',
        '!**/*.map'
    ],

    extraResources: [
        { from: 'src/engine', to: 'engine', filter: ['**/*', '!__pycache__'] },
        { from: 'models', to: 'models', filter: ['**/*'] }
    ],

    // ── macOS (DMG) ─────────────────────────────────
    mac: {
        target: [
            { target: 'dmg', arch: ['x64', 'arm64'] },
            { target: 'zip', arch: ['x64', 'arm64'] }
        ],
        icon: 'build/icon.icns',
        category: 'public.app-category.productivity',
        hardenedRuntime: true,
        gatekeeperAssess: false,
        entitlements: 'build/entitlements.mac.plist',
        entitlementsInherit: 'build/entitlements.mac.plist',
        extendInfo: {
            NSMicrophoneUsageDescription: 'Windy Pro needs microphone access for voice transcription.',
            NSAccessibilityUsageDescription: 'Windy Pro uses accessibility to inject transcribed text at your cursor.'
        }
    },

    dmg: {
        background: 'build/dmg-background.png',
        iconSize: 128,
        contents: [
            { x: 380, y: 170, type: 'link', path: '/Applications' },
            { x: 130, y: 170, type: 'file' }
        ]
    },

    // ── Windows (NSIS) ──────────────────────────────
    win: {
        target: [
            { target: 'nsis', arch: ['x64'] },
            { target: 'portable', arch: ['x64'] }
        ],
        icon: 'build/icon.ico',
        requestedExecutionLevel: 'asInvoker'
    },

    nsis: {
        oneClick: false,
        allowToChangeInstallationDirectory: true,
        installerIcon: 'build/icon.ico',
        uninstallerIcon: 'build/icon.ico',
        installerHeaderIcon: 'build/icon.ico',
        createDesktopShortcut: true,
        createStartMenuShortcut: true,
        shortcutName: 'Windy Pro',
        include: 'build/nsis-installer.nsh',
        perMachine: false,
        license: 'LICENSE'
    },

    // ── Linux (AppImage + deb) ──────────────────────
    linux: {
        target: [
            { target: 'AppImage', arch: ['x64'] },
            { target: 'deb', arch: ['x64'] },
            { target: 'rpm', arch: ['x64'] }
        ],
        icon: 'build/icons',
        category: 'Utility;AudioVideo',
        mimeTypes: ['audio/wav', 'audio/mp3', 'audio/ogg'],
        desktop: {
            Name: 'Windy Pro',
            Comment: 'Voice to text, unlimited',
            Terminal: false
        }
    },

    appImage: {
        artifactName: 'WindyPro-${version}-${arch}.AppImage'
    },

    // ── Auto-Update ─────────────────────────────────
    publish: [
        {
            provider: 'generic',
            url: 'https://windypro.thewindstorm.uk/releases',
            useMultipleRangeRequest: false
        }
    ],

    // ── Build hooks ─────────────────────────────────
    afterPack: async (context) => {
        console.log(`Packed: ${context.appOutDir}`);
    }
};
