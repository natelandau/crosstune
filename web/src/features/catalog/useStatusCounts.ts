import type { TuneStatus } from '../../api/vocabulary'
import { createSharedLiveQuery } from '../../db/sharedLiveQuery'
import { effectiveStatus, hideArchived, pairTunes } from './filters'

export interface LiveTuneCounts {
  /** Non-archived tunes per status, counted as the catalog filter reads each status. */
  byStatus: Record<TuneStatus, number>
  /** Every non-archived tune, whatever its status. */
  total: number
  /** The user tune ids those counts cover. */
  userTuneIds: string[]
}

/**
 * Absolute counts for navigation, whatever the catalog's filters. Undefined until read. The
 * sidebar and the catalog show them at once, so they share one query.
 */
export const useStatusCounts = createSharedLiveQuery(async (db): Promise<LiveTuneCounts> => {
  const [tunes, userTunes] = await Promise.all([db.tunes.toArray(), db.user_tunes.toArray()])
  const entries = hideArchived(pairTunes(tunes, userTunes), false)
  const byStatus: Record<TuneStatus, number> = { known: 0, learning: 0, want_to_learn: 0 }
  for (const { userTune } of entries) byStatus[effectiveStatus(userTune)]++
  return {
    byStatus,
    total: entries.length,
    userTuneIds: entries.map(({ userTune }) => userTune.id),
  }
})
