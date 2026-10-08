import { page, userEvent } from 'vitest/browser'
import { expect, it, vi } from 'vitest'
import type { PullRow } from '../../api/types'
import type * as ListsModule from '../../commands/lists'
import { deleteList, moveItem } from '../../commands/lists'
import type { CrosstuneDb } from '../../db/schema'
import type { LocalList, LocalListItem } from '../../db/types'
import { SEARCH_TUNES, TUNE_LIST, SELECT_TUNES } from '../catalog/catalogCopy'
import { EDITED_YESTERDAY, editedLabel } from './editedLabel'
import {
  ADD_LIST,
  ADD_TUNES,
  addTuneName,
  CREATE_LIST,
  DELETE_LIST,
  EMPTY_LIST_TITLE,
  IN_THIS_LIST,
  LIST_GONE,
  LIST_NAME_LABEL,
  NEW_LIST_TITLE,
  NOT_PLAYABLE,
  REMOVE,
  RENAME,
  RENAME_LIST_TITLE,
  SAVE_LIST_NAME,
} from './listsCopy'
import type { Player } from '../player/usePlayer'
import { closeRecordingName, playName } from '../recordings/recordingNames'
import { countTunes } from '../selection/copy'
import { removedFromListToast, selectedTitle } from '../selection/selectionCopy'
import { EDIT_TUNE } from '../tune/tuneScreenCopy'
import { applyPullPage } from '../../sync/apply'
import { openTestDb } from '../../test/db'
import { fakePlayer } from '../../test/providers'
import { recordingFile, recordingRow, tuneRow, userTuneRow } from '../../test/rows'
import { CANCEL, DONE } from '../../ui/confirmCopy'
import { MORE_ACTIONS } from '../../ui/menuCopy'
import { movedAnnouncement } from '../../ui/reorderCopy'
import { destination } from '../../app/destinations'

import { CHOOSE_OR_PRESS_N, NO_TUNE_SELECTED } from '../../app/DetailEmpty'
import { NEW_LIST, SIDEBAR } from '../../app/Sidebar'

import { renderApp } from '../../test/renderApp'
import type { TuneFormLauncher } from '../tune/formLauncher'
import { TUNE } from '../tune/tunePageCopy'
import { DELETE } from '../../ui/Confirm'
import { moveRowLabel } from '../../ui/reorder'
import { UNDO } from '../../ui/Toast'
import { FixedNow } from '../../ui/useNow'
import { CHOOSE_A_LIST, NO_LIST_SELECTED } from './ListsLayout'
import { TAB_BAR } from '../../app/tabs'

vi.mock('../../commands/lists', { spy: true })

const { moveItem: realMoveItem } = await vi.importActual<typeof ListsModule>('../../commands/lists')

const PHONE = { width: 390, height: 844 }
const WIDE = { width: 1280, height: 800 }
const AT = '2025-03-04T12:00:00.000Z'

const LISTS = destination('lists')

const TUNES = ["Soldier's Joy", 'Cluck Old Hen', 'Forked Deer', 'Kesh Jig', 'Big Sciota']
const slug = (title: string) => title.toLowerCase().replace(/[^a-z]+/g, '-')

/** Two lists: Thursday jam holds three tunes in order, Session sets one. */
async function seed(db: CrosstuneDb) {
  await db.tunes.bulkPut(TUNES.map((title) => tuneRow(slug(title), title, { key: 'D' })))
  await db.user_tunes.bulkPut(TUNES.map((title) => userTuneRow(`u-${slug(title)}`, slug(title))))
  const list = (id: string, name: string, position: number): LocalList => ({
    id,
    created_at: AT,
    updated_at: AT,
    deleted_at: null,
    server_seq: 0,
    name,
    position,
  })
  await db.lists.bulkPut([list('l1', 'Thursday jam', 0), list('l2', 'Session sets', 1)])
  const item = (listId: string, title: string, position: number): LocalListItem => ({
    id: `${listId}-${slug(title)}`,
    created_at: AT,
    updated_at: AT,
    deleted_at: null,
    server_seq: 0,
    list_id: listId,
    user_tune_id: `u-${slug(title)}`,
    position,
  })
  await db.list_items.bulkPut([
    item('l1', "Soldier's Joy", 0),
    item('l1', 'Cluck Old Hen', 1),
    item('l1', 'Forked Deer', 2),
    item('l2', 'Kesh Jig', 0),
  ])
}

async function mount(
  path: string,
  frame = PHONE,
  {
    player,
    before,
    density,
  }: {
    player?: Player
    before?: (db: CrosstuneDb) => Promise<unknown>
    density?: 'pointer' | 'touch'
  } = {},
) {
  const db = openTestDb()
  await seed(db)
  await before?.(db)
  const launcher = { open: vi.fn<TuneFormLauncher['open']>() }
  const app = await renderApp({ path, db, frame, launcher, player, density })
  return { ...app, db, launcher }
}

/** A recording of Soldier's Joy this device holds, so its row plays it. */
const heldRecording = async (db: CrosstuneDb) => {
  await db.recordings.put(recordingRow('rec1', { tune_id: 'soldier-s-joy' }))
  await db.recording_files.put(
    recordingFile('rec1', { blob: new Blob(['x'], { type: 'audio/mp4' }) }),
  )
}

const at = (router: { state: { location: { pathname: string } } }) => () =>
  router.state.location.pathname
const sidebar = () => page.getByRole('navigation', { name: SIDEBAR })
const listRows = () => page.getByRole('grid', { name: LISTS.label })
const tuneRows = () => page.getByRole('grid', { name: TUNE_LIST })
const rowTitles = () =>
  tuneRows()
    .getByRole('row')
    .elements()
    .map((e) => e.querySelector('[data-row-title]')?.textContent)
const activeItems = async (db: CrosstuneDb, listId: string) =>
  (await db.list_items.where('list_id').equals(listId).toArray()).filter((i) => !i.deleted_at)
// A plain string with quotes in it does not survive the text locator's own quoting.
const literally = (text: string) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))

it('lists every list with its count and edited date on the phone', async () => {
  await mount('/lists')
  await expect.element(page.getByRole('heading', { level: 1, name: LISTS.label })).toBeVisible()
  const jam = listRows().getByRole('row', { name: /Thursday jam/ })
  await expect.element(jam).toHaveTextContent(countTunes(3))
  await expect.element(jam).toHaveTextContent(editedLabel(AT))
  await expect
    .element(listRows().getByRole('row', { name: /Session sets/ }))
    .toHaveTextContent(countTunes(1))
  await expect.element(page.getByRole('button', { name: ADD_LIST })).toBeVisible()
})

it('dates each list by the fixed clock when one is set', async () => {
  const db = openTestDb()
  await seed(db)
  const nextDay = Date.parse(AT) + 86_400_000
  await renderApp({
    path: '/lists',
    db,
    wrap: (app) => <FixedNow value={nextDay}>{app}</FixedNow>,
  })
  await expect
    .element(listRows().getByRole('row', { name: /Thursday jam/ }))
    .toHaveTextContent(EDITED_YESTERDAY)
})

it('opens a list from its row, and renames one from the row actions', async () => {
  const { router, db } = await mount('/lists')
  await listRows()
    .getByRole('row', { name: /Session sets/ })
    .getByRole('button', { name: RENAME })
    .click()
  const dialog = page.getByRole('dialog', { name: RENAME_LIST_TITLE })
  const field = dialog.getByRole('textbox', { name: LIST_NAME_LABEL })
  await expect.element(field).toHaveValue('Session sets')
  await field.fill('Irish sets')
  await dialog.getByRole('button', { name: SAVE_LIST_NAME }).click()
  await expect.poll(async () => (await db.lists.get('l2'))?.name).toBe('Irish sets')
  await expect.element(dialog).not.toBeInTheDocument()
  await listRows()
    .getByRole('row', { name: /Irish sets/ })
    .click()
  await expect.poll(at(router)).toBe('/lists/l2')
  await expect.element(page.getByRole('heading', { level: 1, name: 'Irish sets' })).toBeVisible()
})

it('creates a list from the sidebar and shows it there', async () => {
  const { db } = await mount('/catalog', WIDE)
  await sidebar().getByRole('button', { name: NEW_LIST }).click()
  const dialog = page.getByRole('dialog', { name: NEW_LIST_TITLE })
  await dialog.getByRole('textbox', { name: LIST_NAME_LABEL }).fill('Square dance')
  await dialog.getByRole('button', { name: CREATE_LIST }).click()
  await expect.element(sidebar().getByRole('link', { name: 'Square dance' })).toBeVisible()
  await expect.element(dialog).not.toBeInTheDocument()
  expect((await db.lists.toArray()).map((list) => list.name)).toContain('Square dance')
})

it('says what the detail column waits for at the lists root and in a list on wide', async () => {
  await mount('/lists', WIDE)
  const detail = () => page.getByRole('main', { name: TUNE })
  await expect.element(detail().getByRole('heading', { name: NO_LIST_SELECTED })).toBeVisible()
  await expect.element(detail().getByText(CHOOSE_A_LIST)).toBeVisible()
  await listRows()
    .getByRole('row', { name: /Thursday jam/ })
    .click()
  await expect.element(detail().getByRole('heading', { name: NO_TUNE_SELECTED })).toBeVisible()
  await expect.element(detail().getByText(CHOOSE_OR_PRESS_N)).toBeVisible()
  await expect.element(page.getByText(NO_LIST_SELECTED)).not.toBeInTheDocument()
})

it('shows a list in the content column on wide and its tune in the detail beside it', async () => {
  const { router } = await mount('/lists/l1', WIDE)
  await expect.element(page.getByRole('heading', { level: 1, name: 'Thursday jam' })).toBeVisible()
  await expect.poll(rowTitles).toEqual(["Soldier's Joy", 'Cluck Old Hen', 'Forked Deer'])
  await tuneRows()
    .getByRole('row', { name: /Cluck Old Hen/ })
    .click()
  await expect.poll(at(router)).toBe('/lists/l1/tunes/cluck-old-hen')
  await expect
    .element(page.getByRole('main', { name: TUNE }).getByRole('heading', { level: 1 }))
    .toHaveTextContent('Cluck Old Hen')
  await expect.element(tuneRows()).toBeVisible()
  await expect.element(page.getByRole('heading', { level: 1, name: 'Thursday jam' })).toBeVisible()
})

it('replaces the open tune in the detail as ArrowDown walks the rows on wide', async () => {
  const { router } = await mount('/lists/l1/tunes/soldier-s-joy', WIDE)
  const joy = tuneRows().getByRole('row', { name: /Soldier's Joy/ })
  await expect.element(joy).toHaveAttribute('aria-selected', 'true')
  ;(joy.element() as HTMLElement).focus()
  await userEvent.keyboard('{ArrowDown}')
  await expect.poll(at(router)).toBe('/lists/l1/tunes/cluck-old-hen')
  expect(router.state.historyAction).toBe('REPLACE')
  await expect
    .element(page.getByRole('main', { name: TUNE }).getByRole('heading', { level: 1 }))
    .toHaveTextContent('Cluck Old Hen')
  await expect
    .element(tuneRows().getByRole('row', { name: /Cluck Old Hen/ }))
    .toHaveAttribute('aria-selected', 'true')
})

it('pushes a tune over the list on the phone, and Back returns to the list', async () => {
  const { router } = await mount('/lists/l1')
  await tuneRows()
    .getByRole('row', { name: /Forked Deer/ })
    .click()
  await expect.poll(at(router)).toBe('/lists/l1/tunes/forked-deer')
  // The hidden list leaves the accessibility tree.
  await expect.element(tuneRows()).not.toBeInTheDocument()
  // The pane bar's Back comes before the page's own link to the list.
  await page
    .getByRole('main', { name: TUNE })
    .getByRole('link', { name: 'Thursday jam' })
    .first()
    .click()
  await expect.poll(at(router)).toBe('/lists/l1')
  await expect.element(tuneRows()).toBeVisible()
})

/** Moves the row titled `title` to the top with its keyboard drag, a key at a time. */
async function moveToTopByKeyboard(title: string) {
  const move = page.getByRole('button', { name: moveRowLabel(title) })
  await expect.element(move).toBeEnabled()
  ;(
    tuneRows()
      .getByRole('row', { name: new RegExp(title) })
      .element() as HTMLElement
  ).focus()
  // The arrows walk the row's controls in order, the status glyph's tip first.
  for (let step = 0; step < 4 && document.activeElement !== move.element(); step++) {
    const before = document.activeElement
    await userEvent.keyboard('{ArrowRight}')
    await expect.poll(() => document.activeElement).not.toBe(before)
  }
  await expect.element(move).toHaveFocus()
  const dropTarget = () => document.activeElement?.getAttribute('aria-label')
  await userEvent.keyboard('{Enter}')
  await expect.poll(dropTarget).toMatch(/^Insert /)
  // Each key waits for the drag to take the one before it, as a person's keys would.
  for (let step = 0; step < 4 && !dropTarget()?.startsWith('Insert before'); step++) {
    const before = dropTarget()
    await userEvent.keyboard('{ArrowUp}')
    await expect.poll(dropTarget).not.toBe(before)
  }
  expect(dropTarget()).toMatch(/^Insert before Soldier's Joy/)
  await userEvent.keyboard('{Enter}')
}

it('reorders from the keyboard and announces where the tune landed', async () => {
  const { db } = await mount('/lists/l1', WIDE)
  await moveToTopByKeyboard('Forked Deer')
  await expect.poll(rowTitles).toEqual(['Forked Deer', "Soldier's Joy", 'Cluck Old Hen'])
  await expect
    .element(page.getByRole('status').filter({ hasText: movedAnnouncement('Forked Deer', 1, 3) }))
    .toBeInTheDocument()
  await expect
    .poll(async () =>
      (await activeItems(db, 'l1')).sort((a, b) => a.position - b.position).map((i) => i.id),
    )
    .toEqual(['l1-forked-deer', 'l1-soldier-s-joy', 'l1-cluck-old-hen'])
})

it('settles a move a sync lands under in the stored order, announcing the drop', async () => {
  let release!: () => void
  const held = new Promise<void>((resolve) => (release = resolve))
  vi.mocked(moveItem).mockImplementationOnce(async (...args) => {
    await held
    await realMoveItem(...args)
  })
  const { db } = await mount('/lists/l1', WIDE)
  await moveToTopByKeyboard('Forked Deer')
  await expect.poll(rowTitles).toEqual(['Forked Deer', "Soldier's Joy", 'Cluck Old Hen'])
  const said = movedAnnouncement('Forked Deer', 1, 3)
  const status = page.getByRole('status').filter({ hasText: said })
  await expect.element(status).toBeInTheDocument()

  // Another device moved Cluck Old Hen to the top, and the sync lands before the write.
  const later = new Date(Date.now() + 60_000).toISOString()
  const synced = ['l1-cluck-old-hen', 'l1-soldier-s-joy', 'l1-forked-deer']
  const rows = await Promise.all(
    synced.map(async (id, position) => ({
      table: 'list_items',
      row: { ...(await db.list_items.get(id))!, position, updated_at: later, server_seq: 9 },
    })),
  )
  await applyPullPage(db, rows as unknown as PullRow[], 9)
  // The local move replays onto the synced order: still before Soldier's Joy.
  await expect.poll(rowTitles).toEqual(['Cluck Old Hen', 'Forked Deer', "Soldier's Joy"])

  const stored = async () =>
    (await activeItems(db, 'l1')).sort((a, b) => a.position - b.position).map((i) => i.id)
  expect(await stored()).toEqual(synced)

  release()
  await expect.poll(stored).toEqual(['l1-cluck-old-hen', 'l1-forked-deer', 'l1-soldier-s-joy'])
  await expect.poll(rowTitles).toEqual(['Cluck Old Hen', 'Forked Deer', "Soldier's Joy"])
  // The live region spoke once, for the musician's drop; the sync is not their move.
  await expect.element(status).toBeInTheDocument()
})

it('reorders while a tune is open beside the list, leaving the tune open', async () => {
  const { router } = await mount('/lists/l1/tunes/soldier-s-joy', WIDE)
  await expect
    .element(page.getByRole('main', { name: TUNE }).getByRole('heading', { level: 1 }))
    .toHaveTextContent("Soldier's Joy")
  await moveToTopByKeyboard('Forked Deer')
  await expect.poll(rowTitles).toEqual(['Forked Deer', "Soldier's Joy", 'Cluck Old Hen'])
  await expect.poll(at(router)).toBe('/lists/l1/tunes/soldier-s-joy')
})

it('offers the move items in the row menu', async () => {
  await mount('/lists/l1', WIDE)
  const row = tuneRows().getByRole('row', { name: /Cluck Old Hen/ })
  await row.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Move to top' }).click()
  await expect.poll(rowTitles).toEqual(['Cluck Old Hen', "Soldier's Joy", 'Forked Deer'])
})

it('deletes the list after asking and leaves it with no entry to return to', async () => {
  const { router, db } = await mount('/catalog')
  await page
    .getByRole('navigation', { name: TAB_BAR })
    .getByRole('link', { name: LISTS.label })
    .click()
  await expect.poll(at(router)).toBe('/lists')
  await listRows()
    .getByRole('row', { name: /Thursday jam/ })
    .click()
  await expect.poll(at(router)).toBe('/lists/l1')
  await page.getByRole('button', { name: MORE_ACTIONS }).click()
  await page.getByRole('menuitem', { name: DELETE_LIST }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: DELETE }).click()
  await expect.poll(at(router)).toBe('/lists')
  await expect.poll(async () => (await db.lists.get('l1'))?.deleted_at).toBeTruthy()
  await expect
    .element(listRows().getByRole('row', { name: /Thursday jam/ }))
    .not.toBeInTheDocument()
  await router.navigate(-1)
  await expect.poll(at(router)).toBe('/catalog')
})

it('removes a tune from its row with an Undo toast', async () => {
  const { db } = await mount('/lists/l1', WIDE)
  const row = tuneRows().getByRole('row', { name: /Cluck Old Hen/ })
  await row.hover()
  await row.getByRole('button', { name: REMOVE }).click()
  await expect.poll(rowTitles).toEqual(["Soldier's Joy", 'Forked Deer'])
  await expect
    .element(page.getByText(literally(removedFromListToast(1, 'Thursday jam'))))
    .toBeVisible()
  await page.getByRole('button', { name: UNDO }).click()
  await expect.poll(rowTitles).toEqual(["Soldier's Joy", 'Cluck Old Hen', 'Forked Deer'])
  await expect.poll(async () => (await activeItems(db, 'l1')).length).toBe(3)
})

it('edits a tune from its row through the tune form', async () => {
  const { launcher } = await mount('/lists/l1', WIDE)
  const row = tuneRows().getByRole('row', { name: /Forked Deer/ })
  await row.hover()
  await row.getByRole('button', { name: EDIT_TUNE }).click()
  await expect.poll(() => launcher.open).toHaveBeenCalledWith({ tuneId: 'forked-deer' })
})

it('offers Select tunes in More, which starts selecting', async () => {
  await mount('/lists/l1', WIDE)
  await page.getByRole('button', { name: MORE_ACTIONS }).click()
  await page.getByRole('menuitem', { name: SELECT_TUNES }).click()
  await expect.element(page.getByText(selectedTitle(0), { exact: true })).toBeVisible()
})

it('adds tunes from the picker, marking those already in the list', async () => {
  const { db } = await mount('/lists/l1', WIDE)
  await page.getByRole('button', { name: ADD_TUNES }).click()
  const dialog = page.getByRole('dialog', { name: ADD_TUNES })
  const search = dialog.getByRole('searchbox', { name: SEARCH_TUNES })
  await search.fill('o')
  expect(dialog.getByRole('button', { name: CANCEL }).elements()).toHaveLength(0)
  const taken = dialog.getByRole('row', { name: /Cluck Old Hen/ })
  await expect.element(taken).toHaveAccessibleName(new RegExp(`${IN_THIS_LIST}$`))
  await expect.element(taken).toHaveAttribute('aria-disabled', 'true')
  await search.fill('Big')
  const offered = dialog.getByRole('row', { name: addTuneName('Big Sciota'), exact: true })
  await expect.element(offered).not.toHaveAttribute('aria-disabled')
  await offered.click()
  await expect.poll(async () => (await activeItems(db, 'l1')).length).toBe(4)
  await dialog.getByRole('button', { name: DONE }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.poll(rowTitles).toContain('Big Sciota')
})

it('shows an empty list with a way to add tunes', async () => {
  const { db } = await mount('/lists/l2', WIDE)
  await expect.poll(rowTitles).toEqual(['Kesh Jig'])
  await db.list_items.update('l2-kesh-jig', { deleted_at: AT })
  await expect.element(page.getByRole('heading', { name: EMPTY_LIST_TITLE })).toBeVisible()
})

it('leaves a list deleted elsewhere, saying it is gone', async () => {
  const { router, db } = await mount('/lists/l2', WIDE)
  await expect.element(page.getByRole('heading', { level: 1, name: 'Session sets' })).toBeVisible()
  await deleteList(db, 'l2')
  await expect.poll(at(router)).toBe('/lists')
  await expect.element(page.getByText(LIST_GONE)).toBeVisible()
})

it("plays a row's recording in the list's context", async () => {
  const player = fakePlayer()
  const { router } = await mount('/lists/l1', WIDE, { player, before: heldRecording })
  await tuneRows()
    .getByRole('button', { name: playName("Soldier's Joy") })
    .click()
  await expect
    .poll(() => player.play)
    .toHaveBeenCalledWith({ kind: 'recording', id: 'rec1' }, { context: 'list', listId: 'l1' })
  // The control answers alone; the row's own press would open the tune.
  await expect.poll(at(router)).toBe('/lists/l1')
})

it('says when a tune in the list has nothing to play', async () => {
  await mount('/lists/l1', WIDE, { player: fakePlayer() })
  const row = tuneRows().getByRole('row', { name: /Cluck Old Hen/ })
  await expect.element(row).toHaveAccessibleName(new RegExp(NOT_PLAYABLE))
  await expect.element(row).toHaveTextContent(NOT_PLAYABLE)
  expect(row.getByRole('button', { name: playName('Cluck Old Hen') }).elements()).toHaveLength(0)
})

/**
 * What the row paints behind its title: the first background, color or image, between the
 * title and the row, read from the title outward.
 */
function paintedBehindTitle(row: Element): string {
  for (let node = row.querySelector('[data-row-title]'); node; node = node.parentElement) {
    const style = getComputedStyle(node)
    if (style.backgroundImage !== 'none' || style.backgroundColor !== 'rgba(0, 0, 0, 0)') {
      return `${style.backgroundColor} ${style.backgroundImage}`
    }
    if (node === row) break
  }
  return 'none'
}

it.each(['pointer', 'touch'] as const)(
  'marks the row whose recording the player holds on %s',
  async (density) => {
    const player = fakePlayer({ item: { kind: 'recording', id: 'rec1' } })
    await mount('/lists/l1', WIDE, { player, before: heldRecording, density })
    const row = tuneRows().getByRole('row', { name: /Soldier's Joy/ })
    const other = tuneRows().getByRole('row', { name: /Forked Deer/ })
    await expect.element(row).toHaveAttribute('data-playing')
    await expect.element(other).not.toHaveAttribute('data-playing')
    expect(row.element().querySelector('[data-playing-glyph]')).not.toBeNull()
    expect(other.element().querySelector('[data-playing-glyph]')).toBeNull()
    expect(paintedBehindTitle(row.element())).not.toBe(paintedBehindTitle(other.element()))
    await row.getByRole('button', { name: closeRecordingName("Soldier's Joy") }).click()
    await expect.poll(() => player.close).toHaveBeenCalled()
  },
)
