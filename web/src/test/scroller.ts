/** The nearest element at or above `element` that scrolls its content, if any. */
export function scrollerOf(element: Element): HTMLElement | null {
  for (let at: Element | null = element; at; at = at.parentElement) {
    if (at instanceof HTMLElement && /auto|scroll/.test(getComputedStyle(at).overflowY)) return at
  }
  return null
}
