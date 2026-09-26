import { expect, test } from '@playwright/test'
import { ACCOUNT_DELETED } from '../src/auth/AuthGate'
import {
  CONFIRM_LABEL,
  DELETE_ACCOUNT,
  DELETE_ACCOUNT_TITLE,
  DELETE_CONFIRMATION_TEXT,
} from '../src/features/settings/deleteAccountCopy'
import { addTune, createThrowawayUser, openTab, removeClerkUser, signInAs, unique } from './helpers'

test('deletes the account and lands on sign-in with the notice', async ({ page }) => {
  const { id, emailAddress } = await createThrowawayUser()
  try {
    await signInAs(page, emailAddress)

    await addTune(page, unique("Cooley's"), 'D')

    await openTab(page, 'Settings')
    await page.getByRole('button', { name: DELETE_ACCOUNT }).click()
    await expect(page.getByRole('heading', { name: DELETE_ACCOUNT_TITLE })).toBeVisible()

    // The sheet's own content is slotted light DOM beside ion-modal's shadow root, not a
    // descendant of the dialog role, and other counts elsewhere on the page share this text.
    const modal = page.locator('ion-modal.show-modal')
    await expect(modal.getByRole('listitem').filter({ hasText: '1 tune' })).toBeVisible()

    await page
      .getByRole('textbox', { name: CONFIRM_LABEL, exact: true })
      .fill(DELETE_CONFIRMATION_TEXT)
    await page.getByRole('button', { name: DELETE_ACCOUNT }).click()

    await expect(page.getByText(ACCOUNT_DELETED)).toBeVisible({ timeout: 30_000 })
  } finally {
    await removeClerkUser(id)
  }
})
