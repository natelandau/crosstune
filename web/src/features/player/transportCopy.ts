/** The player's transport labels, shared by every screen that drives the one engine. */

export const CLOSE_PLAYER = 'Close player'
export const PLAY = 'Play'
export const PAUSE = 'Pause'
export const PITCH_UNAVAILABLE = "Pitch shift isn't available here"
export const SPEED_LABEL = 'Speed'
export const PITCH_LABEL = 'Pitch'
export const ELAPSED_LABEL = 'Elapsed'
export const REMAINING_LABEL = 'Remaining'
export const REPEAT_LABEL = 'Repeat'

/** `Repeating B part`, the loop the player repeats while Practice is closed. */
export function REPEATING_BADGE(label: string): string {
  return `Repeating ${label}`
}

/** `75%`, shown only away from the 100% default. */
export function SPEED_BADGE(percent: number): string {
  return `${percent}%`
}

/**
 * Semitones with a sign, one decimal only when the cents are not a whole semitone: `+2`,
 * `-1`, `+2.1`. Rounds the magnitude, then prefixes the sign from `cents`, so a negative and
 * a positive value of the same size round identically (`Math.round` alone rounds halves
 * toward positive infinity, which is asymmetric for negatives). Rounds at the
 * tenths-of-a-semitone integer (`magnitude / 10`) rather than on the final float, so 205
 * cents (2.05 semitones) rounds to 2.1 rather than whatever binary value `2.05` itself
 * happens to be stored as, and never rounds a non-zero pitch away to a bare "0.0": the
 * smallest a shown fraction ever reads is a tenth of a semitone.
 */
export function PITCH_BADGE(cents: number): string {
  const magnitude = Math.abs(cents)
  const sign = cents < 0 ? '-' : '+'
  if (magnitude % 100 === 0) return `${sign}${(magnitude / 100).toFixed(0)}`
  const tenths = Math.max(1, Math.round(magnitude / 10))
  return `${sign}${(tenths / 10).toFixed(1)}`
}

export function OPEN_RECORDING(title: string): string {
  return `Open ${title}`
}
