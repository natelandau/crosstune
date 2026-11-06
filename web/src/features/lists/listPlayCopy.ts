/** A list's play row. */

export const SHUFFLE = 'Shuffle'

/** `2 of 3 tunes will play`. Counts the list's rows, so a tune listed twice counts twice. */
export function willPlayLabel(playable: number, total: number): string {
  return `${playable} of ${total} tunes will play`
}

export const NOTHING_PLAYS = 'No tunes in this list can play'

/** `Play Thursday jam`, a list row's play control. */
export function playListName(name: string): string {
  return `Play ${name}`
}

/** `Pause Thursday jam`, the playing list's row control. */
export function pauseListName(name: string): string {
  return `Pause ${name}`
}
