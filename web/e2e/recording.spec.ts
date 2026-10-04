import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  addTune,
  DEFAULT_LABEL,
  expectNoOverlay,
  nudgeSync,
  openRecordingScreen,
  recordUnfiled,
  renameRecording,
  signIn,
  swipeLeft,
  unique,
  waitForReady,
} from './helpers'
import { PAUSE, PLAY } from '../src/features/player/transportCopy'
import { TRIM } from '../src/features/recording-screen/TrimView'
import { MORE_ACTIONS } from '../src/ui/Menu'

// The Stop button pulses continuously while recording, so Playwright's actionability
// check never sees it stable. Reduced motion turns the pulse off.
test.use({ reducedMotion: 'reduce' })

/** File an unfiled row under `title` from its swipe action, and return its row in Filed. */
async function addToTune(page: Page, row: Locator, title: string): Promise<Locator> {
  await swipeLeft(page, row)
  // The swipe actions are a sibling of the row inside ion-item-sliding, not a descendant of it,
  // so reaching them means stepping up to the sliding element first.
  await row
    .locator('xpath=..')
    .getByRole('button', { name: /^Add to tune / })
    .click()
  // The sheet's own controls are never scoped to its dialog, for the reason `addTune` in
  // helpers.ts records: the dialog is a wrapper inside ion-modal's shadow root and the sheet's
  // content is slotted light DOM rather than a descendant of it.
  await page.getByRole('searchbox', { name: 'Search tunes' }).fill(title)
  await page.getByRole('button', { name: `Add to ${title}` }).click()
  // Every filed recording shares one list, and each row there names its tune on its tune line.
  const filed = page
    .getByRole('list', { name: 'Filed', exact: true })
    .getByRole('listitem')
    .filter({ hasText: title })
    .filter({ hasText: DEFAULT_LABEL })
    .first()
  await expect(filed).toContainText(DEFAULT_LABEL)
  return filed
}

test('record, add the recording to a tune, and play it back on the device', async ({ page }) => {
  await signIn(page)
  const title = unique('Cluck Old Hen')
  await addTune(page, title, 'A')

  const unfiled = await recordUnfiled(page, 6)
  const row = await addToTune(page, unfiled, title)
  // At the title, clear of the tune line under it, which is a separate control that opens the tune.
  const play = row.getByRole('button', { name: /^Play / })
  const control = (await play.boundingBox())!
  const heading = (await row.getByRole('heading', { name: DEFAULT_LABEL }).boundingBox())!
  await play.click({
    position: {
      x: heading.x - control.x + Math.min(heading.width / 2, 16),
      y: heading.y - control.y + heading.height / 2,
    },
  })
  const player = page.getByRole('region', { name: 'Player' })
  // Every recording reaches the dock from a Play tap, so it starts playing on its own.
  await expect(player.getByRole('button', { name: PAUSE })).toBeVisible()
  await expect(player.getByRole('timer').first()).toHaveText(/^0:0\d$/)
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
  await addTune(page, title, 'G')
  const tuneUrl = page.url()

  const unfiled = await recordUnfiled(page, 3)
  await addToTune(page, unfiled, title)
  await page.goto(tuneUrl)
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  const row = page.getByRole('list', { name: 'Recordings' }).getByRole('listitem').first()
  await expect(row).toContainText(DEFAULT_LABEL)

  try {
    await waitForReady(page, row, {
      timeout: 120_000,
      restore: async () => {
        await page.goto(tuneUrl)
        await expect(page.getByRole('heading', { name: title })).toBeVisible()
      },
    })
  } catch (error) {
    throw new Error(
      `upload/processing did not finish in time; row: "${await row.textContent()}"; ` +
        `console errors: ${JSON.stringify(consoleErrors)}`,
      { cause: error },
    )
  }

  const secondDevice = await browser.newContext()
  try {
    const page2 = await secondDevice.newPage()
    const consoleErrors2: string[] = []
    page2.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors2.push(msg.text())
    })
    await signIn(page2)
    await page2.goto(tuneUrl)
    await expect(page2.getByRole('heading', { name: title })).toBeVisible()
    const row2 = page2.getByRole('list', { name: 'Recordings' }).getByRole('listitem').first()
    // The second device holds no audio yet: the row fetches it first, then offers to play it.
    await row2.getByRole('button', { name: /^Download / }).click()
    await row2.getByRole('button', { name: /^Play / }).click({ timeout: 30_000 })
    const player2 = page2.getByRole('region', { name: 'Player' })
    await expect(player2.getByRole('button', { name: PAUSE })).toBeVisible()
    try {
      // The elapsed timer only advances once the decoded audio is genuinely playing.
      await expect
        .poll(async () => player2.getByRole('timer').first().textContent(), { timeout: 30_000 })
        .not.toBe('0:00')
    } catch (error) {
      throw new Error(`playback never started; console errors: ${JSON.stringify(consoleErrors2)}`, {
        cause: error,
      })
    }
  } finally {
    await secondDevice.close()
  }
})

test('trims a recording and another device sees it', async ({ page, browser }) => {
  test.setTimeout(180_000)

  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })

  await signIn(page)

  const unfiled = await recordUnfiled(page, 6)
  await waitForReady(page, unfiled)
  const screen = await openRecordingScreen(page, unfiled)

  // Opening the recording starts it playing; pausing (whichever state it lands in) keeps the
  // playhead from drifting past the range this test is about to trim.
  const transport = screen
    .getByRole('button', { name: PAUSE, exact: true })
    .or(screen.getByRole('button', { name: PLAY, exact: true }))
  await expect(transport).toBeVisible({ timeout: 15_000 })
  if ((await transport.getAttribute('aria-label')) === PAUSE) await transport.click()

  await screen.getByRole('button', { name: MORE_ACTIONS, exact: true }).click()
  await page
    .locator('ion-action-sheet, ion-popover')
    .last()
    .getByRole('button', { name: TRIM, exact: true })
    .click()

  const overview = screen.getByRole('slider', { name: 'Whole recording' })
  await expect(screen.getByRole('button', { name: 'Set end', exact: true })).toBeEnabled()
  const box = await overview.boundingBox()
  if (!box) throw new Error('trim overview is not visible')
  // Halfway across a 6-second recording lands the playhead around 3 seconds.
  await overview.click({ position: { x: box.width / 2, y: box.height / 2 } })
  await page.keyboard.press(']')
  const save = screen.getByRole('button', { name: 'Save', exact: true })
  await expect(save).toBeEnabled()
  // Back to the start before saving, so the kept range plays from its own beginning.
  await screen.getByRole('button', { name: 'Go to start' }).click()
  await save.click()
  // The confirm sheet is its own overlay, outside the recording screen's modal.
  await page.getByRole('button', { name: 'Trim', exact: true }).click()
  await expectNoOverlay(page)
  const label = unique('Trimmed take')
  await renameRecording(page, screen, label)

  await screen.getByRole('button', { name: 'Close', exact: true }).click()
  const player = page.getByRole('region', { name: 'Player' })
  await expect(player.getByRole('timer', { name: /^Remaining/ })).toHaveText('-0:03', {
    timeout: 15_000,
  })

  const secondDevice = await browser.newContext()
  try {
    const page2 = await secondDevice.newPage()
    const consoleErrors2: string[] = []
    page2.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors2.push(msg.text())
    })
    await signIn(page2)
    await page2.goto('/recordings')
    const row2 = page2
      .getByRole('list', { name: 'Unfiled' })
      .getByRole('listitem')
      .filter({ hasText: label })
    // The server's trim job runs after the push; each poll nudges both devices so neither
    // sits on a backed-off sync pass waiting for the other.
    await expect
      .poll(
        async () => {
          await nudgeSync(page)
          await nudgeSync(page2)
          return row2.textContent()
        },
        { timeout: 60_000, intervals: [3_000] },
      )
      .toMatch(/0:03/)
    expect(consoleErrors2, JSON.stringify(consoleErrors2)).toEqual([])
  } finally {
    await secondDevice.close()
  }
  expect(consoleErrors, JSON.stringify(consoleErrors)).toEqual([])
})
