import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { pendingFor } from '../db/outbox'
import type { CrosstuneDb } from '../db/schema'
import { openTestDb } from '../test/db'
import { addToList, createList } from './lists'
import {
  addUploadedFile,
  appendChunk,
  beginCapture,
  cancelCapture,
  clearUnpinnedBlobs,
  deleteRecording,
  finishCapture,
  isKeptOffline,
  localAudioBytes,
  retryUpload,
  setFileState,
  setListKeepOffline,
  setPinned,
  setSongKeepOffline,
  storeDownloadedBlob,
  updateRecording,
} from './recordings'
import { createSong, deleteSong } from './songs'
import { newId } from './write'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

afterEach(async () => {
  await db.delete()
})

const AT = '2026-09-14T20:00:00.000Z'

async function captured(songId: string | null = null): Promise<string> {
  const id = newId()
  await beginCapture(db, id, { songId: null, recordedAt: new Date().toISOString() })
  await appendChunk(db, id, 0, new Blob(['ab'], { type: 'audio/mp4' }))
  await appendChunk(db, id, 1, new Blob(['cd'], { type: 'audio/mp4' }))
  await finishCapture(db, id, { songId, mime: 'audio/mp4', durationMs: 10_000, recordedAt: AT })
  return id
}

describe('capture', () => {
  it('assembles chunks into one blob and queues the synced row', async () => {
    const id = await captured()
    const file = await db.recording_files.get(id)
    expect(file).toMatchObject({
      local_state: 'captured',
      bytes: 4,
      mime: 'audio/mp4',
      pinned: false,
    })
    expect(await file?.blob?.text()).toBe('abcd')
    expect(await db.recording_chunks.where('recording_id').equals(id).count()).toBe(0)
    const row = await db.recordings.get(id)
    expect(row).toMatchObject({
      song_id: null,
      source: 'microphone',
      recorded_at: AT,
      state: 'pending_upload',
    })
    const queued = await pendingFor(db, 'recordings', id)
    expect(queued?.data).toMatchObject({ source: 'microphone', recorded_at: AT, position: 0 })
    expect(queued?.data).not.toHaveProperty('state')
  })

  it('cancel drops the chunks and the file row', async () => {
    const id = newId()
    await beginCapture(db, id, { songId: null, recordedAt: new Date().toISOString() })
    await appendChunk(db, id, 0, new Blob(['x']))
    await cancelCapture(db, id)
    expect(await db.recording_files.get(id)).toBeUndefined()
    expect(await db.recording_chunks.count()).toBe(0)
    expect(await db.recordings.get(id)).toBeUndefined()
  })

  it('attaches to a song and positions after existing recordings', async () => {
    const { songId } = await createSong(db, { title: 'X' }, { status: 'known' })
    await captured(songId)
    const second = await captured(songId)
    expect((await db.recordings.get(second))?.position).toBe(1)
  })

  it('ignores a repeated finish for an already finished capture', async () => {
    const id = await captured()
    const position = (await db.recordings.get(id))?.position
    await finishCapture(db, id, {
      songId: null,
      mime: 'audio/mp4',
      durationMs: 5_000,
      recordedAt: AT,
    })
    const file = await db.recording_files.get(id)
    expect(await file?.blob?.text()).toBe('abcd')
    expect(file?.bytes).toBe(4)
    expect((await db.recordings.get(id))?.position).toBe(position)
  })

  it('leaves a finished take alone when cancelCapture races it', async () => {
    const id = await captured()
    const file = await db.recording_files.get(id)
    const row = await db.recordings.get(id)
    await cancelCapture(db, id)
    expect(await db.recording_files.get(id)).toEqual(file)
    expect(await db.recordings.get(id)).toEqual(row)
  })

  it('ignores a finish after cancelCapture', async () => {
    const id = newId()
    await beginCapture(db, id, { songId: null, recordedAt: new Date().toISOString() })
    await appendChunk(db, id, 0, new Blob(['x']))
    await cancelCapture(db, id)
    await finishCapture(db, id, {
      songId: null,
      mime: 'audio/mp4',
      durationMs: 1000,
      recordedAt: AT,
    })
    expect(await db.recordings.get(id)).toBeUndefined()
    expect(await db.recording_files.get(id)).toBeUndefined()
  })

  it('writes nothing for a chunk with no file row', async () => {
    await appendChunk(db, 'ghost', 0, new Blob(['x']))
    expect(await db.recording_chunks.where('recording_id').equals('ghost').count()).toBe(0)
  })

  it('writes nothing for a chunk that arrives once the capture has finished', async () => {
    const id = await captured()
    await appendChunk(db, id, 5, new Blob(['x'], { type: 'audio/mp4' }))
    expect(await db.recording_chunks.where('recording_id').equals(id).count()).toBe(0)
    expect((await db.recording_files.get(id))?.last_chunk_at).toBeNull()
  })
})

describe('uploads and edits', () => {
  it('stores an uploaded file as captured with its type', async () => {
    const file = new File(['wav-bytes'], 'jam.wav', { type: 'audio/wav' })
    const id = await addUploadedFile(db, file, { songId: null, label: 'Field recorder' })
    expect(await db.recording_files.get(id)).toMatchObject({
      local_state: 'captured',
      mime: 'audio/wav',
      bytes: 9,
    })
    expect(await db.recordings.get(id)).toMatchObject({ source: 'upload', label: 'Field recorder' })
  })

  it('updates label and song and queues the row', async () => {
    const { songId } = await createSong(db, { title: 'X' }, { status: 'known' })
    const id = await captured()
    await updateRecording(db, id, { label: 'Take 2', song_id: songId })
    expect(await db.recordings.get(id)).toMatchObject({ label: 'Take 2', song_id: songId })
    expect((await pendingFor(db, 'recordings', id))?.data).toMatchObject({
      label: 'Take 2',
      song_id: songId,
    })
  })

  it('puts a failed upload back in the queue when the recording is edited', async () => {
    const id = await captured()
    await setFileState(db, id, 'failed_upload', 'bad type')
    await updateRecording(db, id, { label: 'Take 3' })
    expect(await db.recording_files.get(id)).toMatchObject({ local_state: 'captured', error: null })
  })

  it('retries a failed upload and leaves any other state alone', async () => {
    const failed = await captured()
    const uploaded = await captured()
    await setFileState(db, failed, 'failed_upload', 'bad type')
    await setFileState(db, uploaded, 'uploaded')
    await retryUpload(db, failed)
    await retryUpload(db, uploaded)
    expect(await db.recording_files.get(failed)).toMatchObject({
      local_state: 'captured',
      error: null,
    })
    expect((await db.recording_files.get(uploaded))?.local_state).toBe('uploaded')
  })

  it('rejects moving a recording to a deleted song and leaves the row unchanged', async () => {
    const { songId } = await createSong(db, { title: 'X' }, { status: 'known' })
    await deleteSong(db, songId)
    const id = await captured()
    const before = await db.recordings.get(id)
    await expect(updateRecording(db, id, { song_id: songId })).rejects.toThrow('Song not found')
    expect(await db.recordings.get(id)).toEqual(before)
  })

  it('deletes with a tombstone and drops the local file', async () => {
    const id = await captured()
    await deleteRecording(db, id)
    expect((await db.recordings.get(id))?.deleted_at).not.toBeNull()
    expect((await pendingFor(db, 'recordings', id))?.op).toBe('delete')
    expect(await db.recording_files.get(id)).toBeUndefined()
  })

  it('deleting a song tombstones its recordings without a second delete change', async () => {
    const { songId } = await createSong(db, { title: 'X' }, { status: 'known' })
    const id = await captured(songId)
    await deleteSong(db, songId)
    expect((await db.recordings.get(id))?.deleted_at).not.toBeNull()
    expect(await pendingFor(db, 'recordings', id)).toBeUndefined()
    expect(await db.recording_files.get(id)).toBeUndefined()
  })
})

describe('keep offline marks and local audio', () => {
  it('marks a song and reports its recordings kept offline, until unmarked', async () => {
    const a = await createSong(db, { title: 'A' }, { status: 'known' })
    const b = await createSong(db, { title: 'B' }, { status: 'known' })
    const ra = await captured(a.songId)
    const rb = await captured(b.songId)
    await setSongKeepOffline(db, a.songId, true)
    expect(await isKeptOffline(db, { id: ra, song_id: a.songId })).toBe(true)
    expect(await isKeptOffline(db, { id: rb, song_id: b.songId })).toBe(false)
    await setSongKeepOffline(db, a.songId, false)
    expect(await isKeptOffline(db, { id: ra, song_id: a.songId })).toBe(false)
  })

  it('marks a list and covers a song added to it, including one with no local file row', async () => {
    const { songId, userSongId } = await createSong(db, { title: 'B' }, { status: 'known' })
    const listId = await createList(db, 'Set')
    await addToList(db, listId, userSongId)
    await setListKeepOffline(db, listId, true)
    expect(await isKeptOffline(db, { id: 'server-rec', song_id: songId })).toBe(true)
  })

  it('keeps a file row pinned on its own, independent of any song or list mark', async () => {
    const id = await captured()
    await setPinned(db, [id], true)
    expect(await isKeptOffline(db, { id, song_id: null })).toBe(true)
  })

  it('stores a downloaded blob and clears only unpinned ones', async () => {
    const kept = await captured()
    const dropped = await captured()
    await db.recording_files.update(kept, { pinned: true })
    await setFileState(db, dropped, 'uploaded')
    await db.recordings.update(dropped, { state: 'ready' })
    await storeDownloadedBlob(db, 'other', new Blob(['12345']), 'audio/mp4')
    await db.recordings.put({
      id: 'other',
      created_at: AT,
      updated_at: AT,
      deleted_at: null,
      server_seq: 1,
      song_id: null,
      label: null,
      source: 'microphone',
      recorded_at: AT,
      position: 0,
      state: 'ready',
      duration_ms: 1000,
      playback_mime: 'audio/mp4',
      playback_bytes: 5,
      error: null,
    })
    expect(await localAudioBytes(db)).toBe(4 + 4 + 5)
    await clearUnpinnedBlobs(db)
    expect((await db.recording_files.get(kept))?.blob).not.toBeNull()
    expect((await db.recording_files.get(dropped))?.blob).toBeNull()
    expect((await db.recording_files.get('other'))?.blob).toBeNull()
    expect(await localAudioBytes(db)).toBe(4)
  })

  it('keeps blobs stuck in a blocked or failed upload state', async () => {
    const blocked = await captured()
    const failed = await captured()
    await setFileState(db, blocked, 'blocked_quota')
    await setFileState(db, failed, 'failed_upload')
    await clearUnpinnedBlobs(db)
    expect((await db.recording_files.get(blocked))?.blob).not.toBeNull()
    expect((await db.recording_files.get(failed))?.blob).not.toBeNull()
  })

  it('keeps the blob of a recording whose song is kept offline, even without a pin', async () => {
    const { songId } = await createSong(db, { title: 'A' }, { status: 'known' })
    const id = await captured(songId)
    await setFileState(db, id, 'uploaded')
    await db.recordings.update(id, { state: 'ready' })
    await setSongKeepOffline(db, songId, true)
    await clearUnpinnedBlobs(db)
    expect((await db.recording_files.get(id))?.blob).not.toBeNull()
  })

  it('only clears an uploaded blob once its recording is ready to play', async () => {
    const ready = await captured()
    const processing = await captured()
    const failed = await captured()
    await setFileState(db, ready, 'uploaded')
    await setFileState(db, processing, 'uploaded')
    await setFileState(db, failed, 'uploaded')
    await db.recordings.update(ready, { state: 'ready' })
    await db.recordings.update(processing, { state: 'processing' })
    await db.recordings.update(failed, { state: 'failed' })
    await clearUnpinnedBlobs(db)
    expect((await db.recording_files.get(ready))?.blob).toBeNull()
    expect((await db.recording_files.get(processing))?.blob).not.toBeNull()
    expect((await db.recording_files.get(failed))?.blob).not.toBeNull()
  })
})
