import { DOWNLOADING, formatDuration } from '../recording/format'

/** The trim view's copy, and why practice or trim cannot be used yet. */

export const TRIM_BUSY = 'Trimming…'
export const TRIM_CHANGED_ELSEWHERE = "This recording's trim changed elsewhere."
export const TRIM_WHILE_RECORDING = 'Still recording'
export const TRIM_WHILE_DOWNLOADING = DOWNLOADING

export const SAVE_TRIM = 'Save'
export const SET_START = 'Set start'
export const SET_END = 'Set end'
export const PLAY_SELECTION = 'Play selection'
export const PREVIEW_END = 'Preview end'
export const GO_TO_START = 'Go to start'
export const GO_TO_END = 'Go to end'
export const LENGTH_LABEL = 'Length'
export const OVERVIEW_LABEL = 'Whole recording'
export const DETAIL_LABEL = 'Zoomed in'
export const TRIM_NOT_SAVED = 'The trim could not be saved.'
export const TRIM_CONFIRM_MESSAGE = "This can't be undone."
export const TRIM_CONFIRM_ACTION = 'Trim'

/** `Trim to 3:12?`, the length the recording keeps. */
export function TRIM_CONFIRM_TITLE(lengthMs: number): string {
  return `Trim to ${formatDuration(lengthMs)}?`
}
