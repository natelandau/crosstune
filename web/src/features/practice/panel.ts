/** What practice's tool panels share. */

import { RECORDING_RANGES } from '../../api/vocabulary'
import { clamp } from '../../math'

export const RESET = 'Reset'

/** A round stepper button. */
export const PANEL_ICON_BUTTON =
  'grid size-11 shrink-0 place-items-center rounded-full bg-(--fill-tertiary) disabled:opacity-40'

/** A text button's shape with no color of its own, for a button that picks its own. */
export const PANEL_TEXT_BUTTON_SHAPE = 't-body min-h-11 rounded-full px-4 disabled:opacity-40'

/** A text button, such as Reset. */
export const PANEL_TEXT_BUTTON = `${PANEL_TEXT_BUTTON_SHAPE} text-(--panel-ink)`

export const ZOOM_IN = 'Zoom in'
export const ZOOM_OUT = 'Zoom out'

/** How much one zoom step scales the view by. */
export const ZOOM_STEP = 2

/** One step of speed, in percent. */
export const SPEED_STEP = 5

/** `percent` moved `by` and clamped to the range. A speed off the 5% grid lands on the nearest
 * grid step in the direction of travel, so the first step from 72% is 70% or 75%, never 65%. */
export function stepSpeed(percent: number, by: number): number {
  const { min, max } = RECORDING_RANGES.speed_percent
  const snap = by < 0 ? Math.ceil : Math.floor
  return clamp(snap((percent + by) / SPEED_STEP) * SPEED_STEP, min, max)
}

export function clampSpeed(percent: number): number {
  const { min, max } = RECORDING_RANGES.speed_percent
  return clamp(percent, min, max)
}

export function clampPitch(cents: number): number {
  const { min, max } = RECORDING_RANGES.pitch_cents
  return clamp(cents, min, max)
}
