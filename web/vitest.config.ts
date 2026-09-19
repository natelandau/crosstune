import { playwright } from '@vitest/browser-playwright'
import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

// Logic runs under jsdom. Anything that renders an Ionic component runs in Chromium, because
// Ionic is web components with shadow DOM and jsdom does not render them.
export default defineConfig((env) =>
  mergeConfig(
    viteConfig(env),
    defineConfig({
      test: {
        restoreMocks: true,
        // Node re-reads TZ per Date/Intl call, so this makes a test that formats a date
        // through the runtime's default zone read the same everywhere this suite runs. Locale
        // has no equivalent pin: Node resolves ICU's default locale once at process start, so a
        // LANG set here arrives too late to change it. A date-formatting test that cares about
        // locale relies on Node's own built-in default (en-US-like), not on anything pinned.
        env: { TZ: 'UTC' },
        projects: [
          {
            extends: true,
            test: {
              name: 'unit',
              environment: 'jsdom',
              setupFiles: ['./src/test/setup.ts'],
              include: [
                'src/**/*.test.{ts,tsx}',
                'worker/**/*.test.ts',
                'scripts/**/*.test.ts',
                'brand.test.ts',
                'pwa.test.ts',
                'headers.test.ts',
              ],
              exclude: ['**/node_modules/**', 'src/**/*.browser.test.tsx'],
            },
          },
          {
            extends: true,
            test: {
              name: 'browser',
              include: ['src/**/*.browser.test.tsx'],
              exclude: ['**/node_modules/**', 'src/**/*.ios.browser.test.tsx'],
              setupFiles: ['./src/test/browser.ts'],
              browser: {
                enabled: true,
                headless: true,
                provider: playwright(),
                instances: [{ browser: 'chromium' }],
                viewport: { width: 390, height: 844 },
              },
            },
          },
          {
            extends: true,
            test: {
              name: 'browser-ios',
              include: ['src/**/*.ios.browser.test.tsx'],
              setupFiles: ['./src/test/browser-ios.ts'],
              browser: {
                enabled: true,
                headless: true,
                provider: playwright(),
                instances: [{ browser: 'chromium' }],
                viewport: { width: 390, height: 844 },
              },
            },
          },
        ],
      },
    }),
  ),
)
