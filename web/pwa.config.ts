import type { VitePWAOptions } from 'vite-plugin-pwa'

export const pwaOptions: Partial<VitePWAOptions> = {
  strategies: 'injectManifest',
  srcDir: 'src/sw',
  filename: 'sw.ts',
  registerType: 'autoUpdate',
  manifest: {
    name: 'Crosstune',
    short_name: 'Crosstune',
    description: 'A tune catalog for folk musicians',
    // The page's theme-color tags follow the scheme; the manifest holds the light page color.
    theme_color: '#FFFEFC',
    background_color: '#FFFEFC',
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
  injectManifest: {
    globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
  },
}
