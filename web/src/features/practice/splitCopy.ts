import { formatDuration } from '../../text/format'

/** The split view's copy, and why split cannot be used yet. */

export const SPLIT = 'Split'
export const SAVE_SPLIT = 'Save'
export const REMOVE_CUT = 'Remove cut'
export const PIECE_MIN_HINT = 'Each piece must be at least 1 second long'
export const PIECE_MAX_HINT = 'This piece is too long to upload. Add a cut to shorten it.'
export const PREVIOUS_CUT = 'Previous cut'
export const NEXT_CUT = 'Next cut'
export const SPLIT_CONFIRM_MESSAGE = "This can't be undone."
export const SPLIT_CONFIRM_ACTION = 'Split'
export const SPLIT_BUSY = 'Still processing'
export const DELETE_WHILE_SPLITTING = 'Wait for the split to finish'

/** `Split at 9:12`, the time the cut lands. */
export function SPLIT_AT(ms: number): string {
  return `Split at ${formatDuration(ms)}`
}

/** `Cut 2`, a cut's handle on the zoomed strip. */
export function CUT_HANDLE(n: number): string {
  return `Cut ${n}`
}

/** `Piece 2 of 3`. */
export function PIECE_OF(n: number, count: number): string {
  return `Piece ${n} of ${count}`
}

/** `Split into 3 recordings?` */
export function SPLIT_CONFIRM_TITLE(count: number): string {
  return `Split into ${count} recordings?`
}
