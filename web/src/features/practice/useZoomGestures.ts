import { useEffect, useRef, type PointerEvent, type RefObject } from 'react'
import { useLatest } from '../../ui/useLatest'

/** Zoom by `factor`, around `centerMs` when the gesture says where it happened. */
export type ZoomAction = { type: 'zoom'; factor: number; centerMs?: number }

/** How far one unit of a ctrl-scroll zooms; a trackpad pinch reports many small units. */
const WHEEL_ZOOM_RATE = 0.01

function emit(
  { onZoom, msAt }: { onZoom: (action: ZoomAction) => void; msAt?: (clientX: number) => number },
  factor: number,
  clientX: number,
) {
  onZoom(msAt ? { type: 'zoom', factor, centerMs: msAt(clientX) } : { type: 'zoom', factor })
}

/**
 * Two-finger pinch and ctrl-scroll (which is also how a trackpad pinch arrives) zoom the
 * detail waveform. The wheel listener is attached by hand because React's is passive and
 * could not stop the page zooming too.
 *
 * A pinch starts with one finger, which has already begun a seek or a handle drag by the time
 * the second lands. From then until every finger lifts the pointers' moves stop here, and
 * `onPinchStart` puts back whatever the first finger changed, which `onFirstPointer` saves.
 * With `msAt`, each zoom carries the time under the wheel or between the fingers.
 */
export function useZoomGestures(
  element: RefObject<HTMLDivElement | null>,
  onZoom: (action: ZoomAction) => void,
  {
    onFirstPointer,
    onPinchStart,
    onPinchEnd,
    msAt,
  }: {
    onFirstPointer: () => void
    onPinchStart: () => void
    /** A pinch's fingers have lifted to fewer than two. */
    onPinchEnd?: () => void
    msAt?: (clientX: number) => number
  },
) {
  // The wheel listener is attached once, so it reaches the latest callbacks through a ref.
  const latestRef = useLatest({ onZoom, msAt, onPinchEnd })

  useEffect(() => {
    const target = element.current
    if (!target) return
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      emit(latestRef.current, Math.exp(-event.deltaY * WHEEL_ZOOM_RATE), event.clientX)
    }
    target.addEventListener('wheel', onWheel, { passive: false })
    return () => target.removeEventListener('wheel', onWheel)
  }, [element, latestRef])

  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const spread = useRef<number | null>(null)
  const pinching = useRef(false)
  const pinchEnded = useRef(false)
  useEffect(() => {
    const held = pointers.current
    return () => held.clear()
  }, [])
  const distance = () => {
    const [a, b] = Array.from(pointers.current.values())
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : null
  }
  const release = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.delete(event.pointerId)) return
    spread.current = null
    if (pinching.current && !pinchEnded.current && pointers.current.size < 2) {
      pinchEnded.current = true
      latestRef.current.onPinchEnd?.()
    }
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
        pinchEnded.current = false
        onPinchStart()
      }
      spread.current = distance()
    },
    onPointerMoveCapture: (event: PointerEvent<HTMLDivElement>) => {
      if (!pinching.current || !pointers.current.has(event.pointerId)) return
      event.stopPropagation()
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      const now = distance()
      const [a, b] = Array.from(pointers.current.values())
      if (now && spread.current && a && b) {
        emit(latestRef.current, now / spread.current, (a.x + b.x) / 2)
      }
      spread.current = now
    },
    onPointerUpCapture: release,
    onPointerCancelCapture: release,
    // A pointer whose pointerup never arrives would otherwise make every later touch a pinch.
    onLostPointerCaptureCapture: release,
  }
}
