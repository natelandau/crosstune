import { liveQuery } from 'dexie'
import type { CrosstuneDb } from '../db/schema'
import type { SyncEngine } from './types'

// Long enough to fold a burst of edits into one push, short enough to feel immediate.
export const WRITE_DEBOUNCE_MS = 3000

// A recording usually clears Processing well within this window, so polling this often
// shows the result soon after it lands without hammering the server while it waits.
export const PROCESSING_POLL_MS = 15_000

const PROCESSING_STATES = ['uploaded', 'processing']

export interface TriggerOptions {
  target?: Window
  doc?: Document
  debounceMs?: number
}

export function startSyncTriggers(
  engine: SyncEngine,
  db: CrosstuneDb,
  { target = window, doc = document, debounceMs = WRITE_DEBOUNCE_MS }: TriggerOptions = {},
): () => void {
  let processing = false
  let pollTimer: ReturnType<typeof setInterval> | null = null

  function updatePolling() {
    const shouldPoll = processing && doc.visibilityState === 'visible'
    if (shouldPoll && !pollTimer) {
      pollTimer = setInterval(() => void engine.sync(), PROCESSING_POLL_MS)
    } else if (!shouldPoll && pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  const onOnline = () => void engine.sync()
  const onVisibility = () => {
    if (doc.visibilityState === 'visible') void engine.sync()
    updatePolling()
  }
  target.addEventListener('online', onOnline)
  doc.addEventListener('visibilitychange', onVisibility)

  let timer: ReturnType<typeof setTimeout> | null = null
  const subscription = liveQuery(() => db.outbox.count()).subscribe({
    next(count) {
      if (count === 0) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        void engine.sync()
      }, debounceMs)
    },
    error(error) {
      console.warn('sync: outbox watch failed', error)
    },
  })

  // A row sitting in Processing gets no pull of its own; only a poll notices it finished.
  const processingSubscription = liveQuery(() =>
    db.recordings.filter((r) => !r.deleted_at && PROCESSING_STATES.includes(r.state)).count(),
  ).subscribe({
    next(count) {
      processing = count > 0
      updatePolling()
    },
    error(error) {
      console.warn('sync: processing watch failed', error)
    },
  })

  void engine.sync()

  return () => {
    target.removeEventListener('online', onOnline)
    doc.removeEventListener('visibilitychange', onVisibility)
    subscription.unsubscribe()
    processingSubscription.unsubscribe()
    if (timer) clearTimeout(timer)
    if (pollTimer) clearInterval(pollTimer)
  }
}
