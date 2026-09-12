import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, NetworkError, NoTokenError } from '../api/client'
import { createSong, deleteSong, updateSong } from '../commands/songs'
import { getInvalidChangeCount, getPullCursor } from '../db/meta'
import { pendingBatch } from '../db/outbox'
import type { CrosstuneDb } from '../db/schema'
import { openTestDb } from '../test/db'
import { createFakeApi, serverSong } from '../test/fakeApi'
import { BACKOFF_MS, classifyFailure, createSyncEngine } from './engine'
import type { SyncStatus } from './types'

let db: CrosstuneDb
let fake: ReturnType<typeof createFakeApi>

beforeEach(() => {
  db = openTestDb()
  fake = createFakeApi()
})

afterEach(async () => {
  vi.useRealTimers()
  await db.delete()
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
    const { songId } = await createSong(db, { title: 'X' }, { status: 'known' })
    fake.queuePull(
      {
        rows: [{ table: 'songs', row: serverSong({ id: 'a', server_seq: 10 }) }],
        next_since: 10,
        has_more: true,
      },
      {
        rows: [{ table: 'songs', row: serverSong({ id: 'b', server_seq: 12 }) }],
        next_since: 12,
        has_more: false,
      },
    )
    const engine = createSyncEngine({ db, api: fake.api, isOnline: () => true })
    const seen = trackStatuses(engine)
    await engine.sync()
    expect(fake.pushes[0]?.map((c) => c.id)).toContain(songId)
    expect(fake.pushes[0]?.[0]?.data).not.toHaveProperty('id')
    expect(fake.pulls).toEqual([0, 10])
    expect(await getPullCursor(db)).toBe(12)
    expect(await db.songs.count()).toBe(3)
    expect(await pendingBatch(db)).toHaveLength(0)
    expect(seen).toEqual(['syncing', 'idle'])
  })

  it('keeps an entry written while its batch was in flight and pushes it next', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-11T10:00:00.000Z'))
    const { songId } = await createSong(db, { title: 'v1' }, { status: 'known' })
    fake.respondToPush(async (changes) => {
      // Give the concurrent write a distinct updated_at, otherwise it can land in the
      // same millisecond as the original and the "changed since sent" check misses it.
      vi.setSystemTime(new Date('2026-09-11T10:00:05.000Z'))
      await updateSong(db, songId, { title: 'v2' })
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
    await createSong(db, { title: 'X' }, { status: 'known' })
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
    await createSong(db, { title: 'X' }, { status: 'known' })
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
    const { songId } = await createSong(db, { title: 'X' }, { status: 'known' })
    fake.respondToPush((changes) =>
      changes.map((c) => ({
        table: c.table,
        id: c.id,
        status: c.id === songId ? ('invalid' as const) : ('applied' as const),
        reason: c.id === songId ? 'title too long' : null,
      })),
    )
    const onInvalid = vi.fn()
    const engine = createSyncEngine({ db, api: fake.api, isOnline: () => true, onInvalid })
    await engine.sync()
    expect(onInvalid).toHaveBeenCalledWith({
      table: 'songs',
      id: songId,
      reason: 'title too long',
    })
    expect(await getInvalidChangeCount(db)).toBe(1)
  })

  it('does not count a delete the server never stored as a lost change', async () => {
    const { songId } = await createSong(db, { title: 'X' }, { status: 'known' })
    await deleteSong(db, songId)
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

  it('stops pushing when a full batch settles nothing', async () => {
    await createSong(db, { title: 'X' }, { status: 'known' })
    fake.respondToPush(() => [])
    const engine = createSyncEngine({ db, api: fake.api, isOnline: () => true, batchSize: 1 })
    await engine.sync()
    expect(fake.pushes).toHaveLength(1)
    expect(await pendingBatch(db)).toHaveLength(2)
  })

  it('pushes the outbox in batches until it is empty', async () => {
    await createSong(db, { title: 'X' }, { status: 'known' })
    await createSong(db, { title: 'Y' }, { status: 'known' })
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
