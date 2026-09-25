import { expect, test, type Page } from '@playwright/test'
import {
  addTune,
  escapeRegExp,
  expectNoOverlay,
  expectSynced,
  openTab,
  signIn,
  swipeLeft,
  unique,
} from './helpers'

/**
 * A row, whose name is its title followed by the lines under it. Anchored: an open row's own
 * actions are named for the same title, and so is the offer to add another tune by that name.
 */
const row = (page: Page, name: string) =>
  page.getByRole('button', { name: new RegExp(`^${escapeRegExp(name)}`) })

test('swipe a tune row to edit and archive, and a list row to delete', async ({ page }) => {
  await signIn(page)
  const title = unique('Angeline the Baker')
  await addTune(page, title, 'D')
  const since = new Date().toISOString()

  await openTab(page, 'Catalog')
  // Narrowing to the one tune keeps it in view whatever else the catalog holds.
  await page.getByRole('searchbox', { name: 'Search tunes' }).fill(title)
  const card = row(page, title)
  // The pending write syncs on its own, and the pull rebuilds the list it lands in. A row
  // replaced under the pointer takes the gesture with it, so the gesture waits for it.
  await expectSynced(page, since)
  await swipeLeft(page, card)
  await page.getByRole('button', { name: `Edit ${title}` }).click()
  await expect(page.getByRole('dialog', { name: 'Edit tune' })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page).toHaveURL('/catalog')

  await swipeLeft(page, card)
  await page.getByRole('button', { name: `Archive ${title}` }).click()
  await expect(card).toBeHidden()

  const listName = unique('Swipe set')
  await openTab(page, 'Lists')
  // The screen's own Add list control, not the one the empty state offers.
  await page.getByRole('banner').getByRole('button', { name: 'Add list' }).click()
  await page.getByRole('textbox', { name: 'List name' }).fill(listName)
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  const listRow = row(page, listName)
  await swipeLeft(page, listRow)
  await page.getByRole('button', { name: `Delete ${listName}` }).click()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await expectNoOverlay(page)
  await expect(listRow).toBeHidden()
})

test('opening a second swipe row closes the first', async ({ page }) => {
  await signIn(page)
  const tag = unique('Swipe pair')
  const first = `${tag} Bonaparte Crossing the Rhine`
  const second = `${tag} Blackberry Blossom`
  await addTune(page, first, 'A')
  await openTab(page, 'Catalog')
  await addTune(page, second, 'G')
  const since = new Date().toISOString()

  await openTab(page, 'Catalog')
  // Narrowing to the pair keeps both rows in view, since a scroll would close the open row on its own.
  await page.getByRole('searchbox', { name: 'Search tunes' }).fill(tag)
  // A row's actions are on screen only while that row is open, so an action's own visibility is
  // what says whether its row is open.
  const editAction = (title: string) =>
    page.getByRole('button', { name: `Edit ${title}`, includeHidden: true })

  // The pending write syncs on its own, and the pull rebuilds the list it lands in. A row
  // replaced under the pointer takes the gesture with it, so the gesture waits for it.
  await expectSynced(page, since)
  await swipeLeft(page, row(page, first))
  await expect(editAction(first)).toBeVisible()

  await swipeLeft(page, row(page, second))
  await expect(editAction(second)).toBeVisible()
  // The closed row keeps its actions in the DOM, so the count is what tells a row that closed
  // from a locator that has gone dead.
  await expect(editAction(first)).toHaveCount(1)
  await expect(editAction(first)).toBeHidden()
})
