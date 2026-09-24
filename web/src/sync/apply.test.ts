import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSong, deleteSong, updateSong } from '../commands/songs'
import { getPullCursor } from '../db/meta'
import { pendingBatch, pendingFor } from '../db/outbox'
import type { CrosstuneDb } from '../db/schema'
import { openTestDb } from '../test/db'
import { serverSong, serverUserSong } from '../test/fakeApi'
import { applyPullPage, applyPushResults, compareTimestamps } from './apply'

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

describe('compareTimestamps', () => {
  it('treats millisecond and microsecond spellings of one instant as equal', () => {
    expect(compareTimestamps('2026-09-11T10:00:00.123Z', '2026-09-11T10:00:00.123000Z')).toBe(0)
    expect(compareTimestamps('2026-09-11T10:00:01Z', '2026-09-11T10:00:00Z')).toBeGreaterThan(0)
  })
})

describe('applyPushResults', () => {
  it('stores the server row and clears the entry on applied', async () => {
    const { songId } = await createSong(db, { title: 'X' }, { status: 'known' })
    const sent = await pendingBatch(db)
    await applyPushResults(db, sent, [
      {
        table: 'songs',
        id: songId,
        status: 'applied',
        row: serverSong({ id: songId, title: 'X', server_seq: 44 }),
      },
      { table: 'user_songs', id: sent[1]!.row_id, status: 'applied' },
    ])
    expect((await db.songs.get(songId))?.server_seq).toBe(44)
    expect('owner_user_id' in (await db.songs.get(songId))!).toBe(false)
    expect(await pendingBatch(db)).toHaveLength(0)
  })

  it('overwrites the local row on stale and reports the rejection on invalid', async () => {
    const { songId } = await createSong(db, { title: 'Mine' }, { status: 'known' })
    const sent = await pendingBatch(db)
    const { invalid, settled } = await applyPushResults(db, sent, [
      {
        table: 'songs',
        id: songId,
        status: 'stale',
        row: serverSong({ id: songId, title: 'Theirs', updated_at: '2026-09-11T12:00:00Z' }),
      },
      { table: 'user_songs', id: sent[1]!.row_id, status: 'invalid', reason: 'nope' },
    ])
    expect((await db.songs.get(songId))?.title).toBe('Theirs')
    expect((await db.user_songs.get(sent[1]!.row_id))?.status).toBe('known')
    expect(await pendingBatch(db)).toHaveLength(0)
    expect(invalid).toEqual([{ table: 'user_songs', id: sent[1]!.row_id, reason: 'nope' }])
    expect(settled).toBe(2)
  })

  it('settles a rejected delete without reporting it', async () => {
    const { songId } = await createSong(db, { title: 'X' }, { status: 'known' })
    await deleteSong(db, songId)
    const sent = await pendingBatch(db)
    const { invalid, settled } = await applyPushResults(db, sent, [
      { table: 'songs', id: songId, status: 'invalid', reason: 'not found' },
    ])
    expect(invalid).toEqual([])
    expect(settled).toBe(1)
    expect(await pendingBatch(db)).toHaveLength(0)
  })

  it('counts only the entries it settled', async () => {
    const { songId } = await createSong(db, { title: 'v1' }, { status: 'known' })
    const sent = await pendingBatch(db)
    const { settled } = await applyPushResults(db, sent, [
      { table: 'songs', id: songId, status: 'applied' },
    ])
    expect(settled).toBe(1)
    expect(await pendingBatch(db)).toHaveLength(1)
  })

  it('leaves an entry that changed while the batch was in flight', async () => {
    const { songId } = await createSong(db, { title: 'v1' }, { status: 'known' })
    const sent = await pendingBatch(db)
    vi.setSystemTime(new Date('2026-09-11T10:00:05.000Z'))
    await updateSong(db, songId, { title: 'v2' })
    await applyPushResults(db, sent, [
      {
        table: 'songs',
        id: songId,
        status: 'applied',
        row: serverSong({ id: songId, title: 'v1' }),
      },
      { table: 'user_songs', id: sent[1]!.row_id, status: 'applied' },
    ])
    expect((await db.songs.get(songId))?.title).toBe('v2')
    expect((await pendingFor(db, 'songs', songId))?.data?.title).toBe('v2')
  })

  it('leaves an entry written in the same millisecond as the batch it follows', async () => {
    const { songId } = await createSong(db, { title: 'v1' }, { status: 'known' })
    const sent = await pendingBatch(db)
    await updateSong(db, songId, { title: 'v2' })
    await applyPushResults(db, sent, [
      {
        table: 'songs',
        id: songId,
        status: 'applied',
        row: serverSong({ id: songId, title: 'v1' }),
      },
      { table: 'user_songs', id: sent[1]!.row_id, status: 'applied' },
    ])
    const pending = await pendingFor(db, 'songs', songId)
    expect((await db.songs.get(songId))?.title).toBe('v2')
    expect(pending?.data?.title).toBe('v2')
    // The server takes only a strictly newer write, so the retry must not tie the first.
    expect(compareTimestamps(pending!.updated_at, sent[0]!.updated_at)).toBeGreaterThan(0)
  })
})

describe('applyPullPage', () => {
  it('stores rows without ownership, drops older pending entries, and advances the cursor', async () => {
    const { songId, userSongId } = await createSong(db, { title: 'local' }, { status: 'known' })
    await applyPullPage(
      db,
      [
        {
          table: 'songs',
          row: serverSong({
            id: songId,
            title: 'server',
            updated_at: '2026-09-11T10:00:00.000000Z',
            server_seq: 3,
          }),
        },
        {
          table: 'user_songs',
          row: serverUserSong({
            id: userSongId,
            song_id: songId,
            updated_at: '2026-09-11T10:00:00Z',
            server_seq: 4,
          }),
        },
        { table: 'songs', row: serverSong({ id: 'other', title: 'Other', server_seq: 5 }) },
      ],
      5,
    )
    expect(await db.songs.get(songId)).toMatchObject({ title: 'server', server_seq: 3 })
    expect('user_id' in (await db.user_songs.get(userSongId))!).toBe(false)
    expect((await db.songs.get('other'))?.title).toBe('Other')
    expect(await pendingBatch(db)).toHaveLength(0)
    expect(await getPullCursor(db)).toBe(5)
  })

  it('skips a row with a newer local write still pending', async () => {
    const { songId } = await createSong(db, { title: 'newer local' }, { status: 'known' })
    await applyPullPage(
      db,
      [
        {
          table: 'songs',
          row: serverSong({
            id: songId,
            title: 'older server',
            updated_at: '2026-09-11T09:00:00Z',
          }),
        },
      ],
      9,
    )
    expect((await db.songs.get(songId))?.title).toBe('newer local')
    expect(await pendingFor(db, 'songs', songId)).toBeDefined()
    expect(await getPullCursor(db)).toBe(9)
  })
})
