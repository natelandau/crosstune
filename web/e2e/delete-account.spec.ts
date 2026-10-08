import { expect, test } from '@playwright/test'
import { ACCOUNT_DELETED } from '../src/auth/session'
import {
  CONFIRM_LABEL,
  DELETE_ACCOUNT,
  DELETE_ACCOUNT_TITLE,
  DELETE_CONFIRMATION_TEXT,
} from '../src/features/settings/deleteAccountCopy'
import {
  addTune,
  createThrowawayUser,
  openAccount,
  removeClerkUser,
  signInAs,
  unique,
} from './helpers'

test('deletes the account and lands on sign-in with the notice', async ({ page }) => {
  const { id, emailAddress } = await createThrowawayUser()
  try {
    await signInAs(page, emailAddress)

    await addTune(page, unique("Cooley's"), 'D')

    await openAccount(page, emailAddress)
    await page.getByRole('button', { name: DELETE_ACCOUNT }).click()
    const sheet = page.getByRole('dialog', { name: DELETE_ACCOUNT })
    await expect(sheet.getByRole('heading', { name: DELETE_ACCOUNT_TITLE })).toBeVisible()
    await expect(sheet.getByRole('listitem').filter({ hasText: /^1 tune$/ })).toBeVisible()

    await sheet
      .getByRole('textbox', { name: CONFIRM_LABEL, exact: true })
      .fill(DELETE_CONFIRMATION_TEXT)
    await sheet.getByRole('button', { name: DELETE_ACCOUNT }).click()

    await expect(page.getByText(ACCOUNT_DELETED)).toBeVisible({ timeout: 30_000 })
  } finally {
    await removeClerkUser(id)
  }
})
