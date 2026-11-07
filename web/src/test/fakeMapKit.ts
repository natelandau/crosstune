import type { MapKit, MapKitEvent, MapKitPlace } from '../platform/mapkit'

export interface FakeMapKitOptions {
  /** What a points-of-interest search resolves with. */
  places?: MapKitPlace[]
  /** Makes the search reject. */
  searchFails?: boolean
  /** Makes the map constructor throw. */
  mapFails?: boolean
  /** Makes adding the pin or circle throw, after the map exists. */
  decorationFails?: boolean
  /** Makes MapKit answer `init` with this error status instead of configuring itself. */
  initError?: string
  /** Held at the start of each search until it resolves. */
  holdSearch?: () => Promise<void>
}

interface Recorded {
  maps: {
    element: HTMLElement
    options: Record<string, unknown>
    region: { center: { latitude: number; longitude: number }; span?: unknown } | null
    destroyed: boolean
  }[]
  annotations: unknown[]
  overlays: { center: unknown; radius: number }[]
  searches: { center: unknown; radius: number; filter: unknown }[]
  inits: number
}

/** A fake for the MapKit JS global that records what the code under test does with it. */
export function fakeMapKit(options: FakeMapKitOptions = {}): {
  mapkit: MapKit
  seen: Recorded
  /** Fires a MapKit event, as MapKit does for a configuration or an error. */
  dispatch: (type: string, event?: MapKitEvent) => void
  /** How many listeners an event type has now. */
  listenerCount: (type: string) => number
  /**
   * Moves the newest map's center as a drag does, firing the events MapKit fires. `settle: false`
   * stops before the region finishes changing.
   */
  moveMap: (lat: number, lon: number, options?: { settle?: boolean }) => void
} {
  const listeners = new Map<string, Set<(event: MapKitEvent) => void>>()
  const dispatch = (type: string, event: MapKitEvent = {}) =>
    [...(listeners.get(type) ?? [])].forEach((listener) => listener(event))
  const fails = options
  const seen: Recorded = { maps: [], annotations: [], overlays: [], searches: [], inits: 0 }
  const mapkit = {
    addEventListener: (type: string, listener: (event: MapKitEvent) => void) => {
      listeners.set(type, (listeners.get(type) ?? new Set()).add(listener))
    },
    removeEventListener: (type: string, listener: (event: MapKitEvent) => void) => {
      listeners.get(type)?.delete(listener)
    },
    init: () => {
      seen.inits += 1
      // MapKit answers a configuration after `init` returns.
      queueMicrotask(() =>
        options.initError
          ? dispatch('error', { status: options.initError })
          : dispatch('configuration-change', { status: 'Initialized' }),
      )
    },
    Coordinate: class {
      constructor(
        readonly latitude: number,
        readonly longitude: number,
      ) {}
    },
    CoordinateSpan: class {
      constructor(
        readonly latitudeDelta: number,
        readonly longitudeDelta: number,
      ) {}
    },
    CoordinateRegion: class {
      constructor(
        readonly center: unknown,
        readonly span: unknown,
      ) {}
    },
    Style: class {
      constructor(readonly options: Record<string, unknown>) {}
    },
    MarkerAnnotation: class {
      constructor(readonly coordinate: unknown) {}
    },
    CircleOverlay: class {
      constructor(
        readonly center: unknown,
        readonly radius: number,
      ) {}
    },
    Map: class {
      region: { center: { latitude: number; longitude: number } } | null = null
      destroyed = false
      moved: { latitude: number; longitude: number } | null = null
      listeners = new Map<string, Set<() => void>>()
      constructor(
        readonly element: HTMLElement,
        readonly options: Record<string, unknown>,
      ) {
        if (fails.mapFails) throw new Error('map failed')
        seen.maps.push(this)
      }
      addAnnotation(annotation: unknown) {
        if (fails.decorationFails) throw new Error('annotation failed')
        seen.annotations.push(annotation)
        return annotation
      }
      addOverlay(overlay: { center: unknown; radius: number }) {
        if (fails.decorationFails) throw new Error('overlay failed')
        seen.overlays.push(overlay)
        return overlay
      }
      removeAnnotation(annotation: unknown) {
        seen.annotations = seen.annotations.filter((shown) => shown !== annotation)
      }
      removeOverlay(overlay: unknown) {
        seen.overlays = seen.overlays.filter((shown) => shown !== overlay)
      }
      /** Where the musician moved the map, else the region's center. */
      get center() {
        return this.moved ?? this.region?.center ?? { latitude: 0, longitude: 0 }
      }
      addEventListener(type: string, listener: () => void) {
        this.listeners.set(type, (this.listeners.get(type) ?? new Set()).add(listener))
      }
      removeEventListener(type: string, listener: () => void) {
        this.listeners.get(type)?.delete(listener)
      }
      dispatch(type: string) {
        ;[...(this.listeners.get(type) ?? [])].forEach((listener) => listener())
      }
      destroy() {
        this.destroyed = true
      }
    },
    PointOfInterestCategory: { MusicVenue: 'MusicVenue', Cafe: 'Cafe', Restaurant: 'Restaurant' },
    PointOfInterestFilter: { including: (categories: string[]) => ({ including: categories }) },
    PointsOfInterestSearch: class {
      async search(request: { center: unknown; radius: number; pointOfInterestFilter: unknown }) {
        seen.searches.push({
          center: request.center,
          radius: request.radius,
          filter: request.pointOfInterestFilter,
        })
        await options.holdSearch?.()
        if (options.searchFails) throw new Error('search failed')
        return { places: options.places ?? [] }
      }
    },
  }
  const listenerCount = (type: string) => listeners.get(type)?.size ?? 0
  const moveMap = (lat: number, lon: number, { settle = true } = {}) => {
    const map = seen.maps.at(-1) as unknown as InstanceType<typeof mapkit.Map> | undefined
    if (!map) throw new Error('no map to move')
    map.dispatch('scroll-start')
    map.dispatch('region-change-start')
    map.moved = { latitude: lat, longitude: lon }
    if (!settle) return
    map.dispatch('scroll-end')
    map.dispatch('region-change-end')
  }
  return { mapkit: mapkit as unknown as MapKit, seen, dispatch, listenerCount, moveMap }
}

/** A point of interest as MapKit JS returns it. */
export function fakePlace(name: string, latitude: number, longitude: number): MapKitPlace {
  return {
    id: `id-${name}`,
    name,
    coordinate: { latitude, longitude },
    fullThoroughfare: '1 Main St',
  }
}
