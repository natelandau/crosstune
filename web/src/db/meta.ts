import type { CrosstuneDb } from './schema'

export const META_PULL_CURSOR = 'pull_cursor'
export const META_EVENTS_CURSOR = 'events_cursor'
export const META_INVALID_CHANGES = 'invalid_changes'
export const META_STORAGE = 'storage'
export const META_KEEP_OFFLINE = 'keep_offline'
/** Which recordings the Recordings tab lists: 'all', 'own', or an import source. */
export const META_RECORDINGS_ORIGIN = 'recordings_origin'
export const META_SCAN_INVERT = 'scan_invert'

export interface StorageFigures {
  used_bytes: number
  quota_bytes: number
  max_file_bytes: number
}

/**
 * Device-local key/value state that never syncs. Anything that should follow the user across
 * devices belongs in a `user_settings` row instead.
 */
export async function getMeta<T>(db: CrosstuneDb, key: string, fallback: T): Promise<T> {
  const entry = await db.meta.get(key)
  return entry === undefined ? fallback : (entry.value as T)
}

/** Writes device-local state; see `getMeta`. */
export async function setMeta(db: CrosstuneDb, key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value })
}

export function getPullCursor(db: CrosstuneDb): Promise<number> {
  return getMeta(db, META_PULL_CURSOR, 0)
}

export function setPullCursor(db: CrosstuneDb, cursor: number): Promise<void> {
  return setMeta(db, META_PULL_CURSOR, cursor)
}

export function getEventsCursor(db: CrosstuneDb): Promise<number> {
  return getMeta(db, META_EVENTS_CURSOR, 0)
}

export function setEventsCursor(db: CrosstuneDb, cursor: number): Promise<void> {
  return setMeta(db, META_EVENTS_CURSOR, cursor)
}

export function getInvalidChangeCount(db: CrosstuneDb): Promise<number> {
  return getMeta(db, META_INVALID_CHANGES, 0)
}

export function getStorage(db: CrosstuneDb): Promise<StorageFigures | null> {
  return getMeta<StorageFigures | null>(db, META_STORAGE, null)
}

export function setStorage(db: CrosstuneDb, figures: StorageFigures): Promise<void> {
  return setMeta(db, META_STORAGE, figures)
}

/** Whether this device downloads every ready recording so it plays without a connection. */
export function getKeepOffline(db: CrosstuneDb): Promise<boolean> {
  return getMeta(db, META_KEEP_OFFLINE, false)
}

export function setKeepOffline(db: CrosstuneDb, on: boolean): Promise<void> {
  return setMeta(db, META_KEEP_OFFLINE, on)
}

/** Whether this device shows scans as light ink on dark paper. */
export function getScanInvert(db: CrosstuneDb): Promise<boolean> {
  return getMeta(db, META_SCAN_INVERT, false)
}

export function setScanInvert(db: CrosstuneDb, on: boolean): Promise<void> {
  return setMeta(db, META_SCAN_INVERT, on)
}

/** Count pushes the server refused, so a later screen can tell the user what was lost. */
export async function countInvalidChanges(db: CrosstuneDb, added: number): Promise<void> {
  await db.transaction('rw', db.meta, async () => {
    await setMeta(db, META_INVALID_CHANGES, (await getInvalidChangeCount(db)) + added)
  })
}
