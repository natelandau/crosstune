import { expect, test } from '@playwright/test'
import { addTune, expectSynced, signIn, tunePage, unique } from './helpers'
import { LARGER_TEXT, lyricsTitle } from '../src/features/lyrics/lyricsCopy'
import { EDIT_TUNE_TITLE, SAVE_TUNE } from '../src/features/tune/tuneFormCopy'
import { EDIT_TUNE, LYRICS_SECTION, OPEN_LYRICS } from '../src/features/tune/tuneScreenCopy'
import { CLOSE } from '../src/ui/confirmCopy'

test('type lyrics on a tune and read them full screen at a larger size', async ({ page }) => {
  await signIn(page)
  const title = unique('Uncle Joe')
  const since = new Date().toISOString()
  await addTune(page, title, 'A')

  await tunePage(page).getByRole('button', { name: EDIT_TUNE, exact: true }).click()
  const form = page.getByRole('dialog', { name: EDIT_TUNE_TITLE })
  await form
    .getByRole('textbox', { name: LYRICS_SECTION })
    .fill('Did you ever go to meeting\nUncle Joe\n\nDon’t mind the weather')
  await form.getByRole('button', { name: SAVE_TUNE, exact: true }).click()
  await expectSynced(page, since)

  await tunePage(page)
    .getByRole('button', { name: new RegExp(`^${OPEN_LYRICS}`) })
    .click()
  const reading = page.getByRole('dialog', { name: lyricsTitle(title) })
  const larger = reading.getByRole('button', { name: LARGER_TEXT })
  await expect(larger).toBeVisible()
  await expect(reading.getByText('Don’t mind the weather')).toBeVisible()
  // The step persists in localStorage, so a prior run can leave it anywhere; compare
  // before against after rather than asserting a step number.
  const body = reading.locator('[data-lyrics-size]')
  const step = () => body.getAttribute('data-lyrics-size').then(Number)
  const before = await step()
  await larger.click()
  await expect.poll(step).toBeGreaterThan(before)
  await reading.getByRole('button', { name: CLOSE }).click()
  await expect(reading).toHaveCount(0)
})
