import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '../../auth/AuthContext'
import { addLink } from '../../commands/links'
import { addToList, createList } from '../../commands/lists'
import {
  appendChunk,
  beginCapture,
  finishCapture,
  defaultRecordingLabel,
} from '../../commands/recordings'
import { createSong, setArchived } from '../../commands/songs'
import type * as SongsModule from '../../commands/songs'
import { newId } from '../../commands/write'
import { AppBar } from '../../components/AppBar'
import { PageChromeProvider } from '../../components/PageChromeProvider'
import { DbContext } from '../../db/DbProvider'
import type { CrosstuneDb } from '../../db/schema'
import { SyncContext } from '../../sync/SyncProvider'
import { openTestDb } from '../../test/db'
import { stubMediaGlobals } from '../../test/fakeMedia'
import { fakeEngine, renderApp, renderWithProviders, testSession } from '../../test/render'
import { PlayerDock } from '../player/PlayerDock'
import { PlayerProvider } from '../player/PlayerProvider'
import { usePlayer, type Player } from '../player/usePlayer'
import { useRecordingsWithFiles } from '../recordings/useRecordings'
import type * as UseRecordingsModule from '../recordings/useRecordings'
import { SelectionChromeProvider } from '../selection/SelectionChromeProvider'
import { SongDetail } from './SongDetail'

vi.mock('../recordings/useRecordings', async (importOriginal) => {
  const actual = await importOriginal<typeof UseRecordingsModule>()
  return { ...actual, useRecordingsWithFiles: vi.fn(actual.useRecordingsWithFiles) }
})

vi.mock('../../commands/songs', async (importOriginal) => {
  const actual = await importOriginal<typeof SongsModule>()
  return { ...actual, setArchived: vi.fn(actual.setArchived) }
})

type Props = Parameters<typeof SongDetail>[0]

let db: CrosstuneDb
let songId: string
let userSongId: string
let fiddleId: string

beforeEach(async () => {
  db = openTestDb()
  const created = await createSong(
    db,
    {
      title: 'Cluck Old Hen',
      key: 'A',
      mode: 'mixolydian',
      violin_tuning: 'AEAE',
      is_crooked: true,
    },
    { status: 'learning', notes: 'Watch the B part' },
  )
  songId = created.songId
  userSongId = created.userSongId
  fiddleId = await addLink(db, songId, {
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    provider: 'youtube',
    provider_ref: 'dQw4w9WgXcQ',
    title: 'Fiddle version',
  })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await db.delete()
})

function playerProbe() {
  const seen: { current: Player | null } = { current: null }
  function Probe() {
    seen.current = usePlayer()
    return null
  }
  const player = () => {
    if (!seen.current) throw new Error('the player probe did not render')
    return seen.current
  }
  return { Probe, player }
}

function renderDetail(overrides: Partial<Props> = {}) {
  const props = { songId, edit: false, onEditChange: vi.fn(), onDeleted: vi.fn(), ...overrides }
  const { Probe, player } = playerProbe()
  const result = renderWithProviders(
    <SelectionChromeProvider>
      <AppBar />
      <PlayerProvider>
        <Probe />
        <SongDetail {...props} />
        <PlayerDock />
      </PlayerProvider>
    </SelectionChromeProvider>,
    { db },
  )
  return { props, result, player }
}

// renderWithProviders builds a fresh router (and route component) per call, so it
// cannot rerender an existing instance with new props. This bypasses the router to
// keep one SongDetail instance and one player alive across prop changes.
// AppBar links home, which needs router context; a route-less router gives it one
// without pulling in the full route tree renderWithProviders builds per call.
function renderDetailDirect(initial: Props) {
  const engine = fakeEngine()
  const { Probe, player } = playerProbe()
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory(),
  })
  const wrap = (p: Props) => (
    <RouterContextProvider router={router}>
      <AuthProvider value={testSession}>
        <DbContext.Provider value={db}>
          <SyncContext.Provider value={engine}>
            <SelectionChromeProvider>
              <PageChromeProvider>
                <AppBar />
                <PlayerProvider>
                  <Probe />
                  <SongDetail {...p} />
                  <PlayerDock />
                </PlayerProvider>
              </PageChromeProvider>
            </SelectionChromeProvider>
          </SyncContext.Provider>
        </DbContext.Provider>
      </AuthProvider>
    </RouterContextProvider>
  )
  const result = render(wrap(initial))
  return { player, rerenderWith: (p: Props) => result.rerender(wrap(p)) }
}

function detailProps(id: string): Props {
  return { songId: id, edit: false, onEditChange: vi.fn(), onDeleted: vi.fn() }
}

// The dock mounts a fresh iframe when the embed changes, so query it from the region each time.
function frameIn(region: HTMLElement): HTMLIFrameElement {
  const frame = region.querySelector('iframe')
  if (!frame) throw new Error('no iframe in the player')
  return frame
}

// jsdom cannot open a popover, so the menu's items are reached while hidden.
async function pick(action: string) {
  await userEvent.click(screen.getByRole('menuitem', { name: action, hidden: true }))
}

describe('SongDetail', () => {
  it('shows facets and changes status', async () => {
    renderDetail()
    expect(await screen.findByRole('heading', { name: 'Cluck Old Hen' })).toBeInTheDocument()
    expect(screen.getByText('A mixolydian')).toBeInTheDocument()
    expect(screen.getByText('AEAE')).toBeInTheDocument()
    expect(screen.getByText('Crooked')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('radio', { name: 'Known' }))
    await waitFor(async () => expect((await db.user_songs.get(userSongId))?.status).toBe('known'))
  })

  it('opens the player only when a row Play is tapped', async () => {
    await addLink(db, songId, {
      url: 'https://www.youtube.com/watch?v=M7lc1UVf-VE',
      provider: 'youtube',
      provider_ref: 'M7lc1UVf-VE',
      title: 'Banjo version',
    })
    await addLink(db, songId, {
      url: 'https://example.com/tune.mp3',
      provider: 'other',
      title: 'Jam recording',
    })
    const { player } = renderDetail()
    await screen.findByRole('heading', { name: 'Cluck Old Hen' })
    // A settled interaction gives any effect that could open the player time to run.
    await userEvent.click(screen.getByRole('radio', { name: 'Known' }))
    await waitFor(async () => expect((await db.user_songs.get(userSongId))?.status).toBe('known'))
    expect(screen.getByRole('button', { name: 'Play Fiddle version' })).toBeInTheDocument()
    expect(player().item).toBeNull()
    expect(screen.queryByRole('region', { name: 'Player' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^(Play|Close) Jam recording/ })).toBeNull()
    expect(screen.getAllByRole('link', { name: /^Open / })).toHaveLength(3)

    await userEvent.click(screen.getByRole('button', { name: 'Play Banjo version' }))
    const region = await screen.findByRole('region', { name: 'Player' })
    await waitFor(() => expect(frameIn(region).src).toContain('M7lc1UVf-VE'))
    expect(frameIn(region).src).toContain('autoplay=1')
    expect(screen.getByRole('button', { name: 'Close Banjo version player' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Play Fiddle version' }))
    await waitFor(() => expect(frameIn(region).src).toContain('dQw4w9WgXcQ'))
    expect(screen.getByRole('button', { name: 'Play Banjo version' })).toBeInTheDocument()
  })

  it('keeps the dock loaded through edit mode', async () => {
    const props = detailProps(songId)
    const { player, rerenderWith } = renderDetailDirect(props)
    await userEvent.click(await screen.findByRole('button', { name: 'Play Fiddle version' }))
    await screen.findByRole('region', { name: 'Player' })

    rerenderWith({ ...props, edit: true })
    await screen.findByRole('textbox', { name: 'Title' })
    expect(player().item).toEqual({ kind: 'link', id: fiddleId })
    expect(screen.getByRole('region', { name: 'Player' })).toBeInTheDocument()
  })

  it('enters edit mode through the callback and saves changes', async () => {
    const { props, result } = renderDetail()
    await screen.findByRole('heading', { name: 'Cluck Old Hen' })
    await pick('Edit')
    expect(props.onEditChange).toHaveBeenCalledWith(true)
    // The route drives `edit` from search state; unmount and re-render with edit: true
    // to stand in for the navigation this callback would otherwise trigger.
    result.unmount()
    renderDetail({ edit: true })
    const title = await screen.findByRole('textbox', { name: 'Title' })
    await userEvent.clear(title)
    await userEvent.type(title, 'Cluck Old Hen (A)')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(async () => expect((await db.songs.get(songId))?.title).toBe('Cluck Old Hen (A)'))
  })

  it('lists recordings above links with record, upload, and paste link controls', async () => {
    const id = newId()
    await beginCapture(db, id, { songId, recordedAt: '2026-09-14T20:00:00.000Z' })
    await appendChunk(db, id, 0, new Blob(['abc'], { type: 'audio/mp4' }))
    await finishCapture(db, id, {
      songId,
      mime: 'audio/mp4',
      durationMs: 3000,
      recordedAt: '2026-09-14T20:00:00.000Z',
    })
    renderDetail()
    const recordings = await screen.findByRole('list', { name: 'Recordings' })
    const plays = within(recordings).getAllByRole('button', { name: /^Play / })
    // The recording leads the list; the linked recordings follow it as rows of the same list.
    expect(plays[0]).toHaveAccessibleName(
      `Play ${defaultRecordingLabel('2026-09-14T20:00:00.000Z')}`,
    )
    expect(plays.length).toBeGreaterThan(1)
    expect(within(recordings).getAllByRole('link', { name: /^Open .* on / })).not.toHaveLength(0)
    const row = screen.getByRole('group', { name: 'Add a recording' })
    expect(within(row).getByRole('button', { name: 'Record' })).toBeInTheDocument()
    expect(within(row).getByLabelText('Upload')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Link' })).toBeNull()
    await userEvent.click(within(row).getByRole('button', { name: 'Paste link' }))
    expect(screen.getByRole('textbox', { name: 'Link' })).toHaveFocus()
  })

  it('opens the recording screen for this song from the Record button', async () => {
    stubMediaGlobals()
    const { router } = renderApp({ db, path: `/songs/${songId}` })
    await screen.findByRole('heading', { name: 'Cluck Old Hen' })
    await userEvent.click(screen.getByRole('button', { name: 'Record' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/record'))
    expect(router.state.location.search).toEqual({ song: songId })
  })

  it('shows the lists the song is in and adds it to another from a picker', async () => {
    const tuesday = await createList(db, 'Tuesday jam')
    await createList(db, 'Waltzes')
    await addToList(db, tuesday, userSongId)
    renderDetail()
    const lists = await screen.findByRole('region', { name: 'Lists' })
    // The region mounts before its own list query resolves, so its membership badges arrive a tick later.
    expect(await within(lists).findByText('Tuesday jam')).toBeInTheDocument()
    expect(within(lists).queryByText('Waltzes')).toBeNull()
    await userEvent.click(within(lists).getByRole('button', { name: 'Add to list' }))
    await userEvent.click(screen.getByRole('button', { name: /Waltzes/ }))
    expect(await within(lists).findByText('Waltzes')).toBeInTheDocument()
  })

  it('removes the song from a list by its pill', async () => {
    const tuesday = await createList(db, 'Tuesday jam')
    await addToList(db, tuesday, userSongId)
    renderDetail()
    const lists = await screen.findByRole('region', { name: 'Lists' })
    await userEvent.click(
      await within(lists).findByRole('button', { name: 'Remove from Tuesday jam' }),
    )
    await waitFor(() => expect(within(lists).queryByText('Tuesday jam')).toBeNull())
    expect(screen.getByText('Not in any list yet.')).toBeInTheDocument()
    const items = await db.list_items.where('user_song_id').equals(userSongId).toArray()
    expect(items.every((item) => item.deleted_at !== null)).toBe(true)
  })

  it('archives and deletes', async () => {
    const { props } = renderDetail()
    await screen.findByRole('heading', { name: 'Cluck Old Hen' })
    await pick('Archive')
    await waitFor(async () =>
      expect((await db.user_songs.get(userSongId))?.archived_at).not.toBeNull(),
    )
    await pick('Delete')
    await waitFor(async () => expect((await db.songs.get(songId))?.deleted_at).not.toBeNull())
    expect(props.onDeleted).toHaveBeenCalled()
  })

  it('reports a failed menu action under the page heading', async () => {
    vi.mocked(setArchived).mockRejectedValueOnce(new Error('The write was refused'))
    renderDetail()
    const heading = await screen.findByRole('heading', { name: 'Cluck Old Hen' })
    await pick('Archive')
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The write was refused')
    const status = screen.getByRole('radio', { name: 'Known' })
    expect(heading.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(alert.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('reports a failed link removal under the recordings list', async () => {
    renderDetail()
    const recordings = await screen.findByRole('list', { name: 'Recordings' })
    const reject = () => {
      throw new Error('Storage is full')
    }
    db.recording_links.hook('creating', reject)
    db.recording_links.hook('updating', reject)
    await userEvent.click(screen.getByRole('button', { name: 'Remove Fiddle version' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Storage is full')
    expect(
      recordings.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    const status = screen.getByRole('radio', { name: 'Known' })
    expect(status.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('warns that deleting the song loses recordings that have not uploaded', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    for (const text of ['abc', 'def']) {
      const id = newId()
      await beginCapture(db, id, { songId, recordedAt: '2026-09-14T20:00:00.000Z' })
      await appendChunk(db, id, 0, new Blob([text], { type: 'audio/mp4' }))
      await finishCapture(db, id, {
        songId,
        mime: 'audio/mp4',
        durationMs: 3000,
        recordedAt: '2026-09-14T20:00:00.000Z',
      })
    }
    renderDetail()
    const recordings = await screen.findByRole('list', { name: 'Recordings' })
    await waitFor(() =>
      expect(within(recordings).getAllByRole('button', { name: /^Delete / })).toHaveLength(2),
    )
    await pick('Delete')
    expect(confirm).toHaveBeenCalledWith(
      'Delete "Cluck Old Hen"? This removes its links, list entries, and 2 recordings. Some recordings have not uploaded, so they cannot be recovered.',
    )
    expect((await db.songs.get(songId))?.deleted_at).toBeNull()
  })

  it('keeps page actions in the app bar menu and none at the foot of the page', async () => {
    renderDetail()
    await screen.findByRole('heading', { name: 'Cluck Old Hen' })
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
    expect(screen.getByRole('button', { name: 'More actions' })).toBeInTheDocument()
    expect(
      screen.getAllByRole('menuitem', { hidden: true }).map((item) => item.textContent),
    ).toEqual(['Edit', 'Add to list', 'Archive', 'Delete'])
  })

  it('holds the app bar menu back until the recordings query has loaded', async () => {
    const actual = await vi.importActual<typeof UseRecordingsModule>('../recordings/useRecordings')
    const mocked = vi.mocked(useRecordingsWithFiles)
    mocked.mockImplementation(() => undefined)
    try {
      renderDetail()
      // The song and instrument queries resolve and re-render the page while the
      // mocked recordings query never does, so this proves the wait outlasts a mount.
      await waitFor(() => expect(mocked.mock.calls.length).toBeGreaterThan(1))
      expect(screen.queryByRole('heading', { name: 'Cluck Old Hen' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull()
    } finally {
      mocked.mockImplementation(actual.useRecordingsWithFiles)
    }
  })
})
