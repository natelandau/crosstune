/** The slice of MapKit JS this app draws with, so no type package is needed. */
export interface MapKitCoordinate {
  latitude: number
  longitude: number
}

export interface MapKitPlace {
  id?: string
  name: string
  coordinate: MapKitCoordinate
  /** The street number and name, such as "12 Main St". */
  fullThoroughfare?: string | null
  /** The city, which Apple Maps sets to New York for every borough. */
  locality?: string | null
  /** A neighborhood, or a New York borough. */
  subLocality?: string | null
  /** The state's short code, such as "VA". */
  administrativeAreaCode?: string | null
  /** The country's ISO code, such as "US". */
  countryCode?: string | null
  country?: string | null
  /** The whole mailing address on one line. */
  formattedAddress?: string | null
}

export interface MapKitMap {
  region: unknown
  addAnnotation(annotation: unknown): unknown
  addOverlay(overlay: unknown): unknown
  destroy(): void
}

export interface MapKitEvent {
  status?: string
}

export interface MapKit {
  addEventListener(type: string, listener: (event: MapKitEvent) => void): void
  removeEventListener(type: string, listener: (event: MapKitEvent) => void): void
  init(options: { authorizationCallback: (done: (token: string) => void) => void }): void
  Coordinate: new (latitude: number, longitude: number) => MapKitCoordinate
  CoordinateSpan: new (latitudeDelta: number, longitudeDelta: number) => unknown
  CoordinateRegion: new (center: MapKitCoordinate, span: unknown) => unknown
  Style: new (options: Record<string, unknown>) => unknown
  MarkerAnnotation: new (coordinate: MapKitCoordinate, options?: Record<string, unknown>) => unknown
  CircleOverlay: new (
    center: MapKitCoordinate,
    radius: number,
    options?: Record<string, unknown>,
  ) => unknown
  Map: new (element: HTMLElement, options: Record<string, unknown>) => MapKitMap
  PointOfInterestCategory: Record<string, string>
  PointOfInterestFilter: { including(categories: string[]): unknown }
  PointsOfInterestSearch: new () => {
    search(request: {
      center: MapKitCoordinate
      radius: number
      pointOfInterestFilter: unknown
    }): Promise<{ places: MapKitPlace[] }>
  }
}

/**
 * An exact MapKit JS 5 release, so a new release never changes what the page runs. The core
 * file loads only the libraries named in `data-libraries`.
 */
export const MAPKIT_SCRIPT_URL = 'https://cdn.apple-mapkit.com/mk/5.81.60/mapkit.core.js'

/** The map, its pin and circle, and the points-of-interest search. */
export const MAPKIT_LIBRARIES = ['map', 'annotations', 'overlays', 'services'] as const

/** What loading MapKit touches, so a test can fake the script, the global, and the clock. */
export interface MapKitEnv {
  /** Loads the script; an abort removes it, so a load that arrives late answers nothing. */
  loadScript(url: string, libraries: readonly string[], signal?: AbortSignal): Promise<void>
  global(): MapKit | undefined
  /** Resolves after `ms`; the load gives up when it wins a race against a step. */
  wait(ms: number): Promise<void>
}

/** How long the script and MapKit's configuration each get before the load gives up. */
export const MAPKIT_TIMEOUT_MS = 15_000

const READY_CALLBACK = '__crosstuneMapKitReady'
let scriptLoads = 0

export const browserMapKitEnv: MapKitEnv = {
  loadScript(url, libraries, signal) {
    return new Promise((resolve, reject) => {
      const holder = window as unknown as Record<string, unknown>
      // A name per load, since the script calls back the name on its own tag, and a stalled
      // load that arrives late must not answer a later one.
      scriptLoads += 1
      const callback = `${READY_CALLBACK}${scriptLoads}`
      const script = document.createElement('script')
      const fail = (message: string) => {
        delete holder[callback]
        script.remove()
        reject(new Error(message))
      }
      const onAbort = () => fail('MapKit JS load stopped')
      holder[callback] = () => {
        delete holder[callback]
        signal?.removeEventListener('abort', onAbort)
        resolve()
      }
      script.addEventListener('error', () => fail('MapKit JS did not load'), { once: true })
      signal?.addEventListener('abort', onAbort, { once: true })
      script.src = url
      script.async = true
      script.crossOrigin = 'anonymous'
      script.dataset.callback = callback
      script.dataset.libraries = libraries.join(',')
      document.head.append(script)
    })
  },
  global: () => (window as unknown as { mapkit?: MapKit }).mapkit,
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}

type TokenSource = () => Promise<string | null>

interface Entry {
  promise: Promise<MapKit | null>
  /** The newest caller's source, so a refresh after a change of user asks the current one. */
  fetchToken: TokenSource
  /** Set once `init` has run: MapKit cannot be initialized twice, so it is never loaded again. */
  initialized: boolean
}

const entries = new WeakMap<MapKitEnv, Entry>()

/**
 * Loads MapKit JS once, with a token from `fetchToken`, and resolves with it once MapKit has
 * configured itself, or null on any failure: no token, a blocked, stalled, or partial script, or
 * a configuration MapKit rejects. A failure before MapKit starts is not remembered, so the next
 * ask tries again. After it starts, an ask made while MapKit reports a passing error waits for it
 * to configure itself again, and every ask resolves null for good once it refuses the token.
 * MapKit asks for a new token when its own runs out, and the newest `fetchToken` answers that.
 */
export function loadMapKit(
  fetchToken: TokenSource,
  env: MapKitEnv = browserMapKitEnv,
): Promise<MapKit | null> {
  const existing = entries.get(env)
  if (existing) {
    existing.fetchToken = fetchToken
    return existing.promise
  }
  const entry: Entry = { fetchToken, initialized: false, promise: Promise.resolve(null) }
  entry.promise = start(entry, env).then((mapkit) => {
    if (!mapkit && !entry.initialized) entries.delete(env)
    return mapkit
  })
  entries.set(env, entry)
  return entry.promise
}

/** Whether the libraries the page draws with arrived; MapKit's getters throw for a missing one. */
function hasLibraries(mapkit: MapKit): boolean {
  try {
    return !!mapkit.Map && !!mapkit.PointsOfInterestSearch
  } catch {
    return false
  }
}

function within<T>(env: MapKitEnv, step: Promise<T>, onTimeout?: () => void): Promise<T> {
  return Promise.race([
    step,
    env.wait(MAPKIT_TIMEOUT_MS).then((): never => {
      onTimeout?.()
      throw new Error('MapKit JS stalled')
    }),
  ])
}

/** An error status after which MapKit never works again on this page: it refused the token. */
const LASTING_ERRORS = new Set(['Unauthorized'])
/** The configuration statuses that say MapKit works: first set up, or set up again. */
const READY_STATUSES = new Set(['Initialized', 'Refreshed'])

/**
 * Tells `onChange` whether MapKit can be used as it reports errors and configurations: an error
 * stops it, a later configuration brings it back, and a refused token stops it for good, since a
 * network error, timeout, or throttle passes and a refusal does not. Returns the unsubscribe.
 */
export function watchMapKit(
  mapkit: MapKit,
  onChange: (usable: boolean, refused: boolean) => void,
): () => void {
  let refused = false
  const onError = (event: MapKitEvent) => {
    if (LASTING_ERRORS.has(event.status ?? '')) refused = true
    onChange(false, refused)
  }
  const onConfigured = (event: MapKitEvent) => {
    if (!refused && READY_STATUSES.has(event.status ?? '')) onChange(true, false)
  }
  mapkit.addEventListener('error', onError)
  mapkit.addEventListener('configuration-change', onConfigured)
  return () => {
    mapkit.removeEventListener('error', onError)
    mapkit.removeEventListener('configuration-change', onConfigured)
  }
}

/** Resolves true once MapKit first answers with a configuration, false with an error. */
function configured(mapkit: MapKit): { answer: Promise<boolean>; stop: () => void } {
  let stop = () => {}
  const answer = new Promise<boolean>((resolve) => {
    stop = watchMapKit(mapkit, (usable) => {
      stop()
      resolve(usable)
    })
  })
  return { answer, stop }
}

async function start(entry: Entry, env: MapKitEnv): Promise<MapKit | null> {
  const quietToken = () => entry.fetchToken().catch(() => null)
  try {
    // Asking first keeps a server with no Maps key from loading a script that cannot start.
    let first = await quietToken()
    if (!first) return null
    const script = new AbortController()
    await within(env, env.loadScript(MAPKIT_SCRIPT_URL, MAPKIT_LIBRARIES, script.signal), () =>
      script.abort(),
    )
    const mapkit = env.global()
    if (!mapkit || !hasLibraries(mapkit)) return null
    // Listening before `init` so a fast answer is not missed.
    const ready = configured(mapkit)
    // Held open through a passing error, so a caller that asks then still gets MapKit back.
    let recover: ((value: MapKit | null) => void) | null = null
    let recovering: Promise<MapKit | null> | null = null
    watchMapKit(mapkit, (usable, refused) => {
      if (usable || refused) {
        recover?.(usable ? mapkit : null)
        recover = recovering = null
        entry.promise = Promise.resolve(usable ? mapkit : null)
      } else if (!recovering) {
        recovering = new Promise((resolve) => (recover = resolve))
        entry.promise = recovering
      }
    })
    mapkit.init({
      authorizationCallback: (done) => {
        const token = first
        first = null
        if (token) return done(token)
        // An empty token is how MapKit is told the refresh failed.
        void quietToken().then((fresh) => done(fresh ?? ''))
      },
    })
    entry.initialized = true
    if (await within(env, ready.answer, ready.stop)) return mapkit
    return recovering ?? null
  } catch {
    return null
  }
}
