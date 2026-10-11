import { scanTuneId } from '../billing/plan'
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

/** The `error` a captured file carries while the free plan refuses it for being off the scan
 * tune, whether its row was refused on push or its upload slot was. It retries once a plan
 * change could open it: see `scanUploadPass`. */
export const SCAN_TUNE_ONLY_ERROR = 'scan_tune_only'

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
  return scans.toSorted((a, b) => a.position - b.position || a.id.localeCompare(b.id))
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

/** The scan tune as the server counts it: every stored live scan, and every live scan made here
 * that has not been refused. A row the server refused on push was never stored, so it never
 * counts; a stored row whose upload slot was refused still does. A caller that has already read
 * the live scans passes them, to save a second read. */
export async function readScanTune(
  db: CrosstuneDb,
  liveScans?: readonly LocalScan[],
): Promise<string | null> {
  const scans = liveScans ?? (await db.scans.filter((row) => !row.deleted_at).toArray())
  // Keys only: a file row carries its image.
  const refused = new Set(
    await db.scan_files.where('error').equals(SCAN_TUNE_ONLY_ERROR).primaryKeys(),
  )
  const neverStored = new Set(
    scans.filter((scan) => refused.has(scan.id) && scan.server_seq === 0).map((scan) => scan.id),
  )
  return scanTuneId(scans, neverStored)
}
