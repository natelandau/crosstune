import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { addToList, createList } from '../../commands/lists'
import type * as ListsModule from '../../commands/lists'
import { createSong, setArchived } from '../../commands/songs'
import type { CrosstuneDb } from '../../db/schema'
import { MOUSE_QUERY } from '../../platform/pointer'
import { openTestDb } from '../../test/db'
import { renderIonic } from '../../test/ionic'
import { settleOverlays } from '../../test/overlays'
import { ListSongs } from './ListSongs'
import { useListView } from './useLists'
import type { Instrument } from '../../api/vocabulary'

vi.mock('../../commands/lists', { spy: true })

const { moveItem: realMoveItem } = await vi.importActual<typeof ListsModule>('../../commands/lists')

let db: CrosstuneDb
let listId: string
const titles = ['Angeline the Baker', "Soldier's Joy", 'Cluck Old Hen', 'Forked Deer']
const violin = new Set<Instrument>(['violin'])

beforeEach(async () => {
  db = openTestDb()
  listId = await createList(db, 'Tuesday jam')
  for (const title of titles) {
    const { userSongId } = await createSong(db, { title }, { status: 'known' })
    await addToList(db, listId, userSongId)
  }
})

const originalMatchMedia = window.matchMedia
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

function Host({
  showArchived = false,
  onMoveStart = () => {},
  onError = () => {},
  onOpen = () => {},
}: {
  showArchived?: boolean
  onMoveStart?: () => void
  onError?: (message: string) => void
  onOpen?: (songId: string) => void
}) {
  const view = useListView(listId)
  if (!view) return null
  return (
    <ListSongs
      listId={listId}
      items={view.items}
      showArchived={showArchived}
      instruments={violin}
      onOpen={onOpen}
      onEdit={() => {}}
      onRemove={() => {}}
      onMoveStart={onMoveStart}
      onError={onError}
    />
  )
}

const shownTitles = () =>
  Array.from(document.querySelectorAll('ion-reorder-group h2')).map((h) => h.textContent)

const storedTitles = async () => {
  const items = (await db.list_items.where('list_id').equals(listId).toArray())
    .filter((i) => !i.deleted_at)
    .sort((a, b) => a.position - b.position)
  const userSongs = await db.user_songs.bulkGet(items.map((i) => i.user_song_id))
  const songs = await db.songs.bulkGet(userSongs.map((u) => u!.song_id))
  return songs.map((s) => s!.title)
}

const openMoveMenu = async (title: string) =>
  page.getByRole('button', { name: `Reorder ${title}` }).click()

/** A promise and the function that settles it, for holding a move in flight. */
function heldWrite() {
  let settle: { resolve: () => void; reject: (error: Error) => void }
  const promise = new Promise<void>((resolve, reject) => {
    settle = { resolve, reject }
  })
  return { promise, ...settle! }
}

const frame = () => new Promise((resolve) => requestAnimationFrame(resolve))

/** Long enough for any further read or render to land, so a settled order can be shown to hold. */
const rest = () => new Promise((resolve) => setTimeout(resolve, 100))

/** A reorder arriving from somewhere else, the way a sync writes one. */
async function storeOrder(order: string[]) {
  const lists = await import('../../commands/lists')
  const items = await lists.activeItems(db, listId)
  const userSongs = await db.user_songs.bulkGet(items.map((item) => item.user_song_id))
  const songs = await db.songs.bulkGet(userSongs.map((userSong) => userSong!.song_id))
  const byTitle = new Map(items.map((item, index) => [songs[index]!.title, item]))
  await lists.writeOrder(
    db,
    order.map((title) => byTitle.get(title)!),
  )
}

/**
 * Ionic's reorder gesture listens for mouse and touch events, not pointer events, and its
 * threshold is zero, so the press itself starts the drag and each move step needs a frame
 * for the gesture's own rAF to run.
 */
async function dragRow(from: number, to: number) {
  await vi.waitFor(() =>
    expect(document.querySelector('ion-reorder-group')?.className).toContain('reorder-enabled'),
  )
  await frame()
  const handles = document.querySelectorAll<HTMLElement>('ion-reorder-group ion-reorder')
  const start = handles[from]!.getBoundingClientRect()
  const end = handles[to]!.getBoundingClientRect()
  const x = start.left + start.width / 2
  const startY = start.top + start.height / 2
  const endY = end.top + end.height / 2
  const at = (y: number, buttons: number) => ({
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: x,
    clientY: y,
    button: 0,
    buttons,
  })
  handles[from]!.dispatchEvent(new MouseEvent('mousedown', at(startY, 1)))
  await frame()
  for (let step = 1; step <= 10; step++) {
    document.dispatchEvent(
      new MouseEvent('mousemove', at(startY + ((endY - startY) * step) / 10, 1)),
    )
    await frame()
  }
  document.dispatchEvent(new MouseEvent('mouseup', at(endY, 0)))
  await frame()
}

describe('ListSongs', () => {
  it('numbers rows from 1 in stored order inside one list', async () => {
    renderIonic(<Host />, { db })
    await expect.element(page.getByRole('heading', { name: 'Forked Deer' })).toBeVisible()
    expect(shownTitles()).toEqual(titles)
    const numbers = Array.from(document.querySelectorAll('[data-position]')).map(
      (n) => n.textContent,
    )
    expect(numbers).toEqual(['1', '2', '3', '4'])
    expect(document.querySelector('ion-list > ion-reorder-group')).not.toBeNull()
  })

  it('moves a song down from its move menu, stores it, and announces it', async () => {
    renderIonic(<Host />, { db })
    await openMoveMenu("Soldier's Joy")
    await page.getByText('Move down', { exact: true }).click()
    await vi.waitFor(async () =>
      expect(await storedTitles()).toEqual([
        'Angeline the Baker',
        'Cluck Old Hen',
        "Soldier's Joy",
        'Forked Deer',
      ]),
    )
    expect(shownTitles()).toEqual([
      'Angeline the Baker',
      'Cluck Old Hen',
      "Soldier's Joy",
      'Forked Deer',
    ])
    await expect
      .element(page.getByRole('status'))
      .toHaveTextContent("Moved Soldier's Joy to position 3 of 4")
  })

  it('moves to the top and bottom and leaves out moves that go nowhere', async () => {
    renderIonic(<Host />, { db })
    await openMoveMenu('Angeline the Baker')
    await expect.element(page.getByText('Move down', { exact: true })).toBeVisible()
    expect(page.getByText('Move up', { exact: true }).elements()).toHaveLength(0)
    expect(page.getByText('Move to top', { exact: true }).elements()).toHaveLength(0)
    await page.getByText('Move to bottom', { exact: true }).click()
    await vi.waitFor(async () => expect((await storedTitles()).at(-1)).toBe('Angeline the Baker'))
    await openMoveMenu('Forked Deer')
    await page.getByText('Move to top', { exact: true }).click()
    await vi.waitFor(async () => expect((await storedTitles())[0]).toBe('Forked Deer'))
  })

  it('keeps the grip at the row trailing edge, past the move button', async () => {
    renderIonic(<Host />, { db })
    await vi.waitFor(() => expect(shownTitles()).toEqual(titles))
    const trailing = document.querySelector('ion-reorder-group .row-trailing')!
    expect(trailing.lastElementChild?.tagName).toBe('ION-REORDER')
    const grip = trailing.querySelector('ion-reorder')!.getBoundingClientRect()
    const button = page
      .getByRole('button', { name: 'Reorder Angeline the Baker' })
      .element()
      .getBoundingClientRect()
    expect(grip.left).toBeGreaterThanOrEqual(button.right)
  })

  it('leaves out the move button when a list holds one song', async () => {
    for (const item of await db.list_items.where('list_id').equals(listId).toArray()) {
      const userSong = await db.user_songs.get(item.user_song_id)
      const song = await db.songs.get(userSong!.song_id)
      if (song!.title !== "Soldier's Joy") await setArchived(db, userSong!.id, true)
    }
    renderIonic(<Host />, { db })
    await vi.waitFor(() => expect(shownTitles()).toEqual(["Soldier's Joy"]))
    expect(page.getByRole('button', { name: "Reorder Soldier's Joy" }).elements()).toHaveLength(0)
    expect(document.querySelectorAll('ion-reorder-group ion-reorder')).toHaveLength(0)
  })

  it("keeps focus on the moved song's move button after a menu move", async () => {
    renderIonic(<Host />, { db })
    await openMoveMenu("Soldier's Joy")
    await page.getByText('Move down', { exact: true }).click()
    await vi.waitFor(async () => expect((await storedTitles())[2]).toBe("Soldier's Joy"))
    await settleOverlays()
    const button = page.getByRole('button', { name: "Reorder Soldier's Joy" }).element()
    expect(document.activeElement).toBe(button)
  })

  it('hides archived songs, numbers only visible rows, and moves past a hidden song', async () => {
    const hen = (await db.songs.toArray()).find((s) => s.title === 'Cluck Old Hen')!
    const henUser = (await db.user_songs.toArray()).find((u) => u.song_id === hen.id)!
    await setArchived(db, henUser.id, true)
    renderIonic(<Host />, { db })
    await vi.waitFor(() =>
      expect(shownTitles()).toEqual(['Angeline the Baker', "Soldier's Joy", 'Forked Deer']),
    )
    const numbers = Array.from(document.querySelectorAll('[data-position]')).map(
      (n) => n.textContent,
    )
    expect(numbers).toEqual(['1', '2', '3'])
    await openMoveMenu("Soldier's Joy")
    await page.getByText('Move down', { exact: true }).click()
    await vi.waitFor(async () =>
      expect(await storedTitles()).toEqual([
        'Angeline the Baker',
        'Cluck Old Hen',
        'Forked Deer',
        "Soldier's Joy",
      ]),
    )
  })

  it('reorders by dragging the grip', async () => {
    renderIonic(<Host />, { db })
    await expect.element(page.getByRole('heading', { name: 'Forked Deer' })).toBeVisible()
    await dragRow(0, 2)
    await vi.waitFor(async () =>
      expect(await storedTitles()).toEqual([
        "Soldier's Joy",
        'Cluck Old Hen',
        'Angeline the Baker',
        'Forked Deer',
      ]),
    )
    expect(shownTitles()).toEqual([
      "Soldier's Joy",
      'Cluck Old Hen',
      'Angeline the Baker',
      'Forked Deer',
    ])
    await expect
      .element(page.getByRole('status'))
      .toHaveTextContent('Moved Angeline the Baker to position 3 of 4')
  })

  it('shows a move at once while it saves, then reports a failure and takes it back', async () => {
    const onError = vi.fn()
    const held = heldWrite()
    const lists = await import('../../commands/lists')
    vi.spyOn(lists, 'moveItem').mockReturnValueOnce(held.promise)
    renderIonic(<Host onError={onError} />, { db })
    await openMoveMenu("Soldier's Joy")
    await page.getByText('Move up', { exact: true }).click()
    await vi.waitFor(() =>
      expect(shownTitles()).toEqual([
        "Soldier's Joy",
        'Angeline the Baker',
        'Cluck Old Hen',
        'Forked Deer',
      ]),
    )
    expect(onError).not.toHaveBeenCalled()
    await expect
      .element(page.getByRole('status'))
      .toHaveTextContent("Moved Soldier's Joy to position 1 of 4")
    held.reject(new Error('The order could not be saved.'))
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith('The order could not be saved.'))
    await vi.waitFor(() => expect(shownTitles()).toEqual(titles))
    // The song is back where it started, so the live region must not still claim it moved.
    expect(page.getByRole('status').element().textContent).toBe('')
  })

  it('keeps a later move when an earlier one fails, showing what the store holds', async () => {
    const onError = vi.fn()
    const held = heldWrite()
    const lists = await import('../../commands/lists')
    vi.spyOn(lists, 'moveItem').mockReturnValueOnce(held.promise)
    renderIonic(<Host onError={onError} />, { db })
    await openMoveMenu('Angeline the Baker')
    await page.getByText('Move to bottom', { exact: true }).click()
    await vi.waitFor(() =>
      expect(shownTitles()).toEqual([
        "Soldier's Joy",
        'Cluck Old Hen',
        'Forked Deer',
        'Angeline the Baker',
      ]),
    )
    await openMoveMenu('Forked Deer')
    await page.getByText('Move to top', { exact: true }).click()
    await vi.waitFor(() =>
      expect(shownTitles()).toEqual([
        'Forked Deer',
        "Soldier's Joy",
        'Cluck Old Hen',
        'Angeline the Baker',
      ]),
    )
    held.reject(new Error('The order could not be saved.'))
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith('The order could not be saved.'))
    const settled = ['Angeline the Baker', 'Forked Deer', "Soldier's Joy", 'Cluck Old Hen']
    await vi.waitFor(async () => expect(await storedTitles()).toEqual(settled))
    // The shown order already matches the store, so no read can make the list jump.
    expect(shownTitles()).toEqual(settled)
  })

  it('keeps a song added while a move is in flight', async () => {
    const held = heldWrite()
    const lists = await import('../../commands/lists')
    vi.spyOn(lists, 'moveItem').mockReturnValueOnce(held.promise)
    renderIonic(<Host />, { db })
    await openMoveMenu("Soldier's Joy")
    await page.getByText('Move to bottom', { exact: true }).click()
    await vi.waitFor(() =>
      expect(shownTitles()).toEqual([
        'Angeline the Baker',
        'Cluck Old Hen',
        'Forked Deer',
        "Soldier's Joy",
      ]),
    )
    const { userSongId } = await createSong(
      db,
      { title: 'Whiskey Before Breakfast' },
      { status: 'known' },
    )
    await addToList(db, listId, userSongId)
    await vi.waitFor(() =>
      expect(shownTitles()).toEqual([
        'Angeline the Baker',
        'Cluck Old Hen',
        'Forked Deer',
        "Soldier's Joy",
        'Whiskey Before Breakfast',
      ]),
    )
    held.resolve()
  })

  it('settles on the stored order when a failed move sends the next one the other way', async () => {
    const onError = vi.fn()
    const held = heldWrite()
    const lists = await import('../../commands/lists')
    vi.spyOn(lists, 'moveItem').mockReturnValueOnce(held.promise)
    renderIonic(<Host onError={onError} />, { db })
    await openMoveMenu('Angeline the Baker')
    await page.getByText('Move to bottom', { exact: true }).click()
    await vi.waitFor(() =>
      expect(shownTitles()).toEqual([
        "Soldier's Joy",
        'Cluck Old Hen',
        'Forked Deer',
        'Angeline the Baker',
      ]),
    )
    await openMoveMenu('Angeline the Baker')
    await page.getByText('Move up', { exact: true }).click()
    await vi.waitFor(() =>
      expect(shownTitles()).toEqual([
        "Soldier's Joy",
        'Cluck Old Hen',
        'Angeline the Baker',
        'Forked Deer',
      ]),
    )
    held.reject(new Error('The order could not be saved.'))
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith('The order could not be saved.'))
    const settled = ["Soldier's Joy", 'Cluck Old Hen', 'Forked Deer', 'Angeline the Baker']
    await vi.waitFor(async () => expect(await storedTitles()).toEqual(settled))
    await vi.waitFor(() => expect(shownTitles()).toEqual(settled))
    await rest()
    expect(shownTitles()).toEqual(settled)
  })

  it('shows a second move of one song the other way and settles on the stored order', async () => {
    const held = heldWrite()
    const lists = await import('../../commands/lists')
    vi.spyOn(lists, 'moveItem').mockImplementationOnce(async (...args) => {
      await held.promise
      return realMoveItem(...args)
    })
    renderIonic(<Host />, { db })
    await openMoveMenu("Soldier's Joy")
    await page.getByText('Move down', { exact: true }).click()
    await vi.waitFor(() =>
      expect(shownTitles()).toEqual([
        'Angeline the Baker',
        'Cluck Old Hen',
        "Soldier's Joy",
        'Forked Deer',
      ]),
    )
    await openMoveMenu("Soldier's Joy")
    await page.getByText('Move up', { exact: true }).click()
    // The second move shows while the first is still being written, not once it lands.
    await vi.waitFor(() => expect(shownTitles()).toEqual(titles))
    held.resolve()
    await vi.waitFor(async () => expect(await storedTitles()).toEqual(titles))
    await vi.waitFor(() => expect(shownTitles()).toEqual(titles))
    await rest()
    expect(shownTitles()).toEqual(titles)
  })

  it('drops a move when a sync reorders the same song before the write settles', async () => {
    const held = heldWrite()
    const lists = await import('../../commands/lists')
    vi.spyOn(lists, 'moveItem').mockReturnValueOnce(held.promise)
    renderIonic(<Host />, { db })
    await openMoveMenu('Angeline the Baker')
    await page.getByText('Move to bottom', { exact: true }).click()
    await vi.waitFor(() =>
      expect(shownTitles()).toEqual([
        "Soldier's Joy",
        'Cluck Old Hen',
        'Forked Deer',
        'Angeline the Baker',
      ]),
    )
    const synced = ['Cluck Old Hen', 'Angeline the Baker', "Soldier's Joy", 'Forked Deer']
    await storeOrder(synced)
    held.resolve()
    await vi.waitFor(() => expect(shownTitles()).toEqual(synced))
    await rest()
    expect(shownTitles()).toEqual(synced)
    expect(await storedTitles()).toEqual(synced)
  })

  it('retires a move whose read landed first, past a row the list view drops', async () => {
    // A list item whose song rows have not arrived yet: the stored order counts it, the list
    // view does not, so the two orders the retirement rule compares differ in length.
    const hen = (await db.songs.toArray()).find((s) => s.title === 'Cluck Old Hen')!
    const henUser = (await db.user_songs.toArray()).find((u) => u.song_id === hen.id)!
    await db.user_songs.update(henUser.id, { deleted_at: new Date().toISOString() })
    const held = heldWrite()
    const lists = await import('../../commands/lists')
    vi.spyOn(lists, 'moveItem').mockImplementationOnce(async (...args) => {
      await realMoveItem(...args)
      // The write's own read lands while this is held, so only the stored order can retire it.
      await held.promise
    })
    renderIonic(<Host />, { db })
    await vi.waitFor(() =>
      expect(shownTitles()).toEqual(['Angeline the Baker', "Soldier's Joy", 'Forked Deer']),
    )
    await openMoveMenu("Soldier's Joy")
    await page.getByText('Move down', { exact: true }).click()
    const settled = ['Angeline the Baker', 'Forked Deer', "Soldier's Joy"]
    await vi.waitFor(async () =>
      expect(await storedTitles()).toEqual([
        'Angeline the Baker',
        'Cluck Old Hen',
        'Forked Deer',
        "Soldier's Joy",
      ]),
    )
    // Let the write's own read land before the write settles, so the items identity cannot
    // retire the move and only the stored order can. Nothing holds a write open like this in
    // the app, where a move settles the moment it commits.
    const before = ['Angeline the Baker', "Soldier's Joy", 'Forked Deer'].join(' | ')
    const seen = new Set<string>()
    const watch = setInterval(() => seen.add(shownTitles().join(' | ')), 5)
    await rest()
    clearInterval(watch)
    // The replay runs again on the order the write already stored, so it must not undo itself
    // and show the song where it was before the move.
    expect([...seen]).not.toContain(before)
    expect(shownTitles()).toEqual(settled)
    held.resolve()
    await vi.waitFor(() => expect(shownTitles()).toEqual(settled))
    await rest()
    expect(shownTitles()).toEqual(settled)
  })

  it('sends a menu move where the rows now are, not where they were when it opened', async () => {
    renderIonic(<Host />, { db })
    await openMoveMenu('Cluck Old Hen')
    await expect.element(page.getByText('Move down', { exact: true })).toBeVisible()
    const { userSongId } = await createSong(
      db,
      { title: 'Whiskey Before Breakfast' },
      { status: 'known' },
    )
    await addToList(db, listId, userSongId)
    await vi.waitFor(() => expect(shownTitles()).toHaveLength(5))
    await page.getByText('Move down', { exact: true }).click()
    await expect
      .element(page.getByRole('status'))
      .toHaveTextContent('Moved Cluck Old Hen to position 4 of 5')
  })
})

describe('ListSongs on touch', () => {
  it('opens the move menu as an action sheet', async () => {
    forceTouch()
    renderIonic(<Host />, { db })
    await expect.element(page.getByRole('heading', { name: 'Forked Deer' })).toBeVisible()
    expect(document.querySelectorAll('ion-reorder-group > ion-item-sliding')).toHaveLength(4)
    await openMoveMenu("Soldier's Joy")
    await vi.waitFor(() =>
      expect(document.querySelector('.action-sheet-title')?.textContent).toBe("Move Soldier's Joy"),
    )
    await page.getByText('Move down', { exact: true }).click()
    await vi.waitFor(async () => expect((await storedTitles())[2]).toBe("Soldier's Joy"))
    await settleOverlays()
    expect(document.activeElement).toBe(
      page.getByRole('button', { name: "Reorder Soldier's Joy" }).element(),
    )
  })

  it('does not open the song when the grip is tapped', async () => {
    forceTouch()
    const onOpen = vi.fn()
    renderIonic(<Host onOpen={onOpen} />, { db })
    await expect.element(page.getByRole('heading', { name: 'Forked Deer' })).toBeVisible()
    await vi.waitFor(() =>
      expect(document.querySelector('ion-reorder-group')?.className).toContain('reorder-enabled'),
    )
    const grip = document.querySelectorAll<HTMLElement>('ion-reorder-group ion-reorder')[1]!
    grip.click()
    await frame()
    expect(onOpen).not.toHaveBeenCalled()
    expect(shownTitles()).toEqual(titles)
  })

  it('does not open the song when the move button is tapped', async () => {
    forceTouch()
    const onOpen = vi.fn()
    renderIonic(<Host onOpen={onOpen} />, { db })
    await openMoveMenu("Soldier's Joy")
    await vi.waitFor(() =>
      expect(document.querySelector('.action-sheet-title')?.textContent).toBe("Move Soldier's Joy"),
    )
    expect(onOpen).not.toHaveBeenCalled()
  })
})
