import { expect, test, type Locator, type Page } from '@playwright/test'
import { addSong, signIn, swipeLeft, unique } from './helpers'

// The Stop button pulses continuously while recording, so Playwright's actionability
// check never sees it stable. Reduced motion turns the pulse off.
test.use({ reducedMotion: 'reduce' })

const DEFAULT_LABEL = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/

/** Record from the dock for at least `seconds`, landing on the recordings tab with the new row unfiled. */
async function recordUnfiled(page: Page, seconds: number): Promise<Locator> {
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('button', { name: 'Start a new recording' })
    .click()
  const timer = page.getByRole('timer')
  await expect(timer).toBeVisible()
  await expect(timer).toHaveText(new RegExp(`^0:0[${seconds}-9]$`), { timeout: 15_000 })
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(page).toHaveURL(/\/recordings$/)
  const row = page.getByRole('list', { name: 'Unfiled' }).getByRole('listitem').first()
  await expect(row).toContainText(DEFAULT_LABEL)
  return row
}

/** File an unfiled row under `title` from its swipe action, and return its row under that song. */
async function addToSong(page: Page, row: Locator, title: string): Promise<Locator> {
  await swipeLeft(page, row)
  // The swipe actions are a sibling of the row inside ion-item-sliding, not a descendant of it,
  // so reaching them means stepping up to the sliding element first.
  await row
    .locator('xpath=..')
    .getByRole('button', { name: /^Add to song / })
    .click()
  // The sheet's own controls are never scoped to its dialog, for the reason `addSong` in
  // helpers.ts records: the dialog is a wrapper inside ion-modal's shadow root and the sheet's
  // content is slotted light DOM rather than a descendant of it.
  await page.getByRole('searchbox', { name: 'Search songs' }).fill(title)
  await page.getByRole('button', { name: `Add to ${title}` }).click()
  // A song's group is headed by the song's own row, so the recording is never the first item.
  const filed = page
    .getByRole('list', { name: title })
    .getByRole('listitem')
    .filter({ hasText: DEFAULT_LABEL })
    .first()
  await expect(filed).toContainText(DEFAULT_LABEL)
  return filed
}

test('record, add the recording to a song, and play it back on the device', async ({ page }) => {
  await signIn(page)
  const title = unique('Cluck Old Hen')
  await addSong(page, title, 'A')

  const unfiled = await recordUnfiled(page, 6)
  const row = await addToSong(page, unfiled, title)
  await row.getByRole('button', { name: /^Play / }).click()
  const audio = page.getByRole('region', { name: 'Player' }).locator('audio')
  await expect(audio).toBeVisible()
  await expect
    .poll(() => audio.evaluate((a: HTMLAudioElement) => a.src.startsWith('blob:')))
    .toBe(true)
})

test('uploads a recording, transcodes it, and plays it back from a second device', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000)

  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })

  await signIn(page)
  const title = unique('Boil Them Cabbage Down')
  await addSong(page, title, 'G')
  const songUrl = page.url()

  const unfiled = await recordUnfiled(page, 3)
  await addToSong(page, unfiled, title)
  await page.goto(songUrl)
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  const row = page.getByRole('list', { name: 'Recordings' }).getByRole('listitem').first()
  await expect(row).toContainText(DEFAULT_LABEL)

  // The transfer loop runs on its own, but nudge it through Settings' Sync now
  // every few seconds in case it is between passes or backing off.
  const uploading = /Waiting to upload|Uploading|Processing/
  const deadline = Date.now() + 120_000
  let settled = false
  while (Date.now() < deadline) {
    if (!uploading.test((await row.textContent()) ?? '')) {
      settled = true
      break
    }
    await page.getByRole('tab', { name: 'Settings' }).click()
    await page.getByRole('button', { name: 'Sync now' }).click()
    await page.waitForTimeout(3_000)
    await page.goto(songUrl)
    await expect(page.getByRole('heading', { name: title })).toBeVisible()
  }
  expect(
    settled,
    `upload/processing did not finish in time; row: "${await row.textContent()}"; ` +
      `console errors: ${JSON.stringify(consoleErrors)}`,
  ).toBe(true)

  const secondDevice = await browser.newContext()
  try {
    const page2 = await secondDevice.newPage()
    const consoleErrors2: string[] = []
    page2.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors2.push(msg.text())
    })
    await signIn(page2)
    await page2.goto(songUrl)
    await expect(page2.getByRole('heading', { name: title })).toBeVisible()
    const row2 = page2.getByRole('list', { name: 'Recordings' }).getByRole('listitem').first()
    // The second device holds no audio yet: the row fetches it first, then offers to play it.
    await row2.getByRole('button', { name: /^Download / }).click()
    await row2.getByRole('button', { name: /^Play / }).click({ timeout: 30_000 })
    const audio = page2.getByRole('region', { name: 'Player' }).locator('audio')
    await expect(audio).toBeVisible()
    try {
      await expect
        .poll(() => audio.evaluate((a: HTMLAudioElement) => a.src.startsWith('blob:')), {
          timeout: 30_000,
        })
        .toBe(true)
      await expect
        .poll(() => audio.evaluate((a: HTMLAudioElement) => a.duration), { timeout: 30_000 })
        .toBeGreaterThan(0)
    } catch (error) {
      throw new Error(`playback never started; console errors: ${JSON.stringify(consoleErrors2)}`, {
        cause: error,
      })
    }
  } finally {
    await secondDevice.close()
  }
})
