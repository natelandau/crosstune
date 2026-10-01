/** What the recording screen's tool panels share. */

import { RECORDING_RANGES } from '../../api/vocabulary'

export const RESET = 'Reset'

/** A round stepper button. */
export const PANEL_ICON_BUTTON =
  'grid size-11 shrink-0 place-items-center rounded-full bg-(--fill-tertiary) disabled:opacity-40'

/** A text button, such as Reset. */
export const PANEL_TEXT_BUTTON =
  'type-body min-h-11 rounded-full px-4 text-(--ion-color-primary) disabled:opacity-40'

/** One step of speed, in percent. */
export const SPEED_STEP = 5

/** `percent` moved `by` and clamped to the range. A speed off the 5% grid lands on the nearest
 * grid step in the direction of travel, so the first step from 72% is 70% or 75%, never 65%. */
export function stepSpeed(percent: number, by: number): number {
  const { min, max } = RECORDING_RANGES.speed_percent
  const snap = by < 0 ? Math.ceil : Math.floor
  return Math.min(max, Math.max(min, snap((percent + by) / SPEED_STEP) * SPEED_STEP))
}
