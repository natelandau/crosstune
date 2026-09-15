import type { CrosstuneDb } from './schema'

export const META_PULL_CURSOR = 'pull_cursor'
export const META_INVALID_CHANGES = 'invalid_changes'
export const META_STORAGE = 'storage'
export const META_KEEP_OFFLINE_SONGS = 'keep_offline_songs'
export const META_KEEP_OFFLINE_LISTS = 'keep_offline_lists'

export interface StorageFigures {
  used_bytes: number
  quota_bytes: number
  max_file_bytes: number
}

export async function getMeta<T>(db: CrosstuneDb, key: string, fallback: T): Promise<T> {
  const entry = await db.meta.get(key)
  return entry === undefined ? fallback : (entry.value as T)
}

export async function setMeta(db: CrosstuneDb, key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value })
}

export function getPullCursor(db: CrosstuneDb): Promise<number> {
  return getMeta(db, META_PULL_CURSOR, 0)
}

export function setPullCursor(db: CrosstuneDb, cursor: number): Promise<void> {
  return setMeta(db, META_PULL_CURSOR, cursor)
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

export function getKeepOfflineSongs(db: CrosstuneDb): Promise<string[]> {
  return getMeta<string[]>(db, META_KEEP_OFFLINE_SONGS, [])
}

export function setKeepOfflineSongs(db: CrosstuneDb, ids: string[]): Promise<void> {
  return setMeta(db, META_KEEP_OFFLINE_SONGS, ids)
}

export function getKeepOfflineLists(db: CrosstuneDb): Promise<string[]> {
  return getMeta<string[]>(db, META_KEEP_OFFLINE_LISTS, [])
}

export function setKeepOfflineLists(db: CrosstuneDb, ids: string[]): Promise<void> {
  return setMeta(db, META_KEEP_OFFLINE_LISTS, ids)
}

/** Count pushes the server refused, so a later screen can tell the user what was lost. */
export async function countInvalidChanges(db: CrosstuneDb, added: number): Promise<void> {
  await db.transaction('rw', db.meta, async () => {
    await setMeta(db, META_INVALID_CHANGES, (await getInvalidChangeCount(db)) + added)
  })
}
