/** True when the keystroke belongs to a field the musician is typing in. */
export function isTextEntry(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) return false
  return element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)
}

/** True when the keystroke lands on a control that keeps Space and the arrows for itself. */
export function isControl(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  return !!element?.closest?.('button, a, [role="button"], [role="slider"]')
}

/** True when the keystroke lands in a row or grid cell, where Space acts on the row. */
export function isRowTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  return !!element?.closest?.('[role="row"], [role="gridcell"]')
}
