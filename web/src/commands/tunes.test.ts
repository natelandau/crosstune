import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pendingBatch, pendingFor } from '../db/outbox'
import type { CrosstuneDb } from '../db/schema'
import { openTestDb } from '../test/db'
import { addLink } from './links'
import { addToList, createList } from './lists'
import { TUNE_NOT_FOUND } from './messages'
import { appendChunk, beginCapture, finishCapture } from './recordings'
import {
  createTune,
  deleteTune,
  setArchived,
  updateTune,
  updateTuneEntry,
  updateUserTune,
} from './tunes'

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

describe('createTune', () => {
  it('writes the tune and the user tune with defaults and queues both', async () => {
    const { tuneId, userTuneId } = await createTune(
      db,
      { title: ' Cluck Old Hen ' },
      { status: 'learning' },
    )
    const tune = await db.tunes.get(tuneId)
    const userTune = await db.user_tunes.get(userTuneId)
    expect(tune).toMatchObject({
      title: 'Cluck Old Hen',
      alternate_titles: [],
      is_crooked: false,
      time_signature: null,
      deleted_at: null,
      server_seq: 0,
      created_at: '2026-09-11T10:00:00.000Z',
      updated_at: '2026-09-11T10:00:00.000Z',
    })
    expect(userTune).toMatchObject({ tune_id: tuneId, status: 'learning', archived_at: null })
    const queued = await pendingBatch(db)
    expect(queued.map((e) => [e.table, e.op])).toEqual([
      ['tunes', 'upsert'],
      ['user_tunes', 'upsert'],
    ])
    expect(Object.keys(queued[0]!.data!)).not.toContain('id')
    expect(Object.keys(queued[1]!.data!)).not.toContain('user_id')
  })

  it('creates a tune with its tunings map, or an empty one', async () => {
    const withMap = await createTune(
      db,
      { title: 'Sally Ann', tunings: { guitar: { capo: 2 } } },
      { status: 'known' },
    )
    expect((await db.tunes.get(withMap.tuneId))!.tunings).toEqual({ guitar: { capo: 2 } })
    const without = await createTune(db, { title: 'Sally Goodin' }, { status: 'known' })
    expect((await db.tunes.get(without.tuneId))!.tunings).toEqual({})
  })

  it('creates a tune with a type, part modes, and a composer', async () => {
    const { tuneId } = await createTune(
      db,
      { title: 'The Kesh', tune_type: 'Jig', modes: ['major', 'mixolydian'], composer: 'Trad.' },
      { status: 'known' },
    )
    expect(await db.tunes.get(tuneId)).toMatchObject({
      tune_type: 'Jig',
      modes: ['major', 'mixolydian'],
      composer: 'Trad.',
    })
  })

  it('creates a tune with no type, modes, or composer as empty values', async () => {
    const { tuneId } = await createTune(db, { title: 'Sally Ann' }, { status: 'known' })
    expect(await db.tunes.get(tuneId)).toMatchObject({ tune_type: null, modes: [], composer: null })
  })

  it('rejects an empty title', async () => {
    await expect(createTune(db, { title: '  ' }, { status: 'known' })).rejects.toThrow()
    expect(await db.tunes.count()).toBe(0)
  })
})

describe('updateTune / updateUserTune', () => {
  it('bumps updated_at, keeps one outbox entry per row, and ignores undefined', async () => {
    const { tuneId, userTuneId } = await createTune(
      db,
      { title: 'Angeline', key: 'A' },
      { status: 'known' },
    )
    vi.setSystemTime(new Date('2026-09-11T10:05:00.000Z'))
    await updateTune(db, tuneId, {
      tunings: { violin: { tuning: 'AEAE' }, five_string_banjo: { tuning: 'gDGBD' } },
      key: undefined,
    })
    await updateUserTune(db, userTuneId, { notes: 'from Bruce' })
    const tune = await db.tunes.get(tuneId)
    expect(tune).toMatchObject({
      key: 'A',
      tunings: { violin: { tuning: 'AEAE' }, five_string_banjo: { tuning: 'gDGBD' } },
      updated_at: '2026-09-11T10:05:00.000Z',
    })
    expect((await db.user_tunes.get(userTuneId))?.notes).toBe('from Bruce')
    expect(await pendingBatch(db)).toHaveLength(2)
    expect((await pendingFor(db, 'tunes', tuneId))?.data?.tunings).toEqual({
      violin: { tuning: 'AEAE' },
      five_string_banjo: { tuning: 'gDGBD' },
    })
  })

  it('archives and unarchives through archived_at', async () => {
    const { userTuneId } = await createTune(db, { title: 'X' }, { status: 'known' })
    await setArchived(db, userTuneId, true)
    expect((await db.user_tunes.get(userTuneId))?.archived_at).toBe('2026-09-11T10:00:00.000Z')
    await setArchived(db, userTuneId, false)
    expect((await db.user_tunes.get(userTuneId))?.archived_at).toBeNull()
  })
})

describe('updateTuneEntry', () => {
  it('saves the tune and the user tune together', async () => {
    const ids = await createTune(db, { title: 'Angeline' }, { status: 'known' })
    await updateTuneEntry(db, ids, { key: 'A' }, { notes: 'from Bruce' })
    expect((await db.tunes.get(ids.tuneId))?.key).toBe('A')
    expect((await db.user_tunes.get(ids.userTuneId))?.notes).toBe('from Bruce')
  })

  it('writes neither row when the user tune write fails', async () => {
    const { tuneId, userTuneId } = await createTune(db, { title: 'Angeline' }, { status: 'known' })
    await db.outbox.clear()
    await db.user_tunes.delete(userTuneId)
    await expect(
      updateTuneEntry(db, { tuneId, userTuneId }, { key: 'A' }, { notes: 'from Bruce' }),
    ).rejects.toThrow(TUNE_NOT_FOUND)
    expect((await db.tunes.get(tuneId))?.key).toBeNull()
    expect(await pendingBatch(db)).toHaveLength(0)
  })
})

describe('deleteTune', () => {
  it('tombstones the tune and its dependents locally, queuing only the tune delete', async () => {
    const { tuneId, userTuneId } = await createTune(db, { title: 'X' }, { status: 'known' })
    const linkId = await addLink(db, tuneId, { url: 'https://youtu.be/abc', provider: 'youtube' })
    const listId = await createList(db, 'Tuesday')
    const itemId = await addToList(db, listId, userTuneId)
    const recordingId = 'recording-1'
    await beginCapture(db, recordingId, { tuneId: null, recordedAt: new Date().toISOString() })
    await appendChunk(db, recordingId, 0, new Blob(['x']))
    await finishCapture(db, recordingId, {
      tuneId,
      mime: 'audio/mp4',
      durationMs: 1000,
      recordedAt: '2026-09-11T10:00:00.000Z',
    })
    vi.setSystemTime(new Date('2026-09-11T11:00:00.000Z'))
    await deleteTune(db, tuneId)

    for (const row of [
      await db.tunes.get(tuneId),
      await db.user_tunes.get(userTuneId),
      await db.recording_links.get(linkId),
      await db.list_items.get(itemId),
      await db.recordings.get(recordingId),
    ]) {
      expect(row?.deleted_at).toBe('2026-09-11T11:00:00.000Z')
    }
    const queued = await pendingBatch(db)
    expect(queued.map((e) => [e.table, e.op])).toEqual([
      ['tunes', 'delete'],
      ['lists', 'upsert'],
    ])
  })
})
