import * as Sentry from '@sentry/react'
import { NetworkError, NoTokenError } from '../api/client'
import type { Change, ResolveResponse } from '../api/types'
import { countInvalidChanges, getPullCursor } from '../db/meta'
import { PUSH_BATCH_SIZE, pendingBatch } from '../db/outbox'
import type { CrosstuneDb } from '../db/schema'
import { applyPullPage, applyPushResults, type InvalidChange } from './apply'
import {
  downloadOne,
  downloadPass,
  recoverInterruptedCaptures,
  refreshStorage,
  uploadPass,
} from './transfers'
import type { SyncApi, SyncEngine, SyncStatus, TransferStatus } from './types'
import { isAuthFailure } from './errors'

export const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 32000, 60000] as const

export interface EngineOptions {
  db: CrosstuneDb
  api: SyncApi
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

export function createSyncEngine({
  db,
  api,
  isOnline = () => navigator.onLine,
  batchSize = PUSH_BATCH_SIZE,
  onInvalid = reportInvalid,
}: EngineOptions): SyncEngine {
  let status: SyncStatus = 'idle'
  const listeners = new Set<(status: SyncStatus) => void>()
  let running: Promise<void> | null = null
  let again = false
  let failures = 0
  let retry: ReturnType<typeof setTimeout> | null = null
  let stopped = false
  let syncedAt: string | null = null
  const inFlightDownloads = new Map<string, Promise<Blob | null>>()
  let transferState: TransferStatus = 'idle'
  const transferListeners = new Set<(status: TransferStatus) => void>()
  let transferRunning: Promise<void> | null = null
  let transferAgain = false
  let transferFailures = 0
  let transferRetry: ReturnType<typeof setTimeout> | null = null

  function setStatus(next: SyncStatus) {
    if (status === next) return
    status = next
    for (const listener of listeners) listener(next)
  }

  function setTransferStatus(next: TransferStatus) {
    if (transferState === next) return
    transferState = next
    for (const listener of transferListeners) listener(next)
  }

  async function push(): Promise<void> {
    for (;;) {
      const batch = await pendingBatch(db, batchSize)
      if (batch.length === 0) return
      const changes: Change[] = batch.map((entry) => ({
        table: entry.table,
        op: entry.op,
        id: entry.row_id,
        updated_at: entry.updated_at,
        data: entry.data,
      }))
      const response = await api.push(changes)
      const { invalid, settled } = await applyPushResults(db, batch, response.results)
      for (const change of invalid) onInvalid(change)
      if (invalid.length > 0) await countInvalidChanges(db, invalid.length)
      // A batch that settles nothing would send the same entries forever.
      if (settled === 0 || batch.length < batchSize) return
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
      void sync()
    }, delay)
  }

  async function runOnce(): Promise<void> {
    setStatus('syncing')
    try {
      // Safe to run every pass: a capture is recovered only once no tab holds its
      // lock, falling back to last-chunk staleness where there is no lock manager.
      await recoverInterruptedCaptures(db)
      await push()
      await pull()
      try {
        await refreshStorage(db, api)
      } catch (error) {
        // Storage figures are informational; only an auth failure should fail a sync
        // whose push and pull already landed.
        if (isAuthFailure(error)) throw error
      }
      failures = 0
      cancelRetry()
      syncedAt = new Date().toISOString()
      setStatus('idle')
    } catch (error) {
      const next = classifyFailure(error, isOnline)
      // Report once per streak: a retry that fails the same way adds nothing.
      if (next !== 'offline' && failures === 0) Sentry.captureException(error)
      setStatus(next)
      if (!stopped) scheduleRetry()
    }
  }

  function cancelTransferRetry() {
    if (transferRetry) clearTimeout(transferRetry)
    transferRetry = null
  }

  function scheduleTransferRetry() {
    cancelTransferRetry()
    const delay = BACKOFF_MS[Math.min(transferFailures, BACKOFF_MS.length - 1)]!
    transferFailures++
    transferRetry = setTimeout(() => {
      transferRetry = null
      void runTransfers()
    }, delay)
  }

  async function transferOnce(): Promise<void> {
    setTransferStatus('transferring')
    try {
      // A row's own transient failure is held rather than thrown immediately, so the
      // download pass still runs; it is rethrown below once it has.
      const uploadError = await uploadPass(db, api)
      await downloadPass(db, api)
      if (uploadError) throw uploadError
      transferFailures = 0
      cancelTransferRetry()
      setTransferStatus('idle')
    } catch (error) {
      const offline = classifyFailure(error, isOnline) === 'offline'
      if (!offline && transferFailures === 0) Sentry.captureException(error)
      setTransferStatus(offline ? 'offline' : 'error')
      if (!stopped) scheduleTransferRetry()
    }
  }

  /** Audio moves on its own serialized loop so a long upload never holds up push and pull. */
  function runTransfers(): Promise<void> {
    if (stopped) return Promise.resolve()
    if (transferRunning) {
      transferAgain = true
      return transferRunning
    }
    cancelTransferRetry()
    transferRunning = (async () => {
      do {
        transferAgain = false
        await transferOnce()
      } while (transferAgain && !stopped)
    })().finally(() => {
      transferRunning = null
    })
    return transferRunning
  }

  function sync(): Promise<void> {
    if (stopped) return Promise.resolve()
    if (running) {
      again = true
      return running
    }
    cancelRetry()
    running = (async () => {
      do {
        again = false
        await runOnce()
        // A pushed row can now take its upload, and a pulled one its download.
        void runTransfers()
      } while (again && !stopped)
    })().finally(() => {
      running = null
    })
    return running
  }

  return {
    sync,
    status: () => status,
    lastSyncedAt: () => syncedAt,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    transfer: runTransfers,
    transferStatus: () => transferState,
    subscribeTransfer(listener) {
      transferListeners.add(listener)
      return () => transferListeners.delete(listener)
    },
    async resolveLink(url: string): Promise<ResolveResponse | null> {
      if (!isOnline()) return null
      try {
        return await api.resolveLink(url)
      } catch {
        return null
      }
    },
    async download(recordingId: string): Promise<Blob | null> {
      const existing = inFlightDownloads.get(recordingId)
      if (existing) return existing
      const attempt = (async () => {
        try {
          if (!isOnline()) {
            const file = await db.recording_files.get(recordingId)
            return file?.blob ?? null
          }
          try {
            return await downloadOne(db, api, recordingId)
          } catch {
            return null
          }
        } finally {
          inFlightDownloads.delete(recordingId)
        }
      })()
      inFlightDownloads.set(recordingId, attempt)
      return attempt
    },
    async retry(recordingId: string): Promise<void> {
      await api.retryRecording(recordingId)
      void sync()
    },
    stop() {
      stopped = true
      cancelRetry()
      cancelTransferRetry()
    },
    resume() {
      stopped = false
    },
  }
}
