import { useEffect } from 'react'

/**
 * Holds the screen on until the returned function is called. The browser drops the lock
 * whenever the tab is hidden, so it is taken again each time the tab becomes visible. A refused
 * or missing lock is silent: a musician can do nothing about it, and an error line on a reading
 * screen would only take room from the words.
 */
export function holdScreenAwake(): () => void {
  const api = navigator.wakeLock
  let sentinel: WakeLockSentinel | null = null
  // Blocks a second request while the first is still in flight, so a hide-then-show before the
  // first resolves cannot leave two sentinels held with only one ever reachable to release.
  let pending = false
  // A visibility change that arrives while a request is already in flight would otherwise be
  // dropped for good: nothing else re-checks visibility once that request settles.
  let missed = false
  let live = true

  const take = (): void => {
    if (!live || !api || sentinel) return
    if (pending) {
      missed = true
      return
    }
    if (document.visibilityState !== 'visible') return
    pending = true
    // request() is specified to return a promise, but caught here too: a synchronous throw
    // from a non-conformant implementation would otherwise leave pending stuck true forever,
    // since the chain that clears it would never have been attached.
    let request: Promise<WakeLockSentinel>
    try {
      request = api.request('screen')
    } catch (error) {
      request = Promise.reject(error)
    }
    void request
      .then((granted) => {
        if (!live) {
          void granted.release().catch(() => {})
          return
        }
        // A sentinel that arrives already released (the document went hidden mid-request) must
        // not be stored: no release event will ever fire to clear it.
        if (granted.released) return
        sentinel = granted
        // Identity-checked: an earlier, already-superseded sentinel releasing on its own must
        // not null out the one currently held.
        granted.addEventListener('release', () => {
          if (sentinel === granted) sentinel = null
        })
      })
      .catch(() => {})
      .finally(() => {
        pending = false
        if (missed) {
          missed = false
          take()
        }
      })
  }

  take()
  document.addEventListener('visibilitychange', take)

  return () => {
    live = false
    document.removeEventListener('visibilitychange', take)
    void sentinel?.release().catch(() => {})
    sentinel = null
  }
}

export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return
    return holdScreenAwake()
  }, [active])
}
