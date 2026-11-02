// Free of imports so the end-to-end specs can read the copy without loading the app.

export const LOOPS_LABEL = 'Loops'
export const MODES_LABEL = 'Practice mode'
export const LOOP_NAME = 'Loop name'
export const WAVEFORM_LABEL = 'Waveform'
export const NEW_LOOP = 'New loop'
export const DELETE_LOOP = 'Delete loop'
export const SET_START = 'Set start'
export const SET_END = 'Set end'
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

export const ISOLATE_LABEL = 'Isolate'
export const SOLO = 'Solo'
export const MUTE = 'Mute'
/** The accessible name of the Solo and Mute choice. */
export const ISOLATE_EFFECT_LABEL = 'Effect'
export const STEREO = 'Stereo'
export const FREQUENCY = 'Frequency'
export const MONO_NOTICE = 'This recording is mono, so only frequency applies.'
export const ISOLATE_PAUSES_ON_LOCK = 'Isolated playback pauses when the screen locks.'
export const ISOLATE_UNAVAILABLE = "Isolate isn't available here"
export const STEREO_START = 'Stereo start'
export const STEREO_END = 'Stereo end'
export const FREQUENCY_LOW = 'Frequency low'
export const FREQUENCY_HIGH = 'Frequency high'

/** The stereo readout's words: where the range sits, then how wide it is. */
export const STEREO_CENTER = 'Center'
export const STEREO_LEFT = 'Left'
export const STEREO_RIGHT = 'Right'
export const STEREO_LEFT_OF_CENTER = 'Left of center'
export const STEREO_RIGHT_OF_CENTER = 'Right of center'
export const STEREO_NARROW = 'narrow'
export const STEREO_MEDIUM = 'medium'
export const STEREO_WIDE = 'wide'
/** A stereo range that keeps the whole picture. */
export const STEREO_EVERYTHING = 'Everything'

/** The side a stereo edge sits on, after its distance from center. */
export const STEREO_EDGE_LEFT = 'left'
export const STEREO_EDGE_RIGHT = 'right'

/** `Left of center, 35 left`: a stereo edge's band, then how far from center it sits. */
export function STEREO_EDGE_VALUE(band: string, pan: number): string {
  if (pan === 0) return band
  return `${band}, ${Math.abs(pan)} ${pan < 0 ? STEREO_EDGE_LEFT : STEREO_EDGE_RIGHT}`
}
