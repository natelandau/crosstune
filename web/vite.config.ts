import { readFileSync } from 'node:fs'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { pwaOptions } from './pwa.config.ts'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string
}

// Same-origin in dev and preview so the API needs no CORS locally.
const apiProxy = { '/v1': { target: 'http://localhost:8000', changeOrigin: true } }

// Node resolves localhost to ::1 first on macOS, which would leave nothing on
// 127.0.0.1 for a proxy such as Tailscale Serve, which only targets IPv4.
const host = '127.0.0.1'

// Vite answers only to localhost and IP addresses unless a hostname is listed
// here, so a proxy such as Tailscale Serve needs its hostname allowed.
const allowedHosts = (mode: string) =>
  (loadEnv(mode, process.cwd(), '').DEV_SERVER_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)

export default defineConfig(({ mode }) => {
  const hosts = allowedHosts(mode)
  return {
    plugins: [
      // One bundle: an offline reload must not fetch a route chunk the shell never loaded.
      tanstackRouter({ target: 'react', autoCodeSplitting: false }),
      react(),
      tailwindcss(),
      VitePWA(pwaOptions),
    ],
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    server: { host, port: 5173, proxy: apiProxy, allowedHosts: hosts },
    preview: { host, port: 4173, proxy: apiProxy, allowedHosts: hosts },
  }
})
