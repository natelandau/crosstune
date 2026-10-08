import { devices, expect, test, type Locator, type Page } from '@playwright/test'
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
  recordUnfiled,
  renameRecording,
  signIn,
  unique,
  waitForReady,
} from './helpers'
import { PAUSE, PLAY, REPEAT_LOOP } from '../src/features/player/transportCopy'
import { CLOSE } from '../src/ui/confirmCopy'

// The Stop button pulses continuously while recording, so Playwright's actionability
// check never sees it stable. Reduced motion turns the pulse off.
test.use({ reducedMotion: 'reduce' })

/** Opens practice on `row` from the now-playing bar, in the Loops mode. */
async function openPracticeOnLoops(page: Page, row: Locator, label?: string): Promise<Locator> {
  const practice = await openPractice(page, row, label)
  // Practice waits while a second device fetches the audio.
  await expect(
    practice
      .getByRole('radiogroup', { name: MODES_LABEL })
      .getByRole('radio', { name: LOOPS_LABEL, exact: true }),
  ).toBeChecked({ timeout: 30_000 })
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

  const practice = await openPracticeOnLoops(page, unfiled)
  const transport = practice
    .getByRole('button', { name: PAUSE, exact: true })
    .or(practice.getByRole('button', { name: PLAY, exact: true }))
  await expect(transport).toBeVisible({ timeout: 15_000 })
  if ((await transport.getAttribute('aria-label')) === PAUSE) await transport.click()

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

  const label = unique('Practice take')
  await renameRecording(page, practice, label)
  await practice.getByRole('button', { name: CLOSE, exact: true }).click()
  const pushedAfter = new Date().toISOString()
  await nudgeSync(page)
  await expectSynced(page, pushedAfter)

  // A desktop, so practice also opens from the desktop player's dock.
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

    const practice2 = await openPracticeOnLoops(page2, row2, label)
    await expect(practice2.locator('[data-name-tab]', { hasText: 'B part' })).toBeVisible({
      timeout: 15_000,
    })
    expect(consoleErrors2, JSON.stringify(consoleErrors2)).toEqual([])
  } finally {
    await secondDevice.close()
  }
  expect(consoleErrors, JSON.stringify(consoleErrors)).toEqual([])
})
