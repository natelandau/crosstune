import { matches, useMediaQuery } from './mediaQuery'

/** Whether the musician has asked the system for less animation. */
export const REDUCE_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

export function prefersReducedMotion(): boolean {
  return matches(REDUCE_MOTION_QUERY)
}

export function useReducedMotion(): boolean {
  return useMediaQuery(REDUCE_MOTION_QUERY)
}
