/**
 * The shown screen's own landmark. A screen held in place behind another keeps its landmark
 * mounted, so the shown one is the one still laid out.
 */
export function visibleMain(): HTMLElement | null {
  const landmarks = Array.from(document.querySelectorAll<HTMLElement>('main'))
  return landmarks.find((landmark) => landmark.offsetParent !== null) ?? null
}
