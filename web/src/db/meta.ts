import type { CrosstuneDb } from './schema'
import { PREMIUM_TABLES } from './types'

export const META_PULL_CURSOR = 'pull_cursor'
const META_EVENTS_CURSOR = 'events_cursor'
const META_INVALID_CHANGES = 'invalid_changes'
const META_STORAGE = 'storage'
/** A point inside the account's country, from the API. */
const META_COUNTRY_CENTER = 'country_center'
export const META_KEEP_OFFLINE = 'keep_offline'
/** Whether the last Keep offline pass left recordings out to keep room for new recordings. */
const META_DOWNLOADS_HELD_FOR_SPACE = 'downloads_held_for_space'
/** Which recordings the Recordings tab lists: 'all', 'own', or an import source. */
export const META_RECORDINGS_ORIGIN = 'recordings_origin'
export const META_SCAN_INVERT = 'scan_invert'
/** Recordings and scans the server refused for Premium: their changes wait in the outbox until
 * it agrees. */
export const META_LOCAL_ONLY_ROWS = 'premium_holds'
/** The seen notices whose post the server refused for good: they stay seen and are never
 * posted again. */
export const META_REFUSED_NOTICES = 'refused_notices'
/** One-time notices seen on this device that the server has not confirmed yet. */
export const META_SEEN_NOTICES = 'seen_notices'

export interface StorageUsage {
  used_bytes: number
  quota_bytes: number
  max_file_bytes: number
  /** The cap for a split parent's upload; absent in usage stored before the server sent it. */
  split_parent_max_file_bytes?: number
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

export function getStorage(db: CrosstuneDb): Promise<StorageUsage | null> {
  return getMeta<StorageUsage | null>(db, META_STORAGE, null)
}

export function setStorage(db: CrosstuneDb, usage: StorageUsage): Promise<void> {
  return setMeta(db, META_STORAGE, usage)
}

/** A point inside the account's country, null until the API has given one. */
export function getCountryCenter(db: CrosstuneDb): Promise<{ lat: number; lon: number } | null> {
  return getMeta<{ lat: number; lon: number } | null>(db, META_COUNTRY_CENTER, null)
}

export function setCountryCenter(
  db: CrosstuneDb,
  center: { lat: number; lon: number } | null,
): Promise<void> {
  return setMeta(db, META_COUNTRY_CENTER, center)
}

/** Whether this device downloads every ready recording so it plays without a connection. */
export function getKeepOffline(db: CrosstuneDb): Promise<boolean> {
  return getMeta(db, META_KEEP_OFFLINE, false)
}

export function setKeepOffline(db: CrosstuneDb, on: boolean): Promise<void> {
  return setMeta(db, META_KEEP_OFFLINE, on)
}

export function getDownloadsHeldForSpace(db: CrosstuneDb): Promise<boolean> {
  return getMeta(db, META_DOWNLOADS_HELD_FOR_SPACE, false)
}

export async function setDownloadsHeldForSpace(db: CrosstuneDb, held: boolean): Promise<void> {
  // Only a change is written, so a pass that ends as it began wakes no live query.
  if ((await getDownloadsHeldForSpace(db)) !== held) {
    await setMeta(db, META_DOWNLOADS_HELD_FOR_SPACE, held)
  }
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

/**
 * The recordings and scans kept local until subscribed. A row counts only while its upsert is
 * still queued: a delete, or a parent's delete that drops the entry, leaves nothing waiting on the
 * plan, and may bring no result to release it. Read inside a transaction that covers the outbox,
 * or a live query.
 */
export async function getLocalOnlyRows(db: CrosstuneDb): Promise<Set<string>> {
  const stored = await storedLocalOnlyRows(db)
  if (stored.size === 0) return stored
  const queued = await db.outbox
    .where('[table+row_id]')
    .anyOf([...stored].flatMap((id) => PREMIUM_TABLES.map((table) => [table, id])))
    .toArray()
  return new Set(queued.filter((entry) => entry.op === 'upsert').map((entry) => entry.row_id))
}

async function storedLocalOnlyRows(db: CrosstuneDb): Promise<Set<string>> {
  return new Set(await getMeta<string[]>(db, META_LOCAL_ONLY_ROWS, []))
}

async function changeHolds(db: CrosstuneDb, change: (holds: Set<string>) => void): Promise<void> {
  await db.transaction('rw', db.meta, async () => {
    const holds = await storedLocalOnlyRows(db)
    const size = holds.size
    change(holds)
    if (holds.size !== size) await setMeta(db, META_LOCAL_ONLY_ROWS, [...holds])
  })
}

export function keepLocalUntilSubscribed(db: CrosstuneDb, ids: string[]): Promise<void> {
  if (ids.length === 0) return Promise.resolve()
  return changeHolds(db, (holds) => ids.forEach((id) => holds.add(id)))
}

export function releaseLocalOnlyRows(db: CrosstuneDb, ids: string[]): Promise<void> {
  if (ids.length === 0) return Promise.resolve()
  return changeHolds(db, (holds) => ids.forEach((id) => holds.delete(id)))
}
