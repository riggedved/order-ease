import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// restarted for tailwind config update
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/auth': 'http://127.0.0.1:8000',
      '/me': 'http://127.0.0.1:8000',
      '/catalogue': 'http://127.0.0.1:8000',
      '/cart': 'http://127.0.0.1:8000',
      '/orders': 'http://127.0.0.1:8000',
      '/capture': 'http://127.0.0.1:8000',
      '/desk': 'http://127.0.0.1:8000',
      '/retailers': 'http://127.0.0.1:8000',
    },
  },
})
