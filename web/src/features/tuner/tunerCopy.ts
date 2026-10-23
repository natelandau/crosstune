import { tabLabel } from '../../layout/tabs'
import { a4Label } from '../settings/settingsCopy'
import { isInTune, tenths, tuneHint, type Note } from './pitch/notes'

export const TUNER_TITLE = tabLabel('tuner')

/** The hint under the cents when a note sits low or high. */
export const FLAT = 'Flat'
export const SHARP = 'Sharp'

/** The hint for a note `cents` off, or null when it is in tune. */
export function hintLabel(cents: number): typeof FLAT | typeof SHARP | null {
  const hint = tuneHint(cents)
  return hint && (hint === 'flat' ? FLAT : SHARP)
}

export const MIC_DENIED_TITLE = "Crosstune can't hear you"
export const MIC_DENIED_BODY =
  "Allow the microphone for this site in your browser's settings, then come back."
export const MIC_UNAVAILABLE = 'No microphone found.'
export const LISTENING = 'Play a note'
export const TAP_TO_LISTEN = 'Tap to start listening'

const STANDARD_A4 = 440

/** The reference pitch under the title, only when it is not the standard one. */
export function referenceLabel(hz: number): string | null {
  return hz === STANDARD_A4 ? null : a4Label(hz)
}

/** A reading as a screen reader speaks it, such as A4, 3 cents flat. */
export function spokenReading(note: Note): string {
  const name = `${note.name}${note.octave}`
  if (isInTune(note.cents)) return `${name}, in tune`
  const off = Math.round(Math.abs(tenths(note.cents)))
  return `${name}, ${off} cents ${note.cents < 0 ? 'flat' : 'sharp'}`
}
