import { useLiveQuery } from 'dexie-react-hooks'
import type { TuneStatus } from '../../api/vocabulary'
import { useDb } from '../../db/DbProvider'
import { effectiveStatus, hideArchived, pairTunes } from './filters'

export interface LiveTuneCounts {
  /** Non-archived tunes per status, counted as the catalog filter reads each status. */
  byStatus: Record<TuneStatus, number>
  /** Every non-archived tune, whatever its status. */
  total: number
  /** The user tune ids those counts cover. */
  userTuneIds: string[]
}

/** Absolute counts for navigation, whatever the catalog's filters. Undefined until read. */
export function useStatusCounts(): LiveTuneCounts | undefined {
  const db = useDb()
  return useLiveQuery(async () => {
    const entries = hideArchived(
      pairTunes(await db.tunes.toArray(), await db.user_tunes.toArray()),
      false,
    )
    const byStatus: Record<TuneStatus, number> = { known: 0, learning: 0, want_to_learn: 0 }
    for (const { userTune } of entries) byStatus[effectiveStatus(userTune)]++
    return {
      byStatus,
      total: entries.length,
      userTuneIds: entries.map(({ userTune }) => userTune.id),
    }
  }, [db])
}
