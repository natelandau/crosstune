import { expect, test } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import {
  ADD_NOTATION,
  NOTATION,
  openPageName,
  pageCount,
} from '../src/features/notation/notationCopy'
import { CHOOSE_NOTATION_FILES } from '../src/features/notation/NotationSection'
import { addTune, escapeRegExp, expectSynced, openTab, signIn, swipeLeft, unique } from './helpers'

const FIXTURE = fileURLToPath(new URL('./fixtures/notation-page.jpg', import.meta.url))

test('adds a page and opens it from the catalog row', async ({ page }) => {
  await signIn(page)
  const title = unique('Red Haired Boy')
  const since = new Date().toISOString()
  await addTune(page, title, 'A')

  await expect(page.getByRole('button', { name: ADD_NOTATION })).toBeVisible()
  await page.getByLabel(CHOOSE_NOTATION_FILES).setInputFiles(FIXTURE)
  await expect(page.getByRole('button', { name: openPageName(0) })).toBeVisible()
  await expectSynced(page, since)

  await openTab(page, 'Catalog')
  await page.getByRole('searchbox', { name: 'Search tunes' }).fill(title)
  const card = page.getByRole('button', { name: new RegExp(`^${escapeRegExp(title)}`) })
  await swipeLeft(page, card)
  await page.getByRole('button', { name: `${NOTATION} ${title}` }).click()

  const viewer = page.locator('ion-modal.show-modal')
  await expect(viewer.getByText(pageCount(0, 1), { exact: true })).toBeVisible()
})
