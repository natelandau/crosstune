import { clerk, setupClerkTestingToken } from '@clerk/testing/playwright'
import { expect, type Locator, type Page } from '@playwright/test'

export function unique(name: string): string {
  return `${name} ${Date.now().toString(36)}`
}

// A fresh database has no settings row for the test user, so the first sign-in of a run
// meets the first-run prompt; once it is answered the row persists for every later test.
let instrumentsAnswered = false

export async function signIn(page: Page): Promise<void> {
  const emailAddress = process.env.E2E_CLERK_USER_EMAIL
  if (!emailAddress) throw new Error('E2E_CLERK_USER_EMAIL is not set')
  await setupClerkTestingToken({ page })
  await page.goto('/')
  await clerk.signIn({ page, emailAddress })
  await page.goto('/')
  await expectSynced(page)
  if (!instrumentsAnswered) {
    await answerInstrumentsPrompt(page)
    instrumentsAnswered = true
  }
}

/** Answer the first-run instruments prompt if it opens, and carry on if it does not. */
async function answerInstrumentsPrompt(page: Page): Promise<void> {
  const prompt = page.getByRole('dialog', { name: 'Which instruments do you play?' })
  const opened = await prompt
    .waitFor({ state: 'visible', timeout: 3000 })
    .then(() => true)
    .catch(() => false)
  if (!opened) return
  await prompt.getByRole('checkbox', { name: 'Violin' }).check()
  await prompt.getByRole('button', { name: 'Done' }).click()
  await expect(prompt).toBeHidden()
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
  const keys = page.getByRole('group', { name: 'Key' })
  const chip = keys.getByRole('button', { name: key, exact: true })
  // A suggested key is one tap; any other key goes through the Other chip's text field.
  if ((await chip.count()) > 0) {
    await chip.click()
  } else {
    await keys.getByRole('button', { name: 'Other…' }).click()
    await page.getByRole('textbox', { name: 'Other key' }).fill(key)
  }
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

/** Press and hold a row with the mouse. The caller checks the result while the button is down, then releases. */
export async function longPress(
  page: Page,
  target: Locator,
): Promise<{ release: () => Promise<void> }> {
  await target.scrollIntoViewIfNeeded()
  const box = await target.boundingBox()
  if (!box) throw new Error('long-press target is not visible')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  return { release: () => page.mouse.up() }
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
