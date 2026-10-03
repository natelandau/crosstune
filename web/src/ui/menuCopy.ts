/** `Trim (Offline)`, a disabled item on an action sheet, whose buttons hold one line of text. */
export function DISABLED_ITEM(label: string, reason: string): string {
  return `${label} (${reason})`
}
