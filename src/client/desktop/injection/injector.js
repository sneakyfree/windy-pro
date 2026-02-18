/**
 * Windy Pro - Cursor Injection Module
 * 
 * Cross-platform text injection into active application:
 * 1. Copy text to system clipboard
 * 2. Simulate Ctrl+V (Win/Linux) or Cmd+V (macOS) keystroke
 * 
 * DNA Strand: B3
 */

const { clipboard } = require('electron');
const { exec } = require('child_process');
const os = require('os');

class CursorInjector {
    constructor() {
        this.platform = process.platform; // 'win32', 'darwin', 'linux'
    }

    /**
     * Inject text into the currently focused application
     * @param {string} text - Text to inject
     * @returns {Promise<void>}
     */
    async inject(text) {
        if (!text || !text.trim()) {
            throw new Error('No text to inject');
        }

        // Save existing clipboard content
        const previousClipboard = clipboard.readText();

        // Step 1: Copy text to system clipboard
        clipboard.writeText(text);

        // Step 2: Small delay to ensure clipboard is ready
        await this.sleep(50);

        // Step 3: Simulate paste keystroke (platform-specific)
        switch (this.platform) {
            case 'win32':
                await this.injectWindows();
                break;
            case 'darwin':
                await this.injectMacOS();
                break;
            case 'linux':
                await this.injectLinux();
                break;
            default:
                throw new Error(`Unsupported platform: ${this.platform}`);
        }

        // Step 4: Restore previous clipboard after paste completes
        setTimeout(() => {
            clipboard.writeText(previousClipboard);
        }, 500);
    }

    /**
     * Windows: Simulate Ctrl+V using PowerShell SendKeys
     */
    async injectWindows() {
        return new Promise((resolve, reject) => {
            // Use PowerShell to simulate Ctrl+V
            const cmd = 'powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait(\'^v\')"';
            exec(cmd, { timeout: 3000 }, (error) => {
                if (error) {
                    reject(new Error(`Windows injection failed: ${error.message}`));
                } else {
                    resolve();
                }
            });
        });
    }

    /**
     * macOS: Simulate Cmd+V using AppleScript
     * Requires Accessibility permission
     */
    async injectMacOS() {
        return new Promise((resolve, reject) => {
            const cmd = 'osascript -e \'tell application "System Events" to keystroke "v" using command down\'';
            exec(cmd, { timeout: 3000 }, (error) => {
                if (error) {
                    if (error.message.includes('not allowed')) {
                        reject(new Error('Accessibility permission required. Please enable Windy Pro in System Preferences > Privacy & Security > Accessibility.'));
                    } else {
                        reject(new Error(`macOS injection failed: ${error.message}`));
                    }
                } else {
                    resolve();
                }
            });
        });
    }

    /**
     * Linux: Simulate Ctrl+V using xdotool (X11) or ydotool (Wayland)
     */
    async injectLinux() {
        const sessionType = process.env.XDG_SESSION_TYPE || 'x11';

        if (sessionType === 'wayland') {
            return this.injectLinuxWayland();
        } else {
            return this.injectLinuxX11();
        }
    }

    async injectLinuxX11() {
        return new Promise((resolve, reject) => {
            // Focus the previously active window, then paste
            const cmd = 'sleep 0.15 && xdotool key --clearmodifiers ctrl+v';
            exec(cmd, { timeout: 5000, env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' } }, (error) => {
                if (error) {
                    if (error.message.includes('not found') || error.message.includes('No such file')) {
                        reject(new Error('xdotool is required for text injection. Install it with: sudo apt install xdotool'));
                    } else {
                        reject(new Error(`Linux X11 injection failed: ${error.message}`));
                    }
                } else {
                    resolve();
                }
            });
        });
    }

    async injectLinuxWayland() {
        return new Promise((resolve, reject) => {
            // ydotool uses keycodes: 29=Ctrl, 47=V
            exec('ydotool key 29:1 47:1 47:0 29:0', { timeout: 3000 }, (error) => {
                if (error) {
                    if (error.message.includes('not found') || error.message.includes('No such file')) {
                        reject(new Error('ydotool is required for Wayland text injection. Install it with: sudo apt install ydotool'));
                    } else {
                        reject(new Error(`Linux Wayland injection failed: ${error.message}`));
                    }
                } else {
                    resolve();
                }
            });
        });
    }

    /**
     * Check if required permissions are available
     * @returns {Promise<{granted: boolean, message: string}>}
     */
    async checkPermissions() {
        switch (this.platform) {
            case 'darwin': {
                // Check macOS Accessibility permission
                const { systemPreferences } = require('electron');
                const trusted = systemPreferences.isTrustedAccessibilityClient(false);
                return {
                    granted: trusted,
                    message: trusted
                        ? 'Accessibility permission granted'
                        : 'Accessibility permission required. Go to System Preferences > Privacy & Security > Accessibility and add Windy Pro.'
                };
            }
            case 'linux': {
                const sessionType = process.env.XDG_SESSION_TYPE || 'x11';
                const tool = sessionType === 'wayland' ? 'ydotool' : 'xdotool';
                return new Promise((resolve) => {
                    exec(`which ${tool}`, (error) => {
                        resolve({
                            granted: !error,
                            message: error
                                ? `${tool} is required. Install with: sudo apt install ${tool}`
                                : `${tool} is available`
                        });
                    });
                });
            }
            case 'win32':
                return { granted: true, message: 'No special permissions needed on Windows' };
            default:
                return { granted: false, message: `Unsupported platform: ${this.platform}` };
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = { CursorInjector };
