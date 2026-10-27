import { useReducedMotionConfig } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  DropIndicator,
  GridList,
  ListLayout,
  useDragAndDrop,
  type Key,
  type Selection,
  Virtualizer,
} from 'react-aria-components'
import { useStampedDensity } from '../platform/density'
import { useListMotion } from './listMotion'
import { useLatest } from './useLatest'
import {
  beginReorderDrag,
  dropIndex,
  moveRowLabel,
  ReorderContext,
  rowsOf,
  type FrameSource,
  type Reorder,
  type ReorderDrag,
  type ReorderItem,
} from './reorder'
import { SwipeGroup, useSwipeGate } from './RowSwipe'

// A type of its own, so a row dropped outside the list carries nothing another app would read.
const ROW_DRAG_TYPE = 'application/x-crosstune-row'
// How far a mouse press moves before it becomes a drag, so a click with a shaky hand stays one.
const DRAG_SLOP_PX = 4
// A row's height before any is measured, which sizes the scrollbar of a virtualized list.
const FIRST_ESTIMATE_PX = 48

const VIRTUAL_FRAME = {
  none: '',
  own: 'max-h-[60dvh] overflow-y-auto',
  // The virtualizer stops pointer events on its rows while anything scrolls, and the page
  // scrolls far more than a list's own box: a tap just after a scroll would do nothing.
  page: '[&>[role=presentation]]:pointer-events-auto!',
}

/**
 * Lays rows out again only when the list's width changes. A page-height list is as tall as its
 * rows, so the stock layout, which also starts over on a height change, would drop every
 * measured row each time one is measured, and the list would never settle. A hidden list, at
 * width 0, keeps its layout, so it shows again with its rows where they were.
 */
class RowLayout<T> extends ListLayout<T> {
  override shouldInvalidate(...[next, previous]: Parameters<ListLayout<T>['shouldInvalidate']>) {
    return next.width !== previous.width && next.width > 0
  }
}

/**
 * The height a virtualized list guesses for a row it has not measured: the mean of the rows it
 * has. A guess off by a few px, over a long list, moves a row a jump such as End lands on out
 * of view once the rows above it are measured.
 */
function useRowEstimate(list: HTMLElement | null, enabled: boolean): number {
  const [estimate, setEstimate] = useState(FIRST_ESTIMATE_PX)
  useEffect(() => {
    if (!list || !enabled) return
    const observer = new ResizeObserver(() => {
      const rows = rowsOf(list)
      if (rows.length === 0) return
      const mean = Math.round(rows.reduce((sum, row) => sum + row.offsetHeight, 0) / rows.length)
      if (mean > 0) setEstimate((current) => (Math.abs(current - mean) >= 1 ? mean : current))
    })
    observer.observe(list)
    return () => observer.disconnect()
  }, [list, enabled])
  return estimate
}

/** The keys whose selection differs between two selections, or null when either is all. */
function changed(before: Selection, after: Selection): Key[] | null {
  if (before === 'all' || after === 'all') return null
  return [...before, ...after].filter((key) => before.has(key) !== after.has(key))
}

/**
 * A list of rows with no separators; selection is a tint on the row, not a divider. At most
 * one of its rows is swiped open at a time, and a swipe or hold never opens or selects a row.
 * A `single` list whose selection follows focus, so the arrows move the selection, takes
 * `selectionBehavior="replace"`. One whose selection follows focus only once a row is open
 * has no selection mode until then and opens a row through `onAction`, with `replace` kept
 * throughout: React Aria adopts a changed behavior a commit late, and a running view transition
 * holds that commit back, so an arrow pressed during one would move focus and select nothing.
 *
 * With `onReorder`, a mouse or pen drag of the whole row runs a live drag on pointer events,
 * a touch long press then a drag runs the same drag through the row's own gesture, and the
 * keyboard drag from each row's move button reorders through React Aria. In a multiple
 * selection list the mouse and keyboard reorder only while nothing is selected: a selection
 * dragged together has no single place to land.
 */
export function RowList({
  label,
  children,
  selectionMode = 'none',
  selectionBehavior,
  disallowEmptySelection,
  selectedKeys,
  onSelectionChange,
  onAction,
  disabledKeys,
  bleed = false,
  onReorder,
  moveLabel = (item) => moveRowLabel(item.title),
  frames,
  arriving = false,
  virtualized,
}: {
  label: string
  children: ReactNode
  selectionMode?: 'none' | 'single' | 'multiple'
  selectionBehavior?: 'toggle' | 'replace'
  disallowEmptySelection?: boolean
  selectedKeys?: Selection
  onSelectionChange?: (keys: Selection) => void
  onAction?: (key: Key) => void
  /** Rows that show but answer nothing, such as a pick already taken. */
  disabledKeys?: Iterable<Key>
  /**
   * Sets the rows' content on the surrounding text's edge, so only the row highlight reaches
   * into the gutter, as a document page's rows do.
   */
  bleed?: boolean
  /**
   * Moves the row to `toIndex`, counted among the rows with it taken out. In a multiple
   * selection list the mouse and the keyboard drag offer it only while no row is selected; a
   * touch drag always moves one row.
   * Leaving it out pauses reordering. Its first arrival mounts the rows again, which drops
   * focus in the list and closes an open swipe, so pass it from the first render when you can.
   */
  onReorder?: (key: Key, toIndex: number) => void
  /** Names a row's keyboard drag button. */
  moveLabel?: (item: ReorderItem) => string
  /** The frames a drag scrolls the list on while it rests at an edge; Motion's by default. */
  frames?: FrameSource
  /** Fades in, since it took the place of an empty state; see `useHadContent`. */
  arriving?: boolean
  /**
   * Renders only the rows in view, for a list as long as the catalog: `own` in a scroll area of
   * its own capped at 60dvh, `page` at full height in whatever scrolls the page. Rows of a
   * virtualized list are plain items: no reorder, since a drag measures every row.
   */
  virtualized?: 'own' | 'page'
}) {
  const gate = useSwipeGate()
  const list = useRef<HTMLDivElement>(null)
  const onReorderRef = useLatest(onReorder)
  const moveLabelRef = useLatest(moveLabel)
  const reduceMotion = useReducedMotionConfig() ?? false
  const densityRef = useLatest(useStampedDensity())
  const holding = useRef(false)
  // State as well as the ref, since the list mounts again once it can first reorder.
  const [listElement, setListElement] = useState<HTMLDivElement | null>(null)
  useListMotion(listElement, reduceMotion, virtualized !== undefined)
  const estimate = useRowEstimate(listElement, virtualized !== undefined)
  const layoutOptions = useMemo(() => ({ estimatedRowHeight: estimate }), [estimate])
  const listRef = useCallback((element: HTMLDivElement | null) => {
    list.current = element
    setListElement(element)
  }, [])
  const canReorder = onReorder !== undefined
  // React Aria's drag hooks cannot come or go under a mounted GridList, so the list mounts
  // again the first time it can reorder, such as once a list that rendered while loading gets
  // its `onReorder`, and keeps the hooks from then on, idle while `onReorder` is absent.
  const [reorderable, setReorderable] = useState(canReorder)
  if (canReorder && !reorderable) setReorderable(true)
  // Held here when the caller does not, so a refused change never reaches the list.
  const [ownSelection, setOwnSelection] = useState<Selection>(() => new Set())
  const selection = selectedKeys ?? ownSelection
  // A single selection marks the open item, and a drag of it or of any other row moves one row.
  const dragsRows =
    canReorder && (selectionMode === 'single' || (selection !== 'all' && selection.size === 0))
  const dragsRowsRef = useLatest(dragsRows)
  const beginDragRef = useLatest((key: Key, pressY: number): ReorderDrag | null => {
    if (!onReorderRef.current || !list.current) return null
    return beginReorderDrag(
      list.current,
      key,
      pressY,
      (moved, to) => onReorderRef.current?.(moved, to),
      { reduceMotion, frames },
    )
  })

  // Listening on the list from the start, not from the hold: a touch's own listeners cannot
  // be added once its moves are under way, and a passive one could not refuse the scroll.
  useEffect(() => {
    const current = list.current
    if (!canReorder || !current) return
    const onTouchMove = (event: TouchEvent) => {
      if (holding.current) event.preventDefault()
    }
    current.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => current.removeEventListener('touchmove', onTouchMove)
  }, [canReorder])
  // A mouse or pen drag runs the same live drag a touch does, in place of the browser's own drag
  // image and drop line, so the row lifts and the rows around it slide aside.
  useEffect(() => {
    const current = list.current
    if (!canReorder || !current) return
    // Ends the press under way, if any, so no listener outlives the list or a lost release.
    let abort: (() => void) | null = null
    const rowAt = (target: EventTarget | null) =>
      target instanceof Element ? target.closest<HTMLElement>('[role="row"][data-key]') : null
    const onDragStart = (event: DragEvent) => {
      if (!rowAt(event.target)) return
      event.preventDefault()
      // Before React Aria's own drag start on the row, which would begin a native drag.
      event.stopPropagation()
    }
    const onPointerDown = (down: PointerEvent) => {
      if (down.button !== 0 || !down.isPrimary) return
      // A touch, and a pen on a touch layout, drag after a long press through the row's swipe.
      if (
        down.pointerType === 'touch' ||
        (down.pointerType === 'pen' && densityRef.current === 'touch')
      )
        return
      abort?.()
      if (!dragsRowsRef.current || !onReorderRef.current) return
      const row = rowAt(down.target)
      if (!row || !current.contains(row)) return
      if ((down.target as Element).closest('button, a, input, textarea, select')) return
      const key = row.dataset.key as string
      let drag: ReorderDrag | null = null
      const finish = (drop: boolean) => {
        if (drag) {
          drag.end(drop)
          // The press ended away from where it began, or on a row that moved under it; either
          // way it was a drag, not a click on whatever row is there now.
          const swallow = (click: MouseEvent) => {
            click.stopPropagation()
            click.preventDefault()
          }
          window.addEventListener('click', swallow, { capture: true, once: true })
          setTimeout(() => window.removeEventListener('click', swallow, true))
        }
        abort = null
        delete document.documentElement.dataset.rowDrag
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp, true)
        window.removeEventListener('pointercancel', onCancel)
        window.removeEventListener('keydown', onKey, true)
        window.removeEventListener('blur', onBlur)
      }
      const onMove = (move: PointerEvent) => {
        if (move.pointerId !== down.pointerId) return
        if (!drag) {
          if (Math.hypot(move.clientX - down.clientX, move.clientY - down.clientY) < DRAG_SLOP_PX)
            return
          drag = beginDragRef.current(key, down.clientY)
          if (!drag) return finish(false)
          // React Aria pressed the row on the way down; a cancel keeps the drop from selecting
          // or opening it.
          row.dispatchEvent(
            new PointerEvent('pointercancel', {
              pointerId: down.pointerId,
              pointerType: down.pointerType,
              bubbles: true,
            }),
          )
          document.documentElement.dataset.rowDrag = ''
        }
        drag.move(move.clientY)
      }
      const onUp = (up: PointerEvent) => {
        if (up.pointerId === down.pointerId) finish(true)
      }
      const onCancel = (cancel: PointerEvent) => {
        if (cancel.pointerId === down.pointerId && cancel.isTrusted) finish(false)
      }
      const onKey = (key: KeyboardEvent) => {
        if (!drag || key.key !== 'Escape') return
        key.preventDefault()
        key.stopPropagation()
        finish(false)
      }
      const onBlur = () => finish(false)
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp, true)
      window.addEventListener('pointercancel', onCancel)
      window.addEventListener('keydown', onKey, true)
      window.addEventListener('blur', onBlur)
      abort = onBlur
    }
    current.addEventListener('dragstart', onDragStart, true)
    current.addEventListener('pointerdown', onPointerDown)
    return () => {
      current.removeEventListener('dragstart', onDragStart, true)
      current.removeEventListener('pointerdown', onPointerDown)
      abort?.()
    }
  }, [canReorder, dragsRowsRef, onReorderRef, beginDragRef, densityRef])
  const { dragAndDropHooks } = useDragAndDrop(
    useMemo(
      () => ({
        isDisabled: !dragsRows,
        getItems: (keys: Set<Key>) => [...keys].map((key) => ({ [ROW_DRAG_TYPE]: String(key) })),
        onReorder: ({ keys, target }) => {
          // One row moves at a time; a selection dragged together has no single place to go.
          if (keys.size !== 1 || !list.current || target.dropPosition === 'on') return
          const [key] = [...keys] as [Key]
          const order = rowsOf(list.current).map((row) => row.dataset.key)
          const from = order.indexOf(String(key))
          const at = order.indexOf(String(target.key))
          if (from < 0 || at < 0) return
          const to = dropIndex(from, at, target.dropPosition)
          if (to !== from) onReorderRef.current?.(key, to)
        },
        renderDropIndicator: (target) => (
          <DropIndicator
            target={target}
            className="data-[drop-target]:bg-accent -my-px h-0.5 rounded-full"
          />
        ),
      }),
      [onReorderRef, dragsRows],
    ),
  )
  const reorder = useMemo<Reorder>(
    () => ({
      moveLabel: (item) => moveLabelRef.current(item),
      hold: (active) => {
        holding.current = active && onReorderRef.current !== undefined
      },
      begin: (key, pressY) => beginDragRef.current(key, pressY),
    }),
    [moveLabelRef, onReorderRef, beginDragRef],
  )
  const grid = (
    <GridList
      key={reorderable ? 'reorderable' : 'fixed'}
      ref={listRef}
      aria-label={label}
      // A letter belongs to the app's shortcuts, and `/` searches.
      disallowTypeAhead
      dragAndDropHooks={reorderable ? dragAndDropHooks : undefined}
      selectionMode={selectionMode}
      selectionBehavior={selectionBehavior}
      disallowEmptySelection={disallowEmptySelection}
      selectedKeys={selection}
      disabledKeys={disabledKeys}
      onSelectionChange={(keys) => {
        if (changed(selection, keys)?.some(gate.blocks)) return
        setOwnSelection(keys)
        onSelectionChange?.(keys)
      }}
      onAction={
        onAction &&
        ((key) => {
          if (!gate.blocks(key)) onAction(key)
        })
      }
      // Positioned and isolated, so a removed row's last frame is placed within the list and
      // fades beneath the rows that slide over it.
      className={`relative isolate ${virtualized ? '' : 'flex flex-col'} ${bleed ? '-mx-3' : virtualized === 'page' ? '' : 'px-2'} ${arriving ? 'arrive' : ''} ${VIRTUAL_FRAME[virtualized ?? 'none']}`}
    >
      {children}
    </GridList>
  )
  // The virtualizer sizes its rows to the list's full width, padding included, so a list with
  // no scroll area of its own takes its inset from a wrapper or it would overhang its edge.
  const placed = virtualized === 'page' && !bleed ? <div className="px-2">{grid}</div> : grid
  return (
    <SwipeGroup gate={gate}>
      <ReorderContext value={reorderable ? reorder : null}>
        {virtualized ? (
          <Virtualizer layout={RowLayout} layoutOptions={layoutOptions}>
            {placed}
          </Virtualizer>
        ) : (
          grid
        )}
      </ReorderContext>
    </SwipeGroup>
  )
}
