/**
 * Windy Pro — OS Permission Requests
 * 
 * Handles platform-specific permission requests for:
 * - Microphone access (required for transcription)
 * - Accessibility/Input Monitoring (required for cursor injection)
 * - Screen recording (required for video capture)
 * 
 * Works across macOS, Windows, and Linux.
 */

const { exec } = require('child_process');
const os = require('os');

class PermissionManager {
    constructor() {
        this.permissions = {};
    }

    /**
     * Check all required permissions — returns status map
     */
    async checkAll() {
        const [mic, accessibility, screenRecording] = await Promise.all([
            this.checkMicrophone(),
            this.checkAccessibility(),
            this.checkScreenRecording()
        ]);

        this.permissions = { mic, accessibility, screenRecording };
        return this.permissions;
    }

    // ── Microphone ────────────────────────────────────────

    async checkMicrophone() {
        const result = { status: 'unknown', required: true };

        if (process.platform === 'darwin') {
            // macOS: Electron's systemPreferences API
            try {
                const { systemPreferences } = require('electron');
                const status = systemPreferences.getMediaAccessStatus('microphone');
                result.status = status; // 'granted', 'denied', 'not-determined', 'restricted'
            } catch (e) {
                // Not in Electron context (e.g., running from wizard)
                result.status = 'check-needed';
            }
        } else if (process.platform === 'linux') {
            // Linux: PulseAudio/PipeWire — mic usually works without prompts
            try {
                await this.execAsync('pactl list sources short 2>/dev/null');
                result.status = 'granted';
            } catch {
                try {
                    await this.execAsync('pw-cli list-objects 2>/dev/null | head -5');
                    result.status = 'granted';
                } catch {
                    result.status = 'check-needed';
                }
            }
        } else if (process.platform === 'win32') {
            // Windows: Check Settings → Privacy → Microphone
            try {
                const out = await this.execAsync(
                    'powershell -Command "Get-ItemProperty -Path HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone -Name Value -ErrorAction SilentlyContinue | Select -ExpandProperty Value"'
                );
                result.status = out.trim() === 'Allow' ? 'granted' : 'denied';
            } catch {
                result.status = 'check-needed';
            }
        }

        return result;
    }

    async requestMicrophone() {
        if (process.platform === 'darwin') {
            try {
                const { systemPreferences } = require('electron');
                const granted = await systemPreferences.askForMediaAccess('microphone');
                return granted ? 'granted' : 'denied';
            } catch {
                return 'error';
            }
        } else if (process.platform === 'win32') {
            // Open Windows Settings → Privacy → Microphone
            exec('start ms-settings:privacy-microphone');
            return 'opened-settings';
        } else {
            // Linux: usually auto-granted
            return 'granted';
        }
    }

    // ── Accessibility / Input Monitoring ──────────────────

    async checkAccessibility() {
        const result = { status: 'unknown', required: false };

        if (process.platform === 'darwin') {
            result.required = true; // Required for cursor injection
            try {
                // Check if accessibility is trusted
                const out = await this.execAsync(
                    'osascript -e \'tell application "System Events" to keystroke ""\' 2>&1 || true'
                );
                result.status = out.includes('not allowed') ? 'denied' : 'granted';
            } catch {
                result.status = 'check-needed';
            }
        } else if (process.platform === 'win32') {
            // Windows: No specific accessibility permission needed for SendKeys
            result.status = 'granted';
        } else {
            // Linux: xdotool works without special permissions on X11
            try {
                await this.execAsync('which xdotool 2>/dev/null || which ydotool 2>/dev/null');
                result.status = 'granted';
            } catch {
                result.status = 'missing-tool';
            }
        }

        return result;
    }

    async requestAccessibility() {
        if (process.platform === 'darwin') {
            // Open System Settings → Privacy & Security → Accessibility
            exec('open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"');
            return 'opened-settings';
        } else if (process.platform === 'linux') {
            // Install xdotool if missing
            try {
                await this.execAsync('which xdotool');
                return 'granted';
            } catch {
                return 'install-xdotool';
            }
        }
        return 'granted';
    }

    // ── Screen Recording ──────────────────────────────────

    async checkScreenRecording() {
        const result = { status: 'unknown', required: false }; // Only needed for video capture

        if (process.platform === 'darwin') {
            try {
                const { systemPreferences } = require('electron');
                const status = systemPreferences.getMediaAccessStatus('screen');
                result.status = status;
            } catch {
                result.status = 'check-needed';
            }
        } else {
            // Linux/Windows: screen recording doesn't require special permissions
            result.status = 'granted';
        }

        return result;
    }

    async requestScreenRecording() {
        if (process.platform === 'darwin') {
            // Open System Settings → Privacy & Security → Screen Recording
            exec('open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"');
            return 'opened-settings';
        }
        return 'granted';
    }

    // ── Summary ───────────────────────────────────────────

    /**
     * Get a wizard-friendly summary of all permissions
     * Returns array of { name, icon, status, action }
     */
    getSummary() {
        const p = this.permissions;
        const items = [];

        items.push({
            name: 'Microphone',
            icon: '🎙️',
            status: p.mic?.status || 'unknown',
            action: p.mic?.status === 'granted' ? null : 'requestMicrophone',
            required: true
        });

        items.push({
            name: 'Accessibility',
            icon: '⌨️',
            status: p.accessibility?.status || 'unknown',
            action: p.accessibility?.status === 'granted' ? null : 'requestAccessibility',
            required: process.platform === 'darwin'
        });

        items.push({
            name: 'Screen Recording',
            icon: '📹',
            status: p.screenRecording?.status || 'unknown',
            action: p.screenRecording?.status === 'granted' ? null : 'requestScreenRecording',
            required: false
        });

        return items;
    }

    /**
     * Are all required permissions granted?
     */
    allGranted() {
        const summary = this.getSummary();
        return summary
            .filter(item => item.required)
            .every(item => item.status === 'granted');
    }

    execAsync(cmd) {
        return new Promise((resolve, reject) => {
            exec(cmd, { timeout: 5000 }, (error, stdout) => {
                if (error) reject(error);
                else resolve(stdout);
            });
        });
    }
}

module.exports = { PermissionManager };
