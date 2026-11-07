import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useRef, useState } from 'react'
import { deleteSavedPlace, renameSavedPlace, savedPlaceName } from '../../commands/places'
import { useDb } from '../../db/DbProvider'
import type { CrosstuneDb } from '../../db/schema'
import type { LocalPlace } from '../../db/types'
import { messageFor } from '../../ui/useAction'
import { useAnalytics } from '../../usage/AnalyticsProvider'
import type { AnalyticsClient } from '../../usage/client'
import { livePlacesByName } from '../recordings/place'

/** A saved location and the live recordings linked to it. */
export interface SavedLocationRow {
  place: LocalPlace
  recordings: number
}

/** The live saved locations by name, each with how many live recordings use it. */
export async function readSavedLocations(db: CrosstuneDb): Promise<SavedLocationRow[]> {
  const places = livePlacesByName(await db.places.toArray())
  const counts = new Map<string, number>()
  for (const recording of await db.recordings.toArray()) {
    if (recording.deleted_at || !recording.place_id) continue
    counts.set(recording.place_id, (counts.get(recording.place_id) ?? 0) + 1)
  }
  return places.map((place) => ({ place, recordings: counts.get(place.id) ?? 0 }))
}

/** Renames a saved location, unless it has that name already; throws why it could not. */
async function renameSavedLocation(
  db: CrosstuneDb,
  analytics: AnalyticsClient,
  id: string,
  name: string,
): Promise<void> {
  const stored = await db.places.get(id)
  if (stored && !stored.deleted_at && stored.name === savedPlaceName(name)) return
  await renameSavedPlace(db, id, name)
  analytics.send('saved_location_renamed', {})
}

export interface SavedLocationActions {
  /** Why the last rename or delete failed, cleared by the next one. */
  failure: string | null
  clearFailure: () => void
  /**
   * Saves `name` as the location's name. A name that trims and cuts to what is stored writes
   * and reports nothing, so one committed twice in a row is saved once; calls run one at a
   * time. Resolves whether the stored name now matches.
   */
  rename: (id: string, name: string) => Promise<boolean>
  /**
   * Renames as `rename` does, after any rename still running, but throws why it could not
   * rather than holding it in `failure`.
   */
  commitRename: (id: string, name: string) => Promise<void>
  /** Resolves whether the location was deleted. */
  remove: (id: string) => Promise<boolean>
}

export interface SavedLocations extends SavedLocationActions {
  /** Undefined until the first read. */
  rows: SavedLocationRow[] | undefined
}

/** The saved locations and the two things Settings does with one: rename and delete. */
export function useSavedLocations(): SavedLocations {
  const db = useDb()
  const rows = useLiveQuery(() => readSavedLocations(db), [db])
  return { rows, ...useSavedLocationActions() }
}

/**
 * Renames and deletes a saved location, without reading the list. Neither event carries any
 * part of the location.
 */
export function useSavedLocationActions(): SavedLocationActions {
  const db = useDb()
  const analytics = useAnalytics()
  const [failure, setFailure] = useState<string | null>(null)
  // Every rename waits for the one before it, so the unchanged check reads the name it wrote.
  const last = useRef<Promise<unknown>>(Promise.resolve())

  const commitRename = useCallback(
    (id: string, name: string) => {
      const run = last.current.then(() => renameSavedLocation(db, analytics, id, name))
      last.current = run.catch(() => undefined)
      return run
    },
    [db, analytics],
  )

  const rename = useCallback(
    async (id: string, name: string) => {
      setFailure(null)
      try {
        await commitRename(id, name)
      } catch (error) {
        setFailure(messageFor(error))
        return false
      }
      return true
    },
    [commitRename],
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
  return { failure, clearFailure, rename, commitRename, remove }
}
