import { ChevronLeft } from 'lucide-react'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useLeaveTo } from './backTrail'
import { useFrame } from '../platform/frame'
import { usePane } from './pane'

/**
 * The bar over one pane: a leading control, the pane's title small once its column title has
 * scrolled away, and the pane's verbs trailing. It sticks to the top of the pane's scroll.
 */
export function PaneBar({
  title,
  compactTitle,
  titleAlways = false,
  leading,
  trailing,
}: {
  title?: string
  /** Shown instead of `title` when the sides leave too little room for it. */
  compactTitle?: string
  /** Shows the title whatever the column title does, for a title no column repeats. */
  titleAlways?: boolean
  leading?: ReactNode
  trailing?: ReactNode
}) {
  const pane = usePane()
  const leadingRef = useRef<HTMLDivElement>(null)
  const trailingRef = useRef<HTMLDivElement>(null)
  const fullRef = useRef<HTMLSpanElement>(null)
  const [fits, setFits] = useState(true)
  const compact = compactTitle !== undefined

  // The title's track grows only to its own content, so the room it could have is measured
  // from the bar less both sides at their natural widths.
  useLayoutEffect(() => {
    const lead = leadingRef.current
    const trail = trailingRef.current
    const full = fullRef.current
    const bar = lead?.closest<HTMLElement>('[data-pane-bar]')
    if (!compact || !lead || !trail || !full || !bar) return
    const measure = () => {
      const style = getComputedStyle(bar)
      const room =
        bar.clientWidth -
        parseFloat(style.paddingInlineStart) -
        parseFloat(style.paddingInlineEnd) -
        2 * parseFloat(style.columnGap) -
        lead.offsetWidth -
        trail.offsetWidth
      setFits(full.scrollWidth <= room)
    }
    measure()
    const observer = new ResizeObserver(measure)
    for (const element of [bar, lead, trail]) observer.observe(element)
    return () => observer.disconnect()
  }, [compact, title])

  // Without a column title nothing else shows the title, so the bar carries it.
  const titleShown = titleAlways || pane?.titleOut !== false
  const compacted = compact && !fits
  // Each side keeps at least its controls' width, so a side wider than half the bar pushes the
  // title over and truncates it instead of drawing over it.
  return (
    <div
      ref={pane?.bar}
      data-pane-bar
      className="bg-ground sticky top-0 z-10 grid min-h-11 grid-cols-[minmax(max-content,1fr)_minmax(0,auto)_minmax(max-content,1fr)] items-center gap-2 px-2"
    >
      <div className="flex min-w-0 items-center justify-start">
        <div ref={leadingRef} className="flex items-center">
          {leading}
        </div>
      </div>
      {title ? (
        <span
          data-pane-title
          aria-hidden={titleShown ? undefined : true}
          className={`t-heading truncate transition-opacity duration-(--dur-short) ease-(--ease) ${titleShown ? 'opacity-100' : 'opacity-0'}`}
        >
          {compacted ? (
            // The short form is for the eye; a reader still hears the whole title.
            <>
              <span aria-hidden>{compactTitle}</span>
              <span className="sr-only">{title}</span>
            </>
          ) : (
            title
          )}
        </span>
      ) : (
        <span />
      )}
      <div className="flex min-w-0 items-center justify-end">
        <div ref={trailingRef} className="flex items-center gap-1">
          {trailing}
        </div>
      </div>
      {compact && title && (
        // Zero wide so it never widens the pane; its scroll width is the title's natural width.
        // The words are drawn from an attribute so no second copy of the title is in the text.
        <span
          ref={fullRef}
          aria-hidden
          data-title={title}
          className="t-heading invisible absolute start-0 top-0 w-0 overflow-hidden whitespace-nowrap after:content-[attr(data-title)]"
        />
      )}
    </div>
  )
}

/**
 * Back to a pushed page's parent on phone and split, named for the parent. It walks history
 * when the entry behind is the parent, so Back stays Back; after a deep link or a refresh
 * nothing is behind, and it replaces the page with its parent instead. Wide shows the parent
 * beside the page, so there it renders nothing.
 */
export function BackLink({ to, label }: { to: string; label: string }) {
  const frame = useFrame()
  const leave = useLeaveTo()
  if (frame === 'wide') return null
  return (
    <Link
      to={to}
      className="t-body text-slate flex min-h-(--target-control) items-center gap-1 pe-2"
      onClick={(event) => {
        if (event.defaultPrevented || event.button !== 0) return
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        leave(to)
      }}
    >
      <ChevronLeft className="size-6 shrink-0" aria-hidden />
      {label}
    </Link>
  )
}
