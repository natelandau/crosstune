import { useEffect, useRef, useState } from 'react'
import { isPrecise } from '../domain/placeDistances'
import type { MapKit, MapKitMap } from '../platform/mapkit'
import { useMapKit } from '../platform/useMapKit'
import { PALETTE, type Scheme } from '../theme/tokens'
import { useScheme } from '../theme/useScheme'

/** The least ground the map spans, so a pin shows the streets around it. */
const MINIMUM_SPAN_M = 400
const M_PER_DEGREE_LATITUDE = 111_320

function drawMap(
  mapkit: MapKit,
  element: HTMLElement,
  lat: number,
  lon: number,
  accuracyM: number | null,
  scheme: Scheme,
) {
  const map = new mapkit.Map(element, {
    isScrollEnabled: false,
    isZoomEnabled: false,
    isRotationEnabled: false,
    showsMapTypeControl: false,
    showsZoomControl: false,
    showsCompass: 'hidden',
    showsScale: 'hidden',
    colorScheme: scheme,
  })
  try {
    populate(mapkit, map, lat, lon, accuracyM, scheme)
  } catch (error) {
    map.destroy()
    throw error
  }
  return map
}

function populate(
  mapkit: MapKit,
  map: MapKitMap,
  lat: number,
  lon: number,
  accuracyM: number | null,
  scheme: Scheme,
) {
  const center = new mapkit.Coordinate(lat, lon)
  const spanM = Math.max(MINIMUM_SPAN_M, (accuracyM ?? 0) * 3)
  const latitudeDelta = spanM / M_PER_DEGREE_LATITUDE
  // A degree of longitude shrinks toward the poles.
  const longitudeDelta = latitudeDelta / Math.max(Math.cos((lat * Math.PI) / 180), 0.01)
  map.region = new mapkit.CoordinateRegion(
    center,
    new mapkit.CoordinateSpan(latitudeDelta, longitudeDelta),
  )
  if (isPrecise(accuracyM)) {
    map.addAnnotation(new mapkit.MarkerAnnotation(center))
  } else if (accuracyM !== null) {
    const color = PALETTE[scheme].brand
    map.addOverlay(
      new mapkit.CircleOverlay(center, accuracyM, {
        style: new mapkit.Style({
          fillColor: color,
          fillOpacity: 0.2,
          strokeColor: color,
          lineWidth: 1,
        }),
      }),
    )
  }
}

/**
 * A small still map of a spot: a pin for a precise point, or a circle as wide as the fix's
 * accuracy for a loose one. Draws nothing until MapKit JS has loaded, and nothing at all when
 * it cannot load or draw. Apple's terms want an Apple map wherever an Apple address or venue
 * shows, so a page with a point shows one when it can.
 */
export function LocationMap({
  lat,
  lon,
  accuracyM,
}: {
  lat: number
  lon: number
  accuracyM: number | null
}) {
  const mapkit = useMapKit()
  const scheme = useScheme()
  const element = useRef<HTMLDivElement>(null)
  const [failedFor, setFailedFor] = useState<string | null>(null)
  const key = `${lat},${lon},${accuracyM},${scheme}`

  useEffect(() => {
    if (!mapkit || !element.current) return
    try {
      const map = drawMap(mapkit, element.current, lat, lon, accuracyM, scheme)
      return () => {
        try {
          map.destroy()
        } catch {
          // A map that cannot be torn down has nothing left to lose.
        }
      }
    } catch {
      // Deferred so the effect makes no synchronous state write.
      queueMicrotask(() => setFailedFor(key))
    }
  }, [mapkit, lat, lon, accuracyM, scheme, key])

  if (!mapkit || failedFor === key) return null
  return (
    <div
      ref={element}
      aria-hidden
      className="ph-no-capture h-[180px] w-full overflow-hidden rounded-lg"
    />
  )
}
