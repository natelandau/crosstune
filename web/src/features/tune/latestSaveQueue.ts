/**
 * Runs one save at a time, so a slow one never lands over a later one. Saves handed over while
 * one runs share a single slot queued behind it, which runs the latest of them.
 *
 * Returns the promise of a newly queued slot, or null when the save took the place of one
 * already waiting.
 */
export function latestSaveQueue(): (save: () => Promise<void>) => Promise<void> | null {
  let queue: Promise<unknown> = Promise.resolve()
  let pending: (() => Promise<void>) | null = null
  return (save) => {
    const queued = pending !== null
    pending = save
    if (queued) return null
    const next = queue.then(() => {
      const run = pending
      pending = null
      return run?.()
    })
    queue = next.catch(() => {})
    return next
  }
}
