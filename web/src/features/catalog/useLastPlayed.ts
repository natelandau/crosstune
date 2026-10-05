import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect } from 'react'
import { useDb } from '../../db/DbProvider'
import { useSyncEngine } from '../../sync/SyncProvider'
import { lastPlayedByTune } from './catalogSort'

const NONE: ReadonlyMap<string, number> = new Map()

/**
 * Each tune's latest play or practice session while `enabled`, live. Enabling it starts the
 * events pull, since history reaches a device only on request; the order redraws as pages land.
 */
export function useLastPlayed(enabled: boolean): ReadonlyMap<string, number> {
  const db = useDb()
  const engine = useSyncEngine()
  const lastPlayed = useLiveQuery(
    async () =>
      enabled
        ? lastPlayedByTune(await db.play_events.toArray(), await db.practice_sessions.toArray())
        : NONE,
    [db, enabled],
  )

  useEffect(() => {
    if (!enabled) return
    // A failed pull leaves the history already stored in force; the next pick tries again.
    engine.pullEvents().catch((caught: unknown) => {
      console.warn('catalog: could not pull history', caught)
    })
  }, [engine, enabled])

  return lastPlayed ?? NONE
}
