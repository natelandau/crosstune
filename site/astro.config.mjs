import sitemap from '@astrojs/sitemap'
import { defineConfig } from 'astro/config'
import { CLERK_JS_VERSION } from './clerkVersion.mjs'
import { THANKS_PATH } from './src/scripts/waitlist'

export default defineConfig({
  site: 'https://crosstune.app',
  output: 'static',
  trailingSlash: 'never',
  integrations: [sitemap({ filter: (page) => !page.endsWith(THANKS_PATH) })],
  vite: { define: { __CLERK_JS_VERSION__: JSON.stringify(CLERK_JS_VERSION) } },
})
