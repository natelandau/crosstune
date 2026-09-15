import { expect, test } from '@playwright/test'
import { addSong, signIn, unique } from './helpers'

// The Stop button pulses continuously while recording, so Playwright's actionability
// check never sees it stable. Reduced motion turns the pulse off.
test.use({ reducedMotion: 'reduce' })

test('record a take from a song and play it back on the device', async ({ page }) => {
  await signIn(page)
  const title = unique('Cluck Old Hen')
  await addSong(page, title, 'A')

  await page.getByRole('main').getByRole('button', { name: 'Record' }).click()
  const timer = page.getByRole('timer')
  await expect(timer).toBeVisible()
  await expect(timer).toHaveText(/^0:0[6-9]$/, { timeout: 15_000 })
  await page.getByRole('button', { name: 'Stop' }).click()
  await page.getByRole('textbox', { name: 'Label' }).fill('First pass')
  await page.getByRole('button', { name: 'Save' }).click()

  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  const row = page.getByRole('list', { name: 'Recordings' }).getByRole('listitem').first()
  await expect(row).toContainText('First pass')
  await expect(row).toContainText('On this device')
  await row.getByRole('button', { name: /^Play / }).click()
  const audio = page.getByRole('region', { name: 'Player' }).locator('audio')
  await expect(audio).toBeVisible()
  await expect
    .poll(() => audio.evaluate((a: HTMLAudioElement) => a.src.startsWith('blob:')))
    .toBe(true)
})

test('the recordings tab lists an unfiled take and attaches it', async ({ page }) => {
  await signIn(page)
  const title = unique('Angeline')
  await addSong(page, title, 'D')
  await page.getByRole('link', { name: 'Crosstune' }).click()

  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('button', { name: 'Record a new take' })
    .click()
  await expect(page.getByRole('timer')).toHaveText(/^0:0[1-9]$/, { timeout: 15_000 })
  await page.getByRole('button', { name: 'Stop' }).click()
  await page.getByRole('button', { name: 'Skip' }).click()
  await expect(page).toHaveURL(/\/recordings$/)
  const row = page.getByRole('list', { name: 'Recordings' }).getByRole('listitem').first()
  await row.getByRole('button', { name: /^Attach / }).click()
  await page.getByRole('searchbox', { name: 'Attach to a song' }).fill(title)
  await page.getByRole('button', { name: new RegExp(title) }).click()
  await expect(row).toContainText(title)
})

test('uploads a take, transcodes it, and plays it back from a second device', async ({
  page,
  browser,
}) => {
  test.skip(process.env.E2E_R2 !== '1', 'set E2E_R2=1 to run against an API with R2 configured')
  test.setTimeout(180_000)

  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })

  await signIn(page)
  const title = unique('Boil Them Cabbage Down')
  await addSong(page, title, 'G')
  const songUrl = page.url()

  await page.getByRole('main').getByRole('button', { name: 'Record' }).click()
  const timer = page.getByRole('timer')
  await expect(timer).toBeVisible()
  await expect(timer).toHaveText(/^0:0[3-9]$/, { timeout: 15_000 })
  await page.getByRole('button', { name: 'Stop' }).click()
  await page.getByRole('textbox', { name: 'Label' }).fill('Upload test')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('heading', { name: title })).toBeVisible()

  const row = page.getByRole('list', { name: 'Recordings' }).getByRole('listitem').first()
  await expect(row).toContainText('Upload test')

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
    await page.getByRole('link', { name: 'Settings' }).click()
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
    await row2.getByRole('button', { name: /^Play / }).click()
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
