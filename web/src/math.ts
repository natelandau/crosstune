/** setTimeout fires at once for a delay past a signed 32-bit integer, so no timer waits longer. */
export const MAX_TIMER_MS = 2_147_483_647

/** `value` held inside `[min, max]`. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
