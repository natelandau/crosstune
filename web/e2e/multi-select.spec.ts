import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  addTune,
  escapeRegExp,
  expectNoOverlay,
  expectSynced,
  openRowMenu,
  openTab,
  playInstrument,
  signIn,
  tuneRow,
  swipeLeft,
  unique,
} from './helpers'
import { tabLabel } from '../src/app/tabs'
import {
  ADD_LIST,
  ADD_TUNES,
  addTuneName,
  CREATE_LIST,
  LIST_NAME_LABEL,
  NEW_LIST_TITLE,
  REMOVE,
} from '../src/features/lists/listsCopy'
import { ADD_TO_LIST, addTunesToListTitle, NONE_IN_IT } from '../src/features/lists/listPickerCopy'
import {
  addedToListToast,
  editedToast,
  editTunesTitle,
  EDIT_SELECTED,
  removedFromListToast,
  removeFromListLabel,
  SAVE_EDIT,
  SELECT,
  SELECT_ALL,
  selectedTitle,
  SET_STATUS,
  setStatusLabel,
  SELECTION_ACTIONS,
} from '../src/features/selection/selectionCopy'
import { STATUS_LABELS } from '../src/constants'
import { DONE } from '../src/ui/confirmCopy'
import { MORE_ACTIONS } from '../src/ui/menuCopy'
import { UNDO } from '../src/ui/toastCopy'
import { SEARCH_TUNES, SELECT_TUNES, TUNE_LIST } from '../src/features/catalog/catalogCopy'

const toast = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text })

/** The bar of bulk actions that takes the tab bar's place while a screen is selecting. */
const selectionBar = (page: Page) => page.getByRole('toolbar', { name: SELECTION_ACTIONS })

// The pane's title reads the count; the spoken line beside it counts in words.
const selectedCount = (page: Page, count: number) =>
  page.getByText(selectedTitle(count), { exact: true })

/** Enter selection, which lives behind the screen's own More actions menu. */
async function startSelecting(page: Page, screen: string): Promise<void> {
  await page
    .getByRole('main', { name: screen, exact: true })
    .getByRole('button', { name: MORE_ACTIONS })
    .click()
  await page
    .getByRole('menu', { name: MORE_ACTIONS })
    .getByRole('menuitem', { name: SELECT_TUNES, exact: true })
    .click()
  await expectNoOverlay(page)
}

/** Hold a row, then choose Select from the menu the hold opens, which selects that row. */
async function selectByHold(page: Page, title: string): Promise<void> {
  const menu = await openRowMenu(page, tuneRow(page, title), title)
  await menu.getByRole('menuitem', { name: SELECT, exact: true }).click()
  await expect(tuneRow(page, title)).toHaveAttribute('aria-selected', 'true')
  await expectNoOverlay(page)
}

async function createList(page: Page, listName: string): Promise<void> {
  await openTab(page, 'lists')
  // The screen's own Add list control, which leads the page, not the one the empty state offers.
  await page
    .getByRole('main', { name: tabLabel('lists'), exact: true })
    .getByRole('button', { name: ADD_LIST })
    .first()
    .click()
  const sheet = page.getByRole('dialog', { name: NEW_LIST_TITLE })
  await sheet.getByRole('textbox', { name: LIST_NAME_LABEL }).fill(listName)
  await sheet.getByRole('button', { name: CREATE_LIST, exact: true }).click()
  await expect(listLink(page, listName)).toBeVisible()
}

/** A list's row on the Lists screen, named for the list, its tune count, and when it was edited. */
const listLink = (page: Page, listName: string): Locator =>
  page
    .getByRole('grid', { name: tabLabel('lists') })
    .getByRole('row', { name: new RegExp(`^${escapeRegExp(listName)},`) })

test('select tunes in a search, set their violin tuning, and undo', async ({ page }) => {
  await signIn(page)
  await playInstrument(page, 'Violin')
  const tag = unique('Bulk tuning')
  const first = `${tag} Say Old Man`
  const second = `${tag} Lost Indian`
  await openTab(page, 'catalog')
  await addTune(page, first, 'A')
  await openTab(page, 'catalog')
  await addTune(page, second, 'A')

  await openTab(page, 'catalog')
  await page.getByRole('searchbox', { name: SEARCH_TUNES }).fill(tag)
  await startSelecting(page, tabLabel('catalog'))
  await page.getByRole('button', { name: SELECT_ALL, exact: true }).click()
  await expect(selectedCount(page, 2)).toBeVisible()

  // The dialog is named for the count it is showing, which is what catches a sheet still wearing
  // the name it was given before anything was selected.
  const sheet = page.getByRole('dialog', { name: editTunesTitle(2) })
  const edit = selectionBar(page).getByRole('button', { name: EDIT_SELECTED, exact: true })
  await edit.click()
  await expect(sheet).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)
  await expect(selectedCount(page, 2)).toBeVisible()

  await edit.click()
  await expect(sheet).toBeVisible()
  await sheet.getByRole('combobox', { name: 'Violin tuning' }).click()
  await page.getByRole('option', { name: 'Cross A (AEAE)', exact: true }).click()
  await sheet.getByRole('button', { name: SAVE_EDIT, exact: true }).click()

  await expect(toast(page, editedToast(2))).toBeVisible()
  const row = tuneRow(page, first)
  await expect(row).toHaveAccessibleName(/Cross A \(AEAE\)/)
  await page.getByRole('button', { name: UNDO, exact: true }).click()
  await expect(row).not.toHaveAccessibleName(/Cross A \(AEAE\)/)
})

test('hold a tune, set its status, and add it to a list', async ({ page }) => {
  await signIn(page)
  const title = unique('Long press Elzic’s Farewell')
  const listName = unique('Bulk set')
  await createList(page, listName)
  await openTab(page, 'catalog')
  await addTune(page, title, 'A')
  const since = new Date().toISOString()

  await openTab(page, 'catalog')
  // The pending write syncs on its own, and the pull rebuilds the list it lands in. A row
  // replaced under the finger takes the gesture with it, so the gesture waits for it.
  await expectSynced(page, since)
  await page.getByRole('searchbox', { name: SEARCH_TUNES }).fill(title)
  await selectByHold(page, title)

  await selectionBar(page).getByRole('button', { name: SET_STATUS, exact: true }).click()
  await page
    .getByRole('menu', { name: SET_STATUS })
    .getByRole('menuitem', { name: STATUS_LABELS.known, exact: true })
    .click()
  await expectNoOverlay(page)
  await expect(toast(page, setStatusLabel(1, 'known'))).toBeVisible()

  await selectByHold(page, title)
  await selectionBar(page).getByRole('button', { name: ADD_TO_LIST, exact: true }).click()
  const picker = page.getByRole('dialog', { name: addTunesToListTitle(1) })
  await expect(picker).toBeVisible()
  // Each list says how much of the selection it already holds.
  await picker.getByRole('button', { name: `${listName} ${NONE_IN_IT}`, exact: true }).click()
  await expect(toast(page, addedToListToast(1, listName))).toBeVisible()

  await openTab(page, 'lists')
  await listLink(page, listName).click()
  await expect(tuneRow(page, title)).toBeVisible()
})

test('select tunes in a list, remove them, and undo', async ({ page, context }) => {
  await signIn(page)
  const tag = unique('List remove')
  const titles = [`${tag} Old Molly Hare`, `${tag} Sail Away Ladies`, `${tag} Big Sciota`]
  const listName = unique('Remove set')
  for (const title of titles) {
    await addTune(page, title, 'D')
    await openTab(page, 'catalog')
  }
  await createList(page, listName)
  await listLink(page, listName).click()
  const list = page.getByRole('main', { name: listName, exact: true })
  await expect(list.getByRole('heading', { name: listName, level: 1 })).toBeVisible()
  // The screen's own Add tunes control, which leads the page, not the one the empty state offers.
  await list.getByRole('button', { name: ADD_TUNES }).first().click()
  const picker = page.getByRole('dialog', { name: ADD_TUNES })
  for (const title of titles) {
    await picker.getByRole('searchbox', { name: SEARCH_TUNES }).fill(title)
    await picker.getByRole('row', { name: addTuneName(title) }).click()
  }
  const since = new Date().toISOString()
  await picker.getByRole('button', { name: DONE, exact: true }).click()
  const rows = list.getByRole('grid', { name: TUNE_LIST }).getByRole('row')
  await expect(rows).toHaveCount(3)

  // Removing the first tune leaves a gap in the stored positions, which undo must handle.
  // The pending write syncs on its own, and the pull rebuilds the list it lands in. A row
  // replaced under the finger takes the gesture with it, so the gesture waits for it.
  await expectSynced(page, since)
  const removed = tuneRow(page, titles[0]!)
  await swipeLeft(page, removed)
  await removed.getByRole('button', { name: REMOVE, exact: true }).click()
  await expect(rows).toHaveCount(2)

  await startSelecting(page, listName)
  await page.getByRole('button', { name: SELECT_ALL, exact: true }).click()
  await expect(selectedCount(page, 2)).toBeVisible()
  await selectionBar(page).getByRole('button', { name: MORE_ACTIONS }).click()
  await page
    .getByRole('menu', { name: MORE_ACTIONS })
    .getByRole('menuitem', { name: removeFromListLabel(2), exact: true })
    .click()
  await expect(toast(page, removedFromListToast(2, listName))).toBeVisible()
  await expect(rows).toHaveCount(0)

  // Offline, so the list shows what undo wrote locally rather than what a sync brings back.
  await context.setOffline(true)
  await page.getByRole('button', { name: UNDO, exact: true }).click()
  await expect(rows).toHaveCount(2)
  const reconnected = new Date().toISOString()
  await context.setOffline(false)
  await expectSynced(page, reconnected)
  await page.reload()
  await expect(rows).toHaveCount(2)
})
