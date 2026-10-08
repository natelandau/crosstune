import { devices, expect, test, type Locator, type Page } from '@playwright/test'
import {
  addTune,
  DEFAULT_LABEL,
  nudgeSync,
  openPractice,
  playRecording,
  recordUnfiled,
  renameRecording,
  signIn,
  swipeLeft,
  tunePage,
  unique,
  waitForReady,
} from './helpers'
import { ELAPSED_LABEL, PAUSE, PLAY } from '../src/features/player/transportCopy'
import { TRIM } from '../src/features/practice/trimCopy'
import {
  GO_TO_START,
  OVERVIEW_LABEL,
  SAVE_TRIM,
  SET_END,
  TRIM_CONFIRM_ACTION,
  TRIM_CONFIRM_MESSAGE,
} from '../src/features/practice/trimViewCopy'
import { PLAYER_REGION } from '../src/features/player/playerCopy'
import {
  ADD_TO_TUNE_TITLE,
  addToTuneName,
  FILED_HEADER,
  UNFILED_HEADER,
} from '../src/features/recordings/recordingsCopy'
import { RECORDINGS_SECTION } from '../src/features/tune/tuneScreenCopy'
import { CLOSE } from '../src/ui/confirmCopy'
import { MORE_ACTIONS } from '../src/ui/menuCopy'
import { ADD_TO_TUNE } from '../src/features/recordings/recordingCopy'
import { SEARCH_TUNES } from '../src/features/catalog/catalogCopy'

// The Stop button pulses continuously while recording, so Playwright's actionability
// check never sees it stable. Reduced motion turns the pulse off.
test.use({ reducedMotion: 'reduce' })

/** File an unfiled row under `title` from its swipe action, and return its row in Filed. */
async function addToTune(page: Page, row: Locator, title: string): Promise<Locator> {
  await swipeLeft(page, row)
  await row.getByRole('button', { name: ADD_TO_TUNE, exact: true }).click()
  const picker = page.getByRole('dialog', { name: ADD_TO_TUNE_TITLE })
  await picker.getByRole('searchbox', { name: SEARCH_TUNES }).fill(title)
  await picker.getByRole('row', { name: addToTuneName(title), exact: true }).click()
  // Every filed recording shares one list, and each row there names its tune on its tune line.
  const filed = page
    .getByRole('grid', { name: FILED_HEADER, exact: true })
    .getByRole('row')
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
  await playRecording(row)
  const player = page.getByRole('region', { name: PLAYER_REGION })
  // Every recording reaches the now-playing bar from a Play tap, so it starts playing on its own.
  await expect(player.getByRole('button', { name: PAUSE })).toBeVisible()
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
  await expect(tunePage(page).getByRole('heading', { name: title })).toBeVisible()
  const row = tunePage(page)
    .getByRole('grid', { name: RECORDINGS_SECTION })
    .getByRole('row')
    .first()
  await expect(row).toContainText(DEFAULT_LABEL)

  try {
    await waitForReady(page, row, {
      timeout: 120_000,
      restore: async () => {
        await page.goto(tuneUrl)
        await expect(tunePage(page).getByRole('heading', { name: title })).toBeVisible()
      },
    })
  } catch (error) {
    throw new Error(
      `upload/processing did not finish in time; row: "${await row.textContent()}"; ` +
        `console errors: ${JSON.stringify(consoleErrors)}`,
      { cause: error },
    )
  }

  // A desktop, whose dock counts the elapsed time the phone's bar leaves out.
  // Every option it leaves out comes from the phone project, so the desktop names them all.
  const secondDevice = await browser.newContext({ ...devices['Desktop Chrome'] })
  try {
    const page2 = await secondDevice.newPage()
    const consoleErrors2: string[] = []
    page2.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors2.push(msg.text())
    })
    await signIn(page2)
    await page2.goto(tuneUrl)
    await expect(tunePage(page2).getByRole('heading', { name: title })).toBeVisible()
    const row2 = tunePage(page2)
      .getByRole('grid', { name: RECORDINGS_SECTION })
      .getByRole('row')
      .first()
    // The second device holds no audio yet: the row fetches it first, then offers to play it.
    await expect(row2).toHaveAccessibleName(/^Download /)
    await playRecording(row2)
    const player2 = page2.getByRole('region', { name: PLAYER_REGION })
    await expect(player2.getByRole('button', { name: PAUSE })).toBeVisible()
    try {
      // The elapsed timer only advances once the decoded audio is genuinely playing.
      await expect
        .poll(
          async () =>
            player2.getByRole('timer', { name: new RegExp(`^${ELAPSED_LABEL}`) }).textContent(),
          { timeout: 30_000 },
        )
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
  const practice = await openPractice(page, unfiled)

  // Opening the recording starts it playing; pausing (whichever state it lands in) keeps the
  // playhead from drifting past the range this test is about to trim.
  const transport = practice
    .getByRole('button', { name: PAUSE, exact: true })
    .or(practice.getByRole('button', { name: PLAY, exact: true }))
  await expect(transport).toBeVisible({ timeout: 15_000 })
  if ((await transport.getAttribute('aria-label')) === PAUSE) await transport.click()

  await practice.getByRole('button', { name: MORE_ACTIONS, exact: true }).click()
  await page
    .getByRole('menu', { name: MORE_ACTIONS })
    .getByRole('menuitem', { name: TRIM, exact: true })
    .click()

  const overview = practice.getByRole('slider', { name: OVERVIEW_LABEL })
  const setEnd = practice.getByRole('button', { name: SET_END, exact: true })
  await expect(setEnd).toBeEnabled()
  const box = await overview.boundingBox()
  if (!box) throw new Error('trim overview is not visible')
  // Halfway across a 6-second recording lands the playhead around 3 seconds.
  await overview.click({ position: { x: box.width / 2, y: box.height / 2 } })
  await setEnd.click()
  const save = practice.getByRole('button', { name: SAVE_TRIM, exact: true })
  await expect(save).toBeEnabled()
  // Back to the start before saving, so the kept range plays from its own beginning.
  await practice.getByRole('button', { name: GO_TO_START }).click()
  await save.click()
  // The confirm is its own overlay, outside practice's.
  const confirm = page.getByRole('dialog').filter({ hasText: TRIM_CONFIRM_MESSAGE })
  await confirm.getByRole('button', { name: TRIM_CONFIRM_ACTION, exact: true }).click()
  await expect(confirm).toHaveCount(0)
  const label = unique('Trimmed take')
  await renameRecording(page, practice, label)
  // Practice's header gives the recording's length beside when it was made.
  await expect(practice.getByRole('banner')).toContainText(/\b0:03\b/, { timeout: 15_000 })
  await practice.getByRole('button', { name: CLOSE, exact: true }).click()

  // A phone, since each nudge drives the phone's tab bar on both devices.
  const secondDevice = await browser.newContext({ ...test.info().project.use })
  try {
    const page2 = await secondDevice.newPage()
    const consoleErrors2: string[] = []
    page2.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors2.push(msg.text())
    })
    await signIn(page2)
    await page2.goto('/recordings')
    const row2 = page2
      .getByRole('grid', { name: UNFILED_HEADER, exact: true })
      .getByRole('row')
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
