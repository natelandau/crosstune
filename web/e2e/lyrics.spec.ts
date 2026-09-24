import { expect, test } from '@playwright/test'
import { addTune, expectSynced, signIn, unique } from './helpers'

test('type lyrics on a tune and read them full screen at a larger size', async ({ page }) => {
  await signIn(page)
  const title = unique('Uncle Joe')
  const since = new Date().toISOString()
  await addTune(page, title, 'A')

  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  // A way into the lyrics form rather than a field on this one, so it names itself and nothing
  // about the tune.
  await page.getByRole('button', { name: 'Lyrics', exact: true }).click()
  await page
    .getByRole('textbox', { name: 'Lyrics' })
    .fill('Did you ever go to meeting\nUncle Joe\n\nDon’t mind the weather')
  // Done hands the words back to the form; the form's own Save writes the tune.
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expectSynced(page, since)

  await page.getByRole('button', { name: /^Open lyrics/ }).click()
  // The reading view's controls are slotted light DOM under ion-modal, not descendants of the
  // shadow-root element that carries the dialog role, so the host element scopes them instead.
  const reading = page.locator('ion-modal.show-modal')
  const larger = reading.getByRole('button', { name: 'Larger text' })
  await expect(larger).toBeVisible()
  await expect(reading.getByText('Don’t mind the weather')).toBeVisible()
  // The step persists in localStorage, so a prior run can leave it anywhere; compare
  // before against after rather than asserting a step number.
  const body = reading.locator('[data-lyrics-size]')
  const step = () => body.getAttribute('data-lyrics-size').then(Number)
  const before = await step()
  await larger.click()
  await expect.poll(step).toBeGreaterThan(before)
  await reading.getByRole('button', { name: 'Close' }).click()
  await expect(larger).toBeHidden()
})
