import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useLayoutEffect } from 'react'
import { useDb } from '../../db/DbProvider'
import { useLatest } from '../../ui/useLatest'
import {
  DEFAULT_ISOLATE,
  isMonoFromRow,
  isolateFromRow,
  type IsolateSetting,
} from '../player/isolate/isolateSetting'
import { usePlaybackEngine } from '../player/PlaybackEngineProvider'
import { usePracticeOverlay } from './usePracticeOverlay'

export interface TrimHoldSettings {
  speed: number
  pitch: number
  isolate: IsolateSetting
  isMono: boolean
}

/**
 * While `trimming`, plays recording `id` at 100%, with no pitch shift and no isolate setting, so
 * what is heard is exactly what is cut, and holds those settings ahead of the row so nothing
 * reapplies the row's own. Leaving the trim view, or practice as a whole from inside it, gives
 * back the row's speed, pitch, and isolate setting: `settings` from a caller already reading the
 * row, else the hook's own read.
 */
export function useTrimHold(id: string, trimming: boolean, settings?: TrimHoldSettings): void {
  const practiceOverlay = usePracticeOverlay()
  const engine = usePlaybackEngine()
  const db = useDb()
  const given = settings !== undefined
  // Undefined while the read is pending, null once the row is gone or `settings` replaces it.
  const row = useLiveQuery(
    async () => (given ? null : ((await db.recordings.get(id)) ?? null)),
    [db, id, given],
  )
  const current =
    settings ??
    (row
      ? {
          speed: row.speed_percent,
          pitch: row.pitch_cents,
          isolate: isolateFromRow(row),
          isMono: isMonoFromRow(row),
        }
      : null)

  useLayoutEffect(() => {
    if (!trimming) return
    practiceOverlay.hold(id, {
      speedPercent: 100,
      pitchCents: 0,
      isolate: DEFAULT_ISOLATE,
      trimming: true,
    })
    return () => practiceOverlay.hold(id, null)
  }, [practiceOverlay, id, trimming])

  const settingsRef = useLatest(current)
  // Waits for the row, so there are settings to give back when trimming ends.
  const forcing = trimming && (given || row !== undefined)
  useEffect(() => {
    if (!forcing) return
    engine.setSpeed(100)
    engine.setPitch(0)
    // The real mono flag keeps the engine's flag in step with the row for the restore.
    engine.setIsolate(DEFAULT_ISOLATE, settingsRef.current?.isMono ?? false)
    return () => {
      // The settings as they are when trimming ends, not as they were when it began.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const restore = settingsRef.current
      if (!restore) return
      engine.setSpeed(restore.speed)
      engine.setPitch(restore.pitch)
      engine.setIsolate(restore.isolate, restore.isMono)
    }
  }, [forcing, engine, settingsRef])
}
