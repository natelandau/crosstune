import type { MenuItem } from '../../ui/Menu'

export const MOVE_DOWN = 'Move down'
export const MOVE_TO_BOTTOM = 'Move to bottom'
export const MOVE_TO_TOP = 'Move to top'
export const MOVE_UP = 'Move up'

/** Where a move sends a row, read against the rows on screen when the item is pressed. */
export type Place = (index: number, last: number) => number

const PLACES = {
  top: () => 0,
  up: (index: number) => index - 1,
  down: (index: number) => index + 1,
  bottom: (_index: number, last: number) => last,
} as const satisfies Record<string, Place>

/**
 * The moves for the row at `index` of `count`, leaving out those that go nowhere. `go` turns a
 * place into the item's handler, so the caller decides which rows the place is read against.
 */
export function moveMenuItems(
  index: number,
  count: number,
  go: (place: Place) => () => void,
): MenuItem[] {
  const last = count - 1
  return [
    ...(index > 0
      ? [
          { label: MOVE_TO_TOP, onPress: go(PLACES.top) },
          { label: MOVE_UP, onPress: go(PLACES.up) },
        ]
      : []),
    ...(index < last
      ? [
          { label: MOVE_DOWN, onPress: go(PLACES.down) },
          { label: MOVE_TO_BOTTOM, onPress: go(PLACES.bottom) },
        ]
      : []),
  ]
}
