import type { PlaceHint } from '../../../api/types'
import type { LocalRecording } from '../../../db/types'

export type Placed = Pick<LocalRecording, 'place_lat' | 'place_lon'>

/** A recording's point, null when it has none. */
export const pointOf = (r: Placed | null): PlaceHint | null =>
  r && r.place_lat != null && r.place_lon != null ? { lat: r.place_lat, lon: r.place_lon } : null

/**
 * Where a place search ranks results near: the recording's point, else its saved location's,
 * else the device's, else the latest recording with a place. Null leaves the ranking to the
 * account's country. A hint only ranks, so a place far from it is still found.
 */
export function searchHint({
  stored,
  device,
  latestPlaced,
}: {
  /** The recording's point as stored, else its saved location's, null for neither. */
  stored: PlaceHint | null
  /** The device's point, only while location access is on. */
  device: PlaceHint | null
  latestPlaced: Placed | null
}): PlaceHint | null {
  return stored ?? device ?? pointOf(latestPlaced)
}

/** The most recently added live recording that has a point, or null. */
export function latestPlaced(recordings: readonly LocalRecording[]): LocalRecording | null {
  let latest: LocalRecording | null = null
  for (const r of recordings) {
    if (r.deleted_at || !pointOf(r)) continue
    if (!latest || r.added_at > latest.added_at) latest = r
  }
  return latest
}
