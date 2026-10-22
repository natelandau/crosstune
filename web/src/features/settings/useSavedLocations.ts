import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useRef, useState } from 'react'
import { deleteSavedPlace, renameSavedPlace, savedPlaceName } from '../../commands/places'
import { useDb } from '../../db/DbProvider'
import type { CrosstuneDb } from '../../db/schema'
import type { LocalPlace } from '../../db/types'
import { compareNames } from '../../text/collate'
import { messageFor } from '../../ui/useAction'
import { useAnalytics } from '../../usage/AnalyticsProvider'

/** A saved location and the live recordings linked to it. */
export interface SavedLocationRow {
  place: LocalPlace
  recordings: number
}

/** The live saved locations by name, each with how many live recordings use it. */
export async function readSavedLocations(db: CrosstuneDb): Promise<SavedLocationRow[]> {
  const places = (await db.places.toArray()).filter((place) => !place.deleted_at)
  const counts = new Map<string, number>()
  for (const recording of await db.recordings.toArray()) {
    if (recording.deleted_at || !recording.place_id) continue
    counts.set(recording.place_id, (counts.get(recording.place_id) ?? 0) + 1)
  }
  return places
    .sort((a, b) => compareNames(a.name, b.name))
    .map((place) => ({ place, recordings: counts.get(place.id) ?? 0 }))
}

export interface SavedLocations {
  /** Undefined until the first read. */
  rows: SavedLocationRow[] | undefined
  /** Why the last rename or delete failed, cleared by the next one. */
  failure: string | null
  clearFailure: () => void
  /**
   * Saves `name` as the location's name. A name that trims and cuts to what is stored writes
   * and reports nothing, so one committed twice in a row is saved once; calls run one at a
   * time. Resolves whether the stored name now matches.
   */
  rename: (id: string, name: string) => Promise<boolean>
  /** Resolves whether the location was deleted. */
  remove: (id: string) => Promise<boolean>
}

/**
 * The saved locations and the two things Settings does with one: rename and delete. Neither
 * event carries any part of the location.
 */
export function useSavedLocations(): SavedLocations {
  const db = useDb()
  const analytics = useAnalytics()
  const rows = useLiveQuery(() => readSavedLocations(db), [db])
  const [failure, setFailure] = useState<string | null>(null)
  const last = useRef<Promise<boolean>>(Promise.resolve(true))

  const save = useCallback(
    async (id: string, name: string) => {
      try {
        const stored = await db.places.get(id)
        if (stored && !stored.deleted_at && stored.name === savedPlaceName(name)) return true
        await renameSavedPlace(db, id, name)
      } catch (error) {
        setFailure(messageFor(error))
        return false
      }
      analytics.send('saved_location_renamed', {})
      return true
    },
    [db, analytics],
  )

  const rename = useCallback(
    (id: string, name: string) => {
      setFailure(null)
      const run = last.current.then(() => save(id, name))
      last.current = run
      return run
    },
    [save],
  )

  const remove = useCallback(
    async (id: string) => {
      setFailure(null)
      try {
        await deleteSavedPlace(db, id)
      } catch (error) {
        setFailure(messageFor(error))
        return false
      }
      analytics.send('saved_location_deleted', {})
      return true
    },
    [db, analytics],
  )

  const clearFailure = useCallback(() => setFailure(null), [])
  return { rows, failure, clearFailure, rename, remove }
}
