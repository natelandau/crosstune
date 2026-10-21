import { useEffect, useState } from 'react'

/** The browser's answer for reading the device's location, or 'unknown' where it cannot say. */
export type LocationPermission = PermissionState | 'unknown'

/**
 * Whether this site may read the device's location, following a change made in the browser's
 * settings. Null until the browser answers. With no Permissions API, or a query the browser
 * refuses, the answer is 'unknown'.
 */
export function useLocationPermission(): LocationPermission | null {
  const [state, setState] = useState<LocationPermission | null>(null)
  useEffect(() => {
    let current = true
    let status: PermissionStatus | null = null
    const follow = () => {
      if (status) setState(status.state)
    }
    Promise.resolve()
      .then(() => navigator.permissions?.query({ name: 'geolocation' }))
      .then(
        (answer) => {
          if (!current) return
          if (!answer) return setState('unknown')
          status = answer
          status.addEventListener('change', follow)
          setState(answer.state)
        },
        () => {
          if (current) setState('unknown')
        },
      )
    return () => {
      current = false
      status?.removeEventListener('change', follow)
    }
  }, [])
  return state
}
