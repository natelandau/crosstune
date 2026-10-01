import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { PlaybackEngine, type EngineClock } from './playbackEngine'

const realClock: EngineClock = {
  every: (ms, fn) => {
    const id = setInterval(fn, ms)
    return () => clearInterval(id)
  },
  after: (ms, fn) => {
    const id = setTimeout(fn, ms)
    return () => clearTimeout(id)
  },
}

// Exported so tests can inject an engine without going through PlaybackEngineProvider.
// eslint-disable-next-line react-refresh/only-export-components
export const PlaybackEngineContext = createContext<PlaybackEngine | null>(null)

/**
 * One engine, and the one `<audio>` element it owns, for the app's whole lifetime. Every
 * surface that plays a recording shares it rather than each holding its own element.
 */
export function PlaybackEngineProvider({ children }: { children: ReactNode }) {
  const engine = useMemo(() => new PlaybackEngine(new Audio(), realClock), [])

  useEffect(() => {
    engine.revive()
    return () => engine.dispose()
  }, [engine])

  return <PlaybackEngineContext.Provider value={engine}>{children}</PlaybackEngineContext.Provider>
}

// This file pairs a provider component with its hook, the point of a context module.
// eslint-disable-next-line react-refresh/only-export-components
export function usePlaybackEngine(): PlaybackEngine {
  const engine = useContext(PlaybackEngineContext)
  if (!engine) throw new Error('usePlaybackEngine must be used inside PlaybackEngineProvider')
  return engine
}
