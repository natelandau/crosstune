import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import * as bulkModule from '../../commands/bulk'
import { addToList, createList } from '../../commands/lists'
import { createSong, setArchived } from '../../commands/songs'
import { getMeta, setMeta } from '../../db/meta'
import type { CrosstuneDb } from '../../db/schema'
import { MOUSE_QUERY } from '../../platform/pointer'
import { openTestDb } from '../../test/db'
import { renderScreen } from '../../test/ionic'
import { ListPage } from './ListPage'
import { META_LIST_SHOW_ARCHIVED } from './useListShowArchived'

vi.mock('../../commands/bulk', { spy: true })
vi.mock('../../commands/lists', { spy: true })
vi.mock('./useListShowArchived', { spy: true })

let db: CrosstuneDb
let listId: string
let joy: { songId: string; userSongId: string }

const originalMatchMedia = window.matchMedia

beforeEach(async () => {
  db = openTestDb()
  listId = await createList(db, 'Tuesday jam')
  joy = await createSong(db, { title: "Soldier's Joy", key: 'D' }, { status: 'known' })
})

afterEach(() => {
  window.matchMedia = originalMatchMedia
})

function forceTouch() {
  window.matchMedia = (query: string) =>
    query === MOUSE_QUERY
      ? ({
          matches: false,
          media: query,
          addEventListener() {},
          removeEventListener() {},
        } as unknown as MediaQueryList)
      : originalMatchMedia.call(window, query)
}

const show = (id = listId) =>
  renderScreen(<ListPage />, { db, path: `/lists/${id}`, route: '/lists/:listId' })
const items = async () =>
  (await db.list_items.where('list_id').equals(listId).toArray()).filter((i) => !i.deleted_at)
const more = async (label: string) => {
  await page.getByRole('button', { name: 'More actions' }).click()
  await page.getByText(label, { exact: true }).click()
}

/** A second song in the list, so the rows offer a reorder handle. */
const addAngeline = async () => {
  const angeline = await createSong(db, { title: 'Angeline the Baker' }, { status: 'known' })
  await addToList(db, listId, angeline.userSongId)
}

const moveDown = async (title: string) => {
  await page.getByRole('button', { name: `Reorder ${title}` }).click()
  await page.getByText('Move down', { exact: true }).click()
}

const ORDER_FAILED = 'The order could not be saved.'
const REMOVE_FAILED = 'The song could not be removed.'
const BULK_REMOVE_FAILED = 'Song not found in list.'

const leaveSelection = () => page.getByRole('button', { name: 'Cancel selection' })
const rowCheckbox = (name: RegExp) => page.getByRole('checkbox', { name })
/** The toolbar title, which reads the count while selecting and the list's name otherwise. */
const screenTitle = () => document.querySelector('ion-title')!.textContent?.trim()
const rowTitles = () =>
  Array.from(document.querySelectorAll('ion-reorder-group h2')).map((h) => h.textContent)
const positions = () =>
  Array.from(document.querySelectorAll('[data-position]')).map((n) => n.textContent)
const reorderGroup = () => document.querySelector<HTMLIonReorderGroupElement>('ion-reorder-group')!

/** An ion-button keeps its native button in a shadow root, which `closest` never leaves. */
function buttonHost(name: string): HTMLElement {
  const root = page.getByRole('button', { name }).element().getRootNode()
  return (root as ShadowRoot).host as HTMLElement
}

/**
 * Ionic keeps a menu in the page while it dismisses and its focus trap holds the keyboard, so
 * anything pressed before it is gone lands in the menu rather than on the screen.
 */
const menuClosed = () =>
  vi.waitFor(() => expect(document.querySelector('ion-popover, ion-action-sheet')).toBeNull(), {
    timeout: 3000,
  })

/** Chooses an item in whichever More actions menu the toolbar is wearing. */
const pickFromMore = async (label: string) => {
  await more(label)
  await menuClosed()
}

async function startSelecting() {
  await pickFromMore('Select')
  await expect.element(leaveSelection()).toBeVisible()
}

/** Holds a row past the long-press threshold, then lifts on whatever row is there now. */
async function longPressRow(index: number) {
  const item = () => document.querySelectorAll('ion-reorder-group ion-item')[index]!
  item().dispatchEvent(
    new PointerEvent('pointerdown', {
      bubbles: true,
      isPrimary: true,
      button: 0,
      clientX: 20,
      clientY: 20,
    }),
  )
  // Past the 500ms hold, with room for the mode to open before the lift. Entering selection
  // replaces the row element, which releases the touch's implicit pointer capture, so the lift
  // is dispatched on the row that is there now.
  await new Promise((resolve) => setTimeout(resolve, 700))
  item().dispatchEvent(new PointerEvent('pointerup', { bubbles: true, isPrimary: true }))
  await new Promise((resolve) => setTimeout(resolve, 100))
}

describe('ListPage', () => {
  it('shows the list name as its one level 1 heading and its songs', async () => {
    await addToList(db, listId, joy.userSongId)
    show()
    await expect.element(page.getByRole('heading', { name: 'Tuesday jam', level: 1 })).toBeVisible()
    await expect.element(page.getByRole('heading', { name: "Soldier's Joy" })).toBeVisible()
    expect(document.querySelectorAll('h1')).toHaveLength(1)
  })

  it('names an empty list and opens the picker from its button', async () => {
    show()
    await expect.element(page.getByText('Nothing in this list')).toBeVisible()
    await expect.element(page.getByText('Add songs to start this list.')).toBeVisible()
    await page.getByRole('button', { name: 'Add songs' }).last().click()
    await expect.element(page.getByRole('searchbox', { name: 'Search songs' })).toBeVisible()
  })

  it('adds a song through the picker', async () => {
    show()
    await page.getByRole('button', { name: 'Add songs' }).first().click()
    await page.getByRole('searchbox', { name: 'Search songs' }).fill('soldier')
    await page.getByRole('button', { name: "Add Soldier's Joy" }).click()
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await expect.element(page.getByRole('heading', { name: "Soldier's Joy" })).toBeVisible()
  })

  it('creates a song from the picker, adds it to the list, and stays on the list', async () => {
    show()
    await page.getByRole('button', { name: 'Add songs' }).first().click()
    await page.getByRole('searchbox', { name: 'Search songs' }).fill('Sally Goodin')
    await page.getByRole('button', { name: 'Add "Sally Goodin"' }).click()
    await expect.element(page.getByText('New song')).toBeVisible()
    await expect.element(page.getByLabelText('Title')).toHaveValue('Sally Goodin')
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await vi.waitFor(async () => expect(await items()).toHaveLength(1))
    await expect.element(page.getByRole('heading', { name: 'Sally Goodin' })).toBeVisible()
    await expect.element(page.getByRole('heading', { name: 'Tuesday jam', level: 1 })).toBeVisible()
  })

  it('removes a song from its row', async () => {
    await addToList(db, listId, joy.userSongId)
    show()
    await page.getByRole('button', { name: "Remove Soldier's Joy" }).click()
    await vi.waitFor(async () => expect(await items()).toHaveLength(0))
    await expect.element(page.getByText('Nothing in this list')).toBeVisible()
  })

  it('says every song is archived and shows them from the empty state, saving the setting', async () => {
    await addToList(db, listId, joy.userSongId)
    await setArchived(db, joy.userSongId, true)
    show()
    await expect.element(page.getByText('Every song here is archived')).toBeVisible()
    await page.getByRole('button', { name: 'Show archived' }).click()
    await expect.element(page.getByRole('heading', { name: "Soldier's Joy" })).toBeVisible()
    await vi.waitFor(async () =>
      expect(await getMeta(db, META_LIST_SHOW_ARCHIVED, false)).toBe(true),
    )
    await more('Hide archived')
    await expect.element(page.getByText('Every song here is archived')).toBeVisible()
  })

  it('renames the list from More actions', async () => {
    show()
    await more('Rename')
    await page.getByLabelText('List name').fill('Wednesday jam')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect
      .element(page.getByRole('heading', { name: 'Wednesday jam', level: 1 }))
      .toBeVisible()
  })

  it('deletes the list after confirming and goes back to Lists', async () => {
    renderScreen(<ListPage />, {
      db,
      path: `/lists/${listId}`,
      route: '/lists/:listId',
      probes: { '/lists': 'Lists probe' },
    })
    await more('Delete list')
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await vi.waitFor(async () => expect((await db.lists.get(listId))?.deleted_at).not.toBeNull())
    await expect.element(page.getByRole('heading', { name: 'Lists probe' })).toBeVisible()
    expect(page.getByText('This list is gone').elements()).toHaveLength(0)
  })

  it('says a missing list is gone, under a named toolbar', async () => {
    show('missing')
    await expect.element(page.getByText('This list is gone')).toBeVisible()
    expect(page.getByRole('button', { name: 'More actions' }).elements()).toHaveLength(0)
    expect(document.querySelector('ion-title')?.textContent).toBe('List')
  })

  it('keeps the list named while its delete is running', async () => {
    const lists = await import('../../commands/lists')
    let finish = () => {}
    vi.spyOn(lists, 'deleteList').mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve
      }),
    )
    show()
    await more('Delete list')
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect.element(page.getByRole('status')).toHaveTextContent('Deleting…')
    expect(document.querySelector('ion-title')?.textContent).toBe('Tuesday jam')
    expect(document.querySelector('h1')?.textContent).toBe('Tuesday jam')
    finish()
  })

  it('waits for the archived setting before offering the list actions', async () => {
    const setting = await import('./useListShowArchived')
    // Restored by hand: the hook answers every render, so a one-shot mock cannot hold it and a
    // standing one would outlive this test.
    const unread = vi
      .spyOn(setting, 'useListShowArchived')
      .mockReturnValue([undefined, async () => {}])
    try {
      show()
      await expect
        .element(page.getByRole('heading', { name: 'Tuesday jam', level: 1 }))
        .toBeVisible()
      expect(page.getByRole('button', { name: 'More actions' }).elements()).toHaveLength(0)
      expect(page.getByRole('button', { name: 'Add songs' }).elements()).toHaveLength(0)
    } finally {
      unread.mockRestore()
    }
  })

  it('edits a song from its row', async () => {
    await addToList(db, listId, joy.userSongId)
    show()
    await page.getByRole('button', { name: "Edit Soldier's Joy" }).click()
    await expect.element(page.getByText('Edit song')).toBeVisible()
    await expect.element(page.getByLabelText('Title')).toHaveValue("Soldier's Joy")
  })

  it('shows a failed remove in the page error line', async () => {
    await addToList(db, listId, joy.userSongId)
    const lists = await import('../../commands/lists')
    vi.spyOn(lists, 'removeFromList').mockRejectedValueOnce(new Error(REMOVE_FAILED))
    show()
    await page.getByRole('button', { name: "Remove Soldier's Joy" }).click()
    await expect.element(page.getByRole('alert')).toHaveTextContent(REMOVE_FAILED)
  })

  it('drops a failed move from the error line once a later move lands', async () => {
    await addToList(db, listId, joy.userSongId)
    await addAngeline()
    const lists = await import('../../commands/lists')
    vi.spyOn(lists, 'moveItem').mockRejectedValueOnce(new Error(ORDER_FAILED))
    show()
    await expect.element(page.getByRole('heading', { name: 'Angeline the Baker' })).toBeVisible()
    await moveDown("Soldier's Joy")
    await expect.element(page.getByRole('alert')).toHaveTextContent(ORDER_FAILED)
    await moveDown("Soldier's Joy")
    await vi.waitFor(() => expect(page.getByRole('alert').elements()).toHaveLength(0))
  })

  it('shows a move error over an older action error', async () => {
    await addToList(db, listId, joy.userSongId)
    await addAngeline()
    const lists = await import('../../commands/lists')
    vi.spyOn(lists, 'removeFromList').mockRejectedValueOnce(new Error(REMOVE_FAILED))
    vi.spyOn(lists, 'moveItem').mockRejectedValueOnce(new Error(ORDER_FAILED))
    show()
    await page.getByRole('button', { name: "Remove Soldier's Joy" }).click()
    await expect.element(page.getByRole('alert')).toHaveTextContent(REMOVE_FAILED)
    await moveDown("Soldier's Joy")
    await expect.element(page.getByRole('alert')).toHaveTextContent(ORDER_FAILED)
  })

  it('walks the rows with the arrow keys on a mouse', async () => {
    await addToList(db, listId, joy.userSongId)
    await addAngeline()
    show()
    await expect.element(page.getByRole('heading', { name: 'Angeline the Baker' })).toBeVisible()
    const opens = document.querySelectorAll<HTMLElement>('[data-row-open]')
    expect(opens).toHaveLength(2)
    await vi.waitFor(() => {
      opens[0]!.focus()
      expect(document.activeElement).toBe(opens[0])
    })
    await userEvent.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(opens[1])
    await userEvent.keyboard('{ArrowUp}')
    expect(document.activeElement).toBe(opens[0])
  })

  it('opens a song in the Lists stack', async () => {
    await addToList(db, listId, joy.userSongId)
    renderScreen(<ListPage />, {
      db,
      path: `/lists/${listId}`,
      route: '/lists/:listId',
      probes: { '/lists/:listId/songs/:songId': 'Song probe' },
    })
    await expect.element(page.getByRole('heading', { name: "Soldier's Joy" })).toBeVisible()
    document.querySelector<HTMLButtonElement>('[data-row-open]')!.click()
    await expect.element(page.getByRole('heading', { name: 'Song probe' })).toBeVisible()
  })
})

describe('ListPage selection', () => {
  it('gives every toolbar control a 44px tap target', async () => {
    await addToList(db, listId, joy.userSongId)
    show()
    await expect.element(page.getByRole('button', { name: 'More actions' })).toBeVisible()
    for (const name of ['Add songs', 'More actions']) {
      const box = buttonHost(name).getBoundingClientRect()
      expect(box.height).toBeGreaterThanOrEqual(44)
      expect(box.width).toBeGreaterThanOrEqual(44)
    }
  })

  it('enters selection from the More menu', async () => {
    await addToList(db, listId, joy.userSongId)
    show()
    await expect.element(page.getByRole('heading', { name: "Soldier's Joy" })).toBeVisible()
    await startSelecting()
    await expect.poll(screenTitle).toBe('0 selected')
    await rowCheckbox(/^Select Soldier's Joy/).click()
    await expect.poll(screenTitle).toBe('1 selected')
    await leaveSelection().click()
    await expect.poll(screenTitle).toBe('Tuesday jam')
    await expect.element(page.getByRole('button', { name: 'Add songs' })).toBeVisible()
  })

  it('stands its exit control in for the back button while selecting', async () => {
    await addToList(db, listId, joy.userSongId)
    show()
    await expect.element(page.getByRole('heading', { name: "Soldier's Joy" })).toBeVisible()
    expect(document.querySelector('ion-back-button')).not.toBeNull()
    await startSelecting()
    expect(document.querySelector('ion-back-button')).toBeNull()
    await leaveSelection().click()
    await expect.poll(() => document.querySelector('ion-back-button')).not.toBeNull()
  })

  it('hides the reorder controls and the song picker, drops Rename, and keeps the positions', async () => {
    await addToList(db, listId, joy.userSongId)
    await addAngeline()
    show()
    await expect.element(page.getByRole('heading', { name: 'Angeline the Baker' })).toBeVisible()
    await expect.element(page.getByRole('button', { name: "Reorder Soldier's Joy" })).toBeVisible()
    expect(document.querySelectorAll('ion-reorder')).toHaveLength(2)
    expect(reorderGroup().disabled).toBe(false)

    await startSelecting()
    expect(page.getByRole('button', { name: "Reorder Soldier's Joy" }).elements()).toHaveLength(0)
    expect(document.querySelectorAll('ion-reorder')).toHaveLength(0)
    expect(reorderGroup().disabled).toBe(true)
    expect(page.getByRole('button', { name: 'Add songs' }).elements()).toHaveLength(0)
    expect(positions()).toEqual(['1', '2'])
    expect(document.querySelectorAll('[data-row-check]')).toHaveLength(2)

    await page.getByRole('button', { name: 'More actions' }).click()
    await expect.element(page.getByText('Select all', { exact: true })).toBeVisible()
    expect(page.getByText('Rename', { exact: true }).elements()).toHaveLength(0)
    expect(page.getByText('Delete list', { exact: true }).elements()).toHaveLength(0)
  })

  it('shows the reorder controls again after leaving', async () => {
    await addToList(db, listId, joy.userSongId)
    await addAngeline()
    show()
    await expect.element(page.getByRole('heading', { name: 'Angeline the Baker' })).toBeVisible()
    await startSelecting()
    expect(document.querySelectorAll('ion-reorder')).toHaveLength(0)
    await leaveSelection().click()
    await expect.element(page.getByRole('button', { name: "Reorder Soldier's Joy" })).toBeVisible()
    await vi.waitFor(() => expect(document.querySelectorAll('ion-reorder')).toHaveLength(2), {
      timeout: 3000,
    })
    expect(reorderGroup().disabled).toBe(false)
  })

  it('refuses selection while the rename sheet is open, including from a long press', async () => {
    forceTouch()
    await addToList(db, listId, joy.userSongId)
    show()
    await expect.element(page.getByRole('heading', { name: "Soldier's Joy" })).toBeVisible()
    await pickFromMore('Rename')
    await expect.element(page.getByLabelText('List name')).toBeVisible()
    await longPressRow(0)
    expect(screenTitle()).toBe('Tuesday jam')
    expect(leaveSelection().elements()).toHaveLength(0)

    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await vi.waitFor(() => expect(page.getByLabelText('List name').elements()).toHaveLength(0), {
      timeout: 3000,
    })
    await longPressRow(0)
    await expect.poll(screenTitle).toBe('1 selected')
  })

  it('asks the list to close its open rows on entering', async () => {
    await addToList(db, listId, joy.userSongId)
    show()
    await expect.element(page.getByRole('heading', { name: "Soldier's Joy" })).toBeVisible()
    // Whether a row is open cannot be read back afterwards: a selecting row passes no actions, so
    // Row drops the IonItemSliding wrapper and the swipe state unmounts with it either way. What
    // can be asserted is that the mode asks, which is what the list's own ref is there for.
    const closeOpenRows = vi.spyOn(document.querySelector('ion-list')!, 'closeSlidingItems')
    await startSelecting()
    expect(closeOpenRows).toHaveBeenCalled()
  })

  it('offers Select under StrictMode, which double-invokes the publish', async () => {
    await addToList(db, listId, joy.userSongId)
    renderScreen(<ListPage />, {
      db,
      path: `/lists/${listId}`,
      route: '/lists/:listId',
      strict: true,
    })
    await expect.element(page.getByRole('heading', { name: "Soldier's Joy" })).toBeVisible()
    await startSelecting()
    await expect.poll(screenTitle).toBe('0 selected')
  })

  it('extends a range with shift-click', async () => {
    await addToList(db, listId, joy.userSongId)
    await addAngeline()
    const hen = await createSong(db, { title: 'Cluck Old Hen' }, { status: 'known' })
    await addToList(db, listId, hen.userSongId)
    show()
    await expect.element(page.getByRole('heading', { name: 'Cluck Old Hen' })).toBeVisible()
    await startSelecting()
    await rowCheckbox(/^Select Soldier's Joy/).click()
    await expect.poll(screenTitle).toBe('1 selected')
    await rowCheckbox(/^Select Cluck Old Hen/).click({ modifiers: ['Shift'] })
    await expect.poll(screenTitle).toBe('3 selected')
  })

  it('removes the selected songs and undoes them into their original positions', async () => {
    await addToList(db, listId, joy.userSongId)
    await addAngeline()
    const hen = await createSong(db, { title: 'Cluck Old Hen' }, { status: 'known' })
    await addToList(db, listId, hen.userSongId)
    show()
    await expect.element(page.getByRole('heading', { name: 'Cluck Old Hen' })).toBeVisible()
    await startSelecting()
    await rowCheckbox(/^Select Soldier's Joy/).click()
    await rowCheckbox(/^Select Cluck Old Hen/).click()
    await expect.poll(screenTitle).toBe('2 selected')
    await pickFromMore('Remove 2 from list')
    await vi.waitFor(async () => expect(await items()).toHaveLength(1), { timeout: 3000 })
    await expect.poll(screenTitle).toBe('Tuesday jam')
    await expect.element(page.getByText('Removed 2 songs from Tuesday jam')).toBeVisible()
    await page.getByRole('button', { name: 'Undo' }).click()
    await vi.waitFor(async () => expect(await items()).toHaveLength(3), { timeout: 3000 })
    await vi.waitFor(
      () => expect(rowTitles()).toEqual(["Soldier's Joy", 'Angeline the Baker', 'Cluck Old Hen']),
      { timeout: 3000 },
    )
  })

  it('keeps the mode and shows the error when Remove fails', async () => {
    await addToList(db, listId, joy.userSongId)
    await addAngeline()
    show()
    await expect.element(page.getByRole('heading', { name: 'Angeline the Baker' })).toBeVisible()
    await startSelecting()
    await rowCheckbox(/^Select Soldier's Joy/).click()
    await expect.poll(screenTitle).toBe('1 selected')
    vi.mocked(bulkModule.removeSongsFromList).mockRejectedValueOnce(new Error(BULK_REMOVE_FAILED))
    await pickFromMore('Remove 1 from list')
    await expect.element(page.getByRole('alert')).toHaveTextContent(BULK_REMOVE_FAILED)
    expect(screenTitle()).toBe('1 selected')
    await expect.element(leaveSelection()).toBeVisible()
  })

  it('prunes the count when Show archived turns off during selection', async () => {
    await addToList(db, listId, joy.userSongId)
    await addAngeline()
    await setArchived(db, joy.userSongId, true)
    await setMeta(db, META_LIST_SHOW_ARCHIVED, true)
    show()
    await expect.element(page.getByRole('heading', { name: "Soldier's Joy" })).toBeVisible()
    await startSelecting()
    await pickFromMore('Select all')
    await expect.poll(screenTitle).toBe('2 selected')
    // The setting is shared, so another tab or a sync can turn it off mid-selection.
    await setMeta(db, META_LIST_SHOW_ARCHIVED, false)
    await expect.poll(screenTitle).toBe('1 selected')
  })

  it('moves focus to the page after every visible song is removed', async () => {
    await addToList(db, listId, joy.userSongId)
    show()
    await expect.element(page.getByRole('heading', { name: "Soldier's Joy" })).toBeVisible()
    await startSelecting()
    await pickFromMore('Select all')
    await expect.poll(screenTitle).toBe('1 selected')
    await pickFromMore('Remove 1 from list')
    await expect.element(page.getByText('Nothing in this list')).toBeVisible()
    await vi.waitFor(() => expect(document.activeElement).toBe(document.querySelector('main')), {
      timeout: 3000,
    })
    await page.getByRole('button', { name: 'Undo' }).click()
    await vi.waitFor(async () => expect(await items()).toHaveLength(1), { timeout: 3000 })
  })

  it('does not offer this list in Add to list', async () => {
    await createList(db, 'Square dance set')
    await addToList(db, listId, joy.userSongId)
    show()
    await expect.element(page.getByRole('heading', { name: "Soldier's Joy" })).toBeVisible()
    await startSelecting()
    await rowCheckbox(/^Select Soldier's Joy/).click()
    await expect.poll(screenTitle).toBe('1 selected')
    await page.getByRole('button', { name: 'Add to list' }).click()
    await expect.element(page.getByRole('button', { name: /Square dance set/ })).toBeVisible()
    // The open list would be offered as a row reading "all in it", since it already holds the
    // song; it is the only list that could read that way.
    expect(page.getByText('all in it', { exact: true }).elements()).toHaveLength(0)
  })
})
