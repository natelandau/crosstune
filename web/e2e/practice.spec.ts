import { devices, expect, test, type Locator } from '@playwright/test'
import {
  LOOP_NAME,
  LOOPS_LABEL,
  MODES_LABEL,
  NEW_LOOP,
} from '../src/features/practice/practiceCopy'
import { UNFILED_HEADER } from '../src/features/recordings/recordingsCopy'
import {
  expectSynced,
  nudgeSync,
  openPractice,
  openRecordingPage,
  recordUnfiled,
  renameRecording,
  showPractice,
  signIn,
  unique,
  waitForReady,
} from './helpers'
import { PAUSE, PLAY, REPEAT_LOOP } from '../src/features/player/transportCopy'

// The Stop button pulses continuously while recording, so Playwright's actionability
// check never sees it stable. Reduced motion turns the pulse off.
test.use({ reducedMotion: 'reduce' })

/** Waits for `practice`, opens its Loops mode, and returns it. */
async function onLoops(practice: Locator): Promise<Locator> {
  const loops = practice
    .getByRole('radiogroup', { name: MODES_LABEL })
    .getByRole('radio', { name: LOOPS_LABEL, exact: true })
  // Practice waits while a second device fetches the audio.
  await loops.click({ timeout: 30_000 })
  await expect(loops).toBeChecked()
  return practice
}

test('adds a loop, names it, and another device sees the name', async ({ page, browser }) => {
  test.setTimeout(180_000)

  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })

  await signIn(page)
  const unfiled = await recordUnfiled(page, 6)
  await waitForReady(page, unfiled)

  await openRecordingPage(unfiled)
  const label = unique('Practice recording')
  await renameRecording(page, label)
  const practice = await onLoops(await showPractice(page))
  // Opening a recording's page never starts it playing.
  await expect(practice.getByRole('button', { name: PLAY, exact: true })).toBeVisible({
    timeout: 15_000,
  })

  await practice.getByRole('button', { name: NEW_LOOP, exact: true }).click()
  // The new loop is selected, and its name tab opens the name field.
  await practice.locator('[data-name-tab]').click()
  const field = practice.getByRole('textbox', { name: LOOP_NAME, exact: true })
  await field.fill('B part')
  await field.press('Enter')
  const repeat = practice.getByRole('button', { name: REPEAT_LOOP('B part'), exact: true })
  await expect(repeat).toBeVisible()
  await repeat.click()
  await expect(practice.getByRole('button', { name: PAUSE, exact: true })).toBeVisible()
  await practice.getByRole('button', { name: PAUSE, exact: true }).click()

  const pushedAfter = new Date().toISOString()
  await nudgeSync(page)
  await expectSynced(page, pushedAfter)

  // A desktop, whose recording page shows practice beside the details, with no tabs.
  // Every option it leaves out comes from the phone project, so the desktop names them all.
  const secondDevice = await browser.newContext({ ...devices['Desktop Chrome'] })
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
    await expect(row2).toBeVisible({ timeout: 30_000 })
    await expectSynced(page2)

    const practice2 = await onLoops(await openPractice(row2, label))
    await expect(practice2.locator('[data-name-tab]', { hasText: 'B part' })).toBeVisible({
      timeout: 15_000,
    })
    expect(consoleErrors2, JSON.stringify(consoleErrors2)).toEqual([])
  } finally {
    await secondDevice.close()
  }
  expect(consoleErrors, JSON.stringify(consoleErrors)).toEqual([])
})
