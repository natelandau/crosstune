/** A short haptic for a gesture that changed state, such as a long press entering selection. */
export function tap(): void {
  navigator.vibrate?.(10)
}
