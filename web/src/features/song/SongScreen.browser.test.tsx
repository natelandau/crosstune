import { IonContent, IonPage, IonRouterOutlet } from '@ionic/react'
import { IonReactMemoryRouter } from '@ionic/react-router'
import { Route } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import * as listsModule from '../../commands/lists'
import { addToList, createList } from '../../commands/lists'
import * as songsModule from '../../commands/songs'
import { createSong, deleteSong } from '../../commands/songs'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { renderIonic } from '../../test/ionic'
import { recordingRow } from '../../test/rows'
import { RecordProvider } from '../recording/useRecord'
import * as recordingsModule from '../recordings/useRecordings'
import type * as ConfirmModule from '../../ui/Confirm'
import type * as SongsModule from '../../commands/songs'
import { SongScreen } from './SongScreen'

vi.mock('../../commands/songs', { spy: true })
vi.mock('../../commands/lists', { spy: true })
vi.mock('../recordings/useRecordings', { spy: true })

let confirmCalls = 0
vi.mock('../../ui/Confirm', async (importOriginal) => {
  const actual = await importOriginal<typeof ConfirmModule>()
  return {
    ...actual,
    useConfirm: () => {
      const confirm = actual.useConfirm()
      return (options: Parameters<typeof confirm>[0]) => {
        confirmCalls += 1
        return confirm(options)
      }
    },
  }
})

const { deleteSong: realDeleteSong } =
  await vi.importActual<typeof SongsModule>('../../commands/songs')

/** A promise and the function that settles it, for holding a write in flight. */
function gate() {
  let open = () => {}
  const opened = new Promise<void>((resolve) => {
    open = resolve
  })
  return { opened, open }
}

let db: CrosstuneDb
let ids: { songId: string; userSongId: string }

beforeEach(async () => {
  confirmCalls = 0
  db = openTestDb()
  ids = await createSong(
    db,
    {
      title: "Soldier's Joy",
      key: 'D',
      mode: 'major',
      alternate_titles: ['Joy'],
      violin_tuning: 'Standard (GDAE)',
      is_crooked: true,
      genre: 'Old-time',
    },
    { status: 'learning', notes: 'Watch the B part.', learned_from: 'Jim' },
  )
})

afterEach(async () => {
  // Resets call counts and any one-off rejection a failed test left unconsumed; a spied module
  // falls back to its real implementation.
  vi.resetAllMocks()
  await db.delete()
})

/**
 * Mounts the song page at its real route pattern, beside a catalog page, with no history behind
 * it. The shared renderScreen helper mounts at `*`, which leaves `songId` out of the params.
 */
function show(songId = ids.songId) {
  renderIonic(
    <IonReactMemoryRouter initialEntries={[`/catalog/${songId}`]}>
      {/* Inside the router, as the shell mounts it, so starting a recording can also navigate. */}
      <RecordProvider>
        <IonRouterOutlet>
          <Route
            path="/catalog"
            element={
              <IonPage>
                <IonContent>
                  <h1>Catalog probe</h1>
                </IonContent>
              </IonPage>
            }
          />
          <Route path="/catalog/:songId" element={<SongScreen parent={() => '/catalog'} />} />
        </IonRouterOutlet>
      </RecordProvider>
    </IonReactMemoryRouter>,
    { db },
  )
}

const title = () => page.getByRole('heading', { name: "Soldier's Joy", level: 1 })

// Menu items render in a popover on a mouse; scoping to it keeps "Add to list" from matching the
// row of the same name on the page.
async function menuItem(label: string) {
  const popover = await vi.waitFor(() => {
    const open = document.querySelector<HTMLElement>('ion-popover:not(.overlay-hidden)')
    if (!open) throw new Error('The menu is not open')
    return open
  })
  return page.elementLocator(popover).getByText(label, { exact: true })
}

// The alert opens while the menu's popover is still dismissing, so its button is scoped to it.
async function alertButton(label: string) {
  const alert = await vi.waitFor(() => {
    const open = document.querySelector<HTMLElement>('ion-alert:not(.overlay-hidden)')
    if (!open) throw new Error('The confirmation is not open')
    return open
  })
  return page.elementLocator(alert).getByRole('button', { name: label, exact: true })
}

async function openMenuItem(label: string) {
  await page.getByRole('button', { name: 'More actions' }).click()
  await (await menuItem(label)).click()
}

describe('SongScreen', () => {
  it('shows the title, alternate titles, facets, and notes', async () => {
    show()
    await expect.element(title()).toBeVisible()
    await expect.element(page.getByText('Joy', { exact: true })).toBeVisible()
    for (const facet of ['major', 'Learning', 'Standard (GDAE)', 'Crooked', 'Old-time']) {
      await expect.element(page.getByText(facet, { exact: true })).toBeVisible()
    }
    await expect.element(page.getByText('Learned from Jim')).toBeVisible()
    await expect.element(page.getByText('Watch the B part.')).toBeVisible()
    expect(page.getByRole('heading', { level: 1 }).elements()).toHaveLength(1)
  })

  it('holds every facet in one row under the title, the key first', async () => {
    show()
    await expect.element(title()).toBeVisible()
    const row = document.querySelector('[data-song-facets]')!
    const pill = row.querySelector('.key-pill')!
    expect(pill.getAttribute('data-pitch')).toBe('2')
    expect(pill.textContent).toBe('D')
    // Every facet is a child of this one row, so none of them sits on a line of its own.
    expect(Array.from(row.children).map((child) => child.textContent)).toEqual([
      'D',
      'major',
      'Learning',
      'Standard (GDAE)',
      'Crooked',
      'Old-time',
    ])
  })

  it('sets its groups as cards on the grouped surface', async () => {
    show()
    await expect.element(title()).toBeVisible()
    const content = title().element().closest('ion-content')!
    expect(content.classList.contains('grouped')).toBe(true)
    await vi.waitFor(() => {
      expect(content.querySelector('ion-list')!.classList.contains('list-inset')).toBe(true)
    })
  })

  it('says when a song was learned when only the date is set', async () => {
    const { songId } = await createSong(
      db,
      { title: 'Cluck Old Hen' },
      { status: 'known', learned_on: '2024-03-05' },
    )
    show(songId)
    await expect.element(page.getByText('Learned on Mar 5, 2024', { exact: true })).toBeVisible()
  })

  it('reads the learned line with both who and when', async () => {
    const { songId } = await createSong(
      db,
      { title: 'Cluck Old Hen' },
      { status: 'known', learned_from: 'Jim', learned_on: '2024-12-31' },
    )
    show(songId)
    await expect
      .element(page.getByText('Learned from Jim on Dec 31, 2024', { exact: true }))
      .toBeVisible()
  })

  it('shows two badges with the same text', async () => {
    const errors = vi.spyOn(console, 'error')
    const { songId } = await createSong(
      db,
      { title: 'Cluck Old Hen', violin_tuning: 'Cross A', banjo_tuning: 'Cross A' },
      { status: 'known' },
    )
    show(songId)
    await expect
      .element(page.getByRole('heading', { name: 'Cluck Old Hen', level: 1 }))
      .toBeVisible()
    expect(page.getByText('Cross A', { exact: true }).elements()).toHaveLength(2)
    expect(errors.mock.calls.flat().join(' ')).not.toContain('same key')
  })

  it('keeps a level 1 heading while the song loads', async () => {
    vi.mocked(recordingsModule.useRecordingsWithFiles).mockReturnValue(undefined)
    show()
    await expect.element(page.getByRole('heading', { name: 'Song', level: 1 })).toBeInTheDocument()
  })

  it('shows the recordings group above the lists group', async () => {
    await db.recordings.put(recordingRow('r1', { song_id: ids.songId, label: 'Jam recording' }))
    show()
    await expect
      .element(page.getByRole('heading', { name: 'Jam recording', level: 3 }))
      .toBeVisible()
    expect(Array.from(document.querySelectorAll('h2')).map((h) => h.textContent)).toEqual([
      'Recordings',
      'Lists',
      'Notes',
    ])
    expect(page.getByRole('heading', { level: 1 }).elements()).toHaveLength(1)
  })

  it('points Back at the parent', async () => {
    show()
    await expect.element(title()).toBeVisible()
    expect(document.querySelector('ion-back-button')?.defaultHref).toBe('/catalog')
  })

  it('lists the lists the song is in and removes it from one', async () => {
    const list = await createList(db, 'Tuesday jam')
    await addToList(db, list, ids.userSongId)
    show()
    await expect.element(page.getByText('Tuesday jam')).toBeVisible()
    await page.getByRole('button', { name: 'Remove Tuesday jam' }).click()
    await expect.element(page.getByText('Not in any list yet.')).toBeVisible()
  })

  it('removes from a list once when Remove is pressed twice', async () => {
    const list = await createList(db, 'Tuesday jam')
    await addToList(db, list, ids.userSongId)
    show()
    const remove = page.getByRole('button', { name: 'Remove Tuesday jam' })
    await expect.element(remove).toBeVisible()
    const button = remove.element() as HTMLElement
    button.click()
    button.click()
    await expect.element(page.getByText('Not in any list yet.')).toBeVisible()
    expect(listsModule.removeFromList).toHaveBeenCalledTimes(1)
  })

  it('removes the same list item again after it is restored', async () => {
    const list = await createList(db, 'Tuesday jam')
    const itemId = await addToList(db, list, ids.userSongId)
    show()
    await page.getByRole('button', { name: 'Remove Tuesday jam' }).click()
    await expect.element(page.getByText('Not in any list yet.')).toBeVisible()
    await db.list_items.update(itemId, { deleted_at: null })
    await page.getByRole('button', { name: 'Remove Tuesday jam' }).click()
    await expect.element(page.getByText('Not in any list yet.')).toBeVisible()
    expect(listsModule.removeFromList).toHaveBeenCalledTimes(2)
  })

  it('shows a failed removal', async () => {
    const list = await createList(db, 'Tuesday jam')
    await addToList(db, list, ids.userSongId)
    vi.mocked(listsModule.removeFromList).mockRejectedValueOnce(new Error('Could not remove'))
    show()
    await page.getByRole('button', { name: 'Remove Tuesday jam' }).click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Could not remove')
    await expect.element(page.getByText('Tuesday jam')).toBeVisible()
  })

  it('opens the list picker from Add to list', async () => {
    show()
    await page.getByRole('button', { name: 'Add to list' }).first().click()
    await expect.element(page.getByText('Add to a list')).toBeVisible()
  })

  it('archives from the More actions menu', async () => {
    show()
    await openMenuItem('Archive')
    await vi.waitFor(async () =>
      expect((await db.user_songs.get(ids.userSongId))?.archived_at).not.toBeNull(),
    )
    await expect.element(page.getByText('Archived', { exact: true })).toBeVisible()
  })

  it('shows a failed archive', async () => {
    vi.mocked(songsModule.setArchived).mockRejectedValueOnce(new Error('Could not archive'))
    show()
    await openMenuItem('Archive')
    await expect.element(page.getByRole('alert')).toHaveTextContent('Could not archive')
  })

  it('deletes only after the confirmation, with the consequence named', async () => {
    show()
    await openMenuItem('Delete')
    await expect
      .element(page.getByText('Delete "Soldier\'s Joy"? This removes its links and list entries.'))
      .toBeVisible()
    await (await alertButton('Cancel')).click()
    await vi.waitFor(() =>
      expect(document.querySelector('ion-alert:not(.overlay-hidden)')).toBeNull(),
    )
    expect((await db.songs.get(ids.songId))?.deleted_at).toBeNull()
    await openMenuItem('Delete')
    await (await alertButton('Delete')).click()
    await vi.waitFor(async () =>
      expect((await db.songs.get(ids.songId))?.deleted_at).not.toBeNull(),
    )
  })

  it('deletes once and goes back to the parent once, without saying the song is gone', async () => {
    show()
    await expect.element(title()).toBeVisible()
    await openMenuItem('Delete')
    const confirm = await alertButton('Delete')
    await expect.element(confirm).toBeVisible()
    const button = confirm.element() as HTMLElement
    button.click()
    button.click()
    await expect.element(page.getByRole('heading', { name: 'Catalog probe' })).toBeVisible()
    expect(songsModule.deleteSong).toHaveBeenCalledTimes(1)
    expect(page.getByText('This song is gone').elements()).toHaveLength(0)
  })

  it('asks once when the Delete menu item is pressed twice', async () => {
    show()
    await expect.element(title()).toBeVisible()
    await page.getByRole('button', { name: 'More actions' }).click()
    const deleteItem = await menuItem('Delete')
    await expect.element(deleteItem).toBeVisible()
    const item = deleteItem.element() as HTMLElement
    item.click()
    item.click()
    await expect.element(await alertButton('Cancel')).toBeVisible()
    expect(confirmCalls).toBe(1)
  })

  it('shows that a slow delete is in progress', async () => {
    const write = gate()
    vi.mocked(songsModule.deleteSong).mockImplementationOnce(async (...args) => {
      await write.opened
      return realDeleteSong(...args)
    })
    show()
    await openMenuItem('Delete')
    await (await alertButton('Delete')).click()
    await expect.element(page.getByText('Deleting…')).toBeVisible()
    await expect.element(title()).toBeVisible()
    expect(page.getByRole('button', { name: 'More actions' }).elements()).toHaveLength(0)
    write.open()
    await expect.element(page.getByRole('heading', { name: 'Catalog probe' })).toBeVisible()
  })

  it('shows a failed delete and stays on the song', async () => {
    vi.mocked(songsModule.deleteSong).mockRejectedValueOnce(new Error('Could not delete'))
    show()
    await openMenuItem('Delete')
    await (await alertButton('Delete')).click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Could not delete')
    await expect.element(title()).toBeVisible()
  })

  it('opens the form sheet from Edit', async () => {
    show()
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await expect.element(page.getByText('Edit song')).toBeVisible()
  })

  it('says the song is gone for an unknown id', async () => {
    show('missing')
    await expect.element(page.getByText('This song is gone')).toBeVisible()
    expect(document.querySelector('ion-back-button')?.defaultHref).toBe('/catalog')
  })

  it('says the song is gone when it is deleted elsewhere while open', async () => {
    show()
    await expect.element(title()).toBeVisible()
    await deleteSong(db, ids.songId)
    await expect.element(page.getByText('This song is gone')).toBeVisible()
  })
})
