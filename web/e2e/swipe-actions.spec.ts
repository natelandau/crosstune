import { expect, test } from '@playwright/test'
import { addSong, signIn, swipeLeft, unique } from './helpers'

test('swipe a song row to edit and archive, and a list row to delete', async ({ page }) => {
  await signIn(page)
  const title = unique('Angeline the Baker')
  await addSong(page, title, 'D')

  await page.getByRole('link', { name: 'Crosstune' }).click()
  const card = page.getByRole('link', { name: new RegExp(title) })
  await swipeLeft(page, card)
  await page.getByRole('button', { name: `Edit ${title}` }).click()
  await expect(page.getByRole('heading', { name: 'Edit song' })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page).toHaveURL('/')

  await swipeLeft(page, card)
  await page.getByRole('button', { name: `Archive ${title}` }).click()
  await expect(card).toBeHidden()

  const listName = unique('Swipe set')
  await page.getByRole('link', { name: 'Lists' }).click()
  await page.getByRole('textbox', { name: 'New list name' }).fill(listName)
  await page.getByRole('button', { name: 'Create list' }).click()
  const row = page.getByRole('link', { name: new RegExp(listName) })
  await swipeLeft(page, row)
  page.once('dialog', (dialog) => void dialog.accept())
  await page.getByRole('button', { name: `Delete ${listName}` }).click()
  await expect(row).toBeHidden()
})

test('opening a second swipe row closes the first', async ({ page }) => {
  await signIn(page)
  const tag = unique('Swipe pair')
  const first = `${tag} Bonaparte Crossing the Rhine`
  const second = `${tag} Blackberry Blossom`
  await addSong(page, first, 'A')
  await page.getByRole('link', { name: 'Crosstune' }).click()
  await addSong(page, second, 'G')

  await page.getByRole('link', { name: 'Crosstune' }).click()
  // Narrowing to the pair keeps both rows in view, since a scroll would close the open row on its own.
  await page.getByRole('searchbox', { name: 'Search songs' }).fill(tag)
  const actionLayer = (title: string) =>
    page.getByRole('button', { name: `Edit ${title}`, includeHidden: true }).locator('xpath=..')

  await swipeLeft(page, page.getByRole('link', { name: new RegExp(first) }))
  await expect(actionLayer(first)).not.toHaveAttribute('inert')

  await swipeLeft(page, page.getByRole('link', { name: new RegExp(second) }))
  await expect(actionLayer(second)).not.toHaveAttribute('inert')
  await expect(actionLayer(first)).toHaveAttribute('inert')
})
