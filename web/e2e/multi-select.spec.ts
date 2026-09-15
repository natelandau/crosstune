import { expect, test, type Page } from '@playwright/test'
import { addSong, expectSynced, longPress, signIn, swipeLeft, unique } from './helpers'

const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Selected songs' })
const toast = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text })
// The toast sits above the Dock for several seconds, so it is dismissed before the test reaches
// for anything it could cover.
const dismissToast = (page: Page) =>
  page.getByRole('button', { name: 'Dismiss', exact: true }).click()

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// A song's full title also matches the catalog's "Add another <title>" search suggestion,
// so anchor to the start of the accessible name to keep the row locator unique.
const rowLink = (page: Page, title: string) =>
  page.getByRole('link', { name: new RegExp(`^${escapeRegExp(title)}`) })

test('select songs in a search, set their violin tuning, and undo', async ({ page }) => {
  await signIn(page)
  const tag = unique('Bulk tuning')
  const first = `${tag} Say Old Man`
  const second = `${tag} Lost Indian`
  await addSong(page, first, 'A')
  await page.getByRole('link', { name: 'Crosstune' }).click()
  await addSong(page, second, 'A')

  await page.getByRole('link', { name: 'Crosstune' }).click()
  await page.getByRole('searchbox', { name: 'Search songs' }).fill(tag)
  await page.getByRole('button', { name: 'Select', exact: true }).click()
  await page.getByRole('button', { name: 'Select all' }).click()
  await expect(page.getByText('2 selected')).toBeVisible()

  const sheet = page.getByRole('dialog', { name: 'Edit 2 songs' })
  await toolbar(page).getByRole('button', { name: 'Edit', exact: true }).click()
  await expect(sheet).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
  await expect(page.getByText('2 selected')).toBeVisible()

  await toolbar(page).getByRole('button', { name: 'Edit', exact: true }).click()
  await sheet.getByRole('combobox', { name: 'Violin tuning' }).fill('Cross A (AEAE)')
  await sheet.getByRole('button', { name: 'Apply to 2' }).click()

  await expect(toast(page, 'Edited 2 songs')).toBeVisible()
  const row = rowLink(page, first)
  await expect(row).toContainText('Cross A (AEAE)')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(row).not.toContainText('Cross A (AEAE)')
})

test('long-press a song, set its status, and add it to a list', async ({ page }) => {
  await signIn(page)
  const title = unique('Long press Elzic’s Farewell')
  const listName = unique('Bulk set')
  await page.getByRole('link', { name: 'Lists' }).click()
  await page.getByRole('textbox', { name: 'New list name' }).fill(listName)
  await page.getByRole('button', { name: 'Create list' }).click()
  await page.getByRole('link', { name: 'Catalog' }).click()
  await addSong(page, title, 'A')

  await page.getByRole('link', { name: 'Crosstune' }).click()
  await page.getByRole('searchbox', { name: 'Search songs' }).fill(title)
  const hold = await longPress(page, rowLink(page, title))
  await expect(page.getByRole('checkbox', { name: title })).toBeChecked()
  await hold.release()

  await toolbar(page).getByRole('button', { name: 'Status', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'Set status for 1 song' })
    .getByRole('button', { name: /^Known/ })
    .click()
  await expect(toast(page, 'Set 1 song to Known')).toBeVisible()
  await dismissToast(page)

  const hold2 = await longPress(page, rowLink(page, title))
  await expect(page.getByRole('checkbox', { name: title })).toBeChecked()
  await hold2.release()
  await toolbar(page).getByRole('button', { name: 'Add to list', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'Add 1 song to a list' })
    .getByRole('button', { name: new RegExp(listName) })
    .click()
  await expect(toast(page, `Added 1 song to ${listName}`)).toBeVisible()
  await dismissToast(page)

  await page.getByRole('link', { name: 'Lists' }).click()
  await page.getByRole('link', { name: new RegExp(listName) }).click()
  await expect(page.getByRole('listitem').filter({ hasText: title })).toBeVisible()
})

test('select songs in a list, remove them, and undo', async ({ page, context }) => {
  await signIn(page)
  const tag = unique('List remove')
  const titles = [`${tag} Old Molly Hare`, `${tag} Sail Away Ladies`, `${tag} Big Sciota`]
  const listName = unique('Remove set')
  for (const title of titles) {
    await addSong(page, title, 'D')
    await page.getByRole('link', { name: 'Crosstune' }).click()
  }
  await page.getByRole('link', { name: 'Lists' }).click()
  await page.getByRole('textbox', { name: 'New list name' }).fill(listName)
  await page.getByRole('button', { name: 'Create list' }).click()
  await page.getByRole('link', { name: new RegExp(listName) }).click()
  for (const title of titles) {
    await page.getByRole('searchbox', { name: 'Add a song' }).fill(title)
    await page.getByRole('button', { name: `Add ${title}` }).click()
  }
  await expect(page.getByRole('listitem')).toHaveCount(3)

  // Removing the first song leaves a gap in the stored positions, which undo must handle.
  await swipeLeft(page, page.getByRole('link', { name: new RegExp(escapeRegExp(titles[0]!)) }))
  await page.getByRole('button', { name: `Remove ${titles[0]}` }).click()
  await expect(page.getByRole('listitem')).toHaveCount(2)

  await page.getByRole('button', { name: 'Select', exact: true }).click()
  await page.getByRole('button', { name: 'Select all' }).click()
  await toolbar(page).getByRole('button', { name: 'More', exact: true }).click()
  await page.getByRole('button', { name: 'Remove 2 from list' }).click()
  await expect(toast(page, `Removed 2 songs from ${listName}`)).toBeVisible()
  await expect(page.getByRole('listitem')).toHaveCount(0)

  // Offline, so the list shows what undo wrote locally rather than what a sync brings back.
  await context.setOffline(true)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(page.getByRole('listitem')).toHaveCount(2)
  const reconnected = new Date().toISOString()
  await context.setOffline(false)
  await expectSynced(page, reconnected)
  await page.reload()
  await expect(page.getByRole('listitem')).toHaveCount(2)
})
