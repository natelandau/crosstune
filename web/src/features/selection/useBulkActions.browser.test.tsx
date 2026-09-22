import { IonButton } from '@ionic/react'
import { screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import type { Instrument } from '../../api/vocabulary'
import * as bulk from '../../commands/bulk'
import { activeItems, addToList, createList } from '../../commands/lists'
import { createSong, setArchived, type SongInput, type UserSongInput } from '../../commands/songs'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { renderIonic } from '../../test/ionic'
import { recordingFile, recordingRow } from '../../test/rows'
import { InlineError } from '../../ui/InlineError'
import { MORE_ACTIONS, useMenu } from '../../ui/Menu'
import type { CatalogEntry } from '../catalog/filters'
import { ADD_TO_LIST, NEW_LIST_ITEM, NEW_LIST_NAME_LABEL } from '../lists/ListPicker'
import { useBulkActions, type SelectionContext } from './useBulkActions'

vi.mock('../../commands/bulk', { spy: true })

const violin = new Set<Instrument>(['violin'])
const CATALOG: SelectionContext = { kind: 'catalog' }

let db: CrosstuneDb
const onExit = vi.fn()

beforeEach(() => {
  db = openTestDb()
})

afterEach(async () => {
  await db.delete()
})

async function seed(song: SongInput, userSong: Partial<UserSongInput> = {}): Promise<CatalogEntry> {
  const { songId, userSongId } = await createSong(db, song, {
    status: 'want_to_learn',
    ...userSong,
  })
  return {
    song: (await db.songs.get(songId))!,
    userSong: (await db.user_songs.get(userSongId))!,
  }
}

async function archive(entry: CatalogEntry): Promise<CatalogEntry> {
  await setArchived(db, entry.userSong.id, true)
  return { ...entry, userSong: (await db.user_songs.get(entry.userSong.id))! }
}

function Host({
  entries,
  context = CATALOG,
}: {
  entries: readonly CatalogEntry[]
  context?: SelectionContext
}) {
  const { actions, more, error, sheets } = useBulkActions({
    entries,
    instruments: violin,
    context,
    onExit,
  })
  const openMenu = useMenu()
  return (
    <>
      {actions.map((action) => (
        <IonButton key={action.label} onClick={action.onPress}>
          {action.label}
        </IonButton>
      ))}
      <IonButton onClick={(event) => openMenu(event, MORE_ACTIONS, [...more])}>More</IonButton>
      <p
        className="sr-only"
        data-probe
        data-actions={actions.map((action) => action.label).join('|')}
        data-more={more.map((item) => item.label).join('|')}
      />
      {error ? <InlineError>{error}</InlineError> : null}
      {sheets}
    </>
  )
}

const show = (entries: readonly CatalogEntry[], context?: SelectionContext) =>
  renderIonic(<Host entries={entries} context={context} />, { db })

const probe = () => document.querySelector('[data-probe]')!

/** Ionic ignores a present that lands while the previous overlay is still dismissing. */
const noMenu = () => vi.waitFor(() => expect(document.querySelector('ion-popover')).toBeNull())

/** Presses one of the host's own controls, once no menu is in the way. */
async function tap(label: string) {
  await noMenu()
  await userEvent.click(await screen.findByText(label))
}

/** Chooses an item in the open menu. */
async function pick(label: string) {
  await userEvent.click(await screen.findByText(label))
}

const save = () => page.getByRole('button', { name: 'Save', exact: true }).click()

/** Waits out a sheet's dismiss animation, which outlives the write that started it. */
const sheetsClosed = () =>
  vi.waitFor(() => expect(document.querySelector('ion-modal:not(.overlay-hidden)')).toBeNull())

const toasts = () => document.querySelectorAll('ion-toast').length

/** The confirmation opens while the menu's popover is still dismissing, so it is scoped. */
async function alertEl(): Promise<HTMLElement> {
  return vi.waitFor(() => {
    const open = document.querySelector<HTMLElement>('ion-alert:not(.overlay-hidden)')
    if (!open) throw new Error('The confirmation is not open')
    return open
  })
}

async function answer(label: string) {
  await page
    .elementLocator(await alertEl())
    .getByRole('button', { name: label, exact: true })
    .click()
}

const deleted = async (entry: CatalogEntry) => (await db.songs.get(entry.song.id))!.deleted_at

const undo = () => page.getByRole('button', { name: 'Undo' }).click()

const statusOf = async (id: string) => (await db.user_songs.get(id))!.status
const archivedAt = async (id: string) => (await db.user_songs.get(id))!.archived_at
const tuningOf = async (id: string) => (await db.songs.get(id))!.violin_tuning
const order = async (listId: string) =>
  (await activeItems(db, listId)).map((item) => item.user_song_id)

/** Opens an edit sheet row, named by its label and the value it currently reads. */
async function openRow(name: string) {
  await noMenu()
  await page
    .getByRole('listitem')
    .filter({ has: page.getByRole('button', { name, exact: true }) })
    .click()
}

/** Puts a violin tuning on every selected song through the edit sheet. */
async function editTuning() {
  await openRow('Violin tuning, Not set')
  await page.getByRole('radio', { name: 'Cross A (AEAE)', exact: true }).click()
  await save()
}

describe('useBulkActions', () => {
  it('sets the status of every selected song, ends the mode, and undoes', async () => {
    const one = await seed({ title: 'Say Old Man' }, { status: 'known' })
    const two = await seed({ title: 'Lost Indian' }, { status: 'learning' })
    show([one, two])
    await tap('Status')
    await pick('Unknown')
    await expect.element(page.getByText('Set 2 songs to Unknown')).toBeVisible()
    await vi.waitFor(async () => {
      expect(await statusOf(one.userSong.id)).toBe('want_to_learn')
      expect(await statusOf(two.userSong.id)).toBe('want_to_learn')
    })
    expect(onExit).toHaveBeenCalledOnce()

    await undo()
    await vi.waitFor(async () => {
      expect(await statusOf(one.userSong.id)).toBe('known')
      expect(await statusOf(two.userSong.id)).toBe('learning')
    })
  })

  it('keeps the selection when the status menu is dismissed and ends it when one is picked', async () => {
    const one = await seed({ title: 'Say Old Man' })
    const two = await seed({ title: 'Lost Indian' })
    show([one, two])
    await tap('Status')
    await expect.element(page.getByText('Known', { exact: true })).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await noMenu()
    expect(onExit).not.toHaveBeenCalled()
    expect(toasts()).toBe(0)
    expect(await statusOf(one.userSong.id)).toBe('want_to_learn')

    await tap('Status')
    await pick('Known')
    await expect.element(page.getByText('Set 2 songs to Known')).toBeVisible()
    expect(onExit).toHaveBeenCalledOnce()
  })

  it('writes an edit to only the selected songs and undoes', async () => {
    const one = await seed({ title: 'Say Old Man' })
    const two = await seed({ title: 'Lost Indian' })
    const unselected = await seed({ title: 'Ducks on the Millpond' })
    show([one, two])
    await tap('Edit')
    await expect.element(page.getByText('Edit 2 songs')).toBeVisible()
    await editTuning()

    await expect.element(page.getByText('Edited 2 songs')).toBeVisible()
    await vi.waitFor(async () => {
      expect(await tuningOf(one.song.id)).toBe('Cross A (AEAE)')
      expect(await tuningOf(two.song.id)).toBe('Cross A (AEAE)')
    })
    expect(await tuningOf(unselected.song.id)).toBeNull()
    expect(onExit).toHaveBeenCalledOnce()
    await sheetsClosed()

    await undo()
    await vi.waitFor(async () => {
      expect(await tuningOf(one.song.id)).toBeNull()
      expect(await tuningOf(two.song.id)).toBeNull()
    })
  })

  it('archives from More and undoes', async () => {
    const one = await seed({ title: 'Say Old Man' })
    const two = await seed({ title: 'Lost Indian' })
    show([one, two])
    await tap('More')
    await pick('Archive 2 songs')
    await expect.element(page.getByText('Archived 2 songs')).toBeVisible()
    await vi.waitFor(async () => {
      expect(await archivedAt(one.userSong.id)).not.toBeNull()
      expect(await archivedAt(two.userSong.id)).not.toBeNull()
    })
    expect(onExit).toHaveBeenCalledOnce()

    await undo()
    await vi.waitFor(async () => {
      expect(await archivedAt(one.userSong.id)).toBeNull()
      expect(await archivedAt(two.userSong.id)).toBeNull()
    })
  })

  it('offers Archive and Unarchive together for a mixed selection', async () => {
    const entries = [
      await seed({ title: 'Say Old Man' }),
      await archive(await seed({ title: 'Lost Indian' })),
      await archive(await seed({ title: 'Ducks on the Millpond' })),
    ]
    show(entries)
    expect(probe().getAttribute('data-more')).toBe(
      'Archive 1 song|Unarchive 2 songs|Delete 3 songs',
    )
    await tap('More')
    await expect.element(page.getByText('Archive 1 song', { exact: true })).toBeVisible()
    await expect.element(page.getByText('Unarchive 2 songs', { exact: true })).toBeVisible()
  })

  it('unarchives from More and undoes', async () => {
    const one = await archive(await seed({ title: 'Say Old Man' }))
    const two = await archive(await seed({ title: 'Lost Indian' }))
    show([one, two])
    await tap('More')
    await pick('Unarchive 2 songs')
    await expect.element(page.getByText('Unarchived 2 songs')).toBeVisible()
    await vi.waitFor(async () => {
      expect(await archivedAt(one.userSong.id)).toBeNull()
      expect(await archivedAt(two.userSong.id)).toBeNull()
    })
    expect(onExit).toHaveBeenCalledOnce()

    await undo()
    await vi.waitFor(async () => {
      expect(await archivedAt(one.userSong.id)).not.toBeNull()
      expect(await archivedAt(two.userSong.id)).not.toBeNull()
    })
  })

  it('omits Archive when every selected song is already archived', async () => {
    const entries = [
      await archive(await seed({ title: 'Say Old Man' })),
      await archive(await seed({ title: 'Lost Indian' })),
    ]
    show(entries)
    expect(probe().getAttribute('data-more')).toBe('Unarchive 2 songs|Delete 2 songs')
    await tap('More')
    await expect.element(page.getByText('Unarchive 2 songs', { exact: true })).toBeVisible()
    expect(page.getByText('Archive 2 songs', { exact: true }).elements()).toHaveLength(0)
  })

  it('removes from a list and undoes into the original positions', async () => {
    const first = await seed({ title: 'Say Old Man' })
    const second = await seed({ title: 'Lost Indian' })
    const third = await seed({ title: 'Ducks on the Millpond' })
    const listId = await createList(db, 'Tuesday jam')
    const itemIdByUserSong = new Map<string, string>()
    for (const entry of [first, second, third]) {
      itemIdByUserSong.set(entry.userSong.id, await addToList(db, listId, entry.userSong.id))
    }
    const context: SelectionContext = {
      kind: 'list',
      listId,
      listName: 'Tuesday jam',
      itemIdByUserSong,
    }
    const before = await order(listId)

    show([first, third], context)
    await tap('More')
    await pick('Remove 2 from list')
    await expect.element(page.getByText('Removed 2 songs from Tuesday jam')).toBeVisible()
    await vi.waitFor(async () => expect(await order(listId)).toEqual([second.userSong.id]))
    expect(onExit).toHaveBeenCalledOnce()

    await undo()
    await vi.waitFor(async () => expect(await order(listId)).toEqual(before))
  })

  it('offers no Remove item on the catalog', async () => {
    const entries = [await seed({ title: 'Say Old Man' }), await seed({ title: 'Lost Indian' })]
    show(entries)
    expect(probe().getAttribute('data-more')).toBe('Archive 2 songs|Delete 2 songs')
    await tap('More')
    await expect.element(page.getByText('Archive 2 songs', { exact: true })).toBeVisible()
    expect(page.getByText('Remove 2 from list', { exact: true }).elements()).toHaveLength(0)
  })

  it('keeps the mode and the selection and reports the error when a write fails', async () => {
    const one = await seed({ title: 'Say Old Man' })
    const two = await seed({ title: 'Lost Indian' })
    vi.mocked(bulk.updateSongs).mockRejectedValueOnce(new Error('Disk full'))
    show([one, two])
    await tap('Edit')
    await expect.element(page.getByText('Edit 2 songs')).toBeVisible()
    await editTuning()

    await expect.element(page.getByRole('alert')).toHaveTextContent('Disk full')
    expect(onExit).not.toHaveBeenCalled()
    expect(toasts()).toBe(0)
    expect(await tuningOf(one.song.id)).toBeNull()
    await expect.element(page.getByText('Edit 2 songs')).toBeVisible()

    // Saving the same edit again, now that the write lands, proves the exit was withheld
    // rather than never wired at all.
    await save()
    await expect.element(page.getByText('Edited 2 songs')).toBeVisible()
    await vi.waitFor(() => expect(onExit).toHaveBeenCalledOnce())
    await sheetsClosed()
  })

  it('adds to an existing list, counting only what it added, and undoes', async () => {
    const one = await seed({ title: 'Say Old Man' })
    const two = await seed({ title: 'Lost Indian' })
    const listId = await createList(db, 'Tuesday jam')
    await addToList(db, listId, one.userSong.id)
    show([one, two])
    await tap(ADD_TO_LIST)
    await expect.element(page.getByText('Add 2 songs to a list')).toBeVisible()
    await expect.element(page.getByText('1 of 2 in it')).toBeVisible()
    await pick('Tuesday jam')

    await expect.element(page.getByText('Added 1 song to Tuesday jam')).toBeVisible()
    await vi.waitFor(async () =>
      expect(await order(listId)).toEqual([one.userSong.id, two.userSong.id]),
    )
    expect(onExit).toHaveBeenCalledOnce()
    await sheetsClosed()

    await undo()
    await vi.waitFor(async () => expect(await order(listId)).toEqual([one.userSong.id]))
  })

  it('creates a list holding the selection and undoes', async () => {
    const one = await seed({ title: 'Say Old Man' })
    const two = await seed({ title: 'Lost Indian' })
    show([one, two])
    await tap(ADD_TO_LIST)
    await page.getByRole('button', { name: NEW_LIST_ITEM }).click()
    await page.getByLabelText(NEW_LIST_NAME_LABEL).fill('Violin club')
    await page.getByRole('button', { name: 'Create' }).click()

    await expect.element(page.getByText('Created Violin club with 2 songs')).toBeVisible()
    const listId = await vi.waitFor(async () => {
      const [list] = await db.lists.toArray()
      expect(list?.name).toBe('Violin club')
      return list!.id
    })
    expect(await order(listId)).toEqual([one.userSong.id, two.userSong.id])
    expect(onExit).toHaveBeenCalledOnce()
    await sheetsClosed()

    await undo()
    await vi.waitFor(async () => expect((await db.lists.get(listId))!.deleted_at).not.toBeNull())
    expect(await order(listId)).toEqual([])
  })

  it('keeps the picker open and the mode alive when an add fails', async () => {
    const one = await seed({ title: 'Say Old Man' })
    const two = await seed({ title: 'Lost Indian' })
    const listId = await createList(db, 'Tuesday jam')
    vi.mocked(bulk.addSongsToList).mockRejectedValueOnce(new Error('Disk full'))
    show([one, two])
    await tap(ADD_TO_LIST)
    await expect.element(page.getByText('none in it')).toBeVisible()
    await pick('Tuesday jam')

    await expect.element(page.getByRole('alert')).toHaveTextContent('Disk full')
    expect(onExit).not.toHaveBeenCalled()
    expect(toasts()).toBe(0)
    expect(await order(listId)).toEqual([])
    await expect.element(page.getByText('Add 2 songs to a list')).toBeVisible()

    // The same pick again, now that the write lands, proves the exit was withheld rather
    // than never wired at all.
    await pick('Tuesday jam')
    await expect.element(page.getByText('Added 2 songs to Tuesday jam')).toBeVisible()
    await vi.waitFor(() => expect(onExit).toHaveBeenCalledOnce())
    await sheetsClosed()
  })

  it('reports a failed More action beside the toolbar and keeps the mode', async () => {
    const one = await seed({ title: 'Say Old Man' })
    const two = await seed({ title: 'Lost Indian' })
    vi.mocked(bulk.setArchivedMany).mockRejectedValueOnce(new Error('Disk full'))
    show([one, two])
    await tap('More')
    await pick('Archive 2 songs')

    await expect.element(page.getByRole('alert')).toHaveTextContent('Disk full')
    expect(onExit).not.toHaveBeenCalled()
    expect(toasts()).toBe(0)
    expect(await archivedAt(one.userSong.id)).toBeNull()

    // The same item again, now that the write lands, proves the exit was withheld rather
    // than never wired at all.
    await tap('More')
    await pick('Archive 2 songs')
    await expect.element(page.getByText('Archived 2 songs')).toBeVisible()
    await vi.waitFor(() => expect(onExit).toHaveBeenCalledOnce())
  })

  it('keeps the selection when the edit sheet is cancelled and ends it when it saves', async () => {
    const one = await seed({ title: 'Say Old Man' })
    const two = await seed({ title: 'Lost Indian' })
    show([one, two])
    await tap('Edit')
    await expect.element(page.getByText('Edit 2 songs')).toBeVisible()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await sheetsClosed()
    expect(onExit).not.toHaveBeenCalled()
    expect(toasts()).toBe(0)
    expect(probe().getAttribute('data-more')).toBe('Archive 2 songs|Delete 2 songs')

    await tap('Edit')
    await editTuning()
    await expect.element(page.getByText('Edited 2 songs')).toBeVisible()
    await vi.waitFor(() => expect(onExit).toHaveBeenCalledOnce())
    await sheetsClosed()
  })

  it('keeps the selection when the list picker is cancelled and ends it when it adds', async () => {
    const one = await seed({ title: 'Say Old Man' })
    const two = await seed({ title: 'Lost Indian' })
    const listId = await createList(db, 'Tuesday jam')
    show([one, two])
    await tap(ADD_TO_LIST)
    await expect.element(page.getByText('none in it')).toBeVisible()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await sheetsClosed()
    expect(onExit).not.toHaveBeenCalled()
    expect(toasts()).toBe(0)
    expect(await order(listId)).toEqual([])
    expect(probe().getAttribute('data-more')).toBe('Archive 2 songs|Delete 2 songs')

    await tap(ADD_TO_LIST)
    await pick('Tuesday jam')
    await expect.element(page.getByText('Added 2 songs to Tuesday jam')).toBeVisible()
    await vi.waitFor(() => expect(onExit).toHaveBeenCalledOnce())
    await sheetsClosed()
  })

  it('deletes the selected songs after the confirmation, with nothing to undo', async () => {
    const one = await seed({ title: 'Say Old Man' })
    const two = await seed({ title: 'Lost Indian' })
    const kept = await seed({ title: 'Ducks on the Millpond' })
    show([one, two])
    await tap('More')
    await pick('Delete 2 songs')
    await answer('Delete')

    await vi.waitFor(async () => {
      expect(await deleted(one)).not.toBeNull()
      expect(await deleted(two)).not.toBeNull()
    })
    expect(await deleted(kept)).toBeNull()
    await vi.waitFor(() => expect(onExit).toHaveBeenCalledOnce())
    expect(toasts()).toBe(0)
  })

  it('keeps the songs and the selection when the confirmation is dismissed', async () => {
    const one = await seed({ title: 'Say Old Man' })
    const two = await seed({ title: 'Lost Indian' })
    show([one, two])
    await tap('More')
    await pick('Delete 2 songs')
    await answer('Cancel')

    await vi.waitFor(() =>
      expect(document.querySelector('ion-alert:not(.overlay-hidden)')).toBeNull(),
    )
    expect(await deleted(one)).toBeNull()
    expect(await deleted(two)).toBeNull()
    expect(onExit).not.toHaveBeenCalled()
    expect(probe().getAttribute('data-more')).toBe('Archive 2 songs|Delete 2 songs')
  })

  it('counts the recordings the delete takes with it and warns about the unsent ones', async () => {
    const one = await seed({ title: 'Say Old Man' })
    const two = await seed({ title: 'Lost Indian' })
    await db.recordings.put(recordingRow('r1', { song_id: one.song.id }))
    await db.recordings.put(recordingRow('r2', { song_id: two.song.id }))
    await db.recording_files.put(recordingFile('r1', { local_state: 'uploaded' }))
    await db.recording_files.put(recordingFile('r2', { local_state: 'failed_upload' }))
    show([one, two])
    await tap('More')
    await pick('Delete 2 songs')

    expect((await alertEl()).textContent).toContain(
      'Delete 2 songs? This removes their links, list entries, and 2 recordings. Some recordings have not uploaded, so they cannot be recovered.',
    )
    await answer('Cancel')
  })

  it('names one selected song in the question, as the song page does', async () => {
    const one = await seed({ title: 'Say Old Man' })
    show([one])
    await tap('More')
    await pick('Delete 1 song')

    expect((await alertEl()).textContent).toContain(
      'Delete "Say Old Man"? This removes its links and list entries.',
    )
    await answer('Cancel')
  })

  it('keeps every action but offers no More items when nothing is selected', async () => {
    show([])
    await vi.waitFor(() => expect(document.querySelector('[data-probe]')).not.toBeNull())
    expect(probe().getAttribute('data-actions')).toBe('Status|Edit|Add to list')
    expect(probe().getAttribute('data-more')).toBe('')
  })
})
