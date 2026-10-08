/** A short haptic for a gesture that changed state, such as a long press taking hold of a row. */
export function tap(): void {
  navigator.vibrate?.(10)
}
