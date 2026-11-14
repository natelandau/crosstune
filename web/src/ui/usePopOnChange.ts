import { useLayoutEffect, useRef, type RefObject } from 'react'
import { useReducedMotionConfig } from 'motion/react'
import { DURATION, springEasing } from '../theme/motion'

const POP_EASING = springEasing()

/**
 * Pops the element in on the spring each time `value` changes. The value it first shows never
 * moves, so an element that mounts, such as a row scrolled into a windowed list, stays still.
 * Runs before paint, so no frame shows the new value at full size.
 */
export function usePopOnChange(ref: RefObject<Element | null>, value: unknown): void {
  const shown = useRef(value)
  const reduceMotion = useReducedMotionConfig()
  useLayoutEffect(() => {
    if (Object.is(shown.current, value)) return
    shown.current = value
    if (reduceMotion) return
    ref.current?.animate(
      { transform: ['scale(0.6)', 'scale(1)'] },
      { duration: DURATION.long * 1000, easing: POP_EASING },
    )
  }, [ref, value, reduceMotion])
}
