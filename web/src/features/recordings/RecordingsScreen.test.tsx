import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  appendChunk,
  beginCapture,
  finishCapture,
  setFileState,
  storeDownloadedBlob,
  updateRecording,
} from '../../commands/recordings'
import { createSong } from '../../commands/songs'
import { newId } from '../../commands/write'
import { setStorage } from '../../db/meta'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { fakeEngine, renderApp } from '../../test/render'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

afterEach(async () => {
  await db.delete()
})

async function take(songId: string | null, label: string): Promise<string> {
  const id = newId()
  await beginCapture(db, id, { songId, recordedAt: '2026-09-14T20:00:00.000Z' })
  await appendChunk(db, id, 0, new Blob(['abc'], { type: 'audio/mp4' }))
  await finishCapture(db, id, {
    songId,
    mime: 'audio/mp4',
    durationMs: 65_000,
    recordedAt: '2026-09-14T20:00:00.000Z',
  })
  await updateRecording(db, id, { label })
  return id
}

describe('RecordingsScreen', () => {
  it('groups unfiled recordings first, then each song under its own header', async () => {
    const { songId } = await createSong(db, { title: 'Angeline', key: 'D' }, { status: 'known' })
    await take(songId, 'Filed')
    const unfiled = await take(null, 'Loose take')
    await setFileState(db, unfiled, 'blocked_quota')
    renderApp({ db, path: '/recordings' })
    const loose = await screen.findByRole('list', { name: 'Unfiled' })
    const row = within(loose).getByRole('listitem')
    expect(row).toHaveTextContent('Loose take')
    expect(row).toHaveTextContent('Storage full')
    expect(row).toHaveTextContent('1:05')
    expect(within(row).getByRole('button', { name: 'Add to song Loose take' })).toBeInTheDocument()
    const header = screen.getByRole('link', { name: /Angeline/ })
    expect(header).toHaveTextContent('Key D')
    expect(header).toHaveTextContent('Known')
    const filed = screen.getByRole('list', { name: 'Angeline' })
    expect(within(filed).getByRole('listitem')).toHaveTextContent('Filed')
    expect(loose.compareDocumentPosition(header) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("prefers the server's duration once it is known over the local estimate", async () => {
    const id = await take(null, 'Synced take')
    // The transcoded duration lands through sync and can differ slightly from the
    // client's own count of what it recorded.
    await db.recordings.update(id, { duration_ms: 70_000 })
    renderApp({ db, path: '/recordings' })
    const list = await screen.findByRole('list', { name: 'Unfiled' })
    expect(within(list).getByRole('listitem')).toHaveTextContent('1:10')
  })

  it('shows storage figures and lets a failed recording retry', async () => {
    await setStorage(db, { used_bytes: 500_000_000, quota_bytes: 1_000_000_000, max_file_bytes: 1 })
    const id = await take(null, 'Broken')
    await db.recordings.update(id, { state: 'failed', error: 'ffprobe failed' })
    await setFileState(db, id, 'uploaded')
    const retry = vi.fn(async () => {})
    renderApp({ db, path: '/recordings', engine: fakeEngine({ retry }) })
    expect(await screen.findByText('500 MB of 1 GB used')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry Broken' }))
    expect(retry).toHaveBeenCalledWith(id)
  })

  it("shows a blocked row's own subtitle with the storage figures", async () => {
    await setStorage(db, { used_bytes: 500_000_000, quota_bytes: 1_000_000_000, max_file_bytes: 1 })
    const id = await take(null, 'Stuck')
    await setFileState(db, id, 'blocked_quota')
    renderApp({ db, path: '/recordings' })
    const list = await screen.findByRole('list', { name: 'Unfiled' })
    const row = within(list).getByRole('listitem')
    expect(await within(row).findByText(/500 MB of 1 GB used/)).toBeInTheDocument()
  })

  it('offers no per-recording keep offline control', async () => {
    await take(null, 'Loose take')
    renderApp({ db, path: '/recordings' })
    const list = await screen.findByRole('list', { name: 'Unfiled' })
    expect(within(list).queryByRole('checkbox')).toBeNull()
  })

  it('shows why an upload failed and retries it', async () => {
    const id = await take(null, 'Refused')
    await setFileState(db, id, 'failed_upload', 'Unsupported audio type')
    const sync = vi.fn(async () => {})
    renderApp({ db, path: '/recordings', engine: fakeEngine({ sync }) })
    const list = await screen.findByRole('list', { name: 'Unfiled' })
    expect(await within(list).findByText('Unsupported audio type')).toBeInTheDocument()
    await userEvent.click(within(list).getByRole('button', { name: 'Retry uploading Refused' }))
    await vi.waitFor(async () =>
      expect((await db.recording_files.get(id))?.local_state).toBe('captured'),
    )
    await vi.waitFor(() => expect(sync).toHaveBeenCalled())
    await vi.waitFor(() => expect(within(list).queryByText('Unsupported audio type')).toBeNull())
  })

  it('warns that a recording still uploading cannot be recovered', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const id = await take(null, 'Sending')
    await setFileState(db, id, 'uploading')
    renderApp({ db, path: '/recordings' })
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Sending' }))
    expect(confirm).toHaveBeenCalledWith(
      'Delete this recording? It has not been uploaded, so this cannot be undone.',
    )
  })

  it('deletes after confirming', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const id = await take(null, 'Gone')
    renderApp({ db, path: '/recordings' })
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Gone' }))
    await vi.waitFor(async () => expect((await db.recordings.get(id))?.deleted_at).not.toBeNull())
  })

  it('downloads a take the device does not hold, then offers to play it', async () => {
    const id = await take(null, 'Remote')
    await db.recording_files.delete(id)
    await db.recordings.update(id, { state: 'ready' })
    let finish!: (blob: Blob | null) => void
    const download = vi.fn(
      () =>
        new Promise<Blob | null>((resolve) => {
          finish = resolve
        }),
    )
    renderApp({ db, path: '/recordings', engine: fakeEngine({ download }) })
    await userEvent.click(await screen.findByRole('button', { name: 'Download Remote' }))
    expect(download).toHaveBeenCalledWith(id)
    expect(screen.getByRole('status', { name: 'Downloading Remote' })).toBeInTheDocument()
    const blob = new Blob(['abc'], { type: 'audio/mp4' })
    await storeDownloadedBlob(db, id, blob, 'audio/mp4')
    finish(blob)
    expect(await screen.findByRole('button', { name: 'Play Remote' })).toBeInTheDocument()
  })

  it('says so and offers the download again when it fails', async () => {
    const id = await take(null, 'Remote')
    await db.recording_files.delete(id)
    await db.recordings.update(id, { state: 'ready' })
    renderApp({ db, path: '/recordings', engine: fakeEngine({ download: async () => null }) })
    await userEvent.click(await screen.findByRole('button', { name: 'Download Remote' }))
    expect(await screen.findByText("Couldn't download")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download Remote' })).toBeInTheDocument()
  })

  it('stores an uploaded file', async () => {
    renderApp({ db, path: '/recordings' })
    const input = await screen.findByLabelText('Upload audio file')
    await userEvent.upload(input, new File(['wav'], 'jam.wav', { type: 'audio/wav' }))
    await vi.waitFor(async () => expect(await db.recordings.count()).toBe(1))
    expect((await db.recordings.toArray())[0]?.source).toBe('upload')
  })

  it('files a recording as unfiled once its song is deleted elsewhere', async () => {
    const { songId } = await createSong(db, { title: 'Angeline' }, { status: 'known' })
    await take(songId, 'Angeline take')
    // A song can be tombstoned by another device's sync pull without that pull also
    // cascading to this device's copy of the recording.
    await db.songs.update(songId, { deleted_at: '2026-09-14T21:00:00.000Z' })
    renderApp({ db, path: '/recordings' })
    const list = await screen.findByRole('list', { name: 'Unfiled' })
    expect(
      within(list).getByRole('button', { name: 'Add to song Angeline take' }),
    ).toBeInTheDocument()
    expect(within(list).queryByRole('link')).not.toBeInTheDocument()
  })

  it('creates a song named for the search and files the take under it', async () => {
    const id = await take(null, 'Loose take')
    const { router } = renderApp({ db, path: '/recordings' })
    await userEvent.click(await screen.findByRole('button', { name: 'Add to song Loose take' }))
    await userEvent.type(screen.getByRole('searchbox', { name: 'Add to a song' }), 'Soldier')
    await userEvent.click(await screen.findByRole('button', { name: 'Add "Soldier"' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/songs/new'))
    expect(router.state.location.search).toEqual({ title: 'Soldier', attach: id })
    expect(await screen.findByRole('textbox', { name: 'Title' })).toHaveValue('Soldier')
    await userEvent.click(screen.getByRole('button', { name: 'Add song' }))
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/songs\/(?!new)/))
    const [song] = await db.songs.toArray()
    expect((await db.recordings.get(id))?.song_id).toBe(song!.id)
    expect(await screen.findByText('Loose take')).toBeInTheDocument()
  })

  it('opens the song from its header, plays a take from its row, and offers Move on swipe', async () => {
    const { songId } = await createSong(db, { title: 'Angeline' }, { status: 'known' })
    await take(songId, 'Filed')
    await take(null, 'Loose take')
    const { router } = renderApp({ db, path: '/recordings' })
    const filed = await screen.findByRole('list', { name: 'Angeline' })
    expect(within(filed).queryByRole('link')).toBeNull()
    expect(within(filed).getByRole('button', { name: 'Move Filed' })).toBeInTheDocument()
    await userEvent.click(within(filed).getByRole('button', { name: 'Play Filed' }))
    expect(await screen.findByRole('region', { name: 'Player' })).toBeInTheDocument()
    expect(within(filed).getByRole('button', { name: 'Close Filed player' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: /Angeline/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe(`/songs/${songId}`))
  })

  it('moves a filed take to another song from its swipe action', async () => {
    const { songId } = await createSong(db, { title: 'Angeline' }, { status: 'known' })
    const { songId: other } = await createSong(db, { title: 'Soldier' }, { status: 'known' })
    const id = await take(songId, 'Filed')
    renderApp({ db, path: '/recordings' })
    await userEvent.click(await screen.findByRole('button', { name: 'Move Filed' }))
    await screen.findByRole('dialog', { name: 'Move to a song' })
    await userEvent.type(screen.getByRole('searchbox', { name: 'Add to a song' }), 'Sold')
    await userEvent.click(await screen.findByRole('button', { name: 'Add to Soldier' }))
    await vi.waitFor(async () => expect((await db.recordings.get(id))?.song_id).toBe(other))
  })

  it('closes the player before deleting a recording that is playing', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await take(null, 'Playing')
    renderApp({ db, path: '/recordings' })
    await userEvent.click(await screen.findByRole('button', { name: 'Play Playing' }))
    expect(await screen.findByRole('region', { name: 'Player' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Delete Playing' }))
    await vi.waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Player' })).not.toBeInTheDocument(),
    )
  })

  it('warns that a recording never uploaded cannot be recovered', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const id = await take(null, 'Stuck')
    renderApp({ db, path: '/recordings' })
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Stuck' }))
    expect(confirm).toHaveBeenCalledWith(
      'Delete this recording? It has not been uploaded, so this cannot be undone.',
    )
    await vi.waitFor(async () => expect((await db.recordings.get(id))?.deleted_at).not.toBeNull())
  })

  it('keeps the ordinary delete warning once a recording has uploaded', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const id = await take(null, 'Synced')
    await setFileState(db, id, 'uploaded')
    renderApp({ db, path: '/recordings' })
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Synced' }))
    expect(confirm).toHaveBeenCalledWith('Delete this recording? It is removed from every device.')
  })

  it('gives each unlabeled unfiled recording a distinct fallback title', async () => {
    const id = newId()
    await beginCapture(db, id, { songId: null, recordedAt: '2026-09-14T20:00:00.000Z' })
    await appendChunk(db, id, 0, new Blob(['abc'], { type: 'audio/mp4' }))
    await finishCapture(db, id, {
      songId: null,
      mime: 'audio/mp4',
      durationMs: 5_000,
      recordedAt: '2026-09-14T20:00:00.000Z',
    })
    renderApp({ db, path: '/recordings' })
    const expected = new Date('2026-09-14T20:00:00.000Z').toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    })
    expect(await screen.findByText(`Recording, ${expected}`)).toBeInTheDocument()
  })
})
