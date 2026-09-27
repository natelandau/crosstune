import { useEffect, useRef, type ActionDispatch, type PointerEvent, type RefObject } from 'react'
import type { TrimAction } from './trimModel'

/** How far one unit of a ctrl-scroll zooms; a trackpad pinch reports many small units. */
const WHEEL_ZOOM_RATE = 0.01

/**
 * Two-finger pinch and ctrl-scroll (which is also how a trackpad pinch arrives) zoom the
 * detail waveform. The wheel listener is attached by hand because React's is passive and
 * could not stop the page zooming too.
 *
 * A pinch starts with one finger, which has already begun a seek or a handle drag by the time
 * the second lands. From then until every finger lifts the pointers' moves stop here, and
 * `onPinchStart` puts back whatever the first finger changed, which `onFirstPointer` saves.
 */
export function useZoomGestures(
  element: RefObject<HTMLDivElement | null>,
  dispatch: ActionDispatch<[TrimAction]>,
  { onFirstPointer, onPinchStart }: { onFirstPointer: () => void; onPinchStart: () => void },
) {
  useEffect(() => {
    const target = element.current
    if (!target) return
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      dispatch({ type: 'zoom', factor: Math.exp(-event.deltaY * WHEEL_ZOOM_RATE) })
    }
    target.addEventListener('wheel', onWheel, { passive: false })
    return () => target.removeEventListener('wheel', onWheel)
  }, [element, dispatch])

  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const spread = useRef<number | null>(null)
  const pinching = useRef(false)
  useEffect(() => {
    const held = pointers.current
    return () => held.clear()
  }, [])
  const distance = () => {
    const [a, b] = Array.from(pointers.current.values())
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : null
  }
  const release = (event: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId)
    spread.current = null
    if (pointers.current.size === 0) pinching.current = false
  }
  return {
    onPointerDownCapture: (event: PointerEvent<HTMLDivElement>) => {
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (pointers.current.size === 1 && !pinching.current) {
        onFirstPointer()
        return
      }
      event.stopPropagation()
      if (pointers.current.size === 2 && !pinching.current) {
        pinching.current = true
        onPinchStart()
      }
      spread.current = distance()
    },
    onPointerMoveCapture: (event: PointerEvent<HTMLDivElement>) => {
      if (!pinching.current || !pointers.current.has(event.pointerId)) return
      event.stopPropagation()
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      const now = distance()
      if (now && spread.current) dispatch({ type: 'zoom', factor: now / spread.current })
      spread.current = now
    },
    onPointerUpCapture: release,
    onPointerCancelCapture: release,
    // A pointer whose pointerup never arrives would otherwise make every later touch a pinch.
    onLostPointerCaptureCapture: release,
  }
}
