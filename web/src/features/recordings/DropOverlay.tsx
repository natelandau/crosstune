import { useLayoutEffect, useRef } from 'react'
import { usePane } from '../../app/pane'

export const DROP_TO_IMPORT = 'Drop to import'

/**
 * What a column shows while files are dragged over it: an inset slate outline and "Drop to
 * import" over the column's visible part. It sticks under the pane bar, so it never covers it,
 * and takes no pointer events, so the drag still lands on the column beneath.
 */
export function DropOverlay({ shown }: { shown: boolean }) {
  const pane = usePane()
  const anchor = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLDivElement>(null)

  // Sized from the pane before paint, and again as the pane resizes during the drag; the
  // column's visible height is not known to CSS here.
  useLayoutEffect(() => {
    if (!shown) return
    const scroller = pane?.scroller.current
    const barElement = pane?.bar.current
    const measure = () => {
      if (!anchor.current || !box.current) return
      const bar = barElement?.offsetHeight ?? 0
      const visible = scroller?.clientHeight ?? 0
      anchor.current.style.top = `${bar}px`
      box.current.style.height = `${Math.max(0, visible - bar - 16)}px`
    }
    measure()
    const observer = new ResizeObserver(measure)
    if (scroller) observer.observe(scroller)
    if (barElement) observer.observe(barElement)
    return () => observer.disconnect()
  }, [shown, pane])

  if (!shown) return null
  return (
    <div ref={anchor} data-drop-overlay className="pointer-events-none sticky z-20 h-0">
      <div
        ref={box}
        className="border-slate bg-wash absolute inset-x-2 top-2 flex items-center justify-center rounded-(--radius-surface) border-2"
      >
        <p className="t-heading text-slate">{DROP_TO_IMPORT}</p>
      </div>
    </div>
  )
}
