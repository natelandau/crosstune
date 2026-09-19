import { matches, useMediaQuery } from './mediaQuery'

/** The chrome around the screens: a tab bar and edge-to-edge lists, or a sidebar and a column. */
export type Frame = 'phone' | 'wide'

// Ionic's md breakpoint, so the split pane and the frame switch at the same width.
export const WIDE_QUERY = '(min-width: 768px)'

export function readFrame(): Frame {
  return matches(WIDE_QUERY) ? 'wide' : 'phone'
}

export function useFrame(): Frame {
  return useMediaQuery(WIDE_QUERY) ? 'wide' : 'phone'
}
