import { useEffect, type RefObject } from 'react'

/**
 * Starts focus on `target` when a view inside the screen opens, since the control that opened
 * the view is gone with the view it sat in and focus would otherwise fall to the page. The
 * button is ready a frame or more after the view shows, so focus the musician has moved into
 * the screen by then, such as a name field they opened, stays where they put it.
 */
export function useEntryFocus(
  target: RefObject<HTMLIonButtonElement | null>,
  modal: RefObject<HTMLIonModalElement | null>,
): void {
  useEffect(() => {
    const element = target.current
    if (!element) return
    let live = true
    let frame = 0
    void Promise.resolve(element.componentOnReady?.()).then(() => {
      // One frame on, once the view that held the opener has left the page.
      frame = requestAnimationFrame(() => {
        if (!live) return
        const active = document.activeElement
        const screen = modal.current
        if (active && screen && active !== screen && screen.contains(active)) return
        element.shadowRoot?.querySelector('button')?.focus()
      })
    })
    return () => {
      live = false
      cancelAnimationFrame(frame)
    }
  }, [target, modal])
}
