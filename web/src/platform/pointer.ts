/** A precise pointer that can hover. A tablet with a trackpad attached is one. */
export const MOUSE_QUERY = '(hover: hover) and (pointer: fine)'

/** Keep a press's later events on `element` wherever the pointer goes. A synthetic or
 * already-released pointer cannot be captured, but its events still arrive, so that is fine. */
export function capturePointer(element: Element, pointerId: number): void {
  try {
    element.setPointerCapture(pointerId)
  } catch {
    // Nothing to do: the press goes on uncaptured.
  }
}
