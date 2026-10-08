import { useEffect, useRef } from 'react'
import { useLocation, useResolvedPath } from 'react-router'
import { useLatest } from '../ui/useLatest'

const trimSlash = (path: string) => (path.length > 1 ? path.replace(/\/+$/, '') : path)

/**
 * Runs `callback` whenever the route that owns the calling component is the current location
 * after some other location was shown. It also runs once on first mount at its own route, so a
 * screen can read session state it shares with its siblings without a separate mount effect.
 * A parent route stays mounted under its children, so it is "shown" again when Back returns
 * from a child, not while a child is open.
 */
export function usePageShown(callback: () => void) {
  const callbackRef = useLatest(callback)
  const { pathname } = useLocation()
  const own = useResolvedPath('.').pathname
  const shown = trimSlash(pathname) === trimSlash(own)
  // A ref outlives strict-mode's simulated remount, so first mount still fires once.
  const wasShown = useRef(false)

  useEffect(() => {
    if (shown && !wasShown.current) callbackRef.current()
    wasShown.current = shown
  }, [shown, callbackRef])
}
