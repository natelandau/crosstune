import { useLiveQuery } from 'dexie-react-hooks'
import { useDb } from '../../db/DbProvider'
import { sortScans, type ScanFile } from '../../db/scans'
import type { LocalScan } from '../../db/types'

export interface TuneScans {
  /** The tune's live scans in reading order. */
  scans: LocalScan[]
  /** The image this device holds for each scan, by scan id; a scan not yet downloaded has none. */
  files: Map<string, ScanFile>
}

/** A tune's scans and their local images, or undefined until the first read lands. */
export function useScans(tuneId: string): TuneScans | undefined {
  const db = useDb()
  return useLiveQuery(async () => {
    const rows = await db.scans.where('tune_id').equals(tuneId).toArray()
    const scans = sortScans(rows.filter((row) => !row.deleted_at))
    const files = await db.scan_files.bulkGet(scans.map((scan) => scan.id))
    return {
      scans,
      files: new Map(files.filter((file) => file !== undefined).map((file) => [file.id, file])),
    }
  }, [db, tuneId])
}

const NO_TUNES: ReadonlySet<string> = new Set()

/** The ids of every tune with a live scan, read once for a whole screen of tune rows. */
export function useScanTuneIds(): ReadonlySet<string> {
  const db = useDb()
  return (
    useLiveQuery(async () => {
      const rows = await db.scans.filter((row) => !row.deleted_at).toArray()
      return new Set(rows.map((row) => row.tune_id))
    }, [db]) ?? NO_TUNES
  )
}
