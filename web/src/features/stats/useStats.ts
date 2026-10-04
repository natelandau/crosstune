import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { INSTRUMENTS } from '../../api/vocabulary'
import { useAuthSession } from '../../auth/AuthContext'
import { settingsId } from '../../commands/settings'
import type { CrosstuneDb } from '../../db/schema'
import { storedInstruments } from '../../db/types'
import { useSyncEngine } from '../../sync/SyncProvider'
import { localDate } from './calendar'
import { computeStats } from './computeStats'
import type { Stats } from './types'

export interface StatsView {
  stats: Stats
  /** The local date the stats were computed for, `YYYY-MM-DD`. */
  today: string
  /** Every tune's title, deleted ones included, for the lines that name a tune. */
  tuneTitles: ReadonlyMap<string, string>
  /** What a recording line calls a recording: its tune's title, else its label, else null. */
  recordingTitles: ReadonlyMap<string, string | null>
}

/**
 * The stats for the rows on the device, live, or undefined until they have been read.
 * `computeStats` runs again only when a read store changes. With `history`, the event stores
 * are read too and the events pull starts once on mount; the page draws from what is stored
 * and redraws as pages land. Without it, as for a summary, the event stores are left alone.
 */
export function useStats(
  db: CrosstuneDb,
  now: Date,
  { history = true }: { history?: boolean } = {},
): StatsView | undefined {
  const { userId } = useAuthSession()
  const engine = useSyncEngine()
  // The day the page opened on: a page left open past midnight keeps its date until reopened.
  const [{ today, timeZone }] = useState(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    return { today: localDate(now.toISOString(), zone), timeZone: zone }
  })

  const rows = useLiveQuery(async () => {
    const [tunes, userTunes, recordings, links, lists, scans, settings] = await Promise.all([
      db.tunes.toArray(),
      db.user_tunes.toArray(),
      db.recordings.toArray(),
      db.recording_links.toArray(),
      db.lists.toArray(),
      db.scans.toArray(),
      db.user_settings.get(settingsId(userId)),
    ])
    const [plays, sessions, views, changes] = history
      ? await Promise.all([
          db.play_events.toArray(),
          db.practice_sessions.toArray(),
          db.scan_views.toArray(),
          db.status_changes.toArray(),
        ])
      : [[], [], [], []]
    return {
      tunes,
      userTunes,
      recordings,
      links,
      lists,
      scans,
      settings,
      plays,
      sessions,
      views,
      changes,
    }
  }, [db, userId, history])

  useEffect(() => {
    if (!history) return
    // A failed pull leaves the history already stored on screen; the next visit tries again.
    engine.pullEvents().catch((caught: unknown) => {
      console.warn('stats: could not pull history', caught)
    })
  }, [engine, history])

  return useMemo(() => {
    if (!rows) return undefined
    const played = new Set(storedInstruments(rows.settings) ?? [])
    const stats = computeStats({
      today,
      time_zone: timeZone,
      instruments: INSTRUMENTS.filter((instrument) => played.has(instrument)),
      tunes: rows.tunes,
      user_tunes: rows.userTunes,
      // A recording's stats date is when it was added, the one date every recording has.
      recordings: rows.recordings.map((recording) => ({
        ...recording,
        recorded_at: recording.added_at,
      })),
      recording_links: rows.links,
      lists: rows.lists,
      scans: rows.scans,
      scan_views: rows.views,
      play_events: rows.plays,
      practice_sessions: rows.sessions,
      status_changes: rows.changes,
    })
    const tuneTitles = new Map(rows.tunes.map((tune) => [tune.id, tune.title]))
    const recordingTitles = new Map(
      rows.recordings.map((recording) => [
        recording.id,
        (recording.tune_id ? tuneTitles.get(recording.tune_id) : undefined) ??
          recording.label ??
          null,
      ]),
    )
    return { stats, today, tuneTitles, recordingTitles }
  }, [rows, today, timeZone])
}
