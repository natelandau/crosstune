import sitemap from '@astrojs/sitemap'
import { defineConfig } from 'astro/config'
import { THANKS_PATH } from './src/scripts/waitlist'

export default defineConfig({
  site: 'https://crosstune.app',
  output: 'static',
  trailingSlash: 'never',
  integrations: [sitemap({ filter: (page) => !page.endsWith(THANKS_PATH) })],
})
