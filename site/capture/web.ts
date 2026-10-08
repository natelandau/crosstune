// Captures the web app signed in as the marketing account, against `just dev`:
//   node capture/web.ts
// Writes family-web.png (desktop) and family-android.png (Pixel 7) to capture/.out/, where run.ts
// picks them up as host stills.
import { mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { clerk, clerkSetup, setupClerkTestingToken } from '@clerk/testing/playwright'
import { chromium, devices } from 'playwright'
import type { BrowserContextOptions, Page } from 'playwright'
import { TUNE } from '../../web/src/features/tune/tunePageCopy.ts'
import { STILL_DIR } from './hosts.ts'

/** Must match MARKETING_EMAIL in api/src/crosstune/ops/seed_marketing.py. */
export const MARKETING_EMAIL = 'crosstune-marketing+clerk_test@example.com'

const BASE_URL = 'http://localhost:5173'
/** The tune the desktop still opens beside the list, the one the iPad still shows. */
const OPEN_TUNE = 'Backstep Cindy'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

async function signIn(page: Page): Promise<void> {
  await setupClerkTestingToken({ page })
  await page.goto(BASE_URL)
  try {
    await clerk.signIn({ page, emailAddress: MARKETING_EMAIL })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(
      `signing in as ${MARKETING_EMAIL} failed (${reason}); ` +
        'run `just api::seed-marketing` to create the account',
      { cause: error },
    )
  }
  await page.goto(BASE_URL)
  // Badges repeat on every frame and the first can be hidden; they all read one store.
  await page.waitForSelector('[data-testid="sync-status"][data-status="idle"]', {
    state: 'attached',
    timeout: 30_000,
  })
}

async function waitForCatalog(page: Page): Promise<void> {
  // The catalog's rows are a grid on every frame; on wide the page's main is the empty detail.
  await page.getByRole('grid').getByRole('row').first().waitFor({ timeout: 30_000 })
  await page.evaluate(() => document.fonts.ready)
}

async function openTune(page: Page, title: string): Promise<void> {
  // A row's name leads with the title, then its key, status, and tunings.
  await page
    .getByRole('grid')
    .getByRole('row', { name: new RegExp(`^${title},`) })
    .click()
  await page
    .getByRole('main', { name: TUNE })
    .getByRole('heading', { level: 1, name: title })
    .waitFor({ timeout: 30_000 })
  await page.evaluate(async () => {
    await Promise.all(
      [...document.images]
        .filter((img) => !img.complete)
        .map((img) => img.decode().catch(() => {})),
    )
  })
  // The click leaves the row hovered and focused; the still shows only its selection.
  await page.mouse.move(0, 0)
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
}

async function main() {
  process.loadEnvFile(join(root, 'web/.env'))
  await clerkSetup({ publishableKey: process.env.VITE_CLERK_PUBLISHABLE_KEY })
  await mkdir(STILL_DIR, { recursive: true })

  const browser = await chromium.launch()
  try {
    const targets: { name: string; options: BrowserContextOptions; open?: string }[] = [
      {
        name: 'family-web',
        options: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
        open: OPEN_TUNE,
      },
      { name: 'family-android', options: devices['Pixel 7'] },
    ]
    for (const { name, options, open } of targets) {
      // Reduced motion lands every transition at its end, so no still catches one midway.
      const context = await browser.newContext({
        ...options,
        colorScheme: 'dark',
        reducedMotion: 'reduce',
      })
      try {
        const page = await context.newPage()
        await signIn(page)
        await waitForCatalog(page)
        if (open) await openTune(page, open)
        await page.screenshot({ path: join(STILL_DIR, `${name}.png`) })
        console.log(`${name}: ${join(STILL_DIR, `${name}.png`)}`)
      } finally {
        await context.close()
      }
    }
  } finally {
    await browser.close()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
