import type { Page } from '@playwright/test'
import { MAPKIT_SCRIPT_URL } from '../src/platform/mapkit'

type Coordinate = { latitude: number; longitude: number }

/** What the fake leaves on `window`, so a test can read where the newest map is. */
interface FakeMapKitWindow {
  fakeMapKitCenter?: () => Coordinate | null
}

/**
 * MapKit JS as the page loads it, run in the page. Each map follows a pointer drag on its own
 * element the way MapKit's does: it reports `scroll-start` as the drag begins, moves its center
 * against the drag, and reports `region-change-end` once the pointer lifts.
 */
function installFakeMapKit() {
  type Listener = (event: { status?: string }) => void
  type Span = { latitudeDelta: number; longitudeDelta: number }
  const listeners = new Map<string, Set<Listener>>()
  const on = (type: string, listener: Listener) =>
    listeners.set(type, (listeners.get(type) ?? new Set()).add(listener))
  const off = (type: string, listener: Listener) => listeners.get(type)?.delete(listener)
  const fire = (type: string, event: { status?: string } = {}) =>
    [...(listeners.get(type) ?? [])].forEach((listener) => listener(event))
  const maps: FakeMap[] = []

  class FakeMap {
    center: Coordinate = { latitude: 0, longitude: 0 }
    span: Span = { latitudeDelta: 1, longitudeDelta: 1 }
    private readonly events = new Map<string, Set<() => void>>()
    constructor(element: HTMLElement) {
      maps.push(this)
      let last: { x: number; y: number } | null = null
      let moved = false
      element.addEventListener('pointerdown', (event) => {
        last = { x: event.clientX, y: event.clientY }
        moved = false
      })
      element.addEventListener('pointermove', (event) => {
        if (!last) return
        if (!moved) this.dispatch('scroll-start')
        moved = true
        const { width, height } = element.getBoundingClientRect()
        this.center = {
          latitude:
            this.center.latitude + ((event.clientY - last.y) / height) * this.span.latitudeDelta,
          longitude:
            this.center.longitude - ((event.clientX - last.x) / width) * this.span.longitudeDelta,
        }
        last = { x: event.clientX, y: event.clientY }
      })
      element.addEventListener('pointerup', () => {
        last = null
        if (moved) this.dispatch('region-change-end')
      })
    }
    set region(region: { center: Coordinate; span: Span }) {
      this.center = region.center
      this.span = region.span
    }
    get region() {
      return { center: this.center, span: this.span }
    }
    addEventListener(type: string, listener: () => void) {
      this.events.set(type, (this.events.get(type) ?? new Set()).add(listener))
    }
    removeEventListener(type: string, listener: () => void) {
      this.events.get(type)?.delete(listener)
    }
    private dispatch(type: string) {
      ;[...(this.events.get(type) ?? [])].forEach((listener) => listener())
    }
    addAnnotation(annotation: unknown) {
      return annotation
    }
    addOverlay(overlay: unknown) {
      return overlay
    }
    removeAnnotation() {}
    removeOverlay() {}
    destroy() {
      maps.splice(maps.indexOf(this), 1)
    }
  }

  const holder = window as unknown as Record<string, unknown> & FakeMapKitWindow
  holder.mapkit = {
    addEventListener: on,
    removeEventListener: off,
    init: () => queueMicrotask(() => fire('configuration-change', { status: 'Initialized' })),
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
        readonly center: Coordinate,
        readonly span: Span,
      ) {}
    },
    Style: class {},
    MarkerAnnotation: class {},
    CircleOverlay: class {},
    Map: FakeMap,
    PointOfInterestCategory: { MusicVenue: 'MusicVenue', Cafe: 'Cafe', Restaurant: 'Restaurant' },
    PointOfInterestFilter: { including: (categories: string[]) => ({ including: categories }) },
    PointsOfInterestSearch: class {
      async search() {
        return { places: [] }
      }
    },
  }
  holder.fakeMapKitCenter = () => maps.at(-1)?.center ?? null
  const callback = document.currentScript?.dataset.callback
  if (callback) (holder[callback] as () => void)()
}

/**
 * Serve a fake MapKit JS and a token for it, so the maps draw and move with no Apple account and
 * on any origin. Returns where the newest map's center is.
 */
export async function fakeMapKit(page: Page): Promise<() => Promise<Coordinate | null>> {
  await page.route('**/v1/places/mapkit-token**', (route) =>
    route.fulfill({
      json: { token: 'e2e', expires_at: new Date(Date.now() + 3_600_000).toISOString() },
    }),
  )
  await page.route(MAPKIT_SCRIPT_URL, (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      headers: { 'access-control-allow-origin': '*' },
      body: `(${installFakeMapKit.toString()})()`,
    }),
  )
  return () => page.evaluate(() => (window as FakeMapKitWindow).fakeMapKitCenter?.() ?? null)
}
