import { useReducedMotionConfig } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  DropIndicator,
  GridList,
  useDragAndDrop,
  type Key,
  type Selection,
} from 'react-aria-components'
import { useLatest } from './useLatest'
import {
  beginTouchReorder,
  dropIndex,
  moveRowLabel,
  ReorderContext,
  rowsOf,
  type FrameSource,
  type Reorder,
  type ReorderItem,
} from './reorder'
import { SwipeGroup, useSwipeGate } from './RowSwipe'

// A type of its own, so a row dropped outside the list carries nothing another app would read.
const ROW_DRAG_TYPE = 'application/x-crosstune-row'

/** The keys whose selection differs between two selections, or null when either is all. */
function changed(before: Selection, after: Selection): Key[] | null {
  if (before === 'all' || after === 'all') return null
  return [...before, ...after].filter((key) => before.has(key) !== after.has(key))
}

/**
 * A list of rows with no separators; selection is a wash on the row, not a divider. At most
 * one of its rows is swiped open at a time, and a swipe or hold never opens or selects a row.
 * A `single` list whose selection follows focus, so the arrows move the selection, takes
 * `selectionBehavior="replace"`.
 *
 * With `onReorder`, a mouse drag of the whole row or the keyboard drag from each row's move
 * button reorders through React Aria, and a touch long press then a drag reorders through the
 * row's own gesture, since a native touch drag is not proven in every WebView. In a multiple
 * selection list the mouse and keyboard reorder only while nothing is selected: React Aria
 * drags every selected row together, and a group has no single place to land.
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
  /** The frames a touch drag scrolls the list on while it rests at an edge; Motion's by default. */
  frames?: FrameSource
}) {
  const gate = useSwipeGate()
  const list = useRef<HTMLDivElement>(null)
  const onReorderRef = useLatest(onReorder)
  const moveLabelRef = useLatest(moveLabel)
  const reduceMotion = useReducedMotionConfig() ?? false
  const reduceMotionRef = useLatest(reduceMotion)
  const framesRef = useLatest(frames)
  const holding = useRef(false)
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
            className="data-[drop-target]:bg-slate -my-px h-0.5 rounded-full"
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
      begin: (key, pressY) => {
        if (!onReorderRef.current || !list.current) return null
        return beginTouchReorder(
          list.current,
          key,
          pressY,
          (moved, to) => onReorderRef.current?.(moved, to),
          { reduceMotion: reduceMotionRef.current, frames: framesRef.current },
        )
      },
    }),
    [moveLabelRef, onReorderRef, reduceMotionRef, framesRef],
  )
  return (
    <SwipeGroup gate={gate}>
      <ReorderContext value={reorderable ? reorder : null}>
        <GridList
          key={reorderable ? 'reorderable' : 'fixed'}
          ref={list}
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
          className={`flex flex-col ${bleed ? '-mx-3' : 'px-2'}`}
        >
          {children}
        </GridList>
      </ReorderContext>
    </SwipeGroup>
  )
}
