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
            '/translate': 'http://localhost:8099',
            '/api': 'http://localhost:8000',
            '/ws': {
                target: 'ws://localhost:8000',
                ws: true
            }
        }
    }
})
