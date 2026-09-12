import { readFileSync } from 'node:fs'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { pwaOptions } from './pwa.config.ts'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string
}

// Same-origin in dev and preview so the API needs no CORS locally.
const apiProxy = { '/v1': { target: 'http://localhost:8000', changeOrigin: true } }

export default defineConfig({
  plugins: [
    // One bundle: an offline reload must not fetch a route chunk the shell never loaded.
    tanstackRouter({ target: 'react', autoCodeSplitting: false }),
    react(),
    tailwindcss(),
    VitePWA(pwaOptions),
  ],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: { port: 5173, proxy: apiProxy },
  preview: { port: 4173, proxy: apiProxy },
})
