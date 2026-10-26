import * as Sentry from '@sentry/react'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { noopAnalytics } from '../usage/client'
import { recordingAnalytics } from '../usage/testing'
import type { Problem } from '../api/types'
import { ApiError, NetworkError, NoTokenError, TransferError } from '../api/client'
import { recordEvent } from '../commands/events'
import { createTune, deleteTune, setPlaySource, updateTune } from '../commands/tunes'
import { addLoop } from '../commands/loops'
import { deleteRecording } from '../commands/recordings'
import { addScans } from '../commands/scans'
import {
  getEventsCursor,
  getInvalidChangeCount,
  getLocalOnlyRows,
  getPullCursor,
  keepLocalUntilSubscribed,
} from '../db/meta'
import { pendingBatch, pendingFor } from '../db/outbox'
import type { CrosstuneDb } from '../db/schema'
import { openTestDb } from '../test/db'
import { createFakeApi, serverTune } from '../test/fakeApi'
import { captureRecording } from '../test/recordings'
import { entitlementRow, playEventRow, scanViewRow } from '../test/rows'
import { dueUnseenNotice, markNoticeSeen, seenNotices } from '../billing/notices'
import { BACKOFF_MS, classifyFailure, createSyncEngine } from './engine'
import {
  ACCOUNT_DELETED_PROBLEM,
  MISSING_RECORDING_REASON,
  PREMIUM_REQUIRED_PROBLEM,
  PREMIUM_REQUIRED_REASON,
} from './errors'
import type { Provider } from '../api/vocabulary'
import type { Change, ChangeResult, EventRow, PullRow } from '../api/types'
import type { SyncApi, SyncStatus } from './types'

vi.mock('@sentry/react', async (importOriginal) => ({
  ...(await importOriginal<typeof Sentry>()),
  captureException: vi.fn(),
}))

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

function refusal(reason: string | undefined): ApiError {
  return new ApiError(409, {
    type: 'urn:crosstune:withdrawal-refused',
    title: 'Refused',
    status: 409,
    reason,
  } as Problem)
}

describe('createSyncEngine', () => {
  it('passes an Apple code through to the delete request', async () => {
    const deleteAccount = vi.spyOn(fake.api, 'deleteAccount')
    const engine = createSyncEngine({
      analytics: noopAnalytics,
      db,
      api: fake.api,
      isOnline: () => true,
    })
    await engine.deleteAccount({ appleAuthorizationCode: 'c1' })
    expect(deleteAccount).toHaveBeenCalledWith({ appleAuthorizationCode: 'c1' })
  })

  it.each([
    ['withdrawn', null],
    ['refused', refusal(undefined)],
    ['window_closed', refusal('window_closed')],
    ['already_withdrawn', refusal('already_withdrawn')],
    ['refused', refusal('no_web_subscription')],
  ] as const)('withdraw reports %s after pulling', async (outcome, error) => {
    vi.spyOn(fake.api, 'withdraw').mockImplementation(async () => {
      if (error) throw error
    })
    const pull = vi.spyOn(fake.api, 'pull')
    const engine = createSyncEngine({
      analytics: noopAnalytics,
      db,
      api: fake.api,
      isOnline: () => true,
    })
    expect(await engine.withdraw()).toBe(outcome)
    // No poll: the outcome only returns once the pull has run.
    expect(pull).toHaveBeenCalled()
  })

  it('withdraw reports failed for any answer but a refusal', async () => {
    vi.spyOn(fake.api, 'withdraw').mockRejectedValue(new ApiError(503, null))
    const engine = createSyncEngine({
      analytics: noopAnalytics,
      db,
      api: fake.api,
      isOnline: () => true,
    })
    expect(await engine.withdraw()).toBe('failed')
  })

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
    const engine = createSyncEngine({
      analytics: noopAnalytics,
      db,
      api: fake.api,
      isOnline: () => true,
    })
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
    const engine = createSyncEngine({
      analytics: noopAnalytics,
      db,
      api: fake.api,
      isOnline: () => true,
    })
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
    const engine = createSyncEngine({
      analytics: noopAnalytics,
      db,
      api: fake.api,
      isOnline: () => online,
    })
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
    const engine = createSyncEngine({
      analytics: noopAnalytics,
      db,
      api: fake.api,
      isOnline: () => true,
    })
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
    const engine = createSyncEngine({
      analytics: noopAnalytics,
      db,
      api: fake.api,
      isOnline: () => true,
    })
    await Promise.all([engine.sync(), engine.sync(), engine.sync()])
    expect(fake.pushes).toHaveLength(1)
    // One pull per full run: proves the coalesced calls still drove a second
    // push+pull cycle after the first, not just a single run three callers awaited.
    expect(fake.pulls).toEqual([0, 0])
  })

  it('stamps lastSyncedAt on every clean run and leaves it alone on a failure', async () => {
    const engine = createSyncEngine({
      analytics: noopAnalytics,
      db,
      api: fake.api,
      isOnline: () => true,
    })
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
    const engine = createSyncEngine({
      analytics: noopAnalytics,
      db,
      api: fake.api,
      isOnline: () => true,
    })
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
    const engine = createSyncEngine({
      analytics: noopAnalytics,
      db,
      api: fake.api,
      isOnline: () => true,
    })
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
    const engine = createSyncEngine({
      analytics: noopAnalytics,
      db,
      api: fake.api,
      isOnline: () => true,
      onInvalid,
    })
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
    const engine = createSyncEngine({
      analytics: noopAnalytics,
      db,
      api: fake.api,
      isOnline: () => true,
      onInvalid,
    })
    await engine.sync()
    expect(onInvalid).not.toHaveBeenCalled()
    expect(await getInvalidChangeCount(db)).toBe(0)
    expect(await pendingBatch(db)).toHaveLength(0)
  })

  it('reports unauthorized when the server rejects the session', async () => {
    fake.fail(new ApiError(401, null))
    const engine = createSyncEngine({
      analytics: noopAnalytics,
      db,
      api: fake.api,
      isOnline: () => true,
    })
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
    const engine = createSyncEngine({
      analytics: noopAnalytics,
      db,
      api: fake.api,
      isOnline: () => true,
    })
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
    const engine = createSyncEngine({
      analytics: noopAnalytics,
      db,
      api: fake.api,
      isOnline: () => true,
    })
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
    const engine = createSyncEngine({
      analytics: noopAnalytics,
      db,
      api: fake.api,
      isOnline: () => true,
    })
    engine.onAccountDeleted(onAccountDeleted)
    await engine.sync()
    expect(onAccountDeleted).not.toHaveBeenCalled()
    engine.stop()
  })

  it('stops pushing when a full batch settles nothing', async () => {
    await createTune(db, { title: 'X' }, { status: 'known' })
    fake.respondToPush(() => [])
    const engine = createSyncEngine({
      analytics: noopAnalytics,
      db,
      api: fake.api,
      isOnline: () => true,
      batchSize: 1,
    })
    await engine.sync()
    expect(fake.pushes).toHaveLength(1)
    expect(await pendingBatch(db)).toHaveLength(2)
  })

  describe('under the plan', () => {
    const premiumRequired = (changes: Change[]): ChangeResult[] =>
      changes.map((c) =>
        c.table === 'recordings'
          ? { table: c.table, id: c.id, status: 'invalid', reason: PREMIUM_REQUIRED_REASON }
          : { table: c.table, id: c.id, status: 'applied' },
      )

    function engineFor(batchSize?: number) {
      return createSyncEngine({
        analytics: noopAnalytics,
        db,
        api: fake.api,
        isOnline: () => true,
        batchSize,
      })
    }

    it('leaves a local-only recording out while free, still sends its delete, and keeps nothing local after', async () => {
      await db.entitlements.put(entitlementRow())
      const id = await captureRecording(db)
      await keepLocalUntilSubscribed(db, [id])
      const { tuneId } = await createTune(db, { title: 'X' }, { status: 'known' })
      const engine = engineFor()
      await engine.sync()
      expect(fake.pushes.flat().map((c) => c.id)).toContain(tuneId)
      expect(fake.pushes.flat().map((c) => c.id)).not.toContain(id)
      expect(await pendingFor(db, 'recordings', id)).toBeDefined()

      await deleteRecording(db, id)
      // The server never stored the recording, so it refuses the delete.
      fake.respondToPush((changes) =>
        changes.map((c) => ({ table: c.table, id: c.id, status: 'invalid', reason: 'not found' })),
      )
      await engine.sync()
      expect(fake.pushes.at(-1)).toEqual([expect.objectContaining({ id, op: 'delete' })])
      expect(await pendingBatch(db)).toHaveLength(0)
      expect(await getLocalOnlyRows(db)).toEqual(new Set())
      expect(await getInvalidChangeCount(db)).toBe(0)
      engine.stop()
    })

    it('sends a local-only recording once the plan is premium, and releases it when applied', async () => {
      await db.entitlements.put(entitlementRow({ premium_source: 'comp' }))
      const id = await captureRecording(db)
      await keepLocalUntilSubscribed(db, [id])
      const engine = engineFor()
      await engine.sync()
      expect(fake.pushes.flat().map((c) => c.id)).toContain(id)
      expect(await pendingFor(db, 'recordings', id)).toBeUndefined()
      expect(await getLocalOnlyRows(db)).toEqual(new Set())
      engine.stop()
    })

    it('keeps a scan refused for Premium local and unreported while free, and sends it once Premium', async () => {
      await db.entitlements.put(entitlementRow())
      const { tuneId } = await createTune(db, { title: 'Angeline' }, { status: 'known' })
      const [scanId] = await addScans(db, tuneId, [
        { blob: new Blob(['jpeg'], { type: 'image/jpeg' }), width: 800, height: 1200 },
      ])
      fake.respondToPush((changes) =>
        changes.map((c) =>
          c.table === 'scans'
            ? { table: c.table, id: c.id, status: 'invalid', reason: PREMIUM_REQUIRED_REASON }
            : { table: c.table, id: c.id, status: 'applied' },
        ),
      )
      const onInvalid = vi.fn()
      const engine = createSyncEngine({
        analytics: noopAnalytics,
        db,
        api: fake.api,
        isOnline: () => true,
        onInvalid,
      })
      await engine.sync()
      expect(fake.pushes.flat().map((c) => c.id)).toContain(scanId)
      expect(onInvalid).not.toHaveBeenCalled()
      expect(await getInvalidChangeCount(db)).toBe(0)
      expect(await pendingFor(db, 'scans', scanId!)).toBeDefined()
      expect(await getLocalOnlyRows(db)).toEqual(new Set([scanId]))

      // Still free: the local-only scan stays out of the next push.
      const sentBefore = fake.pushes.length
      await engine.sync()
      expect(
        fake.pushes
          .slice(sentBefore)
          .flat()
          .map((c) => c.id),
      ).not.toContain(scanId)

      await db.entitlements.put(entitlementRow({ premium_source: 'comp' }))
      fake.respondToPush((changes) =>
        changes.map((c) => ({ table: c.table, id: c.id, status: 'applied' })),
      )
      await engine.sync()
      engine.stop()
      expect(fake.pushes.at(-1)?.map((c) => c.id)).toContain(scanId)
      expect(await pendingFor(db, 'scans', scanId!)).toBeUndefined()
      expect(await getLocalOnlyRows(db)).toEqual(new Set())
    })

    it("keeps a local-only recording's loop and play with it, and sends them once Premium", async () => {
      await db.entitlements.put(entitlementRow())
      const { tuneId, userTuneId } = await createTune(db, { title: 'X' }, { status: 'known' })
      const id = await captureRecording(db, { tuneId })
      const loopId = await addLoop(db, id, { start_ms: 1_000, end_ms: 5_000 })
      await recordEvent(db, 'play_events', playEventRow('play-1', { recording_id: id }))
      await setPlaySource(db, userTuneId, { kind: 'recording', id })
      // The server refuses the new recording and every row that needs it, and takes the pin, whose
      // recording it never checks.
      fake.respondToPush((changes) =>
        changes.map((c) => {
          if (c.table === 'recordings') {
            return { table: c.table, id: c.id, status: 'invalid', reason: PREMIUM_REQUIRED_REASON }
          }
          if (c.table === 'recording_loops' || c.table === 'play_events') {
            return { table: c.table, id: c.id, status: 'invalid', reason: MISSING_RECORDING_REASON }
          }
          return { table: c.table, id: c.id, status: 'applied' }
        }),
      )
      const onInvalid = vi.fn()
      const engine = createSyncEngine({
        analytics: noopAnalytics,
        db,
        api: fake.api,
        isOnline: () => true,
        onInvalid,
      })
      await engine.sync()
      expect(fake.pushes.flat().map((c) => c.id)).toEqual(
        expect.arrayContaining([id, loopId, 'play-1', userTuneId]),
      )
      expect(onInvalid).not.toHaveBeenCalled()
      expect(await getInvalidChangeCount(db)).toBe(0)
      expect(await pendingFor(db, 'user_tunes', userTuneId)).toBeUndefined()
      expect((await pendingBatch(db)).map((entry) => entry.row_id).toSorted()).toEqual(
        [id, loopId, 'play-1'].toSorted(),
      )

      // Still free: the recording and its rows wait out the next push.
      const pushed = fake.pushes.length
      await engine.sync()
      expect(fake.pushes.slice(pushed).flat()).toEqual([])

      await db.entitlements.put(entitlementRow({ premium_source: 'comp' }))
      fake.respondToPush((changes) =>
        changes.map((c) => ({ table: c.table, id: c.id, status: 'applied' })),
      )
      await engine.sync()
      engine.stop()
      expect(
        fake.pushes
          .slice(pushed)
          .flat()
          .map((c) => c.id),
      ).toEqual([id, loopId, 'play-1'])
      expect(await pendingBatch(db)).toHaveLength(0)
      expect(await getLocalOnlyRows(db)).toEqual(new Set())
    })

    it('drops a local-only recording that has nothing left in the outbox', async () => {
      await keepLocalUntilSubscribed(db, ['gone'])
      const engine = engineFor()
      await engine.sync()
      engine.stop()
      expect(await getLocalOnlyRows(db)).toEqual(new Set())
    })

    it('ends a push whose results are all kept local instead of resending them', async () => {
      const recordingIds = [
        await captureRecording(db),
        await captureRecording(db),
        await captureRecording(db),
      ]
      fake.respondToPush(premiumRequired)
      const engine = engineFor(2)
      await engine.sync()
      expect(fake.pushes.map((batch) => batch.map((c) => c.id))).toEqual([
        recordingIds.slice(0, 2),
        [recordingIds[2]],
      ])
      expect(await getLocalOnlyRows(db)).toEqual(new Set(recordingIds))
      expect(await getInvalidChangeCount(db)).toBe(0)
      engine.stop()
    })

    it('still pushes an edit queued behind a full batch of local-only recordings', async () => {
      const recordingIds = [
        await captureRecording(db),
        await captureRecording(db),
        await captureRecording(db),
      ]
      const { tuneId } = await createTune(db, { title: 'X' }, { status: 'known' })
      fake.respondToPush(premiumRequired)
      const engine = engineFor(2)
      await engine.sync()
      const sent = fake.pushes.flat().map((c) => c.id)
      expect(sent).toContain(tuneId)
      // Each local-only recording goes out once per push.
      for (const recordingId of recordingIds)
        expect(sent.filter((id) => id === recordingId)).toHaveLength(1)
      expect(await pendingFor(db, 'tunes', tuneId)).toBeUndefined()
      expect((await pendingBatch(db)).map((entry) => entry.row_id)).toEqual(recordingIds)
      engine.stop()
    })
  })

  it('pushes the outbox in batches until it is empty', async () => {
    await createTune(db, { title: 'X' }, { status: 'known' })
    await createTune(db, { title: 'Y' }, { status: 'known' })
    expect(await pendingBatch(db)).toHaveLength(4)
    const engine = createSyncEngine({
      analytics: noopAnalytics,
      db,
      api: fake.api,
      isOnline: () => true,
      batchSize: 2,
    })
    await engine.sync()
    expect(fake.pushes.map((batch) => batch.length)).toEqual([2, 2])
    expect(await pendingBatch(db)).toHaveLength(0)
  })

  it('stops notifying a listener that unsubscribed', async () => {
    const engine = createSyncEngine({
      analytics: noopAnalytics,
      db,
      api: fake.api,
      isOnline: () => true,
    })
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
    const engine = createSyncEngine({
      analytics: noopAnalytics,
      db,
      api: fake.api,
      isOnline: () => true,
    })
    await expect(engine.resolveLink('https://x')).resolves.toMatchObject({ title: 'Resolved' })
    fake.fail(new TypeError('Failed to fetch'))
    await expect(engine.resolveLink('https://x')).resolves.toBeNull()
    const offline = createSyncEngine({
      analytics: noopAnalytics,
      db,
      api: fake.api,
      isOnline: () => false,
    })
    await expect(offline.resolveLink('https://x')).resolves.toBeNull()
  })

  it('fetchFile reads a recording or a scan through its signed URL and stores neither', async () => {
    const audio = new Blob([new Uint8Array([1, 2])], { type: 'audio/mp4' })
    const image = new Blob([new Uint8Array([3])], { type: 'image/jpeg' })
    fake.recordingStates.set('r1', 'ready')
    fake.objects.set('r1/playback.m4a', audio)
    fake.scanStates.set('p1', 'ready')
    fake.objects.set('p1/scan.jpg', image)
    const engine = createSyncEngine({ analytics: noopAnalytics, db, api: fake.api })

    await expect(engine.fetchFile('recording', 'r1')).resolves.toBe(audio)
    await expect(engine.fetchFile('scan', 'p1')).resolves.toBe(image)
    expect(await db.recording_files.count()).toBe(0)
    expect(await db.scan_files.count()).toBe(0)
  })

  it("fetchFile asks for the signed URL under the caller's signal", async () => {
    fake.recordingStates.set('r1', 'ready')
    fake.objects.set('r1/playback.m4a', new Blob([new Uint8Array([1])]))
    fake.scanStates.set('p1', 'ready')
    fake.objects.set('p1/scan.jpg', new Blob([new Uint8Array([3])]))
    const recording = vi.spyOn(fake.api, 'downloadUrl')
    const scan = vi.spyOn(fake.api, 'scanDownloadUrl')
    const engine = createSyncEngine({ analytics: noopAnalytics, db, api: fake.api })
    const { signal } = new AbortController()

    await engine.fetchFile('recording', 'r1', signal)
    await engine.fetchFile('scan', 'p1', signal)
    expect(recording).toHaveBeenCalledWith('r1', signal)
    expect(scan).toHaveBeenCalledWith('p1', signal)
  })

  it('fetchFile rejects with the failure rather than settling for nothing', async () => {
    const engine = createSyncEngine({ analytics: noopAnalytics, db, api: fake.api })
    fake.fail(new NetworkError(new TypeError('Failed to fetch')))
    await expect(engine.fetchFile('recording', 'r1')).rejects.toBeInstanceOf(NetworkError)
  })

  describe('fetchFile retries', () => {
    const audio = new Blob([new Uint8Array([1])])

    /** An engine whose `step` of the fetch fails once with `error`, then works. */
    function failingOnce(step: 'downloadUrl' | 'getObject', error: unknown) {
      fake.recordingStates.set('r1', 'ready')
      fake.objects.set('r1/playback.m4a', audio)
      const real = fake.api[step] as (...args: never[]) => Promise<unknown>
      let calls = 0
      const failing = vi.fn(async (...args: never[]) => {
        calls += 1
        if (calls === 1) throw error
        return real(...args)
      })
      const engine = createSyncEngine({
        analytics: noopAnalytics,
        db,
        api: { ...fake.api, [step]: failing },
      })
      return { engine, failing }
    }

    it.each([
      ['a network error', 'getObject', new NetworkError(new TypeError('Failed to fetch'))],
      ['a 5xx from the object store', 'getObject', new TransferError(503)],
      ['a 5xx from the API', 'downloadUrl', new ApiError(502, null)],
    ] as const)('tries once more after %s', async (_name, step, error) => {
      const { engine, failing } = failingOnce(step, error)
      await expect(engine.fetchFile('recording', 'r1')).resolves.toBe(audio)
      expect(failing).toHaveBeenCalledTimes(2)
    })

    it('gives up after the second failure', async () => {
      const error = new TransferError(503)
      const getObject = vi.fn(async () => {
        throw error
      })
      fake.recordingStates.set('r1', 'ready')
      const engine = createSyncEngine({
        analytics: noopAnalytics,
        db,
        api: { ...fake.api, getObject },
      })
      await expect(engine.fetchFile('recording', 'r1')).rejects.toBe(error)
      expect(getObject).toHaveBeenCalledTimes(2)
    })

    it.each([
      ['a 404 from the object store', 'getObject', new TransferError(404)],
      ['a 409 from the API', 'downloadUrl', new ApiError(409, null)],
    ] as const)('fails at once on %s', async (_name, step, error) => {
      const { engine, failing } = failingOnce(step, error)
      await expect(engine.fetchFile('recording', 'r1')).rejects.toBe(error)
      expect(failing).toHaveBeenCalledOnce()
    })

    it('never retries a fetch its caller aborted', async () => {
      const controller = new AbortController()
      const getObject = vi.fn(async () => {
        controller.abort(new Error('cancelled'))
        throw new NetworkError(new DOMException('aborted', 'AbortError'))
      })
      fake.recordingStates.set('r1', 'ready')
      const engine = createSyncEngine({
        analytics: noopAnalytics,
        db,
        api: { ...fake.api, getObject },
      })
      await expect(engine.fetchFile('recording', 'r1', controller.signal)).rejects.toThrow(
        'cancelled',
      )
      expect(getObject).toHaveBeenCalledOnce()
    })

    it('hands the signal to the object read', async () => {
      const getObject = vi.fn(async (_url: string, _signal?: AbortSignal) => audio)
      fake.recordingStates.set('r1', 'ready')
      const engine = createSyncEngine({
        analytics: noopAnalytics,
        db,
        api: { ...fake.api, getObject },
      })
      const controller = new AbortController()
      await engine.fetchFile('recording', 'r1', controller.signal)
      expect(getObject.mock.calls[0]![1]).toBe(controller.signal)
    })
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
      createSyncEngine({
        analytics: noopAnalytics,
        db,
        api: { ...fake.api, searchRecordings },
        isOnline,
      })

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

  describe('searchPlaces', () => {
    const results = [
      {
        name: 'Galax, VA',
        lat: 36.66,
        lon: -80.92,
        title: 'Galax, VA',
        subtitle: null,
        kind: 'town' as const,
      },
    ]
    const withSearch = (searchPlaces: SyncApi['searchPlaces'], isOnline = () => true) =>
      createSyncEngine({
        analytics: noopAnalytics,
        db,
        api: { ...fake.api, searchPlaces },
        isOnline,
      })

    it('returns offline without calling the API', async () => {
      const search = vi.fn()
      const engine = withSearch(search, () => false)
      await expect(engine.searchPlaces('Ga')).resolves.toEqual({ kind: 'offline' })
      expect(search).not.toHaveBeenCalled()
    })

    it('passes results through on success', async () => {
      const search = vi.fn(async () => ({ results }))
      const engine = withSearch(search)
      await expect(engine.searchPlaces('Ga')).resolves.toEqual({ kind: 'ok', results })
      expect(search).toHaveBeenCalledWith('Ga')
    })

    it('reports a 429 with its Retry-After seconds', async () => {
      const engine = withSearch(async () => {
        throw new ApiError(429, null, 7)
      })
      await expect(engine.searchPlaces('Ga')).resolves.toEqual({
        kind: 'rate_limited',
        retryAfterSeconds: 7,
      })
    })

    it('reports a 503 as unavailable', async () => {
      const engine = withSearch(async () => {
        throw new ApiError(503, null)
      })
      await expect(engine.searchPlaces('Ga')).resolves.toEqual({ kind: 'unavailable' })
    })

    it('reports other failures as failed', async () => {
      const network = withSearch(async () => {
        throw new NetworkError(new TypeError('x'))
      })
      await expect(network.searchPlaces('Ga')).resolves.toEqual({ kind: 'failed' })
      const server = withSearch(async () => {
        throw new ApiError(500, null)
      })
      await expect(server.searchPlaces('Ga')).resolves.toEqual({ kind: 'failed' })
    })
  })

  describe('map services', () => {
    const query = { lat: 1, lon: 2, width: 100, height: 80, scheme: 'light' as const }
    const withApi = (api: Partial<SyncApi>, isOnline = () => true) =>
      createSyncEngine({ analytics: noopAnalytics, db, api: { ...fake.api, ...api }, isOnline })

    it('hands back the token and the snapshot url', async () => {
      const engine = withApi({
        mapKitToken: async () => ({ token: 'jwt', expires_at: '2026-10-21T00:30:00Z' }),
        placeSnapshot: async () => ({ url: 'https://snapshot.test/a.png' }),
      })
      await expect(engine.mapKitToken()).resolves.toBe('jwt')
      await expect(engine.placeSnapshot(query)).resolves.toBe('https://snapshot.test/a.png')
    })

    it('answers null on a failed call or offline, without calling the API offline', async () => {
      const token = vi.fn()
      const snapshot = vi.fn()
      const offline = withApi({ mapKitToken: token, placeSnapshot: snapshot }, () => false)
      await expect(offline.mapKitToken()).resolves.toBeNull()
      await expect(offline.placeSnapshot(query)).resolves.toBeNull()
      expect(token).not.toHaveBeenCalled()
      expect(snapshot).not.toHaveBeenCalled()
      const failing = withApi({
        mapKitToken: async () => {
          throw new ApiError(503, null)
        },
        placeSnapshot: async () => {
          throw new ApiError(503, null)
        },
      })
      await expect(failing.mapKitToken()).resolves.toBeNull()
      await expect(failing.placeSnapshot(query)).resolves.toBeNull()
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
    const engine = createSyncEngine({
      analytics: noopAnalytics,
      db,
      api: fake.api,
      isOnline: () => true,
    })
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
    const engine = createSyncEngine({
      analytics: noopAnalytics,
      db,
      api: fake.api,
      isOnline: () => true,
    })
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
    const engine = createSyncEngine({
      analytics: noopAnalytics,
      db,
      api: fake.api,
      isOnline: () => false,
    })
    await engine.pullEvents()
    expect(fake.eventPulls).toEqual([])
    expect(await getEventsCursor(db)).toBe(0)
    expect(await db.play_events.count()).toBe(0)
  })

  it('push applies an event result into its store', async () => {
    const play = playEventRow('play-1')
    await recordEvent(db, 'play_events', play)
    const engine = createSyncEngine({
      analytics: noopAnalytics,
      db,
      api: fake.api,
      isOnline: () => true,
    })
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
    const engine = createSyncEngine({
      analytics: noopAnalytics,
      db,
      api: fake.api,
      isOnline: () => true,
    })
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
    const engine = createSyncEngine({ analytics: noopAnalytics, db, api, isOnline: () => true })
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
    const engine = createSyncEngine({ analytics: noopAnalytics, db, api, isOnline: () => true })
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

describe('seen notices', () => {
  const TRIAL_ENDS = '2026-10-20T00:00:00.000Z'
  const trial = entitlementRow({
    premium_source: 'trial',
    premium_expires_at: TRIAL_ENDS,
    trial_ends_at: TRIAL_ENDS,
  })

  function engineFor() {
    const engine = createSyncEngine({
      analytics: noopAnalytics,
      db,
      api: fake.api,
      isOnline: () => true,
    })
    onTestFinished(() => engine.stop())
    return engine
  }

  /** The server's row once it has stamped the notice, as the next pull brings it. */
  function stamped(): PullRow {
    const row = { ...trial, recording_notice_seen_at: '2026-10-10T00:00:00.000Z', server_seq: 2 }
    return { table: 'entitlements', row: { ...row, user_id: 'server-user' } } as unknown as PullRow
  }

  it('posts a notice seen on this device once, and forgets it once the row carries it', async () => {
    await db.entitlements.put(trial)
    await markNoticeSeen(db, 'first_recording')
    const engine = engineFor()

    fake.queuePull({ rows: [stamped()], next_since: 2, has_more: false })
    await engine.sync()
    expect(fake.notices).toEqual(['first_recording'])
    expect(await seenNotices(db)).toEqual(new Set(['first_recording']))

    await engine.sync()
    await engine.sync()
    expect(fake.notices).toEqual(['first_recording'])
    expect(await seenNotices(db)).toEqual(new Set())
  })

  it('keeps a notice whose post failed and posts it on the next sync, with the sync clean', async () => {
    await db.entitlements.put(trial)
    await markNoticeSeen(db, 'first_recording')
    const analytics = recordingAnalytics()
    const engine = createSyncEngine({ analytics, db, api: fake.api, isOnline: () => true })
    onTestFinished(() => engine.stop())

    const failure = new ApiError(500, null)
    fake.failNotice(failure)
    vi.mocked(Sentry.captureException).mockClear()
    await engine.sync()
    expect(engine.status()).toBe('idle')
    expect(Sentry.captureException).toHaveBeenCalledExactlyOnceWith(failure, { level: 'warning' })
    expect(fake.notices).toEqual([])
    expect(await seenNotices(db)).toEqual(new Set(['first_recording']))
    expect(analytics.sends()).toEqual([])

    fake.failNotice(null)
    await engine.sync()
    expect(fake.notices).toEqual(['first_recording'])
  })

  it('reports a failing notice post once per run of consecutive failed syncs', async () => {
    await db.entitlements.put(trial)
    await markNoticeSeen(db, 'first_recording')
    const engine = engineFor()
    const failure = new ApiError(500, null)
    vi.mocked(Sentry.captureException).mockClear()

    fake.failNotice(failure)
    await engine.sync()
    await engine.sync()
    expect(Sentry.captureException).toHaveBeenCalledOnce()

    fake.failNotice(null)
    await engine.sync()
    expect(fake.notices).toEqual(['first_recording'])
    await markNoticeSeen(db, 'trial_reminder')
    fake.failNotice(failure)
    await engine.sync()
    expect(Sentry.captureException).toHaveBeenCalledTimes(2)
  })

  it('stops posting a notice the server refuses for good, and keeps it seen here', async () => {
    await db.entitlements.put(trial)
    await markNoticeSeen(db, 'first_recording')
    const engine = engineFor()
    const recordNotice = vi.spyOn(fake.api, 'recordNotice')

    fake.failNotice(new ApiError(422, null))
    await engine.sync()
    expect(engine.status()).toBe('idle')
    expect(recordNotice).toHaveBeenCalledOnce()

    fake.failNotice(null)
    await engine.sync()
    expect(recordNotice).toHaveBeenCalledOnce()
    expect(fake.notices).toEqual([])
    expect(await seenNotices(db)).toEqual(new Set(['first_recording']))
    expect(
      dueUnseenNotice(trial, new Date('2026-10-10T00:00:00.000Z'), true, await seenNotices(db)),
    ).toBeNull()
  })

  it('stops posting a notice the plan refuses, without failing the sync', async () => {
    await db.entitlements.put(trial)
    await markNoticeSeen(db, 'first_recording')
    const engine = engineFor()
    const recordNotice = vi.spyOn(fake.api, 'recordNotice')

    fake.failNotice(
      new ApiError(403, { type: PREMIUM_REQUIRED_PROBLEM, title: 't', status: 403, detail: 'd' }),
    )
    await engine.sync()
    expect(engine.status()).toBe('idle')

    fake.failNotice(null)
    await engine.sync()
    expect(recordNotice).toHaveBeenCalledOnce()
    expect(await seenNotices(db)).toEqual(new Set(['first_recording']))
  })

  it('fails the sync as unauthorized when the notice post is refused for the session', async () => {
    await db.entitlements.put(trial)
    await markNoticeSeen(db, 'first_recording')
    const engine = engineFor()

    fake.failNotice(new ApiError(401, null))
    await engine.sync()
    expect(engine.status()).toBe('unauthorized')
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

describe('sync_failed', () => {
  function reporting(isOnline = () => true) {
    const analytics = recordingAnalytics()
    const engine = createSyncEngine({ analytics, db, api: fake.api, isOnline })
    onTestFinished(() => engine.stop())
    return { analytics, engine }
  }

  it('sync_failed once per state across consecutive failures, again after a clean run', async () => {
    const { analytics, engine } = reporting()

    fake.fail(new ApiError(500, null))
    await engine.sync()
    await engine.sync()
    expect(analytics.sends()).toEqual([
      { name: 'sync_failed', props: { failure_reason: 'server_error' } },
    ])

    fake.fail(new ApiError(401, null))
    await engine.sync()
    await engine.sync()
    expect(engine.status()).toBe('unauthorized')
    expect(analytics.sends().map((send) => send.props)).toEqual([
      { failure_reason: 'server_error' },
      { failure_reason: 'auth_expired' },
    ])

    fake.fail(null)
    await engine.sync()
    expect(engine.status()).toBe('idle')
    fake.fail(new ApiError(422, null))
    await engine.sync()
    expect(analytics.sends().map((send) => send.props)).toEqual([
      { failure_reason: 'server_error' },
      { failure_reason: 'auth_expired' },
      { failure_reason: 'other' },
    ])
  })

  it('sync_failed reports a local storage error as other', async () => {
    const { analytics, engine } = reporting()
    vi.spyOn(fake.api, 'pull').mockRejectedValue(new DOMException('full', 'QuotaExceededError'))

    await engine.sync()

    expect(engine.status()).toBe('error')
    expect(analytics.sends()).toEqual([{ name: 'sync_failed', props: { failure_reason: 'other' } }])
  })

  it('sync_failed is never sent while offline', async () => {
    let online = false
    const { analytics, engine } = reporting(() => online)

    fake.fail(new NetworkError(new TypeError('Failed to fetch')))
    await engine.sync()
    expect(engine.status()).toBe('offline')

    online = true
    fake.fail(new NoTokenError())
    await engine.sync()
    expect(engine.status()).toBe('offline')

    fake.fail(new NetworkError(new TypeError('Failed to fetch')))
    await engine.sync()
    expect(engine.status()).toBe('offline')

    expect(analytics.sends()).toEqual([])
  })
})
