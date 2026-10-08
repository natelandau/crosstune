import { expect, test } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import {
  ADD_SCANS,
  CHOOSE_SCAN_FILES,
  openScanName,
  SCANS,
  scanCount,
  scanViewerName,
} from '../src/features/scans/scanCopy'
import {
  addTune,
  expectSynced,
  openTab,
  signIn,
  swipeLeft,
  tunePage,
  tuneRow,
  unique,
} from './helpers'
import { SEARCH_TUNES } from '../src/features/catalog/catalogCopy'

const FIXTURE = fileURLToPath(new URL('./fixtures/scan.jpg', import.meta.url))

test('adds a scan and opens it from the catalog row', async ({ page }) => {
  await signIn(page)
  const title = unique('Red Haired Boy')
  const since = new Date().toISOString()
  await addTune(page, title, 'A')

  await expect(tunePage(page).getByRole('button', { name: ADD_SCANS })).toBeVisible()
  await page.getByLabel(CHOOSE_SCAN_FILES).setInputFiles(FIXTURE)
  await expect(tunePage(page).getByRole('button', { name: openScanName(0) })).toBeVisible()
  await expectSynced(page, since)

  await openTab(page, 'catalog')
  await page.getByRole('searchbox', { name: SEARCH_TUNES }).fill(title)
  const row = tuneRow(page, title)
  await swipeLeft(page, row)
  await row.getByRole('button', { name: SCANS, exact: true }).click()

  const viewer = page.getByRole('dialog', { name: scanViewerName(title) })
  await expect(viewer.getByText(scanCount(0, 1), { exact: true })).toBeVisible()
})
