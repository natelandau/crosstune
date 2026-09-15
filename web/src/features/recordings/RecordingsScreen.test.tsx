import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  appendChunk,
  beginCapture,
  finishCapture,
  setFileState,
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
  it('lists unfiled recordings first with their state and duration', async () => {
    const { songId } = await createSong(db, { title: 'Angeline' }, { status: 'known' })
    await take(songId, 'Filed')
    const unfiled = await take(null, 'Loose take')
    await setFileState(db, unfiled, 'blocked_quota')
    renderApp({ db, path: '/recordings' })
    const list = await screen.findByRole('list', { name: 'Recordings' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('Loose take')
    expect(rows[0]).toHaveTextContent('Storage full')
    expect(rows[0]).toHaveTextContent('1:05')
    expect(rows[1]).toHaveTextContent('Angeline')
    expect(
      within(rows[0]!).getByRole('button', { name: 'Attach Loose take to a song' }),
    ).toBeInTheDocument()
  })

  it("prefers the server's duration once it is known over the local estimate", async () => {
    const id = await take(null, 'Synced take')
    // The transcoded duration lands through sync and can differ slightly from the
    // client's own count of what it recorded.
    await db.recordings.update(id, { duration_ms: 70_000 })
    renderApp({ db, path: '/recordings' })
    const list = await screen.findByRole('list', { name: 'Recordings' })
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
    const list = await screen.findByRole('list', { name: 'Recordings' })
    const row = within(list).getByRole('listitem')
    expect(await within(row).findByText(/500 MB of 1 GB used/)).toBeInTheDocument()
  })

  it('offers no per-recording keep offline control', async () => {
    await take(null, 'Loose take')
    renderApp({ db, path: '/recordings' })
    const list = await screen.findByRole('list', { name: 'Recordings' })
    expect(within(list).queryByRole('checkbox')).toBeNull()
  })

  it('shows why an upload failed and retries it', async () => {
    const id = await take(null, 'Refused')
    await setFileState(db, id, 'failed_upload', 'Unsupported audio type')
    const sync = vi.fn(async () => {})
    renderApp({ db, path: '/recordings', engine: fakeEngine({ sync }) })
    const list = await screen.findByRole('list', { name: 'Recordings' })
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
    const list = await screen.findByRole('list', { name: 'Recordings' })
    expect(
      within(list).getByRole('button', { name: 'Attach Angeline take to a song' }),
    ).toBeInTheDocument()
    expect(within(list).queryByRole('link', { name: /Open/ })).not.toBeInTheDocument()
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
