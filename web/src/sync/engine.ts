import * as Sentry from '@sentry/react'
import { ApiError, NetworkError, NoTokenError } from '../api/client'
import type { Change, ResolveResponse } from '../api/types'
import { countInvalidChanges, getPullCursor } from '../db/meta'
import { PUSH_BATCH_SIZE, pendingBatch } from '../db/outbox'
import type { CrosstuneDb } from '../db/schema'
import { applyPullPage, applyPushResults, type InvalidChange } from './apply'
import type { SyncApi, SyncEngine, SyncStatus } from './types'

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
  if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
    return 'unauthorized'
  }
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

  function setStatus(next: SyncStatus) {
    if (status === next) return
    status = next
    for (const listener of listeners) listener(next)
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
      await push()
      await pull()
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
    async resolveLink(url: string): Promise<ResolveResponse | null> {
      if (!isOnline()) return null
      try {
        return await api.resolveLink(url)
      } catch {
        return null
      }
    },
    stop() {
      stopped = true
      cancelRetry()
    },
    resume() {
      stopped = false
    },
  }
}
