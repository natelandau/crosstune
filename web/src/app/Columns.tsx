import {
  createContext,
  useCallback,
  Suspense,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { useStampedDensity } from '../platform/density'
import { useFrame } from '../platform/frame'
import { useLocation } from 'react-router'
import { NowPlayingSlot } from './NowPlayingSlot'
import { PaneScroller } from './pane'

export const COLUMN_WIDTH = 'Column width'

export const COLUMN_MIN = 280
export const COLUMN_MAX = 480
export const COLUMN_DEFAULT = 340
const STEP = 16
const WIDTH_KEY = 'crosstune.columnWidth'

const clamp = (width: number) => Math.min(COLUMN_MAX, Math.max(COLUMN_MIN, Math.round(width)))

function readWidth(): number {
  try {
    const stored = Number(localStorage.getItem(WIDTH_KEY))
    return stored > 0 ? clamp(stored) : COLUMN_DEFAULT
  } catch {
    return COLUMN_DEFAULT
  }
}

function writeWidth(width: number) {
  try {
    localStorage.setItem(WIDTH_KEY, String(width))
  } catch {
    // Storage can be blocked; the width still holds for this page load.
  }
}

/** The content column sits at the inline start, so in a right-to-left page the arrows flip. */
const inlineSign = (element: Element) => (getComputedStyle(element).direction === 'rtl' ? -1 : 1)

/**
 * The wide frame's content column and its detail column. Wide shows both, with `detail ?? empty`
 * filling the detail column. Phone and split show one pane: `detail` while it is present, else
 * `list`. The list stays mounted while hidden, so its scroll, selection, and focus survive a
 * push and every frame change.
 *
 * The columns own the landmarks: the detail is the page's one main, named `detailLabel`, and
 * the list is a region named `listLabel`, or the main itself while it is the only pane.
 */
export function Columns({
  list,
  detail,
  empty,
  listLabel,
  detailLabel,
}: {
  list: ReactNode
  detail: ReactNode | null
  empty: ReactNode
  listLabel: string
  detailLabel: string
}) {
  const frame = useFrame()
  const wide = frame === 'wide'
  const listShown = wide || detail == null
  const detailShown = wide || detail != null
  const detailAlone = !wide && detail != null
  const { pathname } = useLocation()
  const [width, setWidth] = useState(readWidth)
  const listId = useId()
  const listRef = useRef<HTMLDivElement>(null)
  const detailRef = useRef<HTMLDivElement>(null)
  const detailColumnRef = useRef<HTMLDivElement>(null)
  const pageRef = useRef<HTMLElement>(null)
  const lastFocus = useRef<HTMLElement | null>(null)

  // Chromium and WebKit keep a hidden scroller's offset, so only focus needs putting back,
  // when the pane that held it has gone.
  useLayoutEffect(() => {
    const scroller = listRef.current
    if (!listShown || !scroller) return
    const focused = lastFocus.current
    const stranded =
      focusLost() || (!wide && detailColumnRef.current?.contains(document.activeElement))
    if (stranded && focused?.isConnected && scroller.contains(focused)) {
      focused.focus({ preventScroll: true })
    }
  }, [listShown, wide])

  // A pushed page hides the list, and focus would fall to the body with it; it lands on the
  // page instead, at its title when it has one.
  useLayoutEffect(() => {
    const page = pageRef.current
    if (!detailAlone || !page) return
    const active = document.activeElement
    if (!focusLost() && !listRef.current?.contains(active)) return
    const title = page.querySelector('h1')
    const target = title ?? page
    if (!target.hasAttribute('tabindex')) target.tabIndex = -1
    // Marked as the pane's hand-off, so focus.css draws it no ring.
    target.setAttribute('data-pane-focus', '')
    target.focus({ preventScroll: true })
  }, [detailAlone])

  // Another page in the detail starts at its top. A page that holds the one before it while
  // the next reads names the page it shows, so the scroll resets only when that one changes.
  const shownPage = useRef<string | null>(null)
  // Called from the page's own layout effect, so the reset lands in the commit that shows the
  // page, before a view transition captures it.
  const showPage = useCallback((page: string | null) => {
    if (page !== null && page !== shownPage.current && detailRef.current) {
      detailRef.current.scrollTop = 0
    }
    shownPage.current = page
  }, [])
  useLayoutEffect(() => {
    if (shownPage.current === null && detailRef.current) detailRef.current.scrollTop = 0
  }, [pathname])

  return (
    <div data-columns className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1">
        <PaneScroller
          scrollerRef={listRef}
          id={listId}
          data-column="list"
          hidden={!listShown}
          inert={!listShown}
          style={wide ? { width } : undefined}
          className={`min-h-0 overflow-y-auto ${wide ? 'shrink-0' : 'min-w-0 flex-1'}`}
          onFocus={(event) => {
            lastFocus.current = event.target
          }}
        >
          {/* The role changes in place, so the list keeps its state when a page pushes. */}
          <section role={detailShown ? undefined : 'main'} aria-label={listLabel}>
            {list}
          </section>
        </PaneScroller>
        {wide && (
          <ColumnSeparator
            width={width}
            controls={listId}
            onResize={setWidth}
            onSettle={(next) => {
              setWidth(next)
              writeWidth(next)
            }}
          />
        )}
        <div
          ref={detailColumnRef}
          data-column="detail"
          hidden={!detailShown}
          className="flex min-h-0 min-w-0 flex-1 flex-col"
        >
          <PaneScroller scrollerRef={detailRef} className="min-h-0 flex-1 overflow-y-auto">
            <main ref={pageRef} aria-label={detailLabel} data-pane-focus className="min-h-full">
              {/* Already shown when a page opens, so a page that waits to read holds the one
                  before it in place rather than blanking the column. */}
              <DetailPageContext value={showPage}>
                <Suspense fallback={null}>{wide ? (detail ?? empty) : detail}</Suspense>
              </DetailPageContext>
            </main>
          </PaneScroller>
          {wide && <NowPlayingSlot priority={1} />}
        </div>
      </div>
      {frame === 'split' && <NowPlayingSlot priority={1} />}
    </div>
  )
}

const DetailPageContext = createContext<((page: string | null) => void) | null>(null)

/**
 * Names the page the detail column shows, for a page that keeps showing one while the address
 * already names the next, so the column's scroll resets when `page` changes rather than the
 * address.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useDetailPage(page: string) {
  const setPage = useContext(DetailPageContext)
  useLayoutEffect(() => {
    setPage?.(page)
  }, [setPage, page])
  useLayoutEffect(() => () => setPage?.(null), [setPage])
}

const focusLost = () => !document.activeElement || document.activeElement === document.body

/**
 * The handle between the columns. React Aria has no splitter, so this follows the ARIA window
 * splitter pattern: the arrows step, Home and End jump to the bounds, and a drag resizes.
 */
function ColumnSeparator({
  width,
  controls,
  onResize,
  onSettle,
}: {
  width: number
  controls: string
  onResize: (width: number) => void
  onSettle: (width: number) => void
}) {
  // A finger gets a full target centered on the hairline. A pointer's reach stays on the
  // detail side, clear of the list's scrollbar at its trailing edge.
  const density = useStampedDensity()
  const drag = useRef<{ x: number; width: number; sign: number; last: number } | null>(null)

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const sign = inlineSign(event.currentTarget)
    const next = {
      ArrowLeft: width - STEP * sign,
      ArrowRight: width + STEP * sign,
      Home: COLUMN_MIN,
      End: COLUMN_MAX,
    }[event.key]
    if (next === undefined) return
    event.preventDefault()
    onSettle(clamp(next))
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    drag.current = { x: event.clientX, width, sign: inlineSign(event.currentTarget), last: width }
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // A pointer the browser no longer tracks cannot be captured; the drag still follows it.
    }
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current
    if (!start) return
    start.last = clamp(start.width + (event.clientX - start.x) * start.sign)
    onResize(start.last)
  }

  const endDrag = () => {
    const start = drag.current
    if (!start) return
    drag.current = null
    onSettle(start.last)
  }

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={COLUMN_WIDTH}
      aria-orientation="vertical"
      aria-valuenow={width}
      aria-valuemin={COLUMN_MIN}
      aria-valuemax={COLUMN_MAX}
      aria-controls={controls}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className={`bg-hairline relative z-10 w-px shrink-0 cursor-col-resize touch-none before:absolute before:inset-y-0 before:content-[''] ${
        density === 'touch'
          ? 'before:start-[calc(0.5px-var(--target)/2)] before:w-(--target)'
          : 'before:start-0 before:-end-2'
      }`}
    />
  )
}
