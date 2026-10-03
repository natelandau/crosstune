import { expect, test, type Locator, type Page } from '@playwright/test'
import { LOOP_NAME, LOOPS_LABEL, NEW_LOOP } from '../src/features/practice/practiceCopy'
import {
  expectSynced,
  nudgeSync,
  openRecordingScreen,
  recordUnfiled,
  renameRecording,
  signIn,
  unique,
  waitForReady,
} from './helpers'
import { PAUSE, PLAY, REPEAT_LOOP } from '../src/features/player/transportCopy'

// The Stop button pulses continuously while recording, so Playwright's actionability
// check never sees it stable. Reduced motion turns the pulse off.
test.use({ reducedMotion: 'reduce' })

/** Opens `row`'s recording screen from the dock, on the Loops segment. */
async function openPractice(page: Page, row: Locator): Promise<Locator> {
  const screen = await openRecordingScreen(page, row)
  // The screen waits while a second device fetches the audio.
  await expect(screen.getByRole('tab', { name: LOOPS_LABEL, exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
    { timeout: 30_000 },
  )
  return screen
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

  const screen = await openPractice(page, unfiled)
  const transport = screen
    .getByRole('button', { name: PAUSE, exact: true })
    .or(screen.getByRole('button', { name: PLAY, exact: true }))
  await expect(transport).toBeVisible({ timeout: 15_000 })
  if ((await transport.getAttribute('aria-label')) === PAUSE) await transport.click()

  await screen.getByRole('button', { name: NEW_LOOP, exact: true }).click()
  // The new loop is selected, and its name tab opens the name field.
  await screen.locator('[data-name-tab]').click()
  const field = screen.getByRole('textbox', { name: LOOP_NAME, exact: true })
  await field.fill('B part')
  await field.press('Enter')
  const repeat = screen.getByRole('button', { name: REPEAT_LOOP('B part'), exact: true })
  await expect(repeat).toBeVisible()
  await repeat.click()
  await expect(screen.getByRole('button', { name: PAUSE, exact: true })).toBeVisible()
  await screen.getByRole('button', { name: PAUSE, exact: true }).click()

  const label = unique('Practice take')
  await renameRecording(page, screen, label)
  await screen.getByRole('button', { name: 'Close', exact: true }).click()
  const pushedAfter = new Date().toISOString()
  await nudgeSync(page)
  await expectSynced(page, pushedAfter)

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
      .getByRole('list', { name: 'Unfiled', exact: true })
      .getByRole('listitem')
      .filter({ hasText: label })
    await expect(row2).toBeVisible({ timeout: 30_000 })
    await expectSynced(page2)

    const screen2 = await openPractice(page2, row2)
    await expect(screen2.locator('[data-name-tab]', { hasText: 'B part' })).toBeVisible({
      timeout: 15_000,
    })
    expect(consoleErrors2, JSON.stringify(consoleErrors2)).toEqual([])
  } finally {
    await secondDevice.close()
  }
  expect(consoleErrors, JSON.stringify(consoleErrors)).toEqual([])
})
