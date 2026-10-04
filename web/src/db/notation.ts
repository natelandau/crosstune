import type { CrosstuneDb } from './schema'
import type { LocalNotationPage } from './types'

export type NotationOrigin = 'captured' | 'downloaded'

/** The `error` a captured file carries while the server refuses it for quota. A code, not copy:
 * the UI maps it to its label. */
export const NOTATION_STORAGE_FULL_ERROR = 'storage_full'

/** The `error` a captured file carries once the server has refused its page row, so it cannot be
 * given a slot. Deleting the page clears it, and so does an upload that lands once a later push
 * has stored the row. */
export const NOTATION_REFUSED_ERROR = 'refused'

/**
 * A page image kept on this device. `captured` files wait for upload; `downloaded` ones are a
 * cache of what the server holds. The retry fields belong to the upload pass.
 */
export interface NotationFile {
  id: string
  blob: Blob
  origin: NotationOrigin
  error: string | null
  next_attempt_at: number | null
  upload_attempts: number
}

/** Reading order: position, with the id breaking ties so two devices agree. */
export function sortPages<T extends { position: number; id: string }>(pages: T[]): T[] {
  return [...pages].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
}

/**
 * Whether each page is live here: not deleted, on a tune that is here and not deleted. A tune
 * tombstone pulled from another device never reaches a page the server refused, so the tune
 * decides as much as the page. Callers inside a transaction must include `tunes`.
 */
export async function pagesLive(
  db: CrosstuneDb,
  pages: readonly (LocalNotationPage | undefined)[],
): Promise<boolean[]> {
  const tunes = await db.tunes.bulkGet(pages.map((page) => page?.tune_id ?? ''))
  return pages.map((page, i) => {
    const tune = tunes[i]
    return !!page && !page.deleted_at && !!tune && !tune.deleted_at
  })
}
