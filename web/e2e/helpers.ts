import { clerk, setupClerkTestingToken } from '@clerk/testing/playwright'
import { expect, type Locator, type Page } from '@playwright/test'

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
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill(title)
  await page.getByRole('combobox', { name: 'Key' }).fill(key)
  await page.getByRole('radio', { name: 'Learning' }).check({ force: true })
  await page.getByRole('button', { name: 'Add song' }).click()
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
}

/** Drag a row left with the mouse, far and fast enough to open its swipe actions. */
export async function swipeLeft(page: Page, target: Locator): Promise<void> {
  // Raw mouse input skips Playwright's actionability checks, so a row under the fixed dock would
  // take the press on the dock instead.
  await target.scrollIntoViewIfNeeded()
  const box = await target.boundingBox()
  if (!box) throw new Error('swipe target is not visible')
  const y = box.y + box.height / 2
  const startX = box.x + box.width - 16
  await page.mouse.move(startX, y)
  await page.mouse.down()
  await page.mouse.move(startX - 200, y, { steps: 12 })
  await page.mouse.up()
  await expectSettled(target)
}

/**
 * Wait until a dragged element stops moving. The app and dnd-kit drop clicks for a moment after a
 * drag, so the next tap has to come only once things settle, as a person's would.
 */
export async function expectSettled(target: Locator): Promise<void> {
  let previous: string | undefined
  await expect
    .poll(
      async () => {
        const box = JSON.stringify(await target.boundingBox())
        const settled = box === previous
        previous = box
        return settled
      },
      { intervals: [50] },
    )
    .toBe(true)
}
