import { page, userEvent } from 'vitest/browser'
import { expect, it } from 'vitest'
import type { PullRow } from '../../api/types'
import { RECORD_LABEL, TAB_BAR } from '../../app/tabs'
import { createList } from '../../commands/lists'
import { setInstruments } from '../../commands/settings'
import { createTune } from '../../commands/tunes'
import { STATUS_LABELS } from '../../constants'
import type { CrosstuneDb } from '../../db/schema'
import { ADD_TO_LIST, NONE_IN_IT } from '../lists/listPickerCopy'
import { EMPTY_LIST_TITLE } from '../lists/listsCopy'
import {
  archiveLabel,
  EDIT_SELECTED,
  editedToast,
  editTunesTitle,
  MIXED,
  removedFromListToast,
  removeFromListLabel,
  SAVE_EDIT,
  SELECT,
  SELECT_ALL,
  selectedTitle,
  SET_STATUS,
  setStatusLabel,
  SELECTION_ACTIONS,
} from './selectionCopy'
import { DETAIL_LABELS } from '../tune/detailFields'
import { ADD_TO_LIST_TITLE, LISTS_SECTION } from '../tune/tuneScreenCopy'
import { applyPullPage } from '../../sync/apply'
import { openTestDb } from '../../test/db'
import { tuneRow, userTuneRow } from '../../test/rows'
import { CANCEL, DONE } from '../../ui/confirmCopy'
import { MORE_ACTIONS } from '../../ui/menuCopy'
import { NOT_SET } from '../../ui/fieldCopy'
import { YEAR_LABEL } from '../../ui/partialDate'

import { COLUMN_DEFAULT, COLUMN_MIN } from '../../app/Columns'

import { longPress, tap } from '../../test/gestures'
import { renderApp } from '../../test/renderApp'
import { TUNE } from '../tune/tunePageCopy'
import { UNDO } from '../../ui/Toast'
import { MORE_CAPTION } from './SelectionBar'
import { TUNE_LIST, SELECT_TUNES } from '../catalog/catalogCopy'

const PHONE = { width: 390, height: 844 }
const WIDE = { width: 1280, height: 800 }
const AT = '2025-03-04T12:00:00.000Z'

/** Four tunes, in title order Angeline, Cluck, Forked, Soldier's, each with its own status. */
async function seedCatalog(db: CrosstuneDb): Promise<Record<string, string>> {
  const ids: Record<string, string> = {}
  const add = async (
    title: string,
    status: 'known' | 'learning' | 'want_to_learn',
    tune: Partial<Parameters<typeof createTune>[1]> = {},
  ) => {
    ids[title] = (await createTune(db, { title, ...tune }, { status })).tuneId
  }
  await add('Angeline the Baker', 'want_to_learn', { modes: ['major'] })
  await add('Cluck Old Hen', 'learning', { modes: ['dorian'] })
  await add('Forked Deer', 'known')
  await add("Soldier's Joy", 'learning')
  return ids
}

/** A tune and its user tune deleted on another device, as the sync applier stores them. */
async function pullDeletion(db: CrosstuneDb, tuneId: string) {
  // Later than the local writes still in the outbox, so the pull is not skipped as older.
  const at = new Date(Date.now() + 60_000).toISOString()
  const tune = (await db.tunes.get(tuneId))!
  const userTune = (await db.user_tunes.where('tune_id').equals(tuneId).first())!
  const rows = [
    { table: 'tunes', row: { ...tune, deleted_at: at, updated_at: at, server_seq: 7 } },
    { table: 'user_tunes', row: { ...userTune, deleted_at: at, updated_at: at, server_seq: 8 } },
  ] as unknown as PullRow[]
  await applyPullPage(db, rows, 8)
}

const archivedAt = async (db: CrosstuneDb, tuneId: string) =>
  (await db.user_tunes.where('tune_id').equals(tuneId).first())?.archived_at ?? null

const tunes = () => page.getByRole('grid', { name: TUNE_LIST })
const row = (title: string) => tunes().getByRole('row', { name: new RegExp(title) })
const tabs = () => page.getByRole('navigation', { name: TAB_BAR })
const statusOf = async (db: CrosstuneDb, tuneId: string) =>
  (await db.user_tunes.where('tune_id').equals(tuneId).first())?.status

async function startSelecting() {
  await page.getByRole('button', { name: MORE_ACTIONS }).click()
  await page.getByRole('menuitem', { name: SELECT_TUNES }).click()
}

it('selects with clicks and a shift-click, then sets status with Undo', async () => {
  const db = openTestDb()
  const ids = await seedCatalog(db)
  await renderApp({ path: '/catalog', db, frame: WIDE })
  await expect.element(row('Forked Deer')).toBeVisible()
  await startSelecting()
  await expect.element(page.getByRole('button', { name: SELECT_ALL })).toHaveFocus()

  await row('Angeline').click()
  await row('Cluck').click()
  await row('Forked').click({ modifiers: ['Shift'] })
  await expect.element(page.getByText(selectedTitle(3), { exact: true })).toBeVisible()
  await expect.element(row('Forked')).toHaveAttribute('aria-selected', 'true')
  await expect.element(row('Soldier')).toHaveAttribute('aria-selected', 'false')
  for (const name of [SET_STATUS, EDIT_SELECTED, ADD_TO_LIST, MORE_ACTIONS, DONE]) {
    await expect.element(page.getByRole('button', { name, exact: true })).toBeVisible()
  }

  await page.getByRole('button', { name: SET_STATUS }).click()
  await page.getByRole('menuitem', { name: STATUS_LABELS.known }).click()
  await expect.element(page.getByText(setStatusLabel(3, 'known'))).toBeVisible()
  await expect.poll(() => statusOf(db, ids['Cluck Old Hen']!)).toBe('known')
  await expect.poll(() => statusOf(db, ids['Angeline the Baker']!)).toBe('known')
  // The action ends the mode.
  await expect.element(page.getByText(selectedTitle(3), { exact: true })).not.toBeInTheDocument()

  await page.getByRole('button', { name: UNDO }).click()
  await expect.poll(() => statusOf(db, ids['Cluck Old Hen']!)).toBe('learning')
  await expect.poll(() => statusOf(db, ids['Angeline the Baker']!)).toBe('want_to_learn')
  await expect.poll(() => statusOf(db, ids['Forked Deer']!)).toBe('known')
})

it.each([
  [COLUMN_DEFAULT, selectedTitle(3)],
  [COLUMN_MIN, '3'],
])('fits the count in a %ipx content column on pointer as "%s"', async (width, shown) => {
  localStorage.setItem('crosstune.columnWidth', String(width))
  const db = openTestDb()
  await seedCatalog(db)
  await renderApp({ path: '/catalog', db, frame: WIDE })
  await expect.element(row('Forked Deer')).toBeVisible()
  await startSelecting()
  await row('Angeline').click()
  await row('Cluck').click()
  await row('Forked').click()
  const title = page.getByText(shown, { exact: true })
  await expect.element(title).toBeVisible()
  const element = title.element().closest<HTMLElement>('[data-pane-title]')!
  await expect.poll(() => element.clientWidth).toBeGreaterThan(0)
  await expect.poll(() => element.scrollWidth - element.clientWidth).toBeLessThanOrEqual(0)
  // A short title is for the eye only; the full one stays in the accessibility tree.
  const full = page.getByText(selectedTitle(3), { exact: true })
  await expect.element(full).toBeInTheDocument()
  expect(full.element().closest('[aria-hidden="true"]')).toBeNull()
})

it("opens selection from a row's menu with that row selected", async () => {
  const db = openTestDb()
  await seedCatalog(db)
  await renderApp({ path: '/catalog', db, frame: WIDE })
  await row('Forked Deer').click({ button: 'right' })
  await page.getByRole('menuitem', { name: SELECT, exact: true }).click()
  await expect.element(page.getByText(selectedTitle(1), { exact: true })).toBeVisible()
  await expect.element(row('Forked Deer')).toHaveAttribute('aria-selected', 'true')
  await row('Cluck').click()
  await expect.element(page.getByText(selectedTitle(2), { exact: true })).toBeVisible()
  await page.getByRole('button', { name: DONE }).click()
  await expect.element(page.getByText(selectedTitle(2), { exact: true })).not.toBeInTheDocument()
  // Back to the rows it was opened from, on the row last pressed.
  await expect.element(row('Cluck')).toHaveFocus()
})

it('leaves the sidebar Record capsule available while selecting, and returns focus to More', async () => {
  const db = openTestDb()
  await seedCatalog(db)
  await renderApp({ path: '/catalog', db, frame: WIDE })
  await expect.element(row('Forked Deer')).toBeVisible()
  await startSelecting()
  await row('Forked').click()
  await expect.element(page.getByText(selectedTitle(1), { exact: true })).toBeVisible()
  // Not stood down: the capsule keeps its place in the accessibility tree and its focus.
  const record = page.getByTestId('record-control')
  await expect.element(record).not.toHaveAttribute('aria-hidden')
  await expect.element(record).not.toHaveAttribute('inert')
  await expect.element(page.getByRole('button', { name: RECORD_LABEL })).toBeVisible()
  await page.getByRole('button', { name: DONE }).click()
  await expect.element(page.getByRole('button', { name: MORE_ACTIONS })).toHaveFocus()
})

it('selects on touch from the menu a long press opens, then by taps', async () => {
  const db = openTestDb()
  await seedCatalog(db)
  await renderApp({ path: '/catalog', db, frame: PHONE, density: 'touch' })
  await expect.element(row('Forked Deer')).toBeVisible()
  await longPress(row('Forked Deer'))
  await page.getByRole('menuitem', { name: SELECT, exact: true }).click()
  await expect.element(page.getByText(selectedTitle(1), { exact: true })).toBeVisible()
  await tap(row('Cluck'))
  await expect.element(page.getByText(selectedTitle(2), { exact: true })).toBeVisible()
  await expect.element(row('Cluck')).toHaveAttribute('aria-selected', 'true')
  await expect.element(page.getByRole('toolbar', { name: SELECTION_ACTIONS })).toBeVisible()
})

it('replaces the tab bar on the phone and stands the Record disc down', async () => {
  const db = openTestDb()
  await seedCatalog(db)
  await renderApp({ path: '/catalog', db, frame: PHONE })
  await expect.element(tabs()).toBeVisible()
  await expect.element(page.getByRole('button', { name: RECORD_LABEL })).toBeVisible()
  await startSelecting()
  await row('Forked Deer').click()

  const bar = page.getByRole('toolbar', { name: SELECTION_ACTIONS })
  await expect.element(bar).toBeVisible()
  await expect.element(bar.getByRole('button', { name: SET_STATUS })).toHaveTextContent(SET_STATUS)
  await expect
    .element(bar.getByRole('button', { name: MORE_ACTIONS }))
    .toHaveTextContent(MORE_CAPTION)
  await expect.element(tabs()).not.toBeInTheDocument()
  await expect.element(page.getByRole('button', { name: RECORD_LABEL })).not.toBeInTheDocument()

  await userEvent.keyboard('{Escape}')
  await expect.element(tabs()).toBeVisible()
  await expect.element(bar).not.toBeInTheDocument()
  await expect.element(page.getByRole('button', { name: RECORD_LABEL })).toBeVisible()
})

it('keeps the selection through a resize and drops a tune deleted under it', async () => {
  const db = openTestDb()
  const ids = await seedCatalog(db)
  await renderApp({ path: '/catalog', db, frame: WIDE })
  await expect.element(row('Forked Deer')).toBeVisible()
  await startSelecting()
  await row('Cluck').click()
  await row('Forked').click()
  await expect.element(page.getByText(selectedTitle(2), { exact: true })).toBeVisible()

  await page.viewport(PHONE.width, PHONE.height)
  await expect.element(page.getByRole('toolbar', { name: SELECTION_ACTIONS })).toBeVisible()
  await expect.element(page.getByText(selectedTitle(2), { exact: true })).toBeVisible()
  await expect.element(row('Cluck')).toHaveAttribute('aria-selected', 'true')

  // Another device deletes one of them, and the deletion arrives by sync.
  await pullDeletion(db, ids['Cluck Old Hen']!)
  await expect.element(page.getByText(selectedTitle(1), { exact: true })).toBeVisible()
  const more = page
    .getByRole('toolbar', { name: SELECTION_ACTIONS })
    .getByRole('button', { name: MORE_ACTIONS })
  await more.click()
  await expect.element(page.getByRole('menuitem', { name: archiveLabel(1, true) })).toBeVisible()
  // Escape closes the menu first and leaves the selection standing.
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByRole('menu')).not.toBeInTheDocument()
  await expect.element(page.getByText(selectedTitle(1), { exact: true })).toBeVisible()

  await more.click()
  await page.getByRole('menuitem', { name: archiveLabel(1, true) }).click()
  await expect.poll(() => archivedAt(db, ids['Forked Deer']!)).not.toBeNull()
  for (const title of ['Angeline the Baker', 'Cluck Old Hen', "Soldier's Joy"]) {
    expect(await archivedAt(db, ids[title]!)).toBeNull()
  }

  // A second selection still leaves by Escape.
  await startSelecting()
  await row('Angeline').click()
  await expect.element(page.getByText(selectedTitle(1), { exact: true })).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(tabs()).toBeVisible()
})

it('holds a half-typed date against Escape in the edit sheet', async () => {
  const db = openTestDb()
  await seedCatalog(db)
  await renderApp({ path: '/catalog', db, frame: WIDE })
  await expect.element(row('Forked Deer')).toBeVisible()
  await startSelecting()
  await row('Angeline').click()
  await row('Cluck').click()
  await page.getByRole('button', { name: EDIT_SELECTED, exact: true }).click()
  const sheet = page.getByRole('dialog', { name: editTunesTitle(2) })
  await sheet.getByRole('textbox', { name: YEAR_LABEL }).fill('2024')
  await userEvent.keyboard('{Escape}')
  await expect.element(sheet.getByRole('textbox', { name: YEAR_LABEL })).toHaveValue('2024')
  await sheet.getByRole('button', { name: CANCEL }).click()
  await expect.element(sheet).not.toBeInTheDocument()
})

it('edits only the fields touched, showing Mixed where the tunes disagree', async () => {
  const db = openTestDb()
  const ids = await seedCatalog(db)
  await renderApp({ path: '/catalog', db, frame: WIDE })
  await expect.element(row('Forked Deer')).toBeVisible()
  await startSelecting()
  await row('Angeline').click()
  await row('Cluck').click()
  await page.getByRole('button', { name: EDIT_SELECTED, exact: true }).click()

  const sheet = page.getByRole('dialog', { name: editTunesTitle(2) })
  await expect.element(sheet).toBeVisible()
  const mode = sheet.getByRole('button', { name: new RegExp(DETAIL_LABELS.mode) })
  await expect.element(mode).toHaveTextContent(MIXED)
  await expect.element(sheet.getByRole('button', { name: SAVE_EDIT })).toBeDisabled()

  await sheet.getByRole('button', { name: new RegExp(DETAIL_LABELS.time_signature) }).click()
  await page.getByRole('option', { name: '6/8' }).click()
  await sheet.getByRole('button', { name: SAVE_EDIT }).click()
  await expect.element(page.getByText(editedToast(2))).toBeVisible()
  const tuneOf = (id: string) => db.tunes.get(id)
  await expect.poll(async () => (await tuneOf(ids['Cluck Old Hen']!))?.time_signature).toBe('6/8')
  await expect
    .poll(async () => (await tuneOf(ids['Angeline the Baker']!))?.time_signature)
    .toBe('6/8')
  expect((await tuneOf(ids['Cluck Old Hen']!))?.modes).toEqual(['dorian'])
  expect((await tuneOf(ids['Angeline the Baker']!))?.modes).toEqual(['major'])
  expect((await tuneOf(ids['Forked Deer']!))?.time_signature).not.toBe('6/8')
})

it.each(['field', 'chevron'] as const)(
  'never picks a tuning on a press that began on the %s, and keeps the list open',
  async (start) => {
    const db = openTestDb()
    await seedCatalog(db)
    await setInstruments(db, 'user_1', ['violin'])
    await renderApp({ path: '/catalog', db, frame: PHONE })
    await expect.element(row('Forked Deer')).toBeVisible()
    await startSelecting()
    await row('Angeline').click()
    await row('Cluck').click()
    await page.getByRole('button', { name: EDIT_SELECTED, exact: true }).click()
    const sheet = page.getByRole('dialog', { name: editTunesTitle(2) })
    const field = sheet.getByRole('combobox', { name: /Violin tuning/ })
    const pressed =
      start === 'field' ? field : sheet.getByRole('button', { name: /^Show suggestions Violin/ })
    const option = page.getByRole('option', { name: 'Cross A (AEAE)', exact: true })
    // The press opens the list as it starts, and lifts over an option, as a fast click does
    // when the list opens under the pointer.
    await userEvent.dragAndDrop(pressed, option)
    await expect.element(field).toHaveValue(NOT_SET)
    await expect.element(field).toHaveAttribute('aria-expanded', 'true')
    await expect.element(option).toHaveAttribute('aria-selected', 'false')
  },
)

/** Thursday jam holds three tunes. */
async function seedList(db: CrosstuneDb) {
  const titles = ["Soldier's Joy", 'Cluck Old Hen', 'Forked Deer']
  const slug = (title: string) => title.toLowerCase().replace(/[^a-z]+/g, '-')
  await db.tunes.bulkPut(titles.map((title) => tuneRow(slug(title), title, { key: 'D' })))
  await db.user_tunes.bulkPut(titles.map((title) => userTuneRow(`u-${slug(title)}`, slug(title))))
  await db.lists.put({
    id: 'l1',
    created_at: AT,
    updated_at: AT,
    deleted_at: null,
    server_seq: 0,
    name: 'Thursday jam',
    position: 0,
  })
  await db.list_items.bulkPut(
    titles.map((title, position) => ({
      id: `l1-${slug(title)}`,
      created_at: AT,
      updated_at: AT,
      deleted_at: null,
      server_seq: 0,
      list_id: 'l1',
      user_tune_id: `u-${slug(title)}`,
      position,
    })),
  )
}

const listItems = async (db: CrosstuneDb) =>
  (await db.list_items.where('list_id').equals('l1').toArray()).filter((i) => !i.deleted_at)

it('removes three tunes from a list together, with Undo', async () => {
  const db = openTestDb()
  await seedList(db)
  await renderApp({ path: '/lists/l1', db, frame: WIDE })
  await expect.element(row('Forked Deer')).toBeVisible()
  await startSelecting()
  await page.getByRole('button', { name: SELECT_ALL }).click()
  await expect.element(page.getByText(selectedTitle(3), { exact: true })).toBeVisible()

  await page.getByRole('button', { name: MORE_ACTIONS }).click()
  await page.getByRole('menuitem', { name: removeFromListLabel(3) }).click()
  await expect.element(page.getByText(removedFromListToast(3, 'Thursday jam'))).toBeVisible()
  await expect.element(page.getByText(EMPTY_LIST_TITLE)).toBeVisible()
  await expect.poll(async () => (await listItems(db)).length).toBe(0)

  await page.getByRole('button', { name: UNDO }).click()
  await expect.poll(async () => (await listItems(db)).length).toBe(3)
  await expect.element(row('Forked Deer')).toBeVisible()
})

it("adds the tune page's tune to a list from the picker", async () => {
  const db = openTestDb()
  const ids = await seedCatalog(db)
  const listId = await createList(db, 'Thursday jam')
  await renderApp({ path: `/catalog/${ids['Forked Deer']}`, db, frame: WIDE })
  const tunePage = page.getByRole('main', { name: TUNE })
  // A tune in no list has no Lists section, so adding starts from the page's More menu.
  const more = tunePage.getByRole('button', { name: MORE_ACTIONS })
  await expect.element(more).toBeVisible()
  await expect
    .element(tunePage.getByRole('heading', { name: LISTS_SECTION }))
    .not.toBeInTheDocument()
  await more.click()
  await page.getByRole('menuitem', { name: ADD_TO_LIST }).click()

  const picker = page.getByRole('dialog', { name: ADD_TO_LIST_TITLE })
  await expect.element(picker).toBeVisible()
  const jam = picker.getByRole('button', { name: /Thursday jam/ })
  await expect.element(jam).toHaveTextContent(NONE_IN_IT)
  await jam.click()
  await expect.element(picker).not.toBeInTheDocument()
  await expect.poll(async () => await db.list_items.where('list_id').equals(listId).count()).toBe(1)
  await expect
    .element(
      tunePage
        .getByRole('region', { name: LISTS_SECTION })
        .getByRole('link', { name: 'Thursday jam' }),
    )
    .toBeVisible()
})
