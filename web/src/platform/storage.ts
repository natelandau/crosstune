/** Ask the browser to keep this origin's storage out of eviction. A refusal is silent: nothing the app can do about it. */
export function persistStorage(): void {
  void navigator.storage?.persist?.().catch(() => {})
}

export type StorageArea = 'local' | 'session'

// Private mode or blocked storage throws on access, even on touching the area itself.
const areaOf = (area: StorageArea): Storage => (area === 'local' ? localStorage : sessionStorage)

/** The raw value under `key`, or null when it is unset or storage is blocked. */
export function readStored(key: string, area: StorageArea = 'local'): string | null {
  try {
    return areaOf(area).getItem(key)
  } catch {
    return null
  }
}

/**
 * Stores `value` under `key`, or removes the key for null. Blocked storage drops the write, so a
 * caller that must keep the value for this page holds it in memory, as `createStoredValue` does.
 */
export function writeStored(key: string, value: string | null, area: StorageArea = 'local'): void {
  try {
    if (value === null) areaOf(area).removeItem(key)
    else areaOf(area).setItem(key, value)
  } catch {
    // Nothing to do: the caller's in-memory copy carries the value.
  }
}

export interface StoredValue<T> {
  get: () => T
  set: (value: T) => void
  subscribe: (listener: () => void) => () => void
  /** Re-reads storage and tells subscribers, for a write another tab made. */
  reload: () => void
}

/**
 * A per-device choice kept in storage, for `useSyncExternalStore`. Storage is read once; after
 * that memory is what the screen shows, so a choice made while storage is blocked still holds
 * until the page reloads. `parse` turns a raw value, null when unset, into a valid one.
 */
export function createStoredValue<T>({
  key,
  parse,
  serialize,
  area = 'local',
}: {
  key: string
  parse: (raw: string | null) => T
  serialize: (value: T) => string
  area?: StorageArea
}): StoredValue<T> {
  const read = () => parse(readStored(key, area))
  let current: { value: T } | undefined
  const listeners = new Set<() => void>()
  const notify = () => {
    for (const listener of listeners) listener()
  }
  return {
    get: () => (current ??= { value: read() }).value,
    set: (value) => {
      current = { value }
      writeStored(key, serialize(value), area)
      notify()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    reload: () => {
      current = { value: read() }
      notify()
    },
  }
}

/**
 * Runs `onWrite` when another tab of this origin writes one of `keys` to local storage, or
 * clears it. The storage event never fires in the tab that wrote. Returns the teardown.
 */
export function onOtherTabWrite(keys: readonly string[], onWrite: () => void): () => void {
  const listener = (event: StorageEvent) => {
    if (event.key === null || keys.includes(event.key)) onWrite()
  }
  window.addEventListener('storage', listener)
  return () => window.removeEventListener('storage', listener)
}
