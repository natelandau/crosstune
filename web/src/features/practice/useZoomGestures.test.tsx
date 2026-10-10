import { renderHook } from '@testing-library/react'
import type { PointerEvent } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useZoomGestures } from './useZoomGestures'

const finger = (pointerId: number, clientX: number) =>
  ({ pointerId, clientX, clientY: 0, stopPropagation: () => {} }) as PointerEvent<HTMLDivElement>

function setup() {
  const onPinchEnd = vi.fn()
  const onPinchStart = vi.fn()
  const { result } = renderHook(() =>
    useZoomGestures({ current: null }, () => {}, {
      onFirstPointer: () => {},
      onPinchStart,
      onPinchEnd,
    }),
  )
  return { handlers: result.current, onPinchEnd, onPinchStart }
}

describe('a pinch', () => {
  it('ends when its fingers lift to fewer than two', () => {
    const { handlers, onPinchEnd, onPinchStart } = setup()
    handlers.onPointerDownCapture(finger(1, 0))
    handlers.onPointerDownCapture(finger(2, 100))
    expect(onPinchStart).toHaveBeenCalledOnce()
    handlers.onPointerUpCapture(finger(2, 100))
    expect(onPinchEnd).toHaveBeenCalledOnce()
  })

  it('ends again after a finger lands once more and lifts', () => {
    const { handlers, onPinchEnd, onPinchStart } = setup()
    handlers.onPointerDownCapture(finger(1, 0))
    handlers.onPointerDownCapture(finger(2, 100))
    handlers.onPointerUpCapture(finger(2, 100))
    handlers.onPointerDownCapture(finger(3, 120))
    // The same pinch resumes, so it does not start over.
    expect(onPinchStart).toHaveBeenCalledOnce()
    handlers.onPointerUpCapture(finger(3, 120))
    handlers.onPointerUpCapture(finger(1, 0))
    expect(onPinchEnd).toHaveBeenCalledTimes(2)
  })
})
