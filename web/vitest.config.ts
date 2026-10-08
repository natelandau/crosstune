import { playwright } from '@vitest/browser-playwright'
import { fileURLToPath } from 'node:url'
import { searchForWorkspaceRoot } from 'vite'
import { defineConfig, mergeConfig } from 'vitest/config'
import type { BrowserCommand } from 'vitest/node'
import viteConfig from './vite.config.ts'

// Chromium tests share a CI runner's few cores with Vite and each other, so a race the code
// does not have can still fail one there. A retry keeps that from failing the run, and the
// github-actions reporter lists every test that needed one in the job summary, so each stays
// visible until it is fixed. Locally a failure is never retried.
const browserRetry = process.env.CI ? 2 : 0

// Answer the requests matching a URL pattern with an empty 204 for as long as a test holds the
// stub, and count the requests answered, so a test can use a third-party URL, such as an
// autoplaying audio file, without downloading it.
const stubbed = new Map<string, number>()
const stubRequests: BrowserCommand<[pattern: string]> = async (context, pattern) => {
  stubbed.set(pattern, 0)
  await context.page.route(pattern, async (route) => {
    stubbed.set(pattern, (stubbed.get(pattern) ?? 0) + 1)
    await route.fulfill({ status: 204 })
  })
}
const stubbedRequests: BrowserCommand<[pattern: string]> = (_context, pattern) =>
  stubbed.get(pattern) ?? 0
const unstubRequests: BrowserCommand<[pattern: string]> = async (context, pattern) => {
  stubbed.delete(pattern)
  await context.page.unroute(pattern)
}
const commands = { stubRequests, stubbedRequests, unstubRequests }

// Each browser project runs headless at the phone viewport, in Chromium unless it names
// another. A fresh object each, because Vitest names each project's instances in place.
const browserBase = () => ({
  enabled: true,
  headless: true,
  provider: playwright(),
  commands,
  instances: [{ browser: 'chromium' as const }],
  viewport: { width: 390, height: 844 },
})

// Logic runs under jsdom. Anything that measures layout, paints, or drives real input runs in a
// browser, since jsdom does neither.
export default defineConfig((env) =>
  mergeConfig(
    viteConfig(env),
    defineConfig({
      // The dev server's strict port would reach each browser project's server, so a second
      // run in the same checkout would fail instead of taking the next port.
      // The export tests read the golden fixture the Apple tests share, at the repository root.
      server: {
        strictPort: false,
        fs: {
          allow: [
            searchForWorkspaceRoot(process.cwd()),
            fileURLToPath(new URL('../fixtures', import.meta.url)),
          ],
        },
      },
      test: {
        restoreMocks: true,
        mockReset: true,
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
              setupFiles: ['./src/test/setupBrowser.ts'],
              retry: browserRetry,
              browser: browserBase(),
            },
          },
          // WebKit does not focus a clicked link, so focus finds its way back to the list after
          // Back by another path there, and this run confirms the hidden list keeps its scroll
          // without a restore.
          {
            extends: true,
            test: {
              name: 'browser-webkit',
              include: ['src/app/columns.browser.test.tsx'],
              setupFiles: ['./src/test/setupBrowser.ts'],
              retry: browserRetry,
              browser: { ...browserBase(), instances: [{ browser: 'webkit' as const }] },
            },
          },
        ],
      },
    }),
  ),
)
