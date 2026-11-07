import { createContext, useContext, useEffect, useState } from 'react'
import { SyncContext } from '../sync/SyncProvider'
import { loadMapKit, watchMapKit, type MapKit } from './mapkit'

/** Replaces how MapKit loads, for a test; the app leaves it unset. */
export const MapKitContext = createContext<(() => Promise<MapKit | null>) | null>(null)

/** Where MapKit JS stands: still loading, usable, or gone for good or until it recovers. */
export type MapKitState =
  | { status: 'loading'; mapkit: null }
  | { status: 'ready'; mapkit: MapKit }
  | { status: 'unavailable'; mapkit: null }

const LOADING: MapKitState = { status: 'loading', mapkit: null }
const UNAVAILABLE: MapKitState = { status: 'unavailable', mapkit: null }

/**
 * MapKit JS and whether it is loading, ready, or unavailable: it could not load, its token
 * request failed, or it reports an error. Nothing loads while `enabled` is false.
 */
export function useMapKitState(enabled = true): MapKitState {
  const injected = useContext(MapKitContext)
  const engine = useContext(SyncContext)
  const [state, setState] = useState<MapKitState>(LOADING)
  useEffect(() => {
    if (!enabled) return
    const load = injected ?? (engine ? () => loadMapKit(() => engine.mapKitToken()) : null)
    if (!load) return
    let current = true
    let stop = () => {}
    void load().then(
      (loaded) => {
        if (!current) return
        if (!loaded) {
          setState(UNAVAILABLE)
          return
        }
        setState({ status: 'ready', mapkit: loaded })
        // MapKit reports a throttle or a rejected token after the fact; the maps then go, and
        // come back once MapKit configures itself again.
        stop = watchMapKit(loaded, (usable) =>
          setState(usable ? { status: 'ready', mapkit: loaded } : UNAVAILABLE),
        )
      },
      () => current && setState(UNAVAILABLE),
    )
    return () => {
      current = false
      stop()
    }
  }, [enabled, injected, engine])
  return state
}

/**
 * MapKit JS once it has loaded, or null while it loads, while it reports an error, and for good
 * if it cannot load. Nothing loads while `enabled` is false.
 */
export function useMapKit(enabled = true): MapKit | null {
  return useMapKitState(enabled).mapkit
}
