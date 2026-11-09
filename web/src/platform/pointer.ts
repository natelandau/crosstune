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

/** How far a press moves before it is a drag rather than a tap. */
export const DRAG_THRESHOLD_PX = 8

/** How far a press has moved sideways once it is a drag, or null while it is still within
 * the threshold that tells a drag from a tap. */
export function dragTravel(
  pressed: { startX: number; moved: boolean },
  clientX: number,
): number | null {
  const dx = clientX - pressed.startX
  return !pressed.moved && Math.abs(dx) < DRAG_THRESHOLD_PX ? null : dx
}
