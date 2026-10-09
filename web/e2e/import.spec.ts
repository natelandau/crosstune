import { expect, test } from '@playwright/test'
import {
  createThrowawayUser,
  expectSynced,
  openTab,
  removeClerkUser,
  signInAs,
  tuneRow,
  unique,
} from './helpers'
import { TUNE_LIST } from '../src/features/catalog/catalogCopy'
import {
  CONTINUE,
  IMPORT_HELP_URL,
  IMPORT_TUNES,
  PASTE_LABEL,
  WHAT_CAN_I_PASTE,
  addTunesLabel,
} from '../src/features/import/importCopy'

test('imports pasted tunes from an empty catalog', async ({ page }) => {
  // A new user, because the offer only shows while the catalog has no tunes.
  const { id, emailAddress } = await createThrowawayUser()
  try {
    await signInAs(page, emailAddress)
    await openTab(page, 'catalog')
    const since = new Date().toISOString()

    await page.getByRole('button', { name: IMPORT_TUNES }).click()
    const sheet = page.getByRole('dialog', { name: IMPORT_TUNES })
    await expect(sheet.getByRole('link', { name: WHAT_CAN_I_PASTE })).toHaveAttribute(
      'href',
      IMPORT_HELP_URL,
    )

    const reel = unique('Imported Reel')
    const first = unique('Imported Spear')
    const second = unique('Imported Apron')
    await sheet.getByRole('textbox', { name: PASTE_LABEL }).fill(`${reel}\n${first} / ${second}`)
    await sheet.getByRole('button', { name: CONTINUE, exact: true }).click()
    await sheet.getByRole('button', { name: addTunesLabel(3), exact: true }).click()

    const list = page.getByRole('grid', { name: TUNE_LIST })
    await expect(list.getByRole('row')).toHaveCount(3)
    for (const title of [reel, first, second]) await expect(tuneRow(page, title)).toBeVisible()
    await expectSynced(page, since)
  } finally {
    await removeClerkUser(id)
  }
})
