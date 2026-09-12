import type { VitePWAOptions } from 'vite-plugin-pwa'

export const pwaOptions: Partial<VitePWAOptions> = {
  registerType: 'autoUpdate',
  manifest: {
    name: 'Crosstune',
    short_name: 'Crosstune',
    description: 'A song catalog for old-time and bluegrass musicians',
    theme_color: '#1d232a',
    background_color: '#1d232a',
    display: 'standalone',
    start_url: '/',
    scope: '/',
    icons: [
      { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
      { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
      { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
      {
        src: 'maskable-icon-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  },
  workbox: {
    globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
    // The API is never served from cache and never falls back to the shell.
    navigateFallbackDenylist: [/^\/v1\//],
    runtimeCaching: [],
    cleanupOutdatedCaches: true,
  },
}
