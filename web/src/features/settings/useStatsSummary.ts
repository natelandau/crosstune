import { useState } from 'react'
import type { TuneStatus } from '../../api/vocabulary'
import { useDb } from '../../db/DbProvider'
import { SUMMARY_SEPARATOR, summaryParts } from '../stats/copy'
import { useStats } from '../stats/useStats'

export interface StatsSummary {
  /** The catalog in one line. */
  line: string
  /** The line's parts, which `SUMMARY_SEPARATOR` joins into it. */
  parts: string[]
  /** Live, non-archived tunes at each status. */
  byStatus: Record<TuneStatus, number>
}

/**
 * The catalog in one line, or null until the rows are read. It reads no history, so showing
 * it never starts the events pull.
 */
export function useStatsSummary(): StatsSummary | null {
  const db = useDb()
  const [now] = useState(() => new Date())
  const view = useStats(db, now, { history: false })
  if (!view) return null
  const { counts, recorded } = view.stats
  const parts = summaryParts({
    tunes: counts.tunes,
    lists: counts.lists,
    recordings: counts.recordings,
    scans: counts.scans,
    ms: recorded.total_ms,
  })
  return {
    line: parts.join(SUMMARY_SEPARATOR),
    parts,
    byStatus: {
      known: counts.known,
      learning: counts.learning,
      want_to_learn: counts.want_to_learn,
    },
  }
}
