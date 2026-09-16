import type { VitePWAOptions } from 'vite-plugin-pwa'

export const pwaOptions: Partial<VitePWAOptions> = {
  registerType: 'autoUpdate',
  manifest: {
    name: 'Crosstune',
    short_name: 'Crosstune',
    description: 'A song catalog for folk musicians',
    theme_color: '#4f5d75',
    // The splash is drawn from the manifest before the page can pick a theme, so it uses the
    // chrome color that both themes share rather than either theme's page color.
    background_color: '#4f5d75',
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
