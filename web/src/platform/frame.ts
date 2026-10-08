import { useMediaQuery } from './mediaQuery'

export type Frame = 'phone' | 'split' | 'wide'

// A short window stays a phone frame: a landscape phone is wide but has no room for panes.
export const SPLIT_QUERY = '(min-width: 768px) and (min-height: 600px)'
export const WIDE_QUERY = '(min-width: 1100px) and (min-height: 600px)'

export function useFrame(): Frame {
  const wide = useMediaQuery(WIDE_QUERY)
  const split = useMediaQuery(SPLIT_QUERY)
  if (wide) return 'wide'
  return split ? 'split' : 'phone'
}
