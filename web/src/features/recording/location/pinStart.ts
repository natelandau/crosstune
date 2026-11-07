import type { PlaceHint } from '../../../api/types'
import { pointOf, type Placed } from './searchHint'

/**
 * Where the pin drop's map opens: the recording's point, else its saved location's, else the
 * device's, else the area of the typed search, else the latest recording with a place, else the
 * account country's center. Null opens on the whole world.
 */
export function pinStart({
  stored,
  device,
  searchArea,
  latestPlaced,
  countryCenter,
}: {
  /** The recording's point as stored, else its saved location's, null for neither. */
  stored: PlaceHint | null
  /** The device's point, only while location access is on. */
  device: PlaceHint | null
  /** Where the typed search's results are, null with no results. */
  searchArea: PlaceHint | null
  latestPlaced: Placed | null
  /** A point inside the account's country, null while it is unknown. */
  countryCenter: PlaceHint | null
}): PlaceHint | null {
  return stored ?? device ?? searchArea ?? pointOf(latestPlaced) ?? countryCenter
}
