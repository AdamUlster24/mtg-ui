import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// dev server proxies everything non-static to the gateway (scripts/run.sh)
const gateway = process.env.GATEWAY_URL ?? 'http://localhost:8080'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/ws': { target: gateway, ws: true },
      '/img': gateway,
      '/api': gateway,
    },
  },
})
