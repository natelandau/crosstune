import { expect, test } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { ADD_SCANS, SCANS, openScanName, scanCount } from '../src/features/scans/scanCopy'
import { CHOOSE_SCAN_FILES } from '../src/features/scans/ScansSection'
import { addTune, escapeRegExp, expectSynced, openTab, signIn, swipeLeft, unique } from './helpers'

const FIXTURE = fileURLToPath(new URL('./fixtures/scan.jpg', import.meta.url))

test('adds a scan and opens it from the catalog row', async ({ page }) => {
  await signIn(page)
  const title = unique('Red Haired Boy')
  const since = new Date().toISOString()
  await addTune(page, title, 'A')

  await expect(page.getByRole('button', { name: ADD_SCANS })).toBeVisible()
  await page.getByLabel(CHOOSE_SCAN_FILES).setInputFiles(FIXTURE)
  await expect(page.getByRole('button', { name: openScanName(0) })).toBeVisible()
  await expectSynced(page, since)

  await openTab(page, 'Catalog')
  await page.getByRole('searchbox', { name: 'Search tunes' }).fill(title)
  const card = page.getByRole('button', { name: new RegExp(`^${escapeRegExp(title)}`) })
  await swipeLeft(page, card)
  await page.getByRole('button', { name: `${SCANS} ${title}` }).click()

  const viewer = page.locator('ion-modal.show-modal')
  await expect(viewer.getByText(scanCount(0, 1), { exact: true })).toBeVisible()
})
