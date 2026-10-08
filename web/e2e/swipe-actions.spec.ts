import { expect, test, type Page } from '@playwright/test'
import {
  addTune,
  escapeRegExp,
  expectNoOverlay,
  expectSynced,
  openTab,
  signIn,
  swipeLeft,
  swipeState,
  tuneRow,
  unique,
} from './helpers'
import { tabLabel } from '../src/app/tabs'
import {
  ADD_LIST,
  CREATE_LIST,
  LIST_NAME_LABEL,
  NEW_LIST_TITLE,
} from '../src/features/lists/listsCopy'
import { ARCHIVE } from '../src/features/tune/archiveLabels'
import { EDIT_TUNE_TITLE } from '../src/features/tune/tuneFormCopy'
import { EDIT_TUNE } from '../src/features/tune/tuneScreenCopy'
import { CANCEL, DELETE } from '../src/ui/confirmCopy'
import { SEARCH_TUNES } from '../src/features/catalog/catalogCopy'

/** A list's row on the Lists screen, named for the list, its tune count, and when it was edited. */
const listRow = (page: Page, name: string) =>
  page
    .getByRole('grid', { name: tabLabel('lists') })
    .getByRole('row', { name: new RegExp(`^${escapeRegExp(name)},`) })

test('swipe a tune row to edit and archive, and a list row to delete', async ({ page }) => {
  await signIn(page)
  const title = unique('Angeline the Baker')
  await addTune(page, title, 'D')
  const since = new Date().toISOString()

  await openTab(page, 'catalog')
  // Narrowing to the one tune keeps it in view whatever else the catalog holds.
  await page.getByRole('searchbox', { name: SEARCH_TUNES }).fill(title)
  const row = tuneRow(page, title)
  // The pending write syncs on its own, and the pull rebuilds the list it lands in. A row
  // replaced under the finger takes the gesture with it, so the gesture waits for it.
  await expectSynced(page, since)
  await swipeLeft(page, row)
  await row.getByRole('button', { name: EDIT_TUNE, exact: true }).click()
  const form = page.getByRole('dialog', { name: EDIT_TUNE_TITLE })
  await expect(form).toBeVisible()
  await form.getByRole('button', { name: CANCEL, exact: true }).click()
  await expect(page).toHaveURL('/catalog')

  await swipeLeft(page, row)
  await row.getByRole('button', { name: ARCHIVE, exact: true }).click()
  await expect(row).toHaveCount(0)

  const listName = unique('Swipe set')
  await openTab(page, 'lists')
  // The screen's own Add list control, which leads the page, not the one the empty state offers.
  await page
    .getByRole('main', { name: tabLabel('lists'), exact: true })
    .getByRole('button', { name: ADD_LIST })
    .first()
    .click()
  const create = page.getByRole('dialog', { name: NEW_LIST_TITLE })
  await create.getByRole('textbox', { name: LIST_NAME_LABEL }).fill(listName)
  await create.getByRole('button', { name: CREATE_LIST, exact: true }).click()
  const list = listRow(page, listName)
  await swipeLeft(page, list)
  await list.getByRole('button', { name: DELETE, exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: DELETE, exact: true }).click()
  await expectNoOverlay(page)
  await expect(list).toHaveCount(0)
})

test('opening a second swipe row closes the first', async ({ page }) => {
  await signIn(page)
  const tag = unique('Swipe pair')
  const first = `${tag} Bonaparte Crossing the Rhine`
  const second = `${tag} Blackberry Blossom`
  await addTune(page, first, 'A')
  await openTab(page, 'catalog')
  await addTune(page, second, 'G')
  const since = new Date().toISOString()

  await openTab(page, 'catalog')
  // Narrowing to the pair keeps both rows in view, since a scroll would close the open row on its own.
  await page.getByRole('searchbox', { name: SEARCH_TUNES }).fill(tag)

  // The pending write syncs on its own, and the pull rebuilds the list it lands in. A row
  // replaced under the finger takes the gesture with it, so the gesture waits for it.
  await expectSynced(page, since)
  await swipeLeft(page, tuneRow(page, first))
  await swipeLeft(page, tuneRow(page, second))
  await expect(swipeState(tuneRow(page, first))).toHaveAttribute('data-swipe', 'closed')
})
