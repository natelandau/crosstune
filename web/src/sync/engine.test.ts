import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, NetworkError, NoTokenError } from '../api/client'
import { recordEvent } from '../commands/events'
import { createTune, deleteTune, updateTune } from '../commands/tunes'
import { getEventsCursor, getInvalidChangeCount, getPullCursor } from '../db/meta'
import { pendingBatch } from '../db/outbox'
import type { CrosstuneDb } from '../db/schema'
import { openTestDb } from '../test/db'
import { createFakeApi, serverTune } from '../test/fakeApi'
import { playEventRow, scanViewRow } from '../test/rows'
import { BACKOFF_MS, classifyFailure, createSyncEngine } from './engine'
import { ACCOUNT_DELETED_PROBLEM } from './errors'
import type { Provider } from '../api/vocabulary'
import type { EventRow } from '../api/types'
import type { SyncApi, SyncStatus } from './types'

let db: CrosstuneDb
let fake: ReturnType<typeof createFakeApi>

beforeEach(() => {
  db = openTestDb()
  fake = createFakeApi()
})

afterEach(async () => {
  vi.useRealTimers()
})

function trackStatuses(engine: { subscribe: (l: (s: SyncStatus) => void) => () => void }) {
  const seen: SyncStatus[] = []
  engine.subscribe((s) => seen.push(s))
  return seen
}

// fake-indexeddb schedules its callbacks with the real setImmediate, not the faked
// setTimeout, so advancing the fake clock alone never resolves a pending IDB request;
// drain the real macrotask queue in the same way.
function realTick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

async function drainRealTasks(iterations = 50): Promise<void> {
  for (let i = 0; i < iterations; i++) await realTick()
}

describe('createSyncEngine', () => {
  it('pushes the outbox, then pulls until has_more is false', async () => {
    const { tuneId } = await createTune(db, { title: 'X' }, { status: 'known' })
    fake.queuePull(
      {
        rows: [{ table: 'tunes', row: serverTune({ id: 'a', server_seq: 10 }) }],
        next_since: 10,
        has_more: true,
      },
      {
        rows: [{ table: 'tunes', row: serverTune({ id: 'b', server_seq: 12 }) }],
        next_since: 12,
        has_more: false,
      },
    )
    const engine = createSyncEngine({ db, api: fake.api, isOnline: () => true })
    const seen = trackStatuses(engine)
    await engine.sync()
    expect(fake.pushes[0]?.map((c) => c.id)).toContain(tuneId)
    expect(fake.pushes[0]?.[0]?.data).not.toHaveProperty('id')
    expect(fake.pulls).toEqual([0, 10])
    expect(await getPullCursor(db)).toBe(12)
    expect(await db.tunes.count()).toBe(3)
    expect(await pendingBatch(db)).toHaveLength(0)
    expect(seen).toEqual(['syncing', 'idle'])
  })

  it('keeps an entry written while its batch was in flight and pushes it next', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-11T10:00:00.000Z'))
    const { tuneId } = await createTune(db, { title: 'v1' }, { status: 'known' })
    fake.respondToPush(async (changes) => {
      // Give the concurrent write a distinct updated_at, otherwise it can land in the
      // same millisecond as the original and the "changed since sent" check misses it.
      vi.setSystemTime(new Date('2026-09-11T10:00:05.000Z'))
      await updateTune(db, tuneId, { title: 'v2' })
      return changes.map((c) => ({ table: c.table, id: c.id, status: 'applied' as const }))
    })
    const engine = createSyncEngine({ db, api: fake.api, isOnline: () => true })
    await engine.sync()
    const pending = await pendingBatch(db)
    expect(pending.map((e) => e.data?.title)).toEqual(['v2'])
    fake.respondToPush((changes) =>
      changes.map((c) => ({ table: c.table, id: c.id, status: 'applied' as const })),
    )
    await engine.sync()
    expect(await pendingBatch(db)).toHaveLength(0)
    expect(fake.pushes).toHaveLength(2)
  })

  it('goes offline on a network failure and retries with backoff', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    let online = false
    fake.fail(new NetworkError(new TypeError('Failed to fetch')))
    const engine = createSyncEngine({ db, api: fake.api, isOnline: () => online })
    const seen = trackStatuses(engine)
    await engine.sync()
    expect(engine.status()).toBe('offline')

    online = true
    fake.fail(null)
    await vi.advanceTimersByTimeAsync(BACKOFF_MS[0]!)
    await drainRealTasks()
    expect(engine.status()).toBe('idle')
    expect(seen).toEqual(['syncing', 'offline', 'syncing', 'idle'])
  })

  it('reports error for a server failure while online and stop() cancels the retry', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    fake.fail(new ApiError(500, null))
    const engine = createSyncEngine({ db, api: fake.api, isOnline: () => true })
    await engine.sync()
    expect(engine.status()).toBe('error')
    engine.stop()
    fake.fail(null)
    await vi.advanceTimersByTimeAsync(BACKOFF_MS[BACKOFF_MS.length - 1]!)
    expect(engine.status()).toBe('error')
    expect(fake.pulls).toHaveLength(0)
  })

  it('coalesces concurrent sync calls', async () => {
    await createTune(db, { title: 'X' }, { status: 'known' })
    const engine = createSyncEngine({ db, api: fake.api, isOnline: () => true })
    await Promise.all([engine.sync(), engine.sync(), engine.sync()])
    expect(fake.pushes).toHaveLength(1)
    // One pull per full run: proves the coalesced calls still drove a second
    // push+pull cycle after the first, not just a single run three callers awaited.
    expect(fake.pulls).toEqual([0, 0])
  })

  it('stamps lastSyncedAt on every clean run and leaves it alone on a failure', async () => {
    const engine = createSyncEngine({ db, api: fake.api, isOnline: () => true })
    expect(engine.lastSyncedAt()).toBeNull()
    await engine.sync()
    const first = engine.lastSyncedAt()
    expect(first).not.toBeNull()
    await engine.sync()
    expect(engine.lastSyncedAt()! >= first!).toBe(true)
    fake.fail(new ApiError(500, null))
    const after = engine.lastSyncedAt()
    await engine.sync()
    engine.stop()
    expect(engine.lastSyncedAt()).toBe(after)
  })

  it('arms no retry when stop() lands during an in-flight failure', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await createTune(db, { title: 'X' }, { status: 'known' })
    let rejectPush: (error: unknown) => void = () => {}
    fake.respondToPush(
      () =>
        new Promise<never>((_resolve, reject) => {
          rejectPush = reject
        }),
    )
    const engine = createSyncEngine({ db, api: fake.api, isOnline: () => true })
    const run = engine.sync()
    await drainRealTasks()
    engine.stop()
    rejectPush(new ApiError(500, null))
    await run
    await vi.advanceTimersByTimeAsync(BACKOFF_MS[BACKOFF_MS.length - 1]!)
    await drainRealTasks()
    expect(fake.pushes).toHaveLength(1)
    expect(fake.pulls).toHaveLength(0)

    await engine.sync()
    expect(fake.pushes).toHaveLength(1)
  })

  it('resume() re-enables sync after a stop', async () => {
    const engine = createSyncEngine({ db, api: fake.api, isOnline: () => true })
    engine.stop()
    await engine.sync()
    expect(fake.pulls).toHaveLength(0)
    engine.resume()
    await engine.sync()
    expect(fake.pulls).toHaveLength(1)
  })

  it('reports a rejected change and counts it', async () => {
    const { tuneId } = await createTune(db, { title: 'X' }, { status: 'known' })
    fake.respondToPush((changes) =>
      changes.map((c) => ({
        table: c.table,
        id: c.id,
        status: c.id === tuneId ? ('invalid' as const) : ('applied' as const),
        reason: c.id === tuneId ? 'title too long' : null,
      })),
    )
    const onInvalid = vi.fn()
    const engine = createSyncEngine({ db, api: fake.api, isOnline: () => true, onInvalid })
    await engine.sync()
    expect(onInvalid).toHaveBeenCalledWith({
      table: 'tunes',
      id: tuneId,
      reason: 'title too long',
    })
    expect(await getInvalidChangeCount(db)).toBe(1)
  })

  it('does not count a delete the server never stored as a lost change', async () => {
    const { tuneId } = await createTune(db, { title: 'X' }, { status: 'known' })
    await deleteTune(db, tuneId)
    fake.respondToPush((changes) =>
      changes.map((c) => ({
        table: c.table,
        id: c.id,
        status: 'invalid' as const,
        reason: 'not found',
      })),
    )
    const onInvalid = vi.fn()
    const engine = createSyncEngine({ db, api: fake.api, isOnline: () => true, onInvalid })
    await engine.sync()
    expect(onInvalid).not.toHaveBeenCalled()
    expect(await getInvalidChangeCount(db)).toBe(0)
    expect(await pendingBatch(db)).toHaveLength(0)
  })

  it('reports unauthorized when the server rejects the session', async () => {
    fake.fail(new ApiError(401, null))
    const engine = createSyncEngine({ db, api: fake.api, isOnline: () => true })
    await engine.sync()
    expect(engine.status()).toBe('unauthorized')
    engine.stop()
  })

  it('stops and reports a deleted account once when the server says it is gone', async () => {
    const deleted = new ApiError(401, {
      type: ACCOUNT_DELETED_PROBLEM,
      title: 'Unauthorized',
      status: 401,
      detail: 'This account was deleted',
    })
    fake.fail(deleted)
    const onAccountDeleted = vi.fn()
    const engine = createSyncEngine({ db, api: fake.api, isOnline: () => true })
    engine.onAccountDeleted(onAccountDeleted)
    await engine.sync()
    expect(onAccountDeleted).toHaveBeenCalledOnce()
    // A stopped engine ignores triggers, so no run can touch the database being deleted.
    const pullsBefore = fake.pulls.length
    await engine.sync()
    expect(fake.pulls).toHaveLength(pullsBefore)
    expect(onAccountDeleted).toHaveBeenCalledOnce()
  })

  it('does not report a deleted account once the engine is stopped', async () => {
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const pull = fake.api.pull
    fake.api.pull = async (since) => {
      await held
      return pull(since)
    }
    fake.fail(
      new ApiError(401, {
        type: ACCOUNT_DELETED_PROBLEM,
        title: 'Unauthorized',
        status: 401,
        detail: 'This account was deleted',
      }),
    )
    const onAccountDeleted = vi.fn()
    const engine = createSyncEngine({ db, api: fake.api, isOnline: () => true })
    engine.onAccountDeleted(onAccountDeleted)
    const run = engine.sync()
    engine.stop()
    release()
    await run
    expect(onAccountDeleted).not.toHaveBeenCalled()
  })

  it('treats a plain 401 as an expired session, not a deleted account', async () => {
    fake.fail(new ApiError(401, null))
    const onAccountDeleted = vi.fn()
    const engine = createSyncEngine({ db, api: fake.api, isOnline: () => true })
    engine.onAccountDeleted(onAccountDeleted)
    await engine.sync()
    expect(onAccountDeleted).not.toHaveBeenCalled()
    engine.stop()
  })

  it('stops pushing when a full batch settles nothing', async () => {
    await createTune(db, { title: 'X' }, { status: 'known' })
    fake.respondToPush(() => [])
    const engine = createSyncEngine({ db, api: fake.api, isOnline: () => true, batchSize: 1 })
    await engine.sync()
    expect(fake.pushes).toHaveLength(1)
    expect(await pendingBatch(db)).toHaveLength(2)
  })

  it('pushes the outbox in batches until it is empty', async () => {
    await createTune(db, { title: 'X' }, { status: 'known' })
    await createTune(db, { title: 'Y' }, { status: 'known' })
    expect(await pendingBatch(db)).toHaveLength(4)
    const engine = createSyncEngine({ db, api: fake.api, isOnline: () => true, batchSize: 2 })
    await engine.sync()
    expect(fake.pushes.map((batch) => batch.length)).toEqual([2, 2])
    expect(await pendingBatch(db)).toHaveLength(0)
  })

  it('stops notifying a listener that unsubscribed', async () => {
    const engine = createSyncEngine({ db, api: fake.api, isOnline: () => true })
    const seen: SyncStatus[] = []
    const unsubscribe = engine.subscribe((s) => seen.push(s))
    await engine.sync()
    unsubscribe()
    engine.stop()
    fake.fail(new ApiError(500, null))
    engine.resume()
    await engine.sync()
    expect(engine.status()).toBe('error')
    expect(seen).toEqual(['syncing', 'idle'])
  })

  it('resolves links only when online and never throws', async () => {
    const engine = createSyncEngine({ db, api: fake.api, isOnline: () => true })
    await expect(engine.resolveLink('https://x')).resolves.toMatchObject({ title: 'Resolved' })
    fake.fail(new TypeError('Failed to fetch'))
    await expect(engine.resolveLink('https://x')).resolves.toBeNull()
    const offline = createSyncEngine({ db, api: fake.api, isOnline: () => false })
    await expect(offline.resolveLink('https://x')).resolves.toBeNull()
  })

  describe('searchRecordings', () => {
    const providers: Provider[] = ['apple_music']
    const groups = [
      {
        provider: 'apple_music' as const,
        status: 'results' as const,
        results: [],
        search_url: 'u',
      },
    ]
    const withSearch = (searchRecordings: SyncApi['searchRecordings'], isOnline = () => true) =>
      createSyncEngine({ db, api: { ...fake.api, searchRecordings }, isOnline })

    it('returns offline without calling the API', async () => {
      const search = vi.fn()
      const engine = withSearch(search, () => false)
      await expect(engine.searchRecordings('so', providers, 'US')).resolves.toEqual({
        kind: 'offline',
      })
      expect(search).not.toHaveBeenCalled()
    })

    it('passes groups through on success', async () => {
      const search = vi.fn(async () => ({ groups }))
      const engine = withSearch(search)
      await expect(engine.searchRecordings('so', providers, 'IE')).resolves.toEqual({
        kind: 'ok',
        groups,
      })
      expect(search).toHaveBeenCalledWith('so', providers, 'IE')
    })

    it('reports a 429 with its Retry-After seconds', async () => {
      const engine = withSearch(async () => {
        throw new ApiError(429, null, 7)
      })
      await expect(engine.searchRecordings('so', providers, 'US')).resolves.toEqual({
        kind: 'rate_limited',
        retryAfterSeconds: 7,
      })
    })

    it('reports other failures as failed', async () => {
      const network = withSearch(async () => {
        throw new NetworkError(new TypeError('x'))
      })
      await expect(network.searchRecordings('so', providers, 'US')).resolves.toEqual({
        kind: 'failed',
      })
      const server = withSearch(async () => {
        throw new ApiError(500, null)
      })
      await expect(server.searchRecordings('so', providers, 'US')).resolves.toEqual({
        kind: 'failed',
      })
    })
  })
})

function pulledPlay(id: string, serverSeq: number): EventRow {
  return {
    table: 'play_events',
    row: { ...playEventRow(id), context: 'row', server_seq: serverSeq },
  }
}

function pulledSession(id: string, serverSeq: number): EventRow {
  return {
    table: 'practice_sessions',
    row: {
      id,
      created_at: '2026-01-01T12:00:00.000Z',
      started_at: '2026-01-01T12:00:00.000Z',
      duration_ms: 60_000,
      recording_id: 'rec-1',
      tune_id: null,
      loop_ids: [],
      speed_percent: 100,
      pitch_cents: 0,
      server_seq: serverSeq,
    },
  }
}

function pulledScanView(id: string, serverSeq: number): EventRow {
  return {
    table: 'scan_views',
    row: { ...scanViewRow(id), context: 'tune', server_seq: serverSeq },
  }
}

function pulledStatusChange(id: string, serverSeq: number): EventRow {
  return {
    table: 'status_changes',
    row: {
      id,
      user_tune_id: 'ut-1',
      from_status: null,
      to_status: 'learning',
      changed_at: '2026-01-01T12:00:00.000Z',
      server_seq: serverSeq,
    },
  }
}

describe('events', () => {
  it('pullEvents pages until caught up and stores the cursor', async () => {
    fake.queueEvents(
      {
        rows: [pulledPlay('play-1', 3), pulledSession('session-1', 5)],
        next_since: 5,
        has_more: true,
      },
      {
        rows: [pulledScanView('view-1', 7), pulledStatusChange('change-1', 9)],
        next_since: 9,
        has_more: false,
      },
    )
    const engine = createSyncEngine({ db, api: fake.api, isOnline: () => true })
    await engine.pullEvents()
    expect(fake.eventPulls).toEqual([0, 5])
    expect(await getEventsCursor(db)).toBe(9)
    expect(await db.scan_views.get('view-1')).toEqual(pulledScanView('view-1', 7).row)
    expect(await db.play_events.get('play-1')).toEqual(pulledPlay('play-1', 3).row)
    expect(await db.practice_sessions.get('session-1')).toEqual(pulledSession('session-1', 5).row)
    expect(await db.status_changes.get('change-1')).toEqual(pulledStatusChange('change-1', 9).row)
    expect(await getPullCursor(db)).toBe(0)

    await engine.pullEvents()
    expect(fake.eventPulls).toEqual([0, 5, 9])
  })

  it('events pull keeps applied pages when a later page fails', async () => {
    fake.queueEvents(
      { rows: [pulledPlay('play-1', 3)], next_since: 3, has_more: true },
      new ApiError(500, null),
    )
    const engine = createSyncEngine({ db, api: fake.api, isOnline: () => true })
    await expect(engine.pullEvents()).rejects.toThrow(ApiError)
    expect(await getEventsCursor(db)).toBe(3)
    expect(await db.play_events.count()).toBe(1)

    fake.queueEvents({ rows: [pulledPlay('play-2', 4)], next_since: 4, has_more: false })
    await engine.pullEvents()
    expect(fake.eventPulls).toEqual([0, 3, 3])
    expect(await getEventsCursor(db)).toBe(4)
    expect(await db.play_events.count()).toBe(2)
  })

  it('pullEvents does nothing offline', async () => {
    fake.queueEvents({ rows: [pulledPlay('play-1', 3)], next_since: 3, has_more: false })
    const engine = createSyncEngine({ db, api: fake.api, isOnline: () => false })
    await engine.pullEvents()
    expect(fake.eventPulls).toEqual([])
    expect(await getEventsCursor(db)).toBe(0)
    expect(await db.play_events.count()).toBe(0)
  })

  it('push applies an event result into its store', async () => {
    const play = playEventRow('play-1')
    await recordEvent(db, 'play_events', play)
    const engine = createSyncEngine({ db, api: fake.api, isOnline: () => true })
    await engine.sync()
    expect(fake.pushes[0]).toEqual([
      {
        table: 'play_events',
        op: 'upsert',
        id: 'play-1',
        updated_at: play.created_at,
        data: expect.not.objectContaining({ id: expect.anything() }),
      },
    ])
    expect(await db.play_events.get('play-1')).toEqual({ ...play, server_seq: 1 })
    expect(await pendingBatch(db)).toHaveLength(0)
  })

  it('push applies a scan view result into its store', async () => {
    const view = scanViewRow('view-1', { context: 'row' })
    await recordEvent(db, 'scan_views', view)
    const engine = createSyncEngine({ db, api: fake.api, isOnline: () => true })
    await engine.sync()
    expect(fake.pushes[0]?.map((c) => [c.table, c.op, c.id])).toEqual([
      ['scan_views', 'upsert', 'view-1'],
    ])
    expect(await db.scan_views.get('view-1')).toEqual({ ...view, server_seq: 1 })
    expect(await pendingBatch(db)).toHaveLength(0)
  })

  it('a sync queued behind an events pull that finds the account deleted never pushes', async () => {
    await createTune(db, { title: 'X' }, { status: 'known' })
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const api: SyncApi = {
      ...fake.api,
      async events() {
        await gate
        throw new ApiError(401, {
          type: ACCOUNT_DELETED_PROBLEM,
          title: 'Unauthorized',
          status: 401,
          detail: 'This account was deleted',
        })
      },
    }
    const engine = createSyncEngine({ db, api, isOnline: () => true })
    const onAccountDeleted = vi.fn()
    engine.onAccountDeleted(onAccountDeleted)
    const pulling = engine.pullEvents()
    const syncing = engine.sync()
    expect(engine.status()).toBe('syncing')
    release()
    await expect(pulling).rejects.toThrow(ApiError)
    await syncing
    expect(onAccountDeleted).toHaveBeenCalledOnce()
    expect(fake.pushes).toEqual([])
    expect(fake.pulls).toEqual([])
  })

  it('pullEvents waits for a push in flight', async () => {
    await createTune(db, { title: 'X' }, { status: 'known' })
    const order: string[] = []
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    fake.respondToPush(async (changes) => {
      await gate
      order.push('push')
      return changes.map((c) => ({ table: c.table, id: c.id, status: 'applied' as const }))
    })
    const api: SyncApi = {
      ...fake.api,
      async events(since) {
        order.push('events')
        return fake.api.events(since)
      },
    }
    const engine = createSyncEngine({ db, api, isOnline: () => true })
    const syncing = engine.sync()
    await expect.poll(() => fake.pushes.length).toBe(1)
    const pulling = engine.pullEvents()
    // Reads queued after the events pull's own cursor read: an overlapping pull would have
    // called the API by the time they land. The order below holds however the race goes.
    await getEventsCursor(db)
    await getEventsCursor(db)
    release()
    await Promise.all([syncing, pulling])
    expect(order).toEqual(['push', 'events'])
  })
})

describe('classifyFailure', () => {
  it('maps failures to statuses', () => {
    expect(classifyFailure(new ApiError(500, null), () => false)).toBe('offline')
    expect(classifyFailure(new NoTokenError(), () => true)).toBe('offline')
    expect(classifyFailure(new NetworkError(new TypeError('x')), () => true)).toBe('offline')
    expect(classifyFailure(new TypeError('x'), () => true)).toBe('error')
    expect(classifyFailure(new ApiError(401, null), () => true)).toBe('unauthorized')
    expect(classifyFailure(new ApiError(403, null), () => true)).toBe('unauthorized')
    expect(classifyFailure(new ApiError(500, null), () => true)).toBe('error')
  })
})
