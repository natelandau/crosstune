import type { CrosstuneDb } from './schema'

export const META_PULL_CURSOR = 'pull_cursor'
export const META_EVENTS_CURSOR = 'events_cursor'
export const META_INVALID_CHANGES = 'invalid_changes'
export const META_STORAGE = 'storage'
export const META_KEEP_OFFLINE = 'keep_offline'
/** Which recordings the Recordings tab lists: 'all', 'own', or an import source. */
export const META_RECORDINGS_ORIGIN = 'recordings_origin'
export const META_SCAN_INVERT = 'scan_invert'
/** Recordings the server refused for Premium: their changes wait in the outbox until it agrees. */
export const META_PREMIUM_HOLDS = 'premium_holds'
/** The seen notices whose post the server refused for good: they stay seen and are never
 * posted again. */
export const META_REFUSED_NOTICES = 'refused_notices'
/** The scans queued again after a refusal for their tune, and the grant they were queued under. */
export const META_SCAN_REQUEUES = 'scan_requeues'
/** One-time notices seen on this device that the server has not confirmed yet. */
export const META_SEEN_NOTICES = 'seen_notices'

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

export async function getPremiumHolds(db: CrosstuneDb): Promise<Set<string>> {
  return new Set(await getMeta<string[]>(db, META_PREMIUM_HOLDS, []))
}

async function changeHolds(db: CrosstuneDb, change: (holds: Set<string>) => void): Promise<void> {
  await db.transaction('rw', db.meta, async () => {
    const holds = await getPremiumHolds(db)
    const size = holds.size
    change(holds)
    if (holds.size !== size) await setMeta(db, META_PREMIUM_HOLDS, [...holds])
  })
}

export function holdForPremium(db: CrosstuneDb, ids: string[]): Promise<void> {
  if (ids.length === 0) return Promise.resolve()
  return changeHolds(db, (holds) => ids.forEach((id) => holds.add(id)))
}

export function releasePremiumHolds(db: CrosstuneDb, ids: string[]): Promise<void> {
  if (ids.length === 0) return Promise.resolve()
  return changeHolds(db, (holds) => ids.forEach((id) => holds.delete(id)))
}

/** Drop the holds whose recording has no queued upsert left, as after its entry was dropped
 * or superseded by a pull. */
export async function prunePremiumHolds(db: CrosstuneDb): Promise<void> {
  await db.transaction('rw', db.meta, db.outbox, async () => {
    const holds = await getPremiumHolds(db)
    if (holds.size === 0) return
    const queued = await db.outbox
      .where('[table+row_id]')
      .anyOf([...holds].map((id) => ['recordings', id]))
      .toArray()
    const live = new Set(queued.filter((entry) => entry.op !== 'delete').map((e) => e.row_id))
    await releasePremiumHolds(
      db,
      [...holds].filter((id) => !live.has(id)),
    )
  })
}
