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
            // /ws goes to account-server (8098), same host as /api/v1. Was
            // 8000 (Python engine), which doesn't serve the transcribe WS — it
            // produced an infinite "Reconnecting…" loop on /transcribe.
            '/ws': {
                target: 'ws://localhost:8098',
                ws: true
            }
        }
    }
})
