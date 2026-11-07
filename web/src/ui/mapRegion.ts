import type { MapKit } from '../platform/mapkit'
import type { Scheme } from '../theme/tokens'

/** The least ground a map of a spot spans, so a pin shows the streets around it. */
export const MINIMUM_SPAN_M = 400
const M_PER_DEGREE_LATITUDE = 111_320

/** A region centered on a point, `spanM` meters tall. */
export function regionAround(mapkit: MapKit, lat: number, lon: number, spanM = MINIMUM_SPAN_M) {
  const latitudeDelta = spanM / M_PER_DEGREE_LATITUDE
  // A degree of longitude shrinks toward the poles.
  const longitudeDelta = latitudeDelta / Math.max(Math.cos((lat * Math.PI) / 180), 0.01)
  return new mapkit.CoordinateRegion(
    new mapkit.Coordinate(lat, lon),
    new mapkit.CoordinateSpan(latitudeDelta, longitudeDelta),
  )
}

/** What every map in the app starts with: north up, no map type, compass, or scale, in `scheme`. */
export const mapOptions = (scheme: Scheme) => ({
  isRotationEnabled: false,
  showsMapTypeControl: false,
  showsCompass: 'hidden',
  showsScale: 'hidden',
  colorScheme: scheme,
})
