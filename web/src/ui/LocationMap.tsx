import { useEffect, useRef, useState } from 'react'
import { isPrecise } from '../domain/placeDistances'
import type { MapKit, MapKitMap } from '../platform/mapkit'
import { useMapKitState } from '../platform/useMapKit'
import { useOnline } from '../sync/SyncProvider'
import { PALETTE, type Scheme } from '../theme/tokens'
import { useScheme } from '../theme/useScheme'
import { mapOptions, MINIMUM_SPAN_M, regionAround } from './mapRegion'
import { useLatest } from './useLatest'

/** Centers `map` on the spot and marks it, returning a call that takes the mark away. */
function markSpot(
  mapkit: MapKit,
  map: MapKitMap,
  lat: number,
  lon: number,
  accuracyM: number | null,
  scheme: Scheme,
): () => void {
  const center = new mapkit.Coordinate(lat, lon)
  map.region = regionAround(mapkit, lat, lon, Math.max(MINIMUM_SPAN_M, (accuracyM ?? 0) * 3))
  if (isPrecise(accuracyM)) {
    const pin = map.addAnnotation(new mapkit.MarkerAnnotation(center))
    return () => map.removeAnnotation(pin)
  }
  if (accuracyM === null) return () => {}
  const color = PALETTE[scheme].brand
  const circle = map.addOverlay(
    new mapkit.CircleOverlay(center, accuracyM, {
      style: new mapkit.Style({
        fillColor: color,
        fillOpacity: 0.2,
        strokeColor: color,
        lineWidth: 1,
      }),
    }),
  )
  return () => map.removeOverlay(circle)
}

export const MAP_UNAVAILABLE = 'The map is unavailable right now.'
export const MAP_NEEDS_CONNECTION = 'The map needs a connection.'

/**
 * What a map's space says when there is no map: it needs a connection offline, and is
 * unavailable when MapKit cannot load or draw. Null while MapKit loads, or when the map shows.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useMapMessage(
  status: 'loading' | 'ready' | 'unavailable',
  failed = false,
): string | null {
  const online = useOnline()
  if (!online) return MAP_NEEDS_CONNECTION
  return status === 'unavailable' || (status === 'ready' && failed) ? MAP_UNAVAILABLE : null
}

/** The message in the muted style of an empty state, filling the map's own space. */
export function MapMessage({ message, height }: { message: string; height: string | number }) {
  return (
    <div
      role="status"
      className="t-secondary text-secondary flex w-full items-center justify-center rounded-lg px-6 text-center"
      style={{ height }}
    >
      {message}
    </div>
  )
}

/**
 * A small still map of a spot: a pin for a precise point, or a circle as wide as the fix's
 * accuracy for a loose one. Draws nothing while MapKit JS loads, and says why when
 * it cannot load or draw. Apple's terms want an Apple map wherever an Apple address or venue
 * shows, so a page with a point shows one when it can.
 */
export function LocationMap({
  lat,
  lon,
  accuracyM,
  height = 180,
}: {
  lat: number
  lon: number
  accuracyM: number | null
  /** In CSS pixels. */
  height?: number
}) {
  const { mapkit, status } = useMapKitState()
  const scheme = useScheme()
  const element = useRef<HTMLDivElement>(null)
  const map = useRef<MapKitMap | null>(null)
  const [failedFor, setFailedFor] = useState<string | null>(null)
  const key = `${lat},${lon},${accuracyM},${scheme}`
  const failed = failedFor === key
  const keyRef = useLatest(key)

  // One map per scheme; a new spot moves it and its mark rather than drawing a new one.
  useEffect(() => {
    if (!mapkit || !element.current || failed) return
    let made: MapKitMap
    try {
      made = new mapkit.Map(element.current, {
        ...mapOptions(scheme),
        isScrollEnabled: false,
        isZoomEnabled: false,
        showsZoomControl: false,
      })
    } catch {
      // Deferred so the effect makes no synchronous state write.
      queueMicrotask(() => setFailedFor(keyRef.current))
      return
    }
    map.current = made
    return () => {
      map.current = null
      try {
        made.destroy()
      } catch {
        // A map that cannot be torn down has nothing left to lose.
      }
    }
  }, [mapkit, scheme, failed, keyRef])

  useEffect(() => {
    const shown = map.current
    if (!mapkit || !shown) return
    try {
      const unmark = markSpot(mapkit, shown, lat, lon, accuracyM, scheme)
      return () => {
        try {
          unmark()
        } catch {
          // A map that cannot be cleared has nothing left to lose.
        }
      }
    } catch {
      queueMicrotask(() => setFailedFor(key))
    }
  }, [mapkit, scheme, failed, lat, lon, accuracyM, key])

  const message = useMapMessage(status, failed)
  if (message) return <MapMessage message={message} height={height} />
  if (!mapkit || failed) return null
  return (
    <div
      ref={element}
      aria-hidden
      className="ph-no-capture w-full overflow-hidden rounded-lg"
      style={{ height }}
    />
  )
}
