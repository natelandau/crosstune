import { expect, test } from '@playwright/test'
import {
  EXPORT_ACTION,
  EXPORT_DATA,
  EXPORT_TITLE,
} from '../src/features/settings/export/exportCopy'
import {
  addTune,
  createThrowawayUser,
  openAccount,
  removeClerkUser,
  signInAs,
  unique,
} from './helpers'

test('exports the library as a zip download', async ({ page }) => {
  const { id, emailAddress } = await createThrowawayUser()
  try {
    await signInAs(page, emailAddress)
    await addTune(page, unique("Cooley's"), 'D')

    await openAccount(page, emailAddress)
    await page.getByRole('button', { name: EXPORT_DATA }).click()
    const download = page.waitForEvent('download')
    await page
      .getByRole('dialog', { name: EXPORT_TITLE })
      .getByRole('button', { name: EXPORT_ACTION, exact: true })
      .click()

    expect((await download).suggestedFilename()).toMatch(
      /^crosstune-export-\d{4}-\d{2}-\d{2}\.zip$/,
    )
  } finally {
    await removeClerkUser(id)
  }
})
