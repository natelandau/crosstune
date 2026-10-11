import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { scanOpens } from '../../billing/plan'
import { usePlanOrUnknown } from '../../billing/usePlan'
import { createSharedLiveQuery } from '../../db/sharedLiveQuery'
import { useDb } from '../../db/DbProvider'
import { readScanTune, sortScans, type ScanFile } from '../../db/scans'
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

interface ScanTunes {
  /** Every tune with a live scan. */
  withScans: ReadonlySet<string>
  /** The one tune a free plan's scans open on; see `readScanTune`. */
  scanTune: string | null
}

const useScanTunes = createSharedLiveQuery(async (db): Promise<ScanTunes> => {
  const rows = await db.scans.filter((row) => !row.deleted_at).toArray()
  return {
    withScans: new Set(rows.map((row) => row.tune_id)),
    scanTune: await readScanTune(db, rows),
  }
})

const NO_TUNES: ReadonlySet<string> = new Set()

/** The tune a free plan's scans open on, or null while there is none or before it is read, which
 * opens every tune's scans as unknown does. */
export function useScanTune(): string | null {
  return useScanTunes()?.scanTune ?? null
}

/** Whether the plan opens the tune's scans. A failed entitlements read counts as unknown, which
 * opens every scan, so it never takes a screen of tunes down; the server still enforces. */
export function useScansOpen(tuneId: string): boolean {
  return scanOpens(usePlanOrUnknown(), tuneId, useScanTune())
}

/** The ids of every tune with a live scan the plan opens, read once for a whole screen of tune
 * rows. */
export function useViewableScanTunes(): ReadonlySet<string> {
  const plan = usePlanOrUnknown()
  const tunes = useScanTunes()
  return useMemo(() => {
    if (!tunes) return NO_TUNES
    const { withScans, scanTune } = tunes
    return new Set([...withScans].filter((tuneId) => scanOpens(plan, tuneId, scanTune)))
  }, [plan, tunes])
}
