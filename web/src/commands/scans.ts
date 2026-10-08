import { sortScans } from '../db/scans'
import { moveBeside } from '../domain/order'
import { syncTables, type CrosstuneDb } from '../db/schema'
import type { LocalScan } from '../db/types'
import { newId, nextPosition, now, putRow, tombstone } from './write'

/** The most live scans one tune can hold; the API refuses more. */
export const MAX_SCANS = 20

export class ScanLimitError extends Error {
  constructor() {
    super(`A tune holds at most ${MAX_SCANS} scans.`)
    this.name = 'ScanLimitError'
  }
}

export interface NewScan {
  blob: Blob
  width: number
  height: number
}

function scansTx<T>(db: CrosstuneDb, fn: () => Promise<T>): Promise<T> {
  return db.transaction('rw', [...syncTables(db), db.outbox, db.scan_files], fn)
}

async function liveScans(db: CrosstuneDb, tuneId: string): Promise<LocalScan[]> {
  const rows = await db.scans.where('tune_id').equals(tuneId).toArray()
  return sortScans(rows.filter((row) => !row.deleted_at))
}

/** Append scans after the tune's existing ones. Throws before writing when they would not fit. */
export async function addScans(
  db: CrosstuneDb,
  tuneId: string,
  scans: NewScan[],
): Promise<string[]> {
  const at = now()
  return scansTx(db, async () => {
    const live = await liveScans(db, tuneId)
    if (live.length + scans.length > MAX_SCANS) throw new ScanLimitError()
    const start = nextPosition(live)
    const ids: string[] = []
    for (const [offset, scan] of scans.entries()) {
      const id = newId()
      ids.push(id)
      await putRow(db, 'scans', {
        id,
        created_at: at,
        updated_at: at,
        deleted_at: null,
        server_seq: 0,
        tune_id: tuneId,
        position: start + offset,
        width: scan.width,
        height: scan.height,
        state: 'pending_upload',
        file_bytes: null,
      })
      await db.scan_files.put({
        id,
        blob: scan.blob,
        origin: 'captured',
        error: null,
        next_attempt_at: null,
        upload_attempts: 0,
      })
    }
    return ids
  })
}

async function writePositions(db: CrosstuneDb, ordered: readonly LocalScan[]): Promise<void> {
  const at = now()
  for (const [position, row] of ordered.entries()) {
    if (row.position !== position) {
      await putRow(db, 'scans', { ...row, position, updated_at: at })
    }
  }
}

/**
 * Move a scan just past another of the same tune's scans, after it when it was below and before
 * it when above, and renumber from 0. Naming the target rather than an index keeps a move made
 * against a stale screen landing beside the scan the musician aimed at.
 */
export async function moveScan(db: CrosstuneDb, scanId: string, targetId: string): Promise<void> {
  await scansTx(db, async () => {
    const scan = await db.scans.get(scanId)
    if (!scan || scan.deleted_at) return
    const live = await liveScans(db, scan.tune_id)
    await writePositions(
      db,
      moveBeside(live, (row) => row.id, scanId, targetId),
    )
  })
}

/** Tombstone a scan. Its local file stays until the transfer pass drops it. */
export async function deleteScan(db: CrosstuneDb, scanId: string): Promise<void> {
  await scansTx(db, () => tombstone(db, 'scans', scanId, now()))
}
