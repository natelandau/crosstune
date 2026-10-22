import { createContext, useContext, useEffect, useState } from 'react'
import { SyncContext } from '../sync/SyncProvider'
import { loadMapKit, watchMapKit, type MapKit } from './mapkit'

/** Replaces how MapKit loads, for a test; the app leaves it unset. */
export const MapKitContext = createContext<(() => Promise<MapKit | null>) | null>(null)

/**
 * MapKit JS once it has loaded, or null while it loads, while it reports an error, and for good
 * if it cannot load. Nothing loads while `enabled` is false.
 */
export function useMapKit(enabled = true): MapKit | null {
  const injected = useContext(MapKitContext)
  const engine = useContext(SyncContext)
  const [mapkit, setMapkit] = useState<MapKit | null>(null)
  useEffect(() => {
    if (!enabled) return
    const load = injected ?? (engine ? () => loadMapKit(() => engine.mapKitToken()) : null)
    if (!load) return
    let current = true
    let stop = () => {}
    void load().then(
      (loaded) => {
        if (!current) return
        setMapkit(loaded)
        if (!loaded) return
        // MapKit reports a throttle or a rejected token after the fact; the maps then go, and
        // come back once MapKit configures itself again.
        stop = watchMapKit(loaded, (usable) => setMapkit(usable ? loaded : null))
      },
      () => {},
    )
    return () => {
      current = false
      stop()
    }
  }, [enabled, injected, engine])
  return mapkit
}
