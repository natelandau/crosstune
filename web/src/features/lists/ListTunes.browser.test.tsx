import { beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import type { Instrument } from '../../api/vocabulary'
import { addToList, createList } from '../../commands/lists'
import type * as ListsModule from '../../commands/lists'
import { createTune, setArchived } from '../../commands/tunes'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { renderIonic } from '../../test/ionic'
import { settleOverlays } from '../../test/overlays'
import { forceTouch } from '../../test/pointer'
import { fakeEngine, fakePlayer } from '../../test/providers'
import { dragRow } from '../../test/reorder'
import { linkRow, notationPageRow, recordingFile, recordingRow } from '../../test/rows'
import { closeLinkName } from '../links/linkNames'
import { NOTATION } from '../notation/notationCopy'
import type { Player } from '../player/usePlayer'
import { closeRecordingName, downloadName, playName } from '../recordings/recordingNames'
import { NOT_PLAYABLE } from './ListRowPlay'
import { ListTunes } from './ListTunes'
import { MOVE_DOWN, MOVE_TO_BOTTOM, MOVE_TO_TOP, MOVE_UP } from './moveMenu'
import type { ListSelectionHost } from './useListSelection'
import { useListView } from './useLists'

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
    const { userTuneId } = await createTune(db, { title }, { status: 'known' })
    await addToList(db, listId, userTuneId)
  }
})

function Host({
  showArchived = false,
  onMoveStart = () => {},
  onError = () => {},
  onOpen = () => {},
  selection,
}: {
  selection?: ListSelectionHost
  showArchived?: boolean
  onMoveStart?: () => void
  onError?: (message: string) => void
  onOpen?: (tuneId: string) => void
}) {
  const view = useListView(listId)
  if (!view) return null
  return (
    <ListTunes
      listId={listId}
      items={view.items}
      showArchived={showArchived}
      instruments={violin}
      selection={selection}
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

const shownNumbers = () =>
  Array.from(document.querySelectorAll('[data-position]')).map((n) => n.textContent)

const storedTitles = async () => {
  const items = (await db.list_items.where('list_id').equals(listId).toArray())
    .filter((i) => !i.deleted_at)
    .sort((a, b) => a.position - b.position)
  const userTunes = await db.user_tunes.bulkGet(items.map((i) => i.user_tune_id))
  const tunes = await db.tunes.bulkGet(userTunes.map((u) => u!.tune_id))
  return tunes.map((s) => s!.title)
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
  const userTunes = await db.user_tunes.bulkGet(items.map((item) => item.user_tune_id))
  const tunes = await db.tunes.bulkGet(userTunes.map((userTune) => userTune!.tune_id))
  const byTitle = new Map(items.map((item, index) => [tunes[index]!.title, item]))
  await lists.writeOrder(
    db,
    order.map((title) => byTitle.get(title)!),
  )
}

describe('ListTunes', () => {
  it('numbers rows from 1 in stored order inside one list', async () => {
    renderIonic(<Host />, { db })
    await expect.element(page.getByRole('heading', { name: 'Forked Deer' })).toBeVisible()
    await expect.poll(shownTitles).toEqual(titles)
    await expect.poll(shownNumbers).toEqual(['1', '2', '3', '4'])
    await expect.poll(() => document.querySelector('ion-list > ion-reorder-group')).not.toBeNull()
  })

  it('offers Notation on a tune only while it has a live page', async () => {
    const tune = (await db.tunes.toArray()).find((row) => row.title === 'Cluck Old Hen')!
    await db.notation_pages.put(notationPageRow('p1', tune.id))
    renderIonic(<Host />, { db })
    const notation = page.getByRole('button', { name: `${NOTATION} Cluck Old Hen` })
    await expect.element(notation).toBeInTheDocument()
    await db.notation_pages.update('p1', { deleted_at: '2026-01-02T00:00:00.000Z' })
    await expect.element(notation).not.toBeInTheDocument()
  })

  it('moves a tune down from its move menu, stores it, and announces it', async () => {
    renderIonic(<Host />, { db })
    await openMoveMenu("Soldier's Joy")
    await page.getByText(MOVE_DOWN, { exact: true }).click()
    await vi.waitFor(async () =>
      expect(await storedTitles()).toEqual([
        'Angeline the Baker',
        'Cluck Old Hen',
        "Soldier's Joy",
        'Forked Deer',
      ]),
    )
    await expect
      .poll(shownTitles)
      .toEqual(['Angeline the Baker', 'Cluck Old Hen', "Soldier's Joy", 'Forked Deer'])
    await expect
      .element(page.getByRole('status'))
      .toHaveTextContent("Moved Soldier's Joy to position 3 of 4")
  })

  it('moves to the top and bottom and leaves out moves that go nowhere', async () => {
    renderIonic(<Host />, { db })
    await openMoveMenu('Angeline the Baker')
    await expect.element(page.getByText(MOVE_DOWN, { exact: true })).toBeVisible()
    await expect.element(page.getByText(MOVE_UP, { exact: true })).not.toBeInTheDocument()
    await expect.element(page.getByText(MOVE_TO_TOP, { exact: true })).not.toBeInTheDocument()
    await page.getByText(MOVE_TO_BOTTOM, { exact: true }).click()
    await vi.waitFor(async () => expect((await storedTitles()).at(-1)).toBe('Angeline the Baker'))
    await openMoveMenu('Forked Deer')
    await page.getByText(MOVE_TO_TOP, { exact: true }).click()
    await vi.waitFor(async () => expect((await storedTitles())[0]).toBe('Forked Deer'))
  })

  it('keeps the grip at the row trailing edge, past the move button', async () => {
    renderIonic(<Host />, { db })
    await vi.waitFor(() => expect(shownTitles()).toEqual(titles))
    const trailing = () => document.querySelector('ion-reorder-group .row-trailing')!
    await expect.poll(() => trailing().lastElementChild?.tagName).toBe('ION-REORDER')
    const grip = () => trailing().querySelector('ion-reorder')!.getBoundingClientRect()
    const button = () =>
      page
        .getByRole('button', { name: 'Reorder Angeline the Baker' })
        .element()
        .getBoundingClientRect()
    await expect.poll(() => grip().left - button().right).toBeGreaterThanOrEqual(0)
  })

  it('leaves out the move button when a list holds one tune', async () => {
    for (const item of await db.list_items.where('list_id').equals(listId).toArray()) {
      const userTune = await db.user_tunes.get(item.user_tune_id)
      const tune = await db.tunes.get(userTune!.tune_id)
      if (tune!.title !== "Soldier's Joy") await setArchived(db, userTune!.id, true)
    }
    renderIonic(<Host />, { db })
    await vi.waitFor(() => expect(shownTitles()).toEqual(["Soldier's Joy"]))
    await expect
      .element(page.getByRole('button', { name: "Reorder Soldier's Joy" }))
      .not.toBeInTheDocument()
    await expect
      .poll(() => document.querySelectorAll('ion-reorder-group ion-reorder'))
      .toHaveLength(0)
  })

  it("keeps focus on the moved tune's move button after a menu move", async () => {
    renderIonic(<Host />, { db })
    await openMoveMenu("Soldier's Joy")
    await page.getByText(MOVE_DOWN, { exact: true }).click()
    await vi.waitFor(async () => expect((await storedTitles())[2]).toBe("Soldier's Joy"))
    await settleOverlays()
    await expect
      .poll(() => document.activeElement)
      .toBe(page.getByRole('button', { name: "Reorder Soldier's Joy" }).element())
  })

  it('hides archived tunes, numbers only visible rows, and moves past a hidden tune', async () => {
    const hen = (await db.tunes.toArray()).find((s) => s.title === 'Cluck Old Hen')!
    const henUser = (await db.user_tunes.toArray()).find((u) => u.tune_id === hen.id)!
    await setArchived(db, henUser.id, true)
    renderIonic(<Host />, { db })
    await vi.waitFor(() =>
      expect(shownTitles()).toEqual(['Angeline the Baker', "Soldier's Joy", 'Forked Deer']),
    )
    await expect.poll(shownNumbers).toEqual(['1', '2', '3'])
    await openMoveMenu("Soldier's Joy")
    await page.getByText(MOVE_DOWN, { exact: true }).click()
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
    await expect
      .poll(shownTitles)
      .toEqual(["Soldier's Joy", 'Cluck Old Hen', 'Angeline the Baker', 'Forked Deer'])
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
    await page.getByText(MOVE_UP, { exact: true }).click()
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
    // The tune is back where it started, so the live region must not still claim it moved.
    await expect.poll(() => page.getByRole('status').element().textContent).toBe('')
  })

  it('keeps a later move when an earlier one fails, showing what the store holds', async () => {
    const onError = vi.fn()
    const held = heldWrite()
    const lists = await import('../../commands/lists')
    vi.spyOn(lists, 'moveItem').mockReturnValueOnce(held.promise)
    renderIonic(<Host onError={onError} />, { db })
    await openMoveMenu('Angeline the Baker')
    await page.getByText(MOVE_TO_BOTTOM, { exact: true }).click()
    await vi.waitFor(() =>
      expect(shownTitles()).toEqual([
        "Soldier's Joy",
        'Cluck Old Hen',
        'Forked Deer',
        'Angeline the Baker',
      ]),
    )
    await openMoveMenu('Forked Deer')
    await page.getByText(MOVE_TO_TOP, { exact: true }).click()
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
    await expect.poll(shownTitles).toEqual(settled)
  })

  it('keeps a tune added while a move is in flight', async () => {
    const held = heldWrite()
    const lists = await import('../../commands/lists')
    vi.spyOn(lists, 'moveItem').mockReturnValueOnce(held.promise)
    renderIonic(<Host />, { db })
    await openMoveMenu("Soldier's Joy")
    await page.getByText(MOVE_TO_BOTTOM, { exact: true }).click()
    await vi.waitFor(() =>
      expect(shownTitles()).toEqual([
        'Angeline the Baker',
        'Cluck Old Hen',
        'Forked Deer',
        "Soldier's Joy",
      ]),
    )
    const { userTuneId } = await createTune(
      db,
      { title: 'Whiskey Before Breakfast' },
      { status: 'known' },
    )
    await addToList(db, listId, userTuneId)
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
    await page.getByText(MOVE_TO_BOTTOM, { exact: true }).click()
    await vi.waitFor(() =>
      expect(shownTitles()).toEqual([
        "Soldier's Joy",
        'Cluck Old Hen',
        'Forked Deer',
        'Angeline the Baker',
      ]),
    )
    await openMoveMenu('Angeline the Baker')
    await page.getByText(MOVE_UP, { exact: true }).click()
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

  it('shows a second move of one tune the other way and settles on the stored order', async () => {
    const held = heldWrite()
    const lists = await import('../../commands/lists')
    vi.spyOn(lists, 'moveItem').mockImplementationOnce(async (...args) => {
      await held.promise
      return realMoveItem(...args)
    })
    renderIonic(<Host />, { db })
    await openMoveMenu("Soldier's Joy")
    await page.getByText(MOVE_DOWN, { exact: true }).click()
    await vi.waitFor(() =>
      expect(shownTitles()).toEqual([
        'Angeline the Baker',
        'Cluck Old Hen',
        "Soldier's Joy",
        'Forked Deer',
      ]),
    )
    await openMoveMenu("Soldier's Joy")
    await page.getByText(MOVE_UP, { exact: true }).click()
    // The second move shows while the first is still being written, not once it lands.
    await vi.waitFor(() => expect(shownTitles()).toEqual(titles))
    held.resolve()
    await vi.waitFor(async () => expect(await storedTitles()).toEqual(titles))
    await vi.waitFor(() => expect(shownTitles()).toEqual(titles))
    await rest()
    expect(shownTitles()).toEqual(titles)
  })

  it('drops a move when a sync reorders the same tune before the write settles', async () => {
    const held = heldWrite()
    const lists = await import('../../commands/lists')
    vi.spyOn(lists, 'moveItem').mockReturnValueOnce(held.promise)
    renderIonic(<Host />, { db })
    await openMoveMenu('Angeline the Baker')
    await page.getByText(MOVE_TO_BOTTOM, { exact: true }).click()
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
    // A list item whose tune rows have not arrived yet: the stored order counts it, the list
    // view does not, so the two orders the retirement rule compares differ in length.
    const hen = (await db.tunes.toArray()).find((s) => s.title === 'Cluck Old Hen')!
    const henUser = (await db.user_tunes.toArray()).find((u) => u.tune_id === hen.id)!
    await db.user_tunes.update(henUser.id, { deleted_at: new Date().toISOString() })
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
    await page.getByText(MOVE_DOWN, { exact: true }).click()
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
    // and show the tune where it was before the move.
    expect([...seen]).not.toContain(before)
    await expect.poll(shownTitles).toEqual(settled)
    held.resolve()
    await vi.waitFor(() => expect(shownTitles()).toEqual(settled))
    await rest()
    expect(shownTitles()).toEqual(settled)
  })

  it('sends a menu move where the rows now are, not where they were when it opened', async () => {
    renderIonic(<Host />, { db })
    await openMoveMenu('Cluck Old Hen')
    await expect.element(page.getByText(MOVE_DOWN, { exact: true })).toBeVisible()
    const { userTuneId } = await createTune(
      db,
      { title: 'Whiskey Before Breakfast' },
      { status: 'known' },
    )
    await addToList(db, listId, userTuneId)
    await vi.waitFor(() => expect(shownTitles()).toHaveLength(5))
    await page.getByText(MOVE_DOWN, { exact: true }).click()
    await expect
      .element(page.getByRole('status'))
      .toHaveTextContent('Moved Cluck Old Hen to position 4 of 5')
  })
})

describe('ListTunes on touch', () => {
  it('opens the move menu as an action sheet', async () => {
    forceTouch()
    renderIonic(<Host />, { db })
    await expect.element(page.getByRole('heading', { name: 'Forked Deer' })).toBeVisible()
    await expect
      .poll(() => document.querySelectorAll('ion-reorder-group > ion-item-sliding'))
      .toHaveLength(4)
    await openMoveMenu("Soldier's Joy")
    await vi.waitFor(() =>
      expect(document.querySelector('.action-sheet-title')?.textContent).toBe("Move Soldier's Joy"),
    )
    await page.getByText(MOVE_DOWN, { exact: true }).click()
    await vi.waitFor(async () => expect((await storedTitles())[2]).toBe("Soldier's Joy"))
    await settleOverlays()
    await expect
      .poll(() => document.activeElement)
      .toBe(page.getByRole('button', { name: "Reorder Soldier's Joy" }).element())
  })

  it('does not open the tune when the grip is tapped', async () => {
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

  it('does not open the tune when the move button is tapped', async () => {
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

describe('ListTunes row play', () => {
  const SPEAR = 'The Silver Spear'
  const YOUTUBE = {
    url: 'https://youtu.be/dQw4w9WgXcQ',
    provider: 'youtube',
    provider_ref: 'dQw4w9WgXcQ',
    title: 'Jam session',
  } as const

  async function addSpear() {
    const { tuneId, userTuneId } = await createTune(db, { title: SPEAR }, { status: 'known' })
    await addToList(db, listId, userTuneId)
    return { tuneId, userTuneId }
  }

  const addRecording = async (tuneId: string, held: boolean) => {
    await db.recordings.put(recordingRow('rec1', { tune_id: tuneId }))
    await db.recording_files.put(
      recordingFile('rec1', held ? { blob: new Blob(['x'], { type: 'audio/mp4' }) } : {}),
    )
  }

  const addLink = (tuneId: string) => db.recording_links.put(linkRow('link1', tuneId, YOUTUBE))

  const show = (player: Player, engine = fakeEngine()) =>
    renderIonic(<Host />, { db, player, engine })

  const spearRow = () =>
    Array.from(document.querySelectorAll('ion-reorder-group ion-item')).find(
      (item) => item.querySelector('h2')?.textContent === SPEAR,
    )

  it("plays a row's pinned link", async () => {
    const { tuneId, userTuneId } = await addSpear()
    await addRecording(tuneId, true)
    await addLink(tuneId)
    await db.user_tunes.update(userTuneId, { play_link_id: 'link1' })
    const player = fakePlayer()
    show(player)
    await page.getByRole('button', { name: playName(SPEAR) }).click()
    await expect.poll(() => player.play).toHaveBeenCalledWith({ kind: 'link', id: 'link1' })
  })

  it('plays the first recording when nothing is pinned', async () => {
    const { tuneId } = await addSpear()
    await addRecording(tuneId, true)
    await addLink(tuneId)
    const player = fakePlayer()
    show(player)
    await page.getByRole('button', { name: playName(SPEAR) }).click()
    await expect.poll(() => player.play).toHaveBeenCalledWith({ kind: 'recording', id: 'rec1' })
  })

  it('shows stop for a loaded recording', async () => {
    const { tuneId } = await addSpear()
    await addRecording(tuneId, true)
    const player = fakePlayer({ item: { kind: 'recording', id: 'rec1' } })
    show(player)
    await page.getByRole('button', { name: closeRecordingName(SPEAR) }).click()
    await expect.poll(() => player.close).toHaveBeenCalled()
  })

  it('shows stop for a loaded link, named as the tune screen names it', async () => {
    const { tuneId, userTuneId } = await addSpear()
    await addLink(tuneId)
    await db.user_tunes.update(userTuneId, { play_link_id: 'link1' })
    const player = fakePlayer({ item: { kind: 'link', id: 'link1' } })
    show(player)
    await page.getByRole('button', { name: closeLinkName('Jam session'), exact: true }).click()
    await expect.poll(() => player.close).toHaveBeenCalled()
  })

  it('marks a tune with nothing to play', async () => {
    await addSpear()
    show(fakePlayer())
    await expect.poll(() => spearRow()?.getAttribute('aria-description')).toBe(NOT_PLAYABLE)
    expect(page.getByRole('button', { name: playName(SPEAR) }).elements()).toHaveLength(0)
  })

  it('offers download for an undownloaded recording', async () => {
    const { tuneId } = await addSpear()
    await addRecording(tuneId, false)
    const download = vi.fn(async () => null)
    show(fakePlayer(), fakeEngine({ download }))
    await page.getByRole('button', { name: downloadName(SPEAR) }).click()
    await expect.poll(() => download).toHaveBeenCalledWith('rec1')
  })

  it('hides the play slot while selecting', async () => {
    forceTouch()
    const { tuneId } = await addSpear()
    await addRecording(tuneId, true)
    renderIonic(
      <Host selection={{ listName: 'Tuesday jam', enabled: true, onChange: () => {} }} />,
      { db, player: fakePlayer() },
    )
    const play = page.getByRole('button', { name: playName(SPEAR) })
    await expect.element(play).toBeVisible()
    spearRow()!.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        isPrimary: true,
        button: 0,
        clientX: 20,
        clientY: 20,
      }),
    )
    await expect.element(page.getByRole('checkbox').first()).toBeVisible()
    await expect.poll(() => play.elements()).toHaveLength(0)
  })
})
