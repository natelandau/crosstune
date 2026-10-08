import { expect, test, type Page } from '@playwright/test'
import {
  addTune,
  dragRow,
  escapeRegExp,
  expectSynced,
  openRowMenu,
  openTab,
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
import { MOVE_TO_TOP } from '../src/features/lists/moveMenu'
import { DONE } from '../src/ui/confirmCopy'
import { SEARCH_TUNES, TUNE_LIST } from '../src/features/catalog/catalogCopy'

async function tuneOrder(page: Page, tag: string): Promise<string[]> {
  const rows = await page.getByRole('grid', { name: TUNE_LIST }).getByRole('row').allTextContents()
  // A row's text runs its actions and position into the title, so match the known names.
  return rows.flatMap((text) => {
    const match = text.match(new RegExp(`${escapeRegExp(tag)} (Arkansas|Billy|Cripple)`))
    return match ? [match[1]!] : []
  })
}

test('reorder a list by dragging a row and from its menu, and swipe a tune out', async ({
  page,
}) => {
  await signIn(page)
  const tag = unique('Set')
  for (const [name, key] of [
    ['Arkansas', 'D'],
    ['Billy', 'G'],
    ['Cripple', 'A'],
  ] as const) {
    await openTab(page, 'catalog')
    await addTune(page, `${tag} ${name}`, key)
  }

  await openTab(page, 'lists')
  // The screen's own Add list control, which leads the page, not the one the empty state offers.
  await page
    .getByRole('main', { name: tabLabel('lists'), exact: true })
    .getByRole('button', { name: ADD_LIST })
    .first()
    .click()
  const create = page.getByRole('dialog', { name: NEW_LIST_TITLE })
  await create.getByRole('textbox', { name: LIST_NAME_LABEL }).fill(tag)
  await create.getByRole('button', { name: CREATE_LIST, exact: true }).click()
  const listRow = page
    .getByRole('grid', { name: tabLabel('lists') })
    .getByRole('row', { name: new RegExp(`^${escapeRegExp(tag)},`) })
  await expect(listRow).toBeVisible()
  await listRow.click()
  // The screen's own Add tunes control, which leads the page, not the one the empty state offers.
  await page
    .getByRole('main', { name: tag, exact: true })
    .getByRole('button', { name: ADD_TUNES })
    .first()
    .click()
  const picker = page.getByRole('dialog', { name: ADD_TUNES })
  for (const name of ['Arkansas', 'Billy', 'Cripple']) {
    await picker.getByRole('searchbox', { name: SEARCH_TUNES }).fill(`${tag} ${name}`)
    await picker.getByRole('row', { name: addTuneName(`${tag} ${name}`) }).click()
  }
  const since = new Date().toISOString()
  await picker.getByRole('button', { name: DONE, exact: true }).click()
  await expect.poll(() => tuneOrder(page, tag)).toEqual(['Arkansas', 'Billy', 'Cripple'])
  // The pending write syncs on its own, and the pull rebuilds the list it lands in. A row
  // replaced under the finger takes the gesture with it, so the gesture waits for it.
  await expectSynced(page, since)

  // Hold Arkansas, then drag it below Cripple.
  await dragRow(page, tuneRow(page, `${tag} Arkansas`), tuneRow(page, `${tag} Cripple`))
  await expect.poll(() => tuneOrder(page, tag)).toEqual(['Billy', 'Cripple', 'Arkansas'])
  // A hold that became a drag must not open the row's menu as well.
  await expect(page.getByRole('menu')).toHaveCount(0)

  // Hold Cripple without moving, and move it to the top from the menu that opens.
  const menu = await openRowMenu(page, tuneRow(page, `${tag} Cripple`), `${tag} Cripple`)
  await menu.getByRole('menuitem', { name: MOVE_TO_TOP, exact: true }).click()
  await expect.poll(() => tuneOrder(page, tag)).toEqual(['Cripple', 'Billy', 'Arkansas'])

  // Remove Billy from the list with a swipe; the tune itself stays in the catalog.
  const billy = tuneRow(page, `${tag} Billy`)
  await swipeLeft(page, billy)
  await billy.getByRole('button', { name: REMOVE, exact: true }).click()
  await expect.poll(() => tuneOrder(page, tag)).toEqual(['Cripple', 'Arkansas'])
  await page.reload()
  await expect.poll(() => tuneOrder(page, tag)).toEqual(['Cripple', 'Arkansas'])
})
