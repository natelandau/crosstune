import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  BACK,
  LOOP_NAME,
  LOOPS_LABEL,
  MARK_LOOP,
  PRACTICE,
} from '../src/features/practice/practiceCopy'
import { expectSynced, nudgeSync, recordUnfiled, signIn, swipeLeft, waitForReady } from './helpers'

// The Stop button pulses continuously while recording, so Playwright's actionability
// check never sees it stable. Reduced motion turns the pulse off.
test.use({ reducedMotion: 'reduce' })

/** Opens `row`'s recording screen from its Edit swipe action, then Practice once it is offered. */
async function openPractice(page: Page, row: Locator): Promise<Locator> {
  await swipeLeft(page, row)
  // The swipe actions are a sibling of the row inside ion-item-sliding, not a descendant of it.
  await row
    .locator('xpath=..')
    .getByRole('button', { name: /^Edit / })
    .click()
  // ion-modal names its shadow dialog asynchronously and unreliably, so the modal element
  // itself is the scope.
  const screen = page.locator('ion-modal.show-modal')
  const practice = screen.locator('[data-tool="practice"]')
  // Practice waits while a second device fetches the audio.
  await expect(practice).not.toHaveAttribute('aria-disabled', 'true', { timeout: 30_000 })
  await practice.click()
  await expect(screen.getByRole('heading', { name: PRACTICE, exact: true })).toBeVisible()
  return screen
}

test('marks a loop with A B, names it, and another device sees the name', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000)

  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })

  await signIn(page)
  const unfiled = await recordUnfiled(page, 6)
  await waitForReady(page, unfiled)
  const label = (await unfiled.locator('h3').innerText()).trim()

  const screen = await openPractice(page, unfiled)
  // Opening the recording starts it playing; from the top, the mark has the whole take to run in.
  const transport = screen
    .getByRole('button', { name: 'Pause', exact: true })
    .or(screen.getByRole('button', { name: 'Play', exact: true }))
  await expect(transport).toBeVisible({ timeout: 15_000 })
  if ((await transport.getAttribute('aria-label')) === 'Pause') await transport.click()
  await screen.getByRole('button', { name: 'Skip back 15 seconds', exact: true }).click()
  await screen.getByRole('button', { name: 'Play', exact: true }).click()

  const mark = screen.getByRole('button', { name: MARK_LOOP, exact: true })
  await mark.click()
  await expect(mark).toHaveAttribute('aria-pressed', 'true')
  // Long enough past the double-tap guard for the loop to run a second or more.
  await page.waitForTimeout(1_500)
  await mark.click()
  await screen.getByRole('button', { name: 'Pause', exact: true }).click()

  const loops = screen.getByRole('region', { name: LOOPS_LABEL, exact: true })
  const created = loops.locator('[data-row-open][aria-current="true"]')
  await expect(created).toHaveCount(1)
  // A tap on the selected row opens its name field.
  await created.click()
  const field = loops.getByRole('textbox', { name: LOOP_NAME, exact: true })
  await field.fill('B part')
  await field.press('Enter')
  await expect(loops.getByRole('button', { name: /^B part/ })).toBeVisible()

  await screen.getByRole('button', { name: BACK, exact: true }).click()
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
    await expect(
      screen2
        .getByRole('region', { name: LOOPS_LABEL, exact: true })
        .getByRole('button', { name: /^B part/ }),
    ).toBeVisible({ timeout: 15_000 })
    expect(consoleErrors2, JSON.stringify(consoleErrors2)).toEqual([])
  } finally {
    await secondDevice.close()
  }
  expect(consoleErrors, JSON.stringify(consoleErrors)).toEqual([])
})
