import { matches, useMediaQuery } from './mediaQuery'

/** The chrome around the screens: a tab bar and edge-to-edge lists, or a sidebar and a column. */
export type Frame = 'phone' | 'wide'

// Width and height together, so a landscape phone stays on the phone frame. The split pane, the
// frame, and Ionic's modal-as-dialog rule all switch on this same pair.
export const WIDE_QUERY = '(min-width: 768px) and (min-height: 600px)'

export function readFrame(): Frame {
  return matches(WIDE_QUERY) ? 'wide' : 'phone'
}

export function useFrame(): Frame {
  return useMediaQuery(WIDE_QUERY) ? 'wide' : 'phone'
}
