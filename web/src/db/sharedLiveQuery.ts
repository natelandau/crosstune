import { liveQuery, type Subscription } from 'dexie'
import { useSyncExternalStore } from 'react'
import { useDb } from './DbProvider'
import type { CrosstuneDb } from './schema'

// Replaced whole on every change, so `useSyncExternalStore` sees a failure as a new snapshot
// even when the value stays the same.
interface Snapshot<T> {
  value: T | undefined
  failure?: { caught: unknown }
}

interface Shared<T> {
  get: () => Snapshot<T>
  subscribe: (listener: () => void) => () => void
}

/**
 * A live query that every component reading it shares, as `useLiveQuery` would give each one its
 * own. Use it for a query several mounted views run at once, such as counts the sidebar and a
 * screen both show. It runs while anything reads it, and a reader after a gap starts from
 * undefined, as a fresh `useLiveQuery` does.
 */
export function createSharedLiveQuery<T>(
  query: (db: CrosstuneDb) => Promise<T>,
): () => T | undefined {
  const byDb = new WeakMap<CrosstuneDb, Shared<T>>()

  function sharedFor(db: CrosstuneDb): Shared<T> {
    let shared = byDb.get(db)
    if (shared) return shared
    const listeners = new Set<() => void>()
    const empty: Snapshot<T> = { value: undefined }
    let snapshot = empty
    let subscription: Subscription | null = null
    const notify = () => {
      for (const listener of listeners) listener()
    }
    shared = {
      get: () => snapshot,
      subscribe: (listener) => {
        listeners.add(listener)
        subscription ??= liveQuery(() => query(db)).subscribe({
          next: (next) => {
            snapshot = { value: next }
            notify()
          },
          error: (caught: unknown) => {
            snapshot = { value: snapshot.value, failure: { caught } }
            notify()
          },
        })
        return () => {
          listeners.delete(listener)
          // Deferred, since a commit that swaps one reader for another unsubscribes the old
          // before it subscribes the new, and the new one must not flash back to undefined.
          queueMicrotask(() => {
            if (listeners.size > 0) return
            subscription?.unsubscribe()
            subscription = null
            snapshot = empty
          })
        }
      },
    }
    byDb.set(db, shared)
    return shared
  }

  return function useSharedLiveQuery() {
    const shared = sharedFor(useDb())
    const { value, failure } = useSyncExternalStore(shared.subscribe, shared.get)
    // Thrown during render, as `useLiveQuery` does, so an error boundary sees a failed read.
    if (failure) throw failure.caught
    return value
  }
}
