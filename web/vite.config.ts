import { readFileSync } from 'node:fs'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { pwaOptions } from './pwa.config.ts'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string
}

// Same-origin in dev and preview so the API needs no CORS locally, and so a browser
// reaching the dev server through a proxy (Tailscale Serve) can also reach local storage:
// changeOrigin restores the Host a presigned URL was signed for. The end-to-end suite
// overrides the API target, because it serves its own API on a database it is free to
// reset; its storage is a separate bucket on the same RustFS, so that target never moves.
const devProxy = (env: Record<string, string>) => ({
  '/v1': { target: env.LOCAL_API_PROXY_TARGET || 'http://localhost:8000', changeOrigin: true },
  '/storage': {
    target: 'http://localhost:9000',
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/storage/, ''),
  },
})

// Node resolves localhost to ::1 first on macOS, which would leave nothing on
// 127.0.0.1 for a proxy such as Tailscale Serve, which only targets IPv4.
const host = '127.0.0.1'

// Vite answers only to localhost and IP addresses unless a hostname is listed
// here, so a proxy such as Tailscale Serve needs its hostname allowed.
const allowedHosts = (env: Record<string, string>) =>
  (env.LOCAL_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)

export default defineConfig(({ mode }) => {
  // An empty prefix takes the process environment too, which is how a recipe hands the
  // end-to-end suite's API origin down to the preview server Playwright starts.
  const env = loadEnv(mode, process.cwd(), '')
  const proxy = devProxy(env)
  const hosts = allowedHosts(env)
  return {
    plugins: [react(), tailwindcss(), VitePWA(pwaOptions)],
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    server: { host, port: 5173, proxy, allowedHosts: hosts },
    preview: { host, port: 4173, proxy, allowedHosts: hosts },
  }
})
