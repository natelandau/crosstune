import type { MotionValue } from 'motion/react'
import { useLayoutEffect, useState, useSyncExternalStore } from 'react'

function subscribeResize(onChange: () => void): () => void {
  window.addEventListener('resize', onChange)
  return () => window.removeEventListener('resize', onChange)
}

export function useViewport(): { width: number; height: number } {
  const width = useSyncExternalStore(subscribeResize, () => window.innerWidth)
  const height = useSyncExternalStore(subscribeResize, () => window.innerHeight)
  return { width, height }
}

/**
 * Where a scrolling body meets the header and footer: whether content has scrolled up under the
 * header, and whether more runs on below the footer. `covered` is how much of the body's foot a
 * raised footer hides, so content under it counts as running on.
 */
export function useScrollEdges(
  element: HTMLElement | null,
  covered?: MotionValue<number>,
): { overflows: boolean; top: boolean; bottom: boolean } {
  const [edges, setEdges] = useState({ overflows: false, top: false, bottom: false })
  useLayoutEffect(() => {
    if (!element) return
    const measure = () => {
      const { scrollTop, scrollHeight, clientHeight } = element
      // Where the content ends, not the scroller: a part-height sheet's scroller runs on past
      // the window's foot with nothing in it.
      const end = element.firstElementChild?.getBoundingClientRect().bottom ?? 0
      const visibleEnd = element.getBoundingClientRect().bottom - (covered?.get() ?? 0)
      const next = {
        overflows: scrollHeight > clientHeight,
        top: scrollTop > 0,
        bottom: end > visibleEnd + 1,
      }
      setEdges((current) =>
        current.overflows === next.overflows &&
        current.top === next.top &&
        current.bottom === next.bottom
          ? current
          : next,
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    // The content's one wrapper grows with whatever it holds.
    if (element.firstElementChild) observer.observe(element.firstElementChild)
    element.addEventListener('scroll', measure, { passive: true })
    const stop = covered?.on('change', measure)
    return () => {
      observer.disconnect()
      element.removeEventListener('scroll', measure)
      stop?.()
    }
  }, [element, covered])
  return edges
}

/**
 * The height the sheet's column needs to show all of its content: the column less the room its
 * scroller has, plus the room the scroller's content takes. Null until measured.
 */
export function useFittedHeight(column: HTMLElement | null): number | null {
  const [fitted, setFitted] = useState<number | null>(null)
  useLayoutEffect(() => {
    const scroller = column?.querySelector<HTMLElement>('[data-sheet-content]')
    const content = scroller?.firstElementChild
    if (!column || !scroller || !content) return
    const measure = () => {
      const style = getComputedStyle(scroller)
      const padding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom)
      setFitted(
        Math.ceil(
          column.offsetHeight -
            scroller.clientHeight +
            content.getBoundingClientRect().height +
            padding,
        ),
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(content)
    // The chrome around the content changes too: a rotation rewraps the title, and the keyboard
    // pads the column's foot.
    observer.observe(column)
    return () => observer.disconnect()
  }, [column])
  return fitted
}

function subscribeKeyboard(onChange: () => void): () => void {
  const viewport = window.visualViewport
  viewport?.addEventListener('resize', onChange)
  viewport?.addEventListener('scroll', onChange)
  return () => {
    viewport?.removeEventListener('resize', onChange)
    viewport?.removeEventListener('scroll', onChange)
  }
}

/**
 * How far the on-screen keyboard reaches up the window, in px. A browser that overlays the
 * keyboard shrinks only the visual viewport, so the sheet's foot would sit under it. A pinch zoom
 * shrinks it too, and is not a keyboard.
 */
export function useKeyboardInset(): number {
  return useSyncExternalStore(subscribeKeyboard, () => {
    const viewport = window.visualViewport
    if (!viewport || viewport.scale > 1.01) return 0
    return Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop))
  })
}
