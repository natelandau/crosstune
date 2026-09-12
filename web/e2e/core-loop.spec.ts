import { expect, test } from '@playwright/test'
import { addSong, expectSynced, signIn, unique } from './helpers'

test('add a tune, link a recording, find it by key, and play it', async ({ page }) => {
  await signIn(page)
  const title = unique("Soldier's Joy")
  const since = new Date().toISOString()
  await addSong(page, title, 'D')

  await page
    .getByRole('textbox', { name: 'Link' })
    .fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
  await page.getByRole('button', { name: 'Add link' }).click()
  await expect(page.getByRole('button', { name: /^Play / })).toBeVisible()
  await expectSynced(page, since)

  await page.getByRole('link', { name: 'Crosstune' }).click()
  await page.getByRole('combobox', { name: 'Key' }).selectOption('D')
  const card = page.getByRole('link', { name: new RegExp(title) })
  await expect(card).toBeVisible()
  await card.click()
  await expect(page.locator('iframe[src*="dQw4w9WgXcQ"]')).toBeVisible()
})
