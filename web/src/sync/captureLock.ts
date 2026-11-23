// jsdom, and any plain Node test environment, has no navigator.locks; guard the read
// so importing or calling these outside a real browser never throws.
export function defaultLocks(): LockManager | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator.locks
}

const LOCK_PREFIX = 'capture:'

export function captureLockName(id: string): string {
  return `${LOCK_PREFIX}${id}`
}

/**
 * Hold the Web Lock `name` until the returned function releases it or the page closes, so any
 * tab can tell work in progress from work a closed page left. Resolves once the lock is
 * granted; rejects when the request is refused before then.
 */
export function holdLock(name: string, locks: LockManager): Promise<() => void> {
  return new Promise<() => void>((resolveAcquired, rejectAcquired) => {
    let granted = false
    locks
      .request(name, () => {
        granted = true
        return new Promise<void>((release) => resolveAcquired(release))
      })
      // A rejection before grant (a SecurityError, an abort) means the caller's promise
      // never resolved and must reject instead; one after grant is the lock manager
      // settling the request once our own release() already resolved it, so it is moot.
      .catch((error: unknown) => {
        if (!granted) rejectAcquired(error)
      })
  })
}

/** The part after `prefix` of every held lock name that starts with it. */
export async function heldLockSuffixes(prefix: string, locks: LockManager): Promise<Set<string>> {
  const { held } = await locks.query()
  const suffixes = new Set<string>()
  for (const lock of held ?? []) {
    if (lock.name?.startsWith(prefix)) suffixes.add(lock.name.slice(prefix.length))
  }
  return suffixes
}

/**
 * Hold a Web Lock for the lifetime of a capture, so any tab or engine can tell a live
 * recorder from an abandoned one regardless of how long it has been since its last chunk.
 * Resolves once the lock is granted, with a function that releases it.
 */
export function acquireCaptureLock(
  id: string,
  locks: LockManager | undefined = defaultLocks(),
): Promise<() => void> {
  if (!locks) return Promise.resolve(() => {})
  return holdLock(captureLockName(id), locks)
}

/** The recording ids with a held capture lock, or null when there is no lock manager to ask. */
export async function heldCaptureIds(
  locks: LockManager | undefined = defaultLocks(),
): Promise<Set<string> | null> {
  return locks ? heldLockSuffixes(LOCK_PREFIX, locks) : null
}
