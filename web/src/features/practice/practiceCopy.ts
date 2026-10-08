// Free of imports so the end-to-end specs can read the copy without loading the app.

export const LOOPS_LABEL = 'Loops'
export const MODES_LABEL = 'Practice mode'
export const LOOP_NAME = 'Loop name'
export const LANES_LABEL = 'Waveform'
export const NEW_LOOP = 'New loop'
export const DELETE_LOOP = 'Delete loop'
export const LOOP_NAME_SUGGESTIONS = 'Suggestions'
export const PREVIOUS_LOOP = 'Previous loop'
export const NEXT_LOOP = 'Next loop'
export const NO_LOOP = 'No loop'
export const LOOP_CREATED = 'Loop created'
export const LOOP_NOT_SAVED = 'The loop could not be saved.'
export const LOOPS_EMPTY_HINT = 'Scroll to a spot and tap New loop.'
export const FIT = 'Fit'
export const LOCKED_LOOPS_NOTICE = 'Loops repeat while the screen is on.'

/** `The playhead is in B part.`, why New loop is off inside a loop. */
export function INSIDE_LOOP(name: string): string {
  return `The playhead is in ${name}.`
}

/** `B part selected`, announced when a tap, Previous, or Next lands on a loop. */
export function LOOP_SELECTED(name: string): string {
  return `${name} selected`
}

/** `Speed 75%`, a mode's name with its value once that value is off its default. */
export function SEGMENT_LABEL(label: string, value: string | null): string {
  return value === null ? label : `${label} ${value}`
}
