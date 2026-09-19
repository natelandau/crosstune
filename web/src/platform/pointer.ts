import { matches, useMediaQuery } from './mediaQuery'

/**
 * Which kind of pointer is driving. `mouse` means a precise pointer that can hover, so row
 * actions show on hover and overlays anchor to their buttons. `touch` means swipes, sheets,
 * and long press. A tablet with a trackpad attached is `mouse`.
 */
export type Pointer = 'touch' | 'mouse'

export const MOUSE_QUERY = '(hover: hover) and (pointer: fine)'

export function readPointer(): Pointer {
  return matches(MOUSE_QUERY) ? 'mouse' : 'touch'
}

export function usePointer(): Pointer {
  return useMediaQuery(MOUSE_QUERY) ? 'mouse' : 'touch'
}
