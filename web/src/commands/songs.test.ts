import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pendingBatch, pendingFor } from '../db/outbox'
import type { CrosstuneDb } from '../db/schema'
import { openTestDb } from '../test/db'
import { addLink } from './links'
import { addToList, createList } from './lists'
import { SONG_NOT_FOUND } from './messages'
import { appendChunk, beginCapture, finishCapture } from './recordings'
import {
  createSong,
  deleteSong,
  setArchived,
  updateSong,
  updateSongEntry,
  updateUserSong,
} from './songs'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-11T10:00:00.000Z'))
})

afterEach(async () => {
  vi.useRealTimers()
  await db.delete()
})

describe('createSong', () => {
  it('writes the song and the user song with defaults and queues both', async () => {
    const { songId, userSongId } = await createSong(
      db,
      { title: ' Cluck Old Hen ' },
      { status: 'learning' },
    )
    const song = await db.songs.get(songId)
    const userSong = await db.user_songs.get(userSongId)
    expect(song).toMatchObject({
      title: 'Cluck Old Hen',
      alternate_titles: [],
      is_crooked: false,
      time_signature: null,
      deleted_at: null,
      server_seq: 0,
      created_at: '2026-09-11T10:00:00.000Z',
      updated_at: '2026-09-11T10:00:00.000Z',
    })
    expect(userSong).toMatchObject({ song_id: songId, status: 'learning', archived_at: null })
    const queued = await pendingBatch(db)
    expect(queued.map((e) => [e.table, e.op])).toEqual([
      ['songs', 'upsert'],
      ['user_songs', 'upsert'],
    ])
    expect(Object.keys(queued[0]!.data!)).not.toContain('id')
    expect(Object.keys(queued[1]!.data!)).not.toContain('user_id')
  })

  it('rejects an empty title', async () => {
    await expect(createSong(db, { title: '  ' }, { status: 'known' })).rejects.toThrow()
    expect(await db.songs.count()).toBe(0)
  })
})

describe('updateSong / updateUserSong', () => {
  it('bumps updated_at, keeps one outbox entry per row, and ignores undefined', async () => {
    const { songId, userSongId } = await createSong(
      db,
      { title: 'Angeline', key: 'A' },
      { status: 'known' },
    )
    vi.setSystemTime(new Date('2026-09-11T10:05:00.000Z'))
    await updateSong(db, songId, { violin_tuning: 'AEAE', banjo_tuning: 'gDGBD', key: undefined })
    await updateUserSong(db, userSongId, { notes: 'from Bruce' })
    const song = await db.songs.get(songId)
    expect(song).toMatchObject({
      key: 'A',
      violin_tuning: 'AEAE',
      banjo_tuning: 'gDGBD',
      updated_at: '2026-09-11T10:05:00.000Z',
    })
    expect((await db.user_songs.get(userSongId))?.notes).toBe('from Bruce')
    expect(await pendingBatch(db)).toHaveLength(2)
    expect((await pendingFor(db, 'songs', songId))?.data?.violin_tuning).toBe('AEAE')
    expect((await pendingFor(db, 'songs', songId))?.data?.banjo_tuning).toBe('gDGBD')
  })

  it('archives and unarchives through archived_at', async () => {
    const { userSongId } = await createSong(db, { title: 'X' }, { status: 'known' })
    await setArchived(db, userSongId, true)
    expect((await db.user_songs.get(userSongId))?.archived_at).toBe('2026-09-11T10:00:00.000Z')
    await setArchived(db, userSongId, false)
    expect((await db.user_songs.get(userSongId))?.archived_at).toBeNull()
  })
})

describe('updateSongEntry', () => {
  it('saves the song and the user song together', async () => {
    const ids = await createSong(db, { title: 'Angeline' }, { status: 'known' })
    await updateSongEntry(db, ids, { key: 'A' }, { notes: 'from Bruce' })
    expect((await db.songs.get(ids.songId))?.key).toBe('A')
    expect((await db.user_songs.get(ids.userSongId))?.notes).toBe('from Bruce')
  })

  it('writes neither row when the user song write fails', async () => {
    const { songId, userSongId } = await createSong(db, { title: 'Angeline' }, { status: 'known' })
    await db.outbox.clear()
    await db.user_songs.delete(userSongId)
    await expect(
      updateSongEntry(db, { songId, userSongId }, { key: 'A' }, { notes: 'from Bruce' }),
    ).rejects.toThrow(SONG_NOT_FOUND)
    expect((await db.songs.get(songId))?.key).toBeNull()
    expect(await pendingBatch(db)).toHaveLength(0)
  })
})

describe('deleteSong', () => {
  it('tombstones the song and its dependents locally, queuing only the song delete', async () => {
    const { songId, userSongId } = await createSong(db, { title: 'X' }, { status: 'known' })
    const linkId = await addLink(db, songId, { url: 'https://youtu.be/abc', provider: 'youtube' })
    const listId = await createList(db, 'Tuesday')
    const itemId = await addToList(db, listId, userSongId)
    const recordingId = 'recording-1'
    await beginCapture(db, recordingId, { songId: null, recordedAt: new Date().toISOString() })
    await appendChunk(db, recordingId, 0, new Blob(['x']))
    await finishCapture(db, recordingId, {
      songId,
      mime: 'audio/mp4',
      durationMs: 1000,
      recordedAt: '2026-09-11T10:00:00.000Z',
    })
    vi.setSystemTime(new Date('2026-09-11T11:00:00.000Z'))
    await deleteSong(db, songId)

    for (const row of [
      await db.songs.get(songId),
      await db.user_songs.get(userSongId),
      await db.recording_links.get(linkId),
      await db.list_items.get(itemId),
      await db.recordings.get(recordingId),
    ]) {
      expect(row?.deleted_at).toBe('2026-09-11T11:00:00.000Z')
    }
    const queued = await pendingBatch(db)
    expect(queued.map((e) => [e.table, e.op])).toEqual([
      ['songs', 'delete'],
      ['lists', 'upsert'],
    ])
  })
})
