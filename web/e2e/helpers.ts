import { clerk, setupClerkTestingToken } from '@clerk/testing/playwright'
import { expect, type Page } from '@playwright/test'

export function unique(name: string): string {
  return `${name} ${Date.now().toString(36)}`
}

export async function signIn(page: Page): Promise<void> {
  const emailAddress = process.env.E2E_CLERK_USER_EMAIL
  if (!emailAddress) throw new Error('E2E_CLERK_USER_EMAIL is not set')
  await setupClerkTestingToken({ page })
  await page.goto('/')
  await clerk.signIn({ page, emailAddress })
  await page.goto('/')
  await expectSynced(page)
}

/**
 * Wait for a sync run that finished clean after `after`, so an idle indicator left over
 * from an earlier run never passes for the run the test just triggered.
 */
export async function expectSynced(page: Page, after = ''): Promise<void> {
  const indicator = page.getByTestId('sync-status')
  await expect
    .poll(
      async () => {
        const [status, syncedAt] = await Promise.all([
          indicator.getAttribute('data-status'),
          indicator.getAttribute('data-synced-at'),
        ])
        return status === 'idle' && syncedAt !== null && syncedAt > after
      },
      { timeout: 30_000 },
    )
    .toBe(true)
}

export async function addSong(page: Page, title: string, key: string): Promise<void> {
  await page.getByRole('link', { name: 'Add song' }).click()
  await page.getByRole('textbox', { name: 'Title' }).fill(title)
  await page.getByRole('combobox', { name: 'Key' }).fill(key)
  await page.getByRole('radio', { name: 'Learning' }).check({ force: true })
  await page.getByRole('button', { name: 'Add song' }).click()
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
}
