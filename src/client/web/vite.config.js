import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
    plugins: [react()],
    appType: 'spa',
    server: {
        port: 5173,
        allowedHosts: [
            'windyword.ai',
            '.windyword.ai'
        ],
        proxy: {
            '/api/v1': 'http://localhost:8098',
            '/api': 'http://localhost:8000',
            // /ws targets the same account-server as /api/v1 (port 8098, not
            // 8000). The 8000 target was a legacy port that caused an infinite
            // "Reconnecting." loop on /transcribe in local dev — Vite tried to
            // upgrade the WebSocket to a service that wasn't running, failed,
            // the client reconnected, repeat. Fixed 2026-05-16.
            '/ws': {
                target: 'ws://localhost:8098',
                ws: true,
                changeOrigin: true,
            }
        }
    }
})
