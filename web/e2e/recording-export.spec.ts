import { expect, test, type Page } from '@playwright/test'
import {
  escapeRegExp,
  expectNoOverlay,
  openRecordingPage,
  recordingPage,
  recordUnfiled,
  renameRecording,
  signIn,
  unique,
} from './helpers'
import { DOWNLOAD } from '../src/features/recordings/recordingNames'
import { SELECT_RECORDINGS, UNFILED_HEADER } from '../src/features/recordings/recordingsCopy'
import { SELECTION_ACTIONS, selectedTitle } from '../src/features/selection/selectionCopy'
import { formatDate } from '../src/features/settings/export/buildExport'
import { destination } from '../src/layout/destinations'
import { MORE_ACTIONS } from '../src/ui/menuCopy'

// The Stop button pulses while recording, so Playwright never sees it stable without this.
test.use({ reducedMotion: 'reduce' })

const RECORDINGS = destination('recordings')

/** Today's date as the browser's clock shows it, which names a recording and the zip. */
const today = (page: Page) =>
  page
    .evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
    .then((timeZone) => formatDate(new Date(), timeZone))

test("downloads a recording from its page under the recording's name", async ({ page }) => {
  await signIn(page)
  const row = await recordUnfiled(page, 1)
  await openRecordingPage(row)
  const name = unique('Exported recording')
  await renameRecording(page, name)

  await recordingPage(page).getByRole('button', { name: MORE_ACTIONS }).click()
  const download = page.waitForEvent('download')
  await page
    .getByRole('menu', { name: MORE_ACTIONS })
    .getByRole('menuitem', { name: DOWNLOAD, exact: true })
    .click()
  // The title, then the recorded date, then the extension the browser's recorder chose.
  expect((await download).suggestedFilename()).toMatch(
    new RegExp(`^${escapeRegExp(`${name} ${await today(page)}`)}\\.\\w+$`),
  )
})

test('downloads two selected recordings as one zip', async ({ page }) => {
  await signIn(page)
  await recordUnfiled(page, 1)
  await recordUnfiled(page, 1)

  await page
    .getByRole('main', { name: RECORDINGS.label, exact: true })
    .getByRole('button', { name: MORE_ACTIONS })
    .click()
  await page
    .getByRole('menu', { name: MORE_ACTIONS })
    .getByRole('menuitem', { name: SELECT_RECORDINGS, exact: true })
    .click()
  await expectNoOverlay(page)
  const rows = page.getByRole('grid', { name: UNFILED_HEADER, exact: true }).getByRole('row')
  await rows.nth(0).click()
  await rows.nth(1).click()
  await expect(page.getByText(selectedTitle(2), { exact: true })).toBeVisible()

  const download = page.waitForEvent('download')
  await page
    .getByRole('toolbar', { name: SELECTION_ACTIONS })
    .getByRole('button', { name: DOWNLOAD, exact: true })
    .click()
  expect((await download).suggestedFilename()).toBe(`crosstune-recordings-${await today(page)}.zip`)
  await expect(page.getByText(selectedTitle(2), { exact: true })).toHaveCount(0)
})
