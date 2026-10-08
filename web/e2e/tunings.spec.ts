import { expect, test } from '@playwright/test'
import {
  addTune,
  expectNoOverlay,
  openTab,
  playInstrument,
  signIn,
  tunePage,
  tuneRow,
  unique,
} from './helpers'
import { capoLabel, NO_CAPO } from '../src/domain/instruments'
import { EDIT_TUNE_TITLE, SAVE_TUNE } from '../src/features/tune/tuneFormCopy'
import { EDIT_TUNE } from '../src/features/tune/tuneScreenCopy'
import { SEARCH_TUNES } from '../src/features/catalog/catalogCopy'

test('a guitar capo shows on the catalog row', async ({ page }) => {
  await signIn(page)
  await playInstrument(page, 'Guitar')
  const title = unique('Capo tune')
  await openTab(page, 'catalog')
  await addTune(page, title, 'G')

  await tunePage(page).getByRole('button', { name: EDIT_TUNE, exact: true }).click()
  const form = page.getByRole('dialog', { name: EDIT_TUNE_TITLE })
  // A closed choice is a field row, named for its field and then its value, that opens a picker.
  await form.getByRole('button', { name: `${capoLabel('guitar')} ${NO_CAPO}`, exact: true }).click()
  const capo = page.getByRole('menu', { name: capoLabel('guitar') })
  await capo.getByRole('menuitemradio', { name: '2', exact: true }).click()
  await expect(capo).toHaveCount(0)
  await form.getByRole('button', { name: SAVE_TUNE, exact: true }).click()
  await expectNoOverlay(page)
  await expect(tunePage(page).getByRole('heading', { name: title, level: 1 })).toBeVisible()

  await openTab(page, 'catalog')
  await page.getByRole('searchbox', { name: SEARCH_TUNES }).fill(title)
  await expect(tuneRow(page, title)).toHaveAccessibleName(/Capo 2/)
})
