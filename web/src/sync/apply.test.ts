import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { recordEvent } from '../commands/events'
import { createTune, deleteTune, updateTune } from '../commands/tunes'
import { deleteRecording } from '../commands/recordings'
import { addScans } from '../commands/scans'
import { addLoop } from '../commands/loops'
import {
  getEventsCursor,
  getInvalidChangeCount,
  getPremiumHolds,
  getPullCursor,
  holdForPremium,
} from '../db/meta'
import { pendingBatch, pendingFor } from '../db/outbox'
import type { CrosstuneDb } from '../db/schema'
import { openTestDb } from '../test/db'
import { serverRecording, serverTune, serverUserTune } from '../test/fakeApi'
import { captureRecording } from '../test/recordings'
import { entitlementRow, playEventRow, scanViewRow } from '../test/rows'
import type { EventRow, PullRow, RecordingLinkRow } from '../api/types'
import { applyEventsPage, applyPullPage, applyPushResults, compareTimestamps } from './apply'
import { MISSING_RECORDING_REASON, PREMIUM_REQUIRED_REASON } from './errors'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-11T10:00:00.000Z'))
})

afterEach(async () => {
  vi.useRealTimers()
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

  it('drops a rejected event without reporting it', async () => {
    await recordEvent(db, 'play_events', playEventRow('play-1'))
    const sent = await pendingBatch(db)
    const { invalid, settled } = await applyPushResults(db, sent, [
      { table: 'play_events', id: 'play-1', status: 'invalid', reason: 'invalid fields: body' },
    ])
    expect(invalid).toEqual([])
    expect(settled).toBe(1)
    expect(await db.play_events.count()).toBe(0)
    expect(await pendingBatch(db)).toHaveLength(0)
  })

  it('drops a rejected scan view without reporting it', async () => {
    await recordEvent(db, 'scan_views', scanViewRow('view-1'))
    const sent = await pendingBatch(db)
    const { invalid, settled } = await applyPushResults(db, sent, [
      { table: 'scan_views', id: 'view-1', status: 'invalid', reason: 'tune not found' },
    ])
    expect(invalid).toEqual([])
    expect(settled).toBe(1)
    expect(await db.scan_views.count()).toBe(0)
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

describe('applyPushResults under the plan', () => {
  const heldResult = (id: string) =>
    ({ table: 'recordings', id, status: 'invalid', reason: PREMIUM_REQUIRED_REASON }) as const

  it('keeps a take the server refused for Premium queued and holds it, uncounted', async () => {
    const id = await captureRecording(db)
    const sent = await pendingBatch(db)
    const { invalid, settled, held } = await applyPushResults(db, sent, [heldResult(id)])
    expect(invalid).toEqual([])
    expect(settled).toBe(0)
    expect(held).toEqual([id])
    expect(await pendingFor(db, 'recordings', id)).toBeDefined()
    expect(await getPremiumHolds(db)).toEqual(new Set([id]))
    expect(await getInvalidChangeCount(db)).toBe(0)
  })

  it('releases a hold once the take is applied', async () => {
    const id = await captureRecording(db)
    await holdForPremium(db, [id])
    const sent = await pendingBatch(db)
    await applyPushResults(db, sent, [{ table: 'recordings', id, status: 'applied' }])
    expect(await getPremiumHolds(db)).toEqual(new Set())
    expect(await pendingFor(db, 'recordings', id)).toBeUndefined()
  })

  it("releases a hold when the held take's delete is refused for a row never stored", async () => {
    const id = await captureRecording(db)
    await holdForPremium(db, [id])
    await deleteRecording(db, id)
    const sent = await pendingBatch(db)
    const { invalid, settled } = await applyPushResults(db, sent, [
      { table: 'recordings', id, status: 'invalid', reason: 'not found' },
    ])
    expect(invalid).toEqual([])
    expect(settled).toBe(1)
    expect(await getPremiumHolds(db)).toEqual(new Set())
    expect(await pendingBatch(db)).toHaveLength(0)
  })

  it("keeps a held take's loop and play queued with it, uncounted", async () => {
    const id = await captureRecording(db)
    const loopId = await addLoop(db, id, { start_ms: 1_000, end_ms: 5_000 })
    await recordEvent(db, 'play_events', playEventRow('play-1', { recording_id: id }))
    const sent = await pendingBatch(db)
    const missing = (table: 'recording_loops' | 'play_events', rowId: string) =>
      ({ table, id: rowId, status: 'invalid', reason: MISSING_RECORDING_REASON }) as const
    const { invalid, settled, held } = await applyPushResults(db, sent, [
      heldResult(id),
      missing('recording_loops', loopId),
      missing('play_events', 'play-1'),
    ])
    expect(invalid).toEqual([])
    expect(settled).toBe(0)
    expect(held).toEqual([id])
    expect(await pendingFor(db, 'recording_loops', loopId)).toBeDefined()
    expect(await pendingFor(db, 'play_events', 'play-1')).toBeDefined()
    expect(await db.play_events.get('play-1')).toBeDefined()
    expect(await getInvalidChangeCount(db)).toBe(0)
  })

  it('keeps a loop whose take an earlier push held, even when the take is not in the batch', async () => {
    const id = await captureRecording(db)
    await holdForPremium(db, [id])
    const loopId = await addLoop(db, id, { start_ms: 1_000, end_ms: 5_000 })
    const sent = (await pendingBatch(db)).filter((entry) => entry.table === 'recording_loops')
    const { invalid, settled, held } = await applyPushResults(db, sent, [
      { table: 'recording_loops', id: loopId, status: 'invalid', reason: MISSING_RECORDING_REASON },
    ])
    expect(invalid).toEqual([])
    expect(settled).toBe(0)
    expect(held).toEqual([id])
    expect(await pendingFor(db, 'recording_loops', loopId)).toBeDefined()
  })

  it('settles a refused loop once its take is no longer held', async () => {
    const id = await captureRecording(db)
    const loopId = await addLoop(db, id, { start_ms: 1_000, end_ms: 5_000 })
    const sent = (await pendingBatch(db)).filter((entry) => entry.table === 'recording_loops')
    const { invalid, settled } = await applyPushResults(db, sent, [
      { table: 'recording_loops', id: loopId, status: 'invalid', reason: MISSING_RECORDING_REASON },
    ])
    expect(invalid).toEqual([
      { table: 'recording_loops', id: loopId, reason: MISSING_RECORDING_REASON },
    ])
    expect(settled).toBe(1)
    expect(await pendingFor(db, 'recording_loops', loopId)).toBeUndefined()
  })

  it('keeps a scan the server refused for Premium queued and holds it, uncounted', async () => {
    const { tuneId } = await createTune(db, { title: 'Angeline' }, { status: 'known' })
    const [scanId] = await addScans(db, tuneId, [
      { blob: new Blob(['jpeg'], { type: 'image/jpeg' }), width: 800, height: 1200 },
    ])
    const sent = (await pendingBatch(db)).filter((entry) => entry.table === 'scans')
    const { invalid, settled, held } = await applyPushResults(db, sent, [
      { table: 'scans', id: scanId!, status: 'invalid', reason: PREMIUM_REQUIRED_REASON },
    ])
    expect(invalid).toEqual([])
    expect(settled).toBe(0)
    expect(held).toEqual([scanId])
    expect(await pendingFor(db, 'scans', scanId!)).toBeDefined()
    expect(await getPremiumHolds(db)).toEqual(new Set([scanId]))
    expect((await db.scan_files.get(scanId!))?.error).toBeNull()
    expect(await getInvalidChangeCount(db)).toBe(0)
  })

  it('releases a held scan once the server applies it', async () => {
    const { tuneId } = await createTune(db, { title: 'Angeline' }, { status: 'known' })
    const [scanId] = await addScans(db, tuneId, [
      { blob: new Blob(['jpeg'], { type: 'image/jpeg' }), width: 800, height: 1200 },
    ])
    await holdForPremium(db, [scanId!])
    const sent = (await pendingBatch(db)).filter((entry) => entry.table === 'scans')
    const { settled, held } = await applyPushResults(db, sent, [
      { table: 'scans', id: scanId!, status: 'applied' },
    ])
    expect(settled).toBe(1)
    expect(held).toEqual([])
    expect(await getPremiumHolds(db)).toEqual(new Set())
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

  it('stores a scrubbed tombstone', async () => {
    const deletedAt = '2026-09-11T09:00:00Z'
    const link: RecordingLinkRow = {
      id: 'gone-link',
      created_at: '2026-09-11T00:00:00Z',
      updated_at: deletedAt,
      deleted_at: deletedAt,
      server_seq: 7,
      added_by_user_id: 'server-user',
      tune_id: 'gone',
      url: 'https://crosstune.app/deleted',
      provider: 'other',
      provider_ref: null,
      title: null,
      artwork_url: null,
      position: 0,
    }
    await applyPullPage(
      db,
      [
        {
          table: 'tunes',
          row: serverTune({
            id: 'gone',
            title: 'deleted',
            alternate_titles: [],
            genre: null,
            tune_type: null,
            composer: null,
            lyrics: null,
            key: null,
            part_structure: null,
            time_signature: null,
            tunings: {},
            deleted_at: deletedAt,
            server_seq: 6,
          }),
        },
        { table: 'recording_links', row: link },
        {
          table: 'recordings',
          row: serverRecording({
            id: 'gone-recording',
            source: 'import',
            origin: 'slippery_hill',
            origin_url: 'https://crosstune.app/deleted',
            label: null,
            error: null,
            deleted_at: deletedAt,
            server_seq: 8,
          }),
        },
      ],
      8,
    )
    expect(await db.tunes.get('gone')).toMatchObject({
      title: 'deleted',
      alternate_titles: [],
      genre: null,
      tune_type: null,
      composer: null,
      lyrics: null,
      key: null,
      part_structure: null,
      time_signature: null,
      tunings: {},
      deleted_at: deletedAt,
    })
    expect(await db.recording_links.get('gone-link')).toMatchObject({
      url: 'https://crosstune.app/deleted',
      provider_ref: null,
      title: null,
      artwork_url: null,
      deleted_at: deletedAt,
    })
    expect(await db.recordings.get('gone-recording')).toMatchObject({
      origin_url: 'https://crosstune.app/deleted',
      label: null,
      error: null,
      deleted_at: deletedAt,
    })
    expect(await getPullCursor(db)).toBe(8)
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

describe('applyPullPage entitlements', () => {
  it('stores a pulled entitlements row without its ownership keys and advances the cursor', async () => {
    const row = { ...entitlementRow({ premium_source: 'comp' }), user_id: 'server-user' }
    await applyPullPage(db, [{ table: 'entitlements', row } as unknown as PullRow], 12)
    const stored = await db.entitlements.get(row.id)
    expect(stored?.premium_source).toBe('comp')
    expect('user_id' in stored!).toBe(false)
    expect(await getPullCursor(db)).toBe(12)
  })

  it('skips a table this client does not store and still advances the cursor', async () => {
    const unknown = { table: 'jam_sessions', row: { id: 'jam-1', server_seq: 5 } }
    await applyPullPage(db, [unknown as unknown as PullRow], 5)
    expect(await getPullCursor(db)).toBe(5)
    expect(await db.entitlements.count()).toBe(0)
  })
})

describe('applyEventsPage', () => {
  it('skips a table this client has no store for and still advances the cursor', async () => {
    const change: EventRow = {
      table: 'status_changes',
      row: {
        id: 'change-1',
        user_tune_id: 'ut-1',
        from_status: null,
        to_status: 'learning',
        changed_at: '2026-01-01T12:00:00.000Z',
        server_seq: 4,
      },
    }
    // A newer server may send a history table this client does not know yet.
    const unknown = { table: 'jam_sessions', row: { id: 'jam-1', server_seq: 5 } }
    await applyEventsPage(db, [change, unknown as unknown as EventRow], 5)
    expect(await db.status_changes.get('change-1')).toEqual(change.row)
    expect(await getEventsCursor(db)).toBe(5)
  })

  it('stores a pulled scan view in its own store', async () => {
    const view: EventRow = {
      table: 'scan_views',
      row: { ...scanViewRow('view-1', { list_id: 'list-1' }), context: 'list', server_seq: 7 },
    }
    await applyEventsPage(db, [view], 7)
    expect(await db.scan_views.get('view-1')).toEqual(view.row)
    expect(await db.play_events.count()).toBe(0)
    expect(await getEventsCursor(db)).toBe(7)
  })
})
