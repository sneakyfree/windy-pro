import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
    plugins: [react()],
    server: {
        port: 5173,
        allowedHosts: [
            'windypro.thewindstorm.uk',
            '.thewindstorm.uk'
        ],
        proxy: {
            '/api/v1/auth': 'http://localhost:8098',
            '/api/v1/recordings': 'http://localhost:8098',
            '/api/v1/analytics': 'http://localhost:8098',
            '/api/v1/admin': 'http://localhost:8098',
            '/translate': {
                target: 'http://localhost:8099',
                bypass(req) {
                    // Only proxy POST (API calls), let GET fall through to React Router
                    if (req.method !== 'POST') return req.url;
                }
            },
            '/health': {
                target: 'http://localhost:8099',
                bypass(req) {
                    // Only proxy if Accept is JSON (API call), not browser navigation
                    if (req.headers.accept && req.headers.accept.includes('text/html')) return req.url;
                }
            },
            '/api': 'http://localhost:8000',
            '/ws': {
                target: 'ws://localhost:8000',
                ws: true
            }
        }
    }
})
