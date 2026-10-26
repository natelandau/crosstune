import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
  type RefObject,
} from 'react'

interface PaneScope {
  scroller: RefObject<HTMLDivElement | null>
  bar: RefObject<HTMLDivElement | null>
  /** Whether the column title has scrolled away; null while the pane has no column title. */
  titleOut: boolean | null
  setTitleOut: (out: boolean | null) => void
}

const PaneContext = createContext<PaneScope | null>(null)

/** The pane the caller sits in, or null outside any. */
// eslint-disable-next-line react-refresh/only-export-components
export function usePane(): PaneScope | null {
  return useContext(PaneContext)
}

/**
 * One pane's own scroll container. Its pane bar and column title share it: the title reports
 * when it has scrolled away, and the bar shows the title small from then on.
 */
export function PaneScroller({
  children,
  scrollerRef,
  className = '',
  ...rest
}: HTMLAttributes<HTMLDivElement> & {
  children: ReactNode
  scrollerRef?: RefObject<HTMLDivElement | null>
}) {
  const own = useRef<HTMLDivElement>(null)
  const scroller = scrollerRef ?? own
  const bar = useRef<HTMLDivElement>(null)
  const [titleOut, setTitleOut] = useState<boolean | null>(null)
  const scope = useMemo(() => ({ scroller, bar, titleOut, setTitleOut }), [scroller, titleOut])
  return (
    <PaneContext value={scope}>
      {/* Relative, so an absolute box inside, such as a hidden announcer, is clipped and
          scrolled by the pane instead of stretching the window. */}
      {/* Scroll padding keeps a control that takes focus clear of the pinned bar above and the
          floating phone chrome below. */}
      <div
        ref={scroller}
        data-pane-scroller
        className={`relative scroll-pt-(--pane-bar-clearance) scroll-pb-(--float-clearance) ${className}`}
        {...rest}
      >
        {children}
      </div>
    </PaneContext>
  )
}

/**
 * Holds the pane's top scroll padding at the height `bar` covers while pinned, so a control
 * that takes focus never scrolls under the bar.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function usePinnedBarClearance(
  bar: RefObject<HTMLElement | null> | undefined,
  active = true,
) {
  useLayoutEffect(() => {
    const element = bar?.current
    const scroller = element?.closest<HTMLElement>('[data-pane-scroller]')
    if (!active || !element || !scroller) return
    const measure = () => {
      // A bar pinned with a negative top hides that much of itself above the pane.
      const top = Math.min(0, parseFloat(getComputedStyle(element).top) || 0)
      scroller.style.setProperty('--pane-bar-clearance', `${element.offsetHeight + top}px`)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => {
      observer.disconnect()
      scroller.style.removeProperty('--pane-bar-clearance')
    }
  }, [bar, active])
}
