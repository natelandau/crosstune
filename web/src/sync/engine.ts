import * as Sentry from '@sentry/react'
import type { AnalyticsClient } from '../usage/client'
import { syncFailureReason } from '../usage/failure'
import { ApiError, NetworkError, NoTokenError } from '../api/client'
import type { Change, DeleteAccountOptions, ResolveResponse } from '../api/types'
import { readPlan } from '../billing/entitlement'
import { postSeenNotices } from '../billing/notices'
import { countInvalidChanges, getEventsCursor, getPullCursor, pruneLocalOnlyRows } from '../db/meta'
import { PUSH_BATCH_SIZE, pendingBatch } from '../db/outbox'
import type { CrosstuneDb } from '../db/schema'
import { applyEventsPage, applyPullPage, applyPushResults, type InvalidChange } from './apply'
import { scanDownloadPass, scanUploadPass } from './scanTransfers'
import {
  createDownloadRetries,
  createUploadReports,
  downloadOne,
  downloadPass,
  fetchUnstored,
  fetchPeaks,
  recoverInterruptedCaptures,
  refreshStorage,
  uploadPass,
} from './transfers'
import type {
  PlaceSearchOutcome,
  SearchOutcome,
  SyncApi,
  SyncEngine,
  SyncStatus,
  TransferStatus,
  WithdrawOutcome,
} from './types'
import { isAccountDeleted, isAuthFailure } from './errors'

// The wait shown when a 429 carries no usable Retry-After.
const DEFAULT_RETRY_AFTER_SECONDS = 60

export const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 32000, 60000] as const

export interface EngineOptions {
  db: CrosstuneDb
  api: SyncApi
  analytics: AnalyticsClient
  isOnline?: () => boolean
  batchSize?: number
  onInvalid?: (change: InvalidChange) => void
}

export function classifyFailure(error: unknown, isOnline: () => boolean): SyncStatus {
  if (!isOnline()) return 'offline'
  // No session token and a failed fetch both mean "not reachable right now", not a bug.
  if (error instanceof NoTokenError || error instanceof NetworkError) return 'offline'
  if (isAuthFailure(error)) return 'unauthorized'
  return 'error'
}

function reportInvalid({ table, id, reason }: InvalidChange): void {
  console.warn('sync: change rejected', table, id, reason)
  Sentry.captureMessage('sync: change rejected', {
    level: 'warning',
    extra: { table, id, reason },
  })
}

interface Loop<S extends string> {
  /** Run now, or once more after the run in flight. */
  trigger(): Promise<void>
  status(): S
  subscribe(listener: (status: S) => void): () => void
  cancelRetry(): void
}

/**
 * A serialized run loop. Triggers while a run is in flight coalesce into one more run
 * after it; a failed run backs off and retries; the first of consecutive failures is reported.
 */
function createLoop<S extends string>({
  idle,
  busy,
  run,
  classify,
  isStopped,
  afterRun,
  onFailure,
}: {
  idle: S
  busy: S
  run: () => Promise<void>
  /** The status a failed run leaves behind. 'offline' is expected and never reported. */
  classify: (error: unknown) => S
  isStopped: () => boolean
  afterRun?: () => void
  /** Called when a run fails into a state, other than offline, not yet reported since the last success. */
  onFailure?: (state: S, error: unknown) => void
}): Loop<S> {
  let status = idle
  const listeners = new Set<(status: S) => void>()
  let running: Promise<void> | null = null
  let again = false
  let failures = 0
  let reportedFailure: S | null = null
  let retry: ReturnType<typeof setTimeout> | null = null

  function setStatus(next: S) {
    if (status === next) return
    status = next
    for (const listener of listeners) listener(next)
  }

  function cancelRetry() {
    if (retry) clearTimeout(retry)
    retry = null
  }

  function scheduleRetry() {
    cancelRetry()
    const delay = BACKOFF_MS[Math.min(failures, BACKOFF_MS.length - 1)]!
    failures++
    retry = setTimeout(() => {
      retry = null
      void trigger()
    }, delay)
  }

  async function runOnce(): Promise<void> {
    setStatus(busy)
    try {
      await run()
      failures = 0
      reportedFailure = null
      cancelRetry()
      setStatus(idle)
    } catch (error) {
      const next = classify(error)
      // Report once until a run succeeds: a retry that fails the same way adds nothing.
      if (next !== 'offline' && failures === 0) Sentry.captureException(error)
      if (next !== 'offline' && reportedFailure !== next) {
        reportedFailure = next
        onFailure?.(next, error)
      }
      setStatus(next)
      if (!isStopped()) scheduleRetry()
    }
  }

  function trigger(): Promise<void> {
    if (isStopped()) return Promise.resolve()
    if (running) {
      again = true
      return running
    }
    cancelRetry()
    running = (async () => {
      do {
        again = false
        await runOnce()
        afterRun?.()
      } while (again && !isStopped())
    })().finally(() => {
      running = null
    })
    return running
  }

  return {
    trigger,
    status: () => status,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    cancelRetry,
  }
}

/** Share one in-flight call per key: a second caller gets the first one's promise until it settles. */
function oncePerKey<T>(start: (key: string) => Promise<T>): (key: string) => Promise<T> {
  const inFlight = new Map<string, Promise<T>>()
  return (key) => {
    const existing = inFlight.get(key)
    if (existing) return existing
    const attempt = start(key).finally(() => inFlight.delete(key))
    inFlight.set(key, attempt)
    return attempt
  }
}

export function createSyncEngine({
  db,
  api,
  analytics,
  isOnline = () => navigator.onLine,
  batchSize = PUSH_BATCH_SIZE,
  onInvalid = reportInvalid,
}: EngineOptions): SyncEngine {
  let stopped = false
  let accountDeleted = false
  const accountDeletedListeners = new Set<() => void>()
  let syncedAt: string | null = null
  let noticeFailureReported = false

  async function push(): Promise<void> {
    await pruneLocalOnlyRows(db)
    const premium = (await readPlan(db, new Date())).kind !== 'free'
    // Kept local this push: each is sent at most once, so a full batch of them never stops the
    // entries queued behind.
    const keptLocalThisPush = new Set<string>()
    for (;;) {
      const batch = await pendingBatch(db, batchSize, { premium, skip: keptLocalThisPush })
      if (batch.length === 0) return
      const changes: Change[] = batch.map((entry) => ({
        table: entry.table,
        op: entry.op,
        id: entry.row_id,
        updated_at: entry.updated_at,
        data: entry.data,
      }))
      const response = await api.push(changes)
      const { invalid, settled, keptLocal } = await applyPushResults(db, batch, response.results)
      for (const change of invalid) onInvalid(change)
      if (invalid.length > 0) await countInvalidChanges(db, invalid.length)
      for (const id of keptLocal) keptLocalThisPush.add(id)
      // A batch that neither settles nor keeps anything local would send the same entries forever.
      if ((settled === 0 && keptLocal.length === 0) || batch.length < batchSize) return
    }
  }

  async function pull(): Promise<void> {
    let since = await getPullCursor(db)
    for (;;) {
      const page = await api.pull(since)
      await applyPullPage(db, page.rows, page.next_since)
      since = page.next_since
      if (!page.has_more) return
    }
  }

  async function pullEvents(): Promise<void> {
    let since = await getEventsCursor(db)
    for (;;) {
      const page = await api.events(since)
      await applyEventsPage(db, page.rows, page.next_since)
      since = page.next_since
      if (!page.has_more) return
    }
  }

  // The sync run and the events pull take turns, so an events page never lands mid-push.
  let turn: Promise<unknown> = Promise.resolve()
  function inTurn(run: () => Promise<void>): Promise<void> {
    const next = turn.then(run)
    turn = next.catch(() => undefined)
    return next
  }

  // One fetch per recording at a time, whether the download pass, a Play tap, or another caller asks.
  const fetchOne = oncePerKey((id) => downloadOne(db, api, id))
  const fetchPeaksOnce = oncePerKey((id) => fetchPeaks(db, api, id))

  const uploadReports = createUploadReports(analytics, isOnline)
  const downloadRetries = createDownloadRetries()
  const scanRetries = createDownloadRetries()

  function stop() {
    stopped = true
    syncing.cancelRetry()
    transfers.cancelRetry()
  }

  /** Rethrows every failure, first stopping and telling listeners, once, of a deleted account. */
  async function watchingForDeletion(run: () => Promise<void>): Promise<void> {
    try {
      await run()
    } catch (error) {
      // A stopped engine belongs to a device already leaving, such as one whose own delete
      // is in flight; that leave does the wipe.
      if (isAccountDeleted(error) && !accountDeleted && !stopped) {
        accountDeleted = true
        stop()
        for (const listener of accountDeletedListeners) listener()
      }
      throw error
    }
  }

  /** Files move on their own loop so a long upload never holds up push and pull. */
  const transfers = createLoop<TransferStatus>({
    idle: 'idle',
    busy: 'transferring',
    run: () =>
      watchingForDeletion(async () => {
        // A row's own transient failure is held rather than thrown immediately, so the
        // later passes still run; the first is rethrown below once they have. Scans go
        // first: they are small, and the reading view needs them more than any one recording.
        const scanUploadError = await scanUploadPass(db, api)
        const scanDownloadError = await scanDownloadPass(db, api, scanRetries).then(
          () => null,
          (error: unknown) => {
            if (isAuthFailure(error)) throw error
            return error
          },
        )
        const uploadError = await uploadPass(db, api, uploadReports)
        await downloadPass(db, api, fetchOne, downloadRetries, fetchPeaksOnce)
        const held = scanUploadError ?? scanDownloadError ?? uploadError
        if (held) throw held
      }),
    // A failed fetch while the browser reports a connection means the storage host or a
    // CORS rule refused, which would otherwise sit silently under "offline" forever.
    classify: (error) => (!isOnline() || error instanceof NoTokenError ? 'offline' : 'error'),
    isStopped: () => stopped,
  })

  const syncing = createLoop<SyncStatus>({
    idle: 'idle',
    busy: 'syncing',
    run: () =>
      // A stop while waiting for an events pull, such as a deleted account, means the database
      // may be on its way out.
      inTurn(() =>
        stopped
          ? Promise.resolve()
          : watchingForDeletion(async () => {
              // Safe to run every pass: a capture is recovered only once no tab holds its
              // lock, falling back to last-chunk staleness where there is no lock manager.
              await recoverInterruptedCaptures(db)
              await push()
              try {
                await postSeenNotices(db, api)
                noticeFailureReported = false
              } catch (error) {
                // A notice that failed to post waits for the next sync; only an auth failure
                // fails this one.
                if (isAuthFailure(error)) throw error
                // Reported once until a post succeeds: a retry that fails the same way adds nothing.
                if (!noticeFailureReported && classifyFailure(error, isOnline) !== 'offline') {
                  noticeFailureReported = true
                  Sentry.captureException(error, { level: 'warning' })
                }
              }
              await pull()
              try {
                await refreshStorage(db, api)
              } catch (error) {
                // Storage usage is informational; only an auth failure should fail a sync
                // whose push and pull already landed.
                if (isAuthFailure(error)) throw error
              }
              syncedAt = new Date().toISOString()
            }),
      ),
    classify: (error) => classifyFailure(error, isOnline),
    isStopped: () => stopped,
    onFailure: (_state, error) =>
      analytics.send('sync_failed', { failure_reason: syncFailureReason(error) }),
    // A pushed row can now take its upload, and a pulled one its download.
    afterRun: () => void transfers.trigger(),
  })

  // The sync loop reports its own failures; a failed pull must not turn a settled withdrawal into one.
  const pullQuietly = () => syncing.trigger().catch(() => {})

  return {
    sync: syncing.trigger,
    status: syncing.status,
    lastSyncedAt: () => syncedAt,
    subscribe: syncing.subscribe,
    transfer: transfers.trigger,
    transferStatus: transfers.status,
    subscribeTransfer: transfers.subscribe,
    async pullEvents(): Promise<void> {
      if (stopped || !isOnline()) return
      // A stop while waiting for the sync run means the database may be on its way out.
      await inTurn(() => (stopped ? Promise.resolve() : watchingForDeletion(pullEvents)))
    },
    async resolveLink(url: string): Promise<ResolveResponse | null> {
      if (!isOnline()) return null
      try {
        return await api.resolveLink(url)
      } catch {
        return null
      }
    },
    async searchRecordings(q, providers, country): Promise<SearchOutcome> {
      if (!isOnline()) return { kind: 'offline' }
      try {
        const { groups } = await api.searchRecordings(q, providers, country)
        return { kind: 'ok', groups }
      } catch (error) {
        if (error instanceof ApiError && error.status === 429) {
          return {
            kind: 'rate_limited',
            retryAfterSeconds: error.retryAfterSeconds ?? DEFAULT_RETRY_AFTER_SECONDS,
          }
        }
        return { kind: 'failed' }
      }
    },
    async searchPlaces(q): Promise<PlaceSearchOutcome> {
      if (!isOnline()) return { kind: 'offline' }
      try {
        const { results } = await api.searchPlaces(q)
        return { kind: 'ok', results }
      } catch (error) {
        if (error instanceof ApiError && error.status === 429) {
          return {
            kind: 'rate_limited',
            retryAfterSeconds: error.retryAfterSeconds ?? DEFAULT_RETRY_AFTER_SECONDS,
          }
        }
        if (error instanceof ApiError && error.status === 503) return { kind: 'unavailable' }
        return { kind: 'failed' }
      }
    },
    async mapKitToken(): Promise<string | null> {
      if (!isOnline()) return null
      try {
        return (await api.mapKitToken()).token
      } catch {
        return null
      }
    },
    async placeSnapshot(query): Promise<string | null> {
      if (!isOnline()) return null
      try {
        return (await api.placeSnapshot(query)).url
      } catch {
        return null
      }
    },
    async download(recordingId: string): Promise<Blob | null> {
      if (!isOnline()) {
        const file = await db.recording_files.get(recordingId)
        return file?.blob ?? null
      }
      try {
        return await fetchOne(recordingId)
      } catch {
        return null
      }
    },
    async peaks(recordingId: string): Promise<Uint8Array | null> {
      if (!isOnline()) {
        const file = await db.recording_files.get(recordingId)
        return file?.peaks ?? null
      }
      try {
        return await fetchPeaksOnce(recordingId)
      } catch {
        return null
      }
    },
    fetchFile: (kind, id, signal) => fetchUnstored(api, kind, id, signal),
    async retry(recordingId: string): Promise<void> {
      await api.retryRecording(recordingId)
      void syncing.trigger()
    },
    async refreshBilling(): Promise<void> {
      await api.refreshBilling()
    },
    async withdraw(): Promise<WithdrawOutcome> {
      try {
        await api.withdraw()
      } catch (caught) {
        if (caught instanceof ApiError && caught.status === 409) {
          // A refusal means the row is stale (window closed, already withdrawn), so pull it.
          await pullQuietly()
          const reason = caught.problem?.reason
          return reason === 'window_closed' || reason === 'already_withdrawn' ? reason : 'refused'
        }
        return 'failed'
      }
      // Returns only once the ended plan is local, so the caller's control never outlives it.
      await pullQuietly()
      return 'withdrawn'
    },
    async deleteAccount(options?: DeleteAccountOptions): Promise<void> {
      await api.deleteAccount(options)
    },
    onAccountDeleted(listener) {
      accountDeletedListeners.add(listener)
      return () => {
        accountDeletedListeners.delete(listener)
      }
    },
    stop,
    resume() {
      stopped = false
    },
  }
}
