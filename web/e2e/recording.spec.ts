import { devices, expect, test, type Locator, type Page } from '@playwright/test'
import {
  addTune,
  DEFAULT_LABEL,
  escapeRegExp,
  nudgeSync,
  openRecordingPage,
  openTab,
  playRecording,
  recordingAttribute,
  showDetails,
  recordingPage,
  recordUnfiled,
  renameRecording,
  showPractice,
  signIn,
  tunePage,
  unique,
  waitForReady,
} from './helpers'
import { ELAPSED_LABEL, PAUSE, PLAY } from '../src/features/player/transportCopy'
import {
  REMOVE_CUT,
  SAVE_SPLIT,
  SPLIT,
  SPLIT_AT,
  SPLIT_CONFIRM_ACTION,
  SPLIT_CONFIRM_TITLE,
} from '../src/features/practice/splitCopy'
import { formatDuration } from '../src/text/format'
import { TRIM } from '../src/features/practice/trimCopy'
import {
  SAVE_TRIM,
  TRIM_CONFIRM_ACTION,
  TRIM_CONFIRM_MESSAGE,
} from '../src/features/practice/trimViewCopy'
import { PLAYER_REGION, SKIP_FORWARD } from '../src/features/player/playerCopy'
import {
  addToTuneName,
  FILED_HEADER,
  UNFILED_HEADER,
} from '../src/features/recordings/recordingsCopy'
import { LINKED_TUNE_LABEL } from '../src/features/recording/recordingPageCopy'
import { RECORDINGS_SECTION } from '../src/features/tune/tuneScreenCopy'
import { MORE_ACTIONS } from '../src/ui/menuCopy'
import { SEARCH_TUNES } from '../src/features/catalog/catalogCopy'

// The Stop button pulses continuously while recording, so Playwright's actionability
// check never sees it stable. Reduced motion turns the pulse off.
test.use({ reducedMotion: 'reduce' })

/**
 * File an unfiled row under `title` from the Linked Tune row of its page, and return its row
 * in Filed, back on Recordings.
 */
async function addToTune(page: Page, row: Locator, title: string): Promise<Locator> {
  await openRecordingPage(row)
  await showDetails(page)
  await recordingAttribute(page, LINKED_TUNE_LABEL).click()
  const picker = page.getByRole('dialog', { name: LINKED_TUNE_LABEL, exact: true })
  await picker.getByRole('searchbox', { name: SEARCH_TUNES }).fill(title)
  await picker.getByRole('row', { name: addToTuneName(title), exact: true }).click()
  await expect(picker).toHaveCount(0)
  await expect(recordingAttribute(page, LINKED_TUNE_LABEL, title)).toBeVisible()
  await openTab(page, 'recordings')
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
    // The second device holds no audio yet: the row's slot fetches it first, then plays it.
    await expect(row2.getByRole('button', { name: /^Download / })).toBeVisible()
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
  await openRecordingPage(unfiled)
  const label = unique('Trimmed recording')
  await renameRecording(page, label)
  const practice = await showPractice(page)
  // Opening a recording's page leaves it stopped, so the playhead holds still for the trim.
  await expect(practice.getByRole('button', { name: PLAY, exact: true })).toBeVisible({
    timeout: 15_000,
  })

  // Trim is in the page's own menu, outside practice.
  await recordingPage(page).getByRole('button', { name: MORE_ACTIONS, exact: true }).click()
  await page
    .getByRole('menu', { name: MORE_ACTIONS })
    .getByRole('menuitem', { name: TRIM, exact: true })
    .click()

  // Three one-second steps in from the end of a 6-second recording keep about 3 seconds.
  const endHandle = practice.locator('[role="slider"][data-handle="end"]')
  await expect(endHandle).toBeVisible()
  await endHandle.focus()
  for (let step = 0; step < 3; step++) await page.keyboard.press('PageDown')
  const save = practice.getByRole('button', { name: SAVE_TRIM, exact: true })
  await expect(save).toBeEnabled()
  await save.click()
  // The confirm is its own overlay, outside the trim view's.
  const confirm = page.getByRole('dialog').filter({ hasText: TRIM_CONFIRM_MESSAGE })
  await confirm.getByRole('button', { name: TRIM_CONFIRM_ACTION, exact: true }).click()
  await expect(confirm).toHaveCount(0)
  // The page's subtitle gives the recording's length beside when it was made.
  await expect(recordingPage(page).locator('[data-recording-subtitle]')).toContainText(/\b0:03\b/, {
    timeout: 15_000,
  })

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

test('splits a recording and another device sees the pieces', async ({ page, browser }) => {
  test.setTimeout(240_000)

  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })

  await signIn(page)

  const unfiled = await recordUnfiled(page, 6)
  await waitForReady(page, unfiled)
  await openRecordingPage(unfiled)
  const label = unique('Split recording')
  await renameRecording(page, label)
  const practice = await showPractice(page)
  // Opening a recording's page leaves it stopped at the start, where the split view opens its
  // cut line.
  await expect(practice.getByRole('button', { name: PLAY, exact: true })).toBeVisible({
    timeout: 15_000,
  })

  await recordingPage(page).getByRole('button', { name: MORE_ACTIONS, exact: true }).click()
  await page
    .getByRole('menu', { name: MORE_ACTIONS })
    .getByRole('menuitem', { name: SPLIT, exact: true })
    .click()

  const split = page.getByRole('dialog', { name: SPLIT, exact: true })
  await expect(split).toBeVisible()
  // One cut a second in, one two seconds before the end of the 6-second recording.
  // Split at the line, whatever time the line is at.
  const splitAtPrefix = SPLIT_AT(0).replace(formatDuration(0), '')
  const addCut = split.getByRole('button', { name: new RegExp(`^${escapeRegExp(splitAtPrefix)}`) })
  await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press('s')
  // The new cut is selected, so the arrows would move it; a skip lets it go and puts the line
  // at the end, from where the second cut is two seconds back.
  await expect(split.getByRole('button', { name: REMOVE_CUT, exact: true })).toBeVisible()
  await split.getByRole('button', { name: SKIP_FORWARD }).click()
  await page.keyboard.press('Shift+ArrowLeft')
  await page.keyboard.press('Shift+ArrowLeft')
  await expect(addCut).toBeVisible()
  await page.keyboard.press('s')
  await expect(split.getByRole('button', { name: REMOVE_CUT, exact: true })).toBeVisible()
  await split.getByRole('button', { name: SAVE_SPLIT, exact: true }).click()
  const confirm = page.getByRole('dialog').filter({ hasText: SPLIT_CONFIRM_TITLE(3) })
  await confirm.getByRole('button', { name: SPLIT_CONFIRM_ACTION, exact: true }).click()
  await expect(confirm).toHaveCount(0)
  await expect(split).toHaveCount(0)
  await openTab(page, 'recordings')

  const pieces = (p: Page): Locator =>
    p
      .getByRole('grid', { name: UNFILED_HEADER, exact: true })
      .getByRole('row')
      .filter({ hasText: label })
  await expect(pieces(page)).toHaveCount(3, { timeout: 15_000 })

  const secondDevice = await browser.newContext({ ...test.info().project.use })
  try {
    const page2 = await secondDevice.newPage()
    const consoleErrors2: string[] = []
    page2.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors2.push(msg.text())
    })
    await signIn(page2)
    await page2.goto('/recordings')
    const rows2 = pieces(page2)
    // The server cuts the pieces in a background job; each poll nudges both devices so neither
    // sits on a backed-off sync pass waiting for the other.
    await expect
      .poll(
        async () => {
          await nudgeSync(page)
          await nudgeSync(page2)
          // A nudge lands on Settings first, so wait for the list to draw before counting.
          await expect(page2.getByRole('grid', { name: UNFILED_HEADER, exact: true })).toBeVisible()
          return rows2.filter({ hasNotText: /Processing/ }).count()
        },
        { timeout: 90_000, intervals: [3_000] },
      )
      .toBe(3)
    await expect(rows2).toHaveCount(3)
    expect(consoleErrors2, JSON.stringify(consoleErrors2)).toEqual([])
  } finally {
    await secondDevice.close()
  }
  expect(consoleErrors, JSON.stringify(consoleErrors)).toEqual([])
})
