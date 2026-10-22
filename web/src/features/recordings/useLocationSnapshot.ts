import { useEffect, useState } from 'react'
import { clamp } from '../../math'
import { useSyncEngine } from '../../sync/SyncProvider'
import type { Scheme } from '../../theme/tokens'

/** The sides the server accepts for a snapshot. */
const MIN_SIDE = 50
const MAX_SIDE = 640

/**
 * A signed map image of a point, with a circle as wide as the accuracy when the fix is loose.
 * Null while the URL is fetched, with no point, and when the server cannot make one.
 */
export function useLocationSnapshot(
  at: { lat: number; lon: number } | null,
  accuracyM: number | null,
  size: { width: number; height: number },
  scheme: Scheme,
): string | null {
  const engine = useSyncEngine()
  const [snapshot, setSnapshot] = useState<{ key: string; url: string } | null>(null)
  const lat = at?.lat
  const lon = at?.lon
  const width = Math.round(clamp(size.width, MIN_SIDE, MAX_SIDE))
  const height = Math.round(clamp(size.height, MIN_SIDE, MAX_SIDE))
  const key = lat === undefined ? null : `${lat},${lon},${accuracyM},${width},${height},${scheme}`

  useEffect(() => {
    if (lat === undefined || lon === undefined || key === null) return
    let current = true
    void engine
      .placeSnapshot({ lat, lon, accuracy_m: accuracyM, width, height, scheme })
      .then((url) => current && url !== null && setSnapshot({ key, url }))
    return () => {
      current = false
    }
  }, [engine, key, lat, lon, accuracyM, width, height, scheme])

  return key !== null && snapshot?.key === key ? snapshot.url : null
}
