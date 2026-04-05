import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
    plugins: [react()],
    appType: 'spa',
    server: {
        port: 5173,
        allowedHosts: [
            'windypro.thewindstorm.uk',
            '.thewindstorm.uk',
            'windyword.ai',
            '.windyword.ai'
        ],
        proxy: {
            '/api/v1': 'http://localhost:8098',
            '/api': 'http://localhost:8000',
            '/ws': {
                target: 'ws://localhost:8000',
                ws: true
            }
        }
    }
})
