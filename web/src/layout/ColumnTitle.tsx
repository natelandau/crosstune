import { useEffect, useLayoutEffect, useRef, type ReactNode, type Ref, type RefObject } from 'react'
import { usePane } from './pane'
import { ScreenSyncBadge } from './SyncBadge'

/**
 * A column's title as the first line of its content, in the screen title role. It scrolls with
 * the content, and tells the pane bar once it has gone under the bar, so the bar takes over.
 * `menu` stands in for the plain title where the title is a control, such as the phone's
 * status scope; `trailing` sits beside it. The phone's sync badge follows, unless
 * `syncBadge` is false. `titleRef` reaches the heading, where focus lands when a control
 * holding it leaves the column.
 */
export function ColumnTitle({
  title,
  menu,
  trailing,
  syncBadge = true,
  titleRef,
}: {
  title: string
  menu?: ReactNode
  trailing?: ReactNode
  syncBadge?: boolean
  titleRef?: Ref<HTMLHeadingElement>
}) {
  const line = useRef<HTMLDivElement>(null)
  usePaneTitleLine(line)

  return (
    <div ref={line} data-column-title className="flex min-h-11 items-center gap-3 px-4 pb-2">
      <h1 ref={titleRef} className="t-screen-title min-w-0 truncate">
        {menu ?? title}
      </h1>
      {(trailing || syncBadge) && (
        <div className="flex shrink-0 items-center gap-2">
          {trailing}
          {syncBadge && <ScreenSyncBadge />}
        </div>
      )}
    </div>
  )
}

/**
 * Makes `line` the pane's title line: the pane bar hides its own small title while the line
 * shows, and shows it once the line has scrolled under the bar. Only an `active` line claims
 * the bar, so a page held off screen leaves it to the one on screen.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function usePaneTitleLine(line: RefObject<HTMLElement | null>, active = true) {
  const pane = usePane()
  const scroller = pane?.scroller
  const bar = pane?.bar
  const setTitleOut = active ? pane?.setTitleOut : undefined

  // Claims the title before paint, so the bar never flashes it while this line shows it.
  useLayoutEffect(() => {
    if (!setTitleOut) return
    setTitleOut(false)
    return () => setTitleOut(null)
  }, [setTitleOut])

  useEffect(() => {
    const target = line.current
    const root = scroller?.current
    if (!target || !root || !setTitleOut) return
    // The bar sticks over the top of the scroll, so the title is gone once it passes under it.
    const barHeight = bar?.current?.offsetHeight ?? 0
    const observer = new IntersectionObserver(
      ([entry]) => setTitleOut(entry ? !entry.isIntersecting : false),
      { root, rootMargin: `-${barHeight}px 0px 0px 0px` },
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [line, scroller, bar, setTitleOut])
}
