import type { CrosstuneDb } from './schema'
import type { LocalScan } from './types'

export type ScanOrigin = 'captured' | 'downloaded'

/** The `error` a captured file carries while the server refuses it for quota. A code, not copy:
 * the UI maps it to its label. */
export const SCAN_STORAGE_FULL_ERROR = 'storage_full'

/** The `error` a captured file carries once the server has refused its scan row, so it cannot be
 * given a slot. Deleting the scan clears it, and so does an upload that lands once a later push
 * has stored the row. */
export const SCAN_REFUSED_ERROR = 'refused'

/**
 * A scan image kept on this device. `captured` files wait for upload; `downloaded` ones are a
 * cache of what the server holds. The retry fields belong to the upload pass.
 */
export interface ScanFile {
  id: string
  blob: Blob
  origin: ScanOrigin
  error: string | null
  next_attempt_at: number | null
  upload_attempts: number
}

/** Reading order: position, with the id breaking ties so two devices agree. */
export function sortScans<T extends { position: number; id: string }>(scans: T[]): T[] {
  return [...scans].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
}

/**
 * Whether each scan is live here: not deleted, on a tune that is here and not deleted. A tune
 * tombstone pulled from another device never reaches a scan the server refused, so the tune
 * decides as much as the scan. Callers inside a transaction must include `tunes`.
 */
export async function scansLive(
  db: CrosstuneDb,
  scans: readonly (LocalScan | undefined)[],
): Promise<boolean[]> {
  const tunes = await db.tunes.bulkGet(scans.map((scan) => scan?.tune_id ?? ''))
  return scans.map((scan, i) => {
    const tune = tunes[i]
    return !!scan && !scan.deleted_at && !!tune && !tune.deleted_at
  })
}
