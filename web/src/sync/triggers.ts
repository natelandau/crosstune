import { liveQuery } from 'dexie'
import type { CrosstuneDb } from '../db/schema'
import type { SyncEngine } from './types'

// Long enough to fold a burst of edits into one push, short enough to feel immediate.
export const WRITE_DEBOUNCE_MS = 3000

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
  const onOnline = () => void engine.sync()
  const onVisibility = () => {
    if (doc.visibilityState === 'visible') void engine.sync()
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

  void engine.sync()

  return () => {
    target.removeEventListener('online', onOnline)
    doc.removeEventListener('visibilitychange', onVisibility)
    subscription.unsubscribe()
    if (timer) clearTimeout(timer)
  }
}
