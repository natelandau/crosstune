import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useLayoutEffect } from 'react'
import { useDb } from '../../db/DbProvider'
import { useLatest } from '../../ui/useLatest'
import { usePlaybackEngine } from '../player/PlaybackEngineProvider'
import { usePracticeOverlay } from './usePracticeOverlay'

export interface TrimHoldSettings {
  speed: number
  pitch: number
}

/**
 * While `trimming`, plays recording `id` at 100% and no pitch shift, so what is heard is
 * exactly what is cut, and holds those settings ahead of the row so nothing reapplies the row's
 * own. Leaving the trim view, or practice as a whole from inside it, gives back the row's speed
 * and pitch: `settings` from a caller already reading the row, else the hook's own read.
 */
export function useTrimHold(id: string, trimming: boolean, settings?: TrimHoldSettings): void {
  const practiceOverlay = usePracticeOverlay()
  const engine = usePlaybackEngine()
  const db = useDb()
  const given = settings !== undefined
  // Undefined while the read is pending, null once the row is gone or `settings` stands in.
  const row = useLiveQuery(
    async () => (given ? null : ((await db.recordings.get(id)) ?? null)),
    [db, id, given],
  )
  const current = settings ?? (row ? { speed: row.speed_percent, pitch: row.pitch_cents } : null)

  useLayoutEffect(() => {
    if (!trimming) return
    practiceOverlay.hold(id, { speedPercent: 100, pitchCents: 0, trimming: true })
    return () => practiceOverlay.hold(id, null)
  }, [practiceOverlay, id, trimming])

  const settingsRef = useLatest(current)
  // Waits for the row, so there are settings to give back when trimming ends.
  const forcing = trimming && (given || row !== undefined)
  useEffect(() => {
    if (!forcing) return
    engine.setSpeed(100)
    engine.setPitch(0)
    return () => {
      // The settings as they stand when trimming ends, not as they were when it began.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const restore = settingsRef.current
      if (!restore) return
      engine.setSpeed(restore.speed)
      engine.setPitch(restore.pitch)
    }
  }, [forcing, engine, settingsRef])
}
