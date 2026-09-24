import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTune, deleteTune, updateTune } from '../commands/tunes'
import { getPullCursor } from '../db/meta'
import { pendingBatch, pendingFor } from '../db/outbox'
import type { CrosstuneDb } from '../db/schema'
import { openTestDb } from '../test/db'
import { serverTune, serverUserTune } from '../test/fakeApi'
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
    const { tuneId } = await createTune(db, { title: 'X' }, { status: 'known' })
    const sent = await pendingBatch(db)
    await applyPushResults(db, sent, [
      {
        table: 'tunes',
        id: tuneId,
        status: 'applied',
        row: serverTune({ id: tuneId, title: 'X', server_seq: 44 }),
      },
      { table: 'user_tunes', id: sent[1]!.row_id, status: 'applied' },
    ])
    expect((await db.tunes.get(tuneId))?.server_seq).toBe(44)
    expect('owner_user_id' in (await db.tunes.get(tuneId))!).toBe(false)
    expect(await pendingBatch(db)).toHaveLength(0)
  })

  it('overwrites the local row on stale and reports the rejection on invalid', async () => {
    const { tuneId } = await createTune(db, { title: 'Mine' }, { status: 'known' })
    const sent = await pendingBatch(db)
    const { invalid, settled } = await applyPushResults(db, sent, [
      {
        table: 'tunes',
        id: tuneId,
        status: 'stale',
        row: serverTune({ id: tuneId, title: 'Theirs', updated_at: '2026-09-11T12:00:00Z' }),
      },
      { table: 'user_tunes', id: sent[1]!.row_id, status: 'invalid', reason: 'nope' },
    ])
    expect((await db.tunes.get(tuneId))?.title).toBe('Theirs')
    expect((await db.user_tunes.get(sent[1]!.row_id))?.status).toBe('known')
    expect(await pendingBatch(db)).toHaveLength(0)
    expect(invalid).toEqual([{ table: 'user_tunes', id: sent[1]!.row_id, reason: 'nope' }])
    expect(settled).toBe(2)
  })

  it('settles a rejected delete without reporting it', async () => {
    const { tuneId } = await createTune(db, { title: 'X' }, { status: 'known' })
    await deleteTune(db, tuneId)
    const sent = await pendingBatch(db)
    const { invalid, settled } = await applyPushResults(db, sent, [
      { table: 'tunes', id: tuneId, status: 'invalid', reason: 'not found' },
    ])
    expect(invalid).toEqual([])
    expect(settled).toBe(1)
    expect(await pendingBatch(db)).toHaveLength(0)
  })

  it('counts only the entries it settled', async () => {
    const { tuneId } = await createTune(db, { title: 'v1' }, { status: 'known' })
    const sent = await pendingBatch(db)
    const { settled } = await applyPushResults(db, sent, [
      { table: 'tunes', id: tuneId, status: 'applied' },
    ])
    expect(settled).toBe(1)
    expect(await pendingBatch(db)).toHaveLength(1)
  })

  it('leaves an entry that changed while the batch was in flight', async () => {
    const { tuneId } = await createTune(db, { title: 'v1' }, { status: 'known' })
    const sent = await pendingBatch(db)
    vi.setSystemTime(new Date('2026-09-11T10:00:05.000Z'))
    await updateTune(db, tuneId, { title: 'v2' })
    await applyPushResults(db, sent, [
      {
        table: 'tunes',
        id: tuneId,
        status: 'applied',
        row: serverTune({ id: tuneId, title: 'v1' }),
      },
      { table: 'user_tunes', id: sent[1]!.row_id, status: 'applied' },
    ])
    expect((await db.tunes.get(tuneId))?.title).toBe('v2')
    expect((await pendingFor(db, 'tunes', tuneId))?.data?.title).toBe('v2')
  })

  it('leaves an entry written in the same millisecond as the batch it follows', async () => {
    const { tuneId } = await createTune(db, { title: 'v1' }, { status: 'known' })
    const sent = await pendingBatch(db)
    await updateTune(db, tuneId, { title: 'v2' })
    await applyPushResults(db, sent, [
      {
        table: 'tunes',
        id: tuneId,
        status: 'applied',
        row: serverTune({ id: tuneId, title: 'v1' }),
      },
      { table: 'user_tunes', id: sent[1]!.row_id, status: 'applied' },
    ])
    const pending = await pendingFor(db, 'tunes', tuneId)
    expect((await db.tunes.get(tuneId))?.title).toBe('v2')
    expect(pending?.data?.title).toBe('v2')
    // The server takes only a strictly newer write, so the retry must not tie the first.
    expect(compareTimestamps(pending!.updated_at, sent[0]!.updated_at)).toBeGreaterThan(0)
  })
})

describe('applyPullPage', () => {
  it('stores rows without ownership, drops older pending entries, and advances the cursor', async () => {
    const { tuneId, userTuneId } = await createTune(db, { title: 'local' }, { status: 'known' })
    await applyPullPage(
      db,
      [
        {
          table: 'tunes',
          row: serverTune({
            id: tuneId,
            title: 'server',
            updated_at: '2026-09-11T10:00:00.000000Z',
            server_seq: 3,
          }),
        },
        {
          table: 'user_tunes',
          row: serverUserTune({
            id: userTuneId,
            tune_id: tuneId,
            updated_at: '2026-09-11T10:00:00Z',
            server_seq: 4,
          }),
        },
        { table: 'tunes', row: serverTune({ id: 'other', title: 'Other', server_seq: 5 }) },
      ],
      5,
    )
    expect(await db.tunes.get(tuneId)).toMatchObject({ title: 'server', server_seq: 3 })
    expect('user_id' in (await db.user_tunes.get(userTuneId))!).toBe(false)
    expect((await db.tunes.get('other'))?.title).toBe('Other')
    expect(await pendingBatch(db)).toHaveLength(0)
    expect(await getPullCursor(db)).toBe(5)
  })

  it('skips a row with a newer local write still pending', async () => {
    const { tuneId } = await createTune(db, { title: 'newer local' }, { status: 'known' })
    await applyPullPage(
      db,
      [
        {
          table: 'tunes',
          row: serverTune({
            id: tuneId,
            title: 'older server',
            updated_at: '2026-09-11T09:00:00Z',
          }),
        },
      ],
      9,
    )
    expect((await db.tunes.get(tuneId))?.title).toBe('newer local')
    expect(await pendingFor(db, 'tunes', tuneId)).toBeDefined()
    expect(await getPullCursor(db)).toBe(9)
  })
})
