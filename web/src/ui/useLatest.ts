import { useLayoutEffect, useRef, type RefObject } from 'react'

/**
 * A ref that always holds the latest render's `value`, for handlers and effects that must read
 * current values without re-subscribing. Written in a layout effect, so it is current before
 * any effect or event that follows the commit reads it.
 */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value)
  useLayoutEffect(() => {
    ref.current = value
  })
  return ref
}
