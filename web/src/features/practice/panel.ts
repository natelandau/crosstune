/** What practice's tool panels share. */

import { RECORDING_RANGES } from '../../api/vocabulary'
import { clamp } from '../../math'

export const RESET = 'Reset'

export const ZOOM_IN = 'Zoom in'
export const ZOOM_OUT = 'Zoom out'

/** How far an arrow key moves a handle or the line, and with Shift. */
export const NUDGE_MS = 100
export const NUDGE_LARGE_MS = 1000

/** How much one zoom step scales the view by. */
export const ZOOM_STEP = 2

/** One step of speed, in percent. */
export const SPEED_STEP = 5

export function clampPitch(cents: number): number {
  const { min, max } = RECORDING_RANGES.pitch_cents
  return clamp(cents, min, max)
}
