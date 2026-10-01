import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { LaneView } from './practiceZoom'

/** How near either end of the zoomed view a drag starts panning it. */
export const AUTO_PAN_ZONE_PX = 24
/** How far the view pans each frame with the pointer at the very edge. */
const AUTO_PAN_MAX_PX = 8

/**
 * Pans the zoomed view while a drag holds the pointer near either end of it, faster the nearer
 * the edge, so a loop can be dragged past what is shown. `follow` runs once the view a pan
 * produced has rendered, to recompute the drag against it and `track` the pointer again, which
 * keeps the panning going. A pan the view's ends refuse renders nothing and ends the panning.
 */
export function useAutoPan({
  view,
  onPan,
  follow,
}: {
  view: LaneView
  onPan: (deltaMs: number) => void
  follow: () => void
}) {
  const latest = useRef({ view, onPan, follow })
  useLayoutEffect(() => {
    latest.current = { view, onPan, follow }
  })
  const frame = useRef(0)
  const pointerX = useRef(0)
  const panned = useRef(false)
  useLayoutEffect(() => {
    if (!panned.current) return
    panned.current = false
    latest.current.follow()
  }, [view.startMs, view.pxPerS])

  // Stable for the life of the drag surface, so an effect can stop it without re-running.
  const controls = useMemo(() => {
    const stop = () => {
      cancelAnimationFrame(frame.current)
      frame.current = 0
      panned.current = false
    }
    const depth = () => {
      const x = pointerX.current
      const width = latest.current.view.widthPx
      if (x < AUTO_PAN_ZONE_PX) return -(AUTO_PAN_ZONE_PX - Math.max(0, x))
      if (x > width - AUTO_PAN_ZONE_PX) return AUTO_PAN_ZONE_PX - Math.max(0, width - x)
      return 0
    }
    const step = () => {
      frame.current = 0
      const by = depth()
      if (by === 0) return
      const { view, onPan } = latest.current
      panned.current = true
      onPan(((by / AUTO_PAN_ZONE_PX) * AUTO_PAN_MAX_PX * 1000) / view.pxPerS)
      // An accepted pan has committed by the next frame; one the ends refuse renders nothing,
      // so only this clears it.
      requestAnimationFrame(() => {
        panned.current = false
      })
    }
    return {
      /** The dragging pointer is now `x` px from the view's left edge. */
      track: (x: number) => {
        pointerX.current = x
        if (depth() === 0) stop()
        else if (!frame.current) frame.current = requestAnimationFrame(step)
      },
      stop,
    }
  }, [])
  useEffect(() => controls.stop, [controls])
  return controls
}
