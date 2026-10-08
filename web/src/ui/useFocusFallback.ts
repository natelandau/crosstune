import { useEffect, useRef, useState, type RefObject } from 'react'

/**
 * Moves focus to `target`, the column's title, when a filter control leaves the page while it
 * holds focus: a token's remove or a sheet's Reset can leave nothing to filter, and the filter
 * write may land before or after the sheet closes. `controls` says which controls are on the
 * page now, `trigger` whether the control that opens the sheet is among them. Pass the returned
 * callback as the sheet's `onClosed`.
 *
 * This runs as an effect of the commit that removes the control or the sheet, never a frame
 * later: a frame can pass before that commit, and the page stays inert until the sheet's own
 * effects have cleaned up.
 */
export function useFocusFallback(
  target: RefObject<HTMLElement | null>,
  {
    controls,
    trigger,
    sheetOpen,
  }: { controls: Readonly<Record<string, boolean>>; trigger: boolean; sheetOpen: boolean },
): () => void {
  // Set beside the presence update that takes the closed sheet off the page, so both commit
  // together.
  const [closes, setCloses] = useState(0)
  const shown = { controls, closes }
  const shownBefore = useRef(shown)
  useEffect(() => {
    const before = shownBefore.current
    shownBefore.current = shown
    const dropped = Object.entries(before.controls).some(
      ([name, present]) => present && !shown.controls[name],
    )
    // While the sheet is open it holds focus, and the page behind it can take none.
    const lost = (!sheetOpen && dropped) || (before.closes !== shown.closes && !trigger)
    if (!lost) return
    // Focus still in a closing sheet stays; its close comes back here.
    const active = document.activeElement
    if (active && active !== document.body) return
    const title = target.current
    if (!title) return
    title.setAttribute('tabindex', '-1')
    title.focus({ preventScroll: true })
  })
  return () => setCloses((count) => count + 1)
}
