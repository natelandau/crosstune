import { useEffect, useState } from 'react'
import type { PlaceHint } from '../../api/types'
import { devicePosition } from './devicePosition'

/**
 * The device's point, read each time `enabled` turns on and kept after, and whether the read
 * since it last turned on is still under way. The point is null until a read lands. Never asks
 * while off, so a caller that turns it on only with access granted never raises the browser's
 * prompt.
 */
export function useDevicePoint(enabled: boolean): { point: PlaceHint | null; reading: boolean } {
  const [device, setDevice] = useState<PlaceHint | null>(null)
  const [answered, setAnswered] = useState(false)
  // Each turn on starts a new read, which is under way until it answers.
  const [wasEnabled, setWasEnabled] = useState(enabled)
  if (enabled !== wasEnabled) {
    setWasEnabled(enabled)
    if (enabled) setAnswered(false)
  }
  useEffect(() => {
    if (!enabled) return
    let live = true
    void devicePosition(navigator.geolocation).then((at) => {
      if (!live) return
      if (at) setDevice({ lat: at.lat, lon: at.lon })
      setAnswered(true)
    })
    return () => {
      live = false
    }
  }, [enabled])
  return { point: device, reading: enabled && !answered }
}
