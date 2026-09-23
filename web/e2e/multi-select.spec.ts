import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  addSong,
  escapeRegExp,
  expectNoOverlay,
  expectSynced,
  longPress,
  openTab,
  playInstrument,
  signIn,
  swipeLeft,
  unique,
} from './helpers'

const toast = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text })

/** A catalog row. Its name is the title followed by the song's key, status, and tunings. */
const songRow = (page: Page, title: string) =>
  page.getByRole('button', { name: new RegExp(`^${escapeRegExp(title)}`) })

/**
 * The whole catalog row, for reading what it shows. The control that opens a row is a native
 * button inside the item's shadow root and holds no text of its own; the lines it is named
 * after are slotted beside it.
 */
const songRowText = (page: Page, title: string) =>
  page.getByRole('listitem').filter({ hasText: title })

/** A catalog row while selecting: the row opens as a checkbox named for what a tap would do. */
const songCheckbox = (page: Page, title: string) =>
  page.getByRole('checkbox', { name: new RegExp(`^(Select|Deselect) ${escapeRegExp(title)}`) })

/** A row in a list, whose name leads with its position. */
const listRow = (page: Page, title: string) =>
  page.getByRole('button', { name: new RegExp(`^\\d+ ${escapeRegExp(title)}`) })

// The count is on screen twice: the toolbar's title and the live region that announces it.
const selectedCount = (page: Page, text: string) => page.getByText(text, { exact: true }).first()

/** Enter selection, which lives behind the screen's own More actions menu. */
async function startSelecting(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'More actions' }).click()
  await page.getByRole('button', { name: 'Select', exact: true }).click()
  await expectNoOverlay(page)
}

/** Take every row on screen, from the same menu the selection toolbar keeps its overflow in. */
async function selectAll(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'More actions' }).click()
  await page.getByRole('button', { name: 'Select all', exact: true }).click()
  await expectNoOverlay(page)
}

/**
 * Raise a sheet to full height. A sheet opens at part of the screen and does not scroll there,
 * so a row past the fold, such as a list near the end of a long picker, is out of reach until it
 * is full.
 */
const expandSheet = (page: Page) =>
  page.getByRole('button', { name: /adjust the size of the dialog/ }).click()

async function createList(page: Page, listName: string): Promise<void> {
  await openTab(page, 'Lists')
  // The screen's own Add list control, not the one the empty state offers.
  await page.getByRole('banner').getByRole('button', { name: 'Add list' }).click()
  await page.getByRole('textbox', { name: 'List name' }).fill(listName)
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(listLink(page, listName)).toBeVisible()
}

/** A list's row on the Lists screen, whose name carries its song count and when it was edited. */
const listLink = (page: Page, listName: string): Locator =>
  page.getByRole('button', { name: new RegExp(`^${escapeRegExp(listName)} `) })

test('select songs in a search, set their violin tuning, and undo', async ({ page }) => {
  await signIn(page)
  await playInstrument(page, 'Violin')
  const tag = unique('Bulk tuning')
  const first = `${tag} Say Old Man`
  const second = `${tag} Lost Indian`
  await openTab(page, 'Catalog')
  await addSong(page, first, 'A')
  await openTab(page, 'Catalog')
  await addSong(page, second, 'A')

  await openTab(page, 'Catalog')
  await page.getByRole('searchbox', { name: 'Search songs' }).fill(tag)
  await startSelecting(page)
  await selectAll(page)
  await expect(selectedCount(page, '2 selected')).toBeVisible()

  // The dialog is named for the count it is showing, which is what catches a sheet still wearing
  // the name it was given before anything was selected. Nothing inside it is ever scoped to it:
  // an ion-modal puts the role on a wrapper in its shadow root and slots the sheet's own content
  // beside it, so a scoped locator matches nothing while the dialog itself resolves.
  const sheet = page.getByRole('dialog', { name: 'Edit 2 songs' })
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await expect(sheet).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
  await expect(selectedCount(page, '2 selected')).toBeVisible()

  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await expect(sheet).toBeVisible()
  await page
    .getByRole('listitem')
    .filter({ has: page.getByRole('button', { name: /^Violin tuning,/ }) })
    .click()
  await page.getByRole('radio', { name: 'Cross A (AEAE)', exact: true }).click()
  await expectNoOverlay(page)
  await page.getByRole('button', { name: 'Save', exact: true }).click()

  await expect(toast(page, 'Edited 2 songs')).toBeVisible()
  const row = songRowText(page, first)
  await expect(row).toContainText('Cross A (AEAE)')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(row).not.toContainText('Cross A (AEAE)')
})

test('long-press a song, set its status, and add it to a list', async ({ page }) => {
  await signIn(page)
  const title = unique('Long press Elzic’s Farewell')
  const listName = unique('Bulk set')
  await createList(page, listName)
  await openTab(page, 'Catalog')
  await addSong(page, title, 'A')
  const since = new Date().toISOString()

  await openTab(page, 'Catalog')
  // The pending write syncs on its own, and the pull rebuilds the list it lands in. A row
  // replaced under the pointer takes the gesture with it, so the gesture waits for it.
  await expectSynced(page, since)
  await page.getByRole('searchbox', { name: 'Search songs' }).fill(title)
  const hold = await longPress(page, songRow(page, title))
  await expect(songCheckbox(page, title)).toBeChecked()
  await hold.release()

  await page.getByRole('button', { name: 'Status', exact: true }).click()
  // The status filter above the list offers a capsule with this same word, so the pick is
  // scoped to the menu that just opened.
  const statusMenu = page.locator('ion-action-sheet, ion-popover').last()
  await expect(statusMenu).toBeVisible()
  await statusMenu.getByText('Known', { exact: true }).click()
  await expectNoOverlay(page)
  await expect(toast(page, 'Set 1 song to Known')).toBeVisible()

  const hold2 = await longPress(page, songRow(page, title))
  await expect(songCheckbox(page, title)).toBeChecked()
  await hold2.release()
  await page.getByRole('button', { name: 'Add to list', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Add 1 song to a list' })).toBeVisible()
  await expandSheet(page)
  // Each list says how much of the selection it already holds.
  await page.getByRole('button', { name: `${listName} none in it`, exact: true }).click()
  await expect(toast(page, `Added 1 song to ${listName}`)).toBeVisible()

  await openTab(page, 'Lists')
  await listLink(page, listName).click()
  await expect(page.getByRole('listitem').filter({ hasText: title })).toBeVisible()
})

test('select songs in a list, remove them, and undo', async ({ page, context }) => {
  await signIn(page)
  const tag = unique('List remove')
  const titles = [`${tag} Old Molly Hare`, `${tag} Sail Away Ladies`, `${tag} Big Sciota`]
  const listName = unique('Remove set')
  for (const title of titles) {
    await addSong(page, title, 'D')
    await openTab(page, 'Catalog')
  }
  await createList(page, listName)
  await listLink(page, listName).click()
  await expect(page.getByRole('heading', { name: listName, level: 1 })).toBeVisible()
  // The screen's own Add songs control, not the one the empty state offers.
  await page.getByRole('banner').getByRole('button', { name: 'Add songs' }).click()
  for (const title of titles) {
    await page.getByRole('searchbox', { name: 'Search songs' }).fill(title)
    await page.getByRole('button', { name: `Add ${title}` }).click()
  }
  const since = new Date().toISOString()
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(page.getByRole('listitem')).toHaveCount(3)

  // Removing the first song leaves a gap in the stored positions, which undo must handle.
  // The pending write syncs on its own, and the pull rebuilds the list it lands in. A row
  // replaced under the pointer takes the gesture with it, so the gesture waits for it.
  await expectSynced(page, since)
  await swipeLeft(page, listRow(page, titles[0]!))
  await page.getByRole('button', { name: `Remove ${titles[0]}` }).click()
  await expect(page.getByRole('listitem')).toHaveCount(2)

  await startSelecting(page)
  await selectAll(page)
  await expect(selectedCount(page, '2 selected')).toBeVisible()
  await page.getByRole('button', { name: 'More actions' }).click()
  await page.getByRole('button', { name: 'Remove 2 from list', exact: true }).click()
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
