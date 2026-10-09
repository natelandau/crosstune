/** A list's play row and its What plays sheet. */

export const SHUFFLE = 'Shuffle'

/** `2 of 3 tunes will play`. Counts the list's rows, so a tune listed twice counts twice. */
export function willPlayLabel(playable: number, total: number): string {
  return `${playable} of ${total} tunes will play`
}

export const NOTHING_PLAYS = 'No tunes in this list can play'
export const WHAT_PLAYS_HINT = 'Shows which tunes play in a list and why the others do not.'
export const WHAT_PLAYS_TITLE = 'What plays'
export const WHAT_PLAYS_LEAD =
  "Lists play your recordings. Links play from each tune's play button."

export const SKIP_NOTHING = 'No recordings or links'
export const SKIP_LINKS_ONLY = "Only links that can't play in a list"
export const SKIP_NOT_HERE = "Recordings that aren't on this device yet"

/** `Play Thursday jam`, a list row's play control. */
export function playListName(name: string): string {
  return `Play ${name}`
}

/** `Pause Thursday jam`, the playing list's row control. */
export function pauseListName(name: string): string {
  return `Pause ${name}`
}
