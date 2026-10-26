/** The loosest fix that counts as a precise point: a pin, not a circle. */
export const STREET_MAX_ACCURACY_M = 50
/** How far from a recording the location page looks for places near it. */
export const NEARBY_RADIUS_M = 150
/** The most places the location page lists as near a recording. */
export const NEARBY_LIMIT = 10
/** How close a saved location sits to a point to count as the same spot. */
export const MATCH_RADIUS_M = 30

const EARTH_RADIUS_M = 6_371_008.8

/** Whether a fix is precise enough for a pin. A point with no accuracy, as a file's, is. */
export function isPrecise(accuracyM: number | null): boolean {
  return accuracyM === null || accuracyM <= STREET_MAX_ACCURACY_M
}

/** Great-circle distance in meters. The haversine form holds across the antimeridian. */
export function distanceM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const rad = Math.PI / 180
  const dLat = (bLat - aLat) * rad
  const dLon = (bLon - aLon) * rad
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}
