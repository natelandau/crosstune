/** The player's own copy: the dock, skipping, and playing through a list. */

export const PLAY_FAILED = "Couldn't play"
export const RETRY = 'Retry'
export const PLAYER_REGION = 'Player'

export const SKIP_BACK = 'Skip back 15 seconds'
export const SKIP_FORWARD = 'Skip forward 15 seconds'
/** The same interval the Apple player skips by. */
export const SKIP_MS = 15_000

export const PREVIOUS_TUNE = 'Previous tune'
export const NEXT_TUNE = 'Next tune'
export const REPEAT_OFF = 'Repeat off'
export const REPEAT_LIST = 'Repeat list'
export const REPEAT_TUNE = 'Repeat tune'
export const NOTHING_LEFT = 'Nothing left in this list can play'

/** `Thursday jam, 3 of 18`, the list that plays and where in it. */
export function listPosition(name: string, position: number, count: number): string {
  return `${name}, ${position} of ${count}`
}
