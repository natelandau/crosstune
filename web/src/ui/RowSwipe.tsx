import {
  animate,
  motion,
  useDragControls,
  useMotionValue,
  useReducedMotionConfig,
  useTransform,
  type PanInfo,
} from 'motion/react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
// React Aria exports the modality getter only from this path.
import { getInteractionModality } from 'react-aria/private/interactions/useFocusVisible'
import { Button as AriaButton, type Key } from 'react-aria-components'
import { tap } from '../platform/haptics'
import { useLatest } from './useLatest'
import { SPRING } from '../theme/motion'
import { ReorderContext, type TouchReorder } from './reorder'
import type { RowAction } from './Row'

/** The width of each swipe action; every action takes the same. */
export const SWIPE_ACTION_WIDTH = 80

// The menu waits for a still release after the hold, so movement after it can become a
// reorder drag.
export const LONG_PRESS_MS = 500
/** A press that moves this far or less, in px, is still held still. */
export const LONG_PRESS_SLOP_PX = 10
// px/s; a flick this fast settles the row by its direction, wherever the finger lifts.
const FLING_VELOCITY = 500

const FILL: Record<NonNullable<RowAction['tone']>, string> = {
  neutral: 'bg-fill text-ink',
  warning: 'bg-warning text-on-slate',
  danger: 'bg-danger text-on-slate',
}

/**
 * Marks the rows whose last touch gesture was a swipe, a hold, or a tap that closed the row, so
 * the list can refuse the press React Aria still reports for it. A mark ends with the next press
 * on its row outside its actions or any key, the frame after it refuses a press, or its row
 * leaving the page, so only the gesture's own report is refused. A press elsewhere leaves it,
 * since React Aria reports a touch's press a beat after the lift, and the next touch can land
 * first.
 */
export interface SwipeGate {
  mark: (key: Key, row: Element) => void
  unmark: (key: Key) => void
  blocks: (key: Key) => boolean
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSwipeGate(): SwipeGate {
  const [marked] = useState(() => new Map<Key, Element>())
  const frame = useRef(0)
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element
      // A press on one of the row's own actions is the action's, and the row's report of the
      // gesture before it can still arrive after it.
      const onAction = target.closest?.('[data-swipe-actions]') != null
      for (const [key, row] of marked) {
        if (!row.isConnected || (row.contains(target) && !onAction)) marked.delete(key)
      }
    }
    const clear = () => marked.clear()
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', clear, true)
    return () => {
      cancelAnimationFrame(frame.current)
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', clear, true)
    }
  }, [marked])
  return useMemo(
    () => ({
      mark: (key, row) => void marked.set(key, row),
      unmark: (key) => void marked.delete(key),
      blocks: (key) => {
        const row = marked.get(key)
        if (!row) return false
        // A row that has left the page will never report its gesture's press.
        if (!row.isConnected) {
          marked.delete(key)
          return false
        }
        // Wait a frame so every callback of the one refused press still sees the mark.
        cancelAnimationFrame(frame.current)
        frame.current = requestAnimationFrame(() => marked.clear())
        return true
      },
    }),
    [marked],
  )
}

interface SwipeGroupValue {
  openKey: Key | null
  setOpenKey: (update: (open: Key | null) => Key | null) => void
  gate?: SwipeGate
}

const SwipeGroupContext = createContext<SwipeGroupValue | null>(null)

/** Keeps at most one row open among the swipe rows inside it, and marks rows on `gate`. */
export function SwipeGroup({ gate, children }: { gate?: SwipeGate; children: ReactNode }) {
  const [openKey, setOpenKey] = useState<Key | null>(null)
  const value = useMemo(() => ({ openKey, setOpenKey, gate }), [openKey, gate])
  return <SwipeGroupContext value={value}>{children}</SwipeGroupContext>
}

function useOpenState(rowKey: Key): [boolean, (open: boolean) => void] {
  const group = useContext(SwipeGroupContext)
  const [ownOpen, setOwnOpen] = useState(false)
  const groupSet = group?.setOpenKey
  const setOpen = useCallback(
    (open: boolean) => {
      if (!groupSet) setOwnOpen(open)
      else groupSet((current) => (open ? rowKey : current === rowKey ? null : current))
    },
    [groupSet, rowKey],
  )
  return [group ? group.openKey === rowKey : ownOpen, setOpen]
}

interface Gesture {
  pointerId: number
  x: number
  y: number
  timer: ReturnType<typeof setTimeout> | null
  held: boolean
  movedAfterHold: boolean
  /** The reorder drag that movement after the hold began, until the finger lifts. */
  reorder: TouchReorder | null
  locked: boolean
  closing: boolean
}

/**
 * A touch row's content over its actions. A leftward drag reveals the actions; release snaps
 * open past half their width or on a flick, and a full swipe only opens. A press held still
 * for 500ms and released in place calls `onLongPress` at the press point; in a reorderable
 * list, movement after that hold drags the row instead. Keyboard focus on an action opens the
 * row, so the actions stay reachable without the gesture.
 */
export function RowSwipe({
  rowKey,
  actions,
  onLongPress,
  children,
}: {
  rowKey: Key
  actions: RowAction[]
  /** Absent when the row has no menu, so a hold is an ordinary press with no buzz. */
  onLongPress?: (x: number, y: number) => void
  children: ReactNode
}) {
  const [isOpen, setOpen] = useOpenState(rowKey)
  const gate = useContext(SwipeGroupContext)?.gate
  const reorder = useContext(ReorderContext)
  const reorderRef = useLatest(reorder)
  const x = useMotionValue(0)
  const dragControls = useDragControls()
  const reduceMotion = useReducedMotionConfig()
  const root = useRef<HTMLDivElement>(null)
  const gesture = useRef<Gesture | null>(null)
  // The content's offset when the drag began, which Motion measures its offsets from.
  const dragOrigin = useRef(0)
  const lockedAxis = useRef<'x' | 'y' | null>(null)
  const endListeners = useRef<(() => void) | null>(null)
  const onLongPressRef = useLatest(onLongPress)
  const width = actions.length * SWIPE_ACTION_WIDTH
  // The row's rounded clip antialiases the content and the actions under it alike, so a
  // closed row would fringe its corners in the actions' color. Clip the actions to what the
  // content has uncovered; clip-path leaves them focusable.
  const trayClip = useTransform(x, (offset) => `inset(0 0 0 ${Math.max(0, width + offset)}px)`)

  const settle = useCallback(
    (open: boolean) => {
      animate(x, open ? -width : 0, reduceMotion ? { duration: 0 } : SPRING)
      setOpen(open)
    },
    [x, width, reduceMotion, setOpen],
  )

  useEffect(() => {
    animate(x, isOpen ? -width : 0, reduceMotion ? { duration: 0 } : SPRING)
  }, [isOpen, x, width, reduceMotion])

  useEffect(() => {
    if (!isOpen) return
    const close = () => setOpen(false)
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close()
    }
    const onScroll = () => {
      if (!root.current?.contains(document.activeElement)) close()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [isOpen, setOpen])

  const endGesture = useCallback(() => {
    const current = gesture.current
    if (current?.timer) clearTimeout(current.timer)
    current?.reorder?.end(false)
    if (current?.held) reorderRef.current?.hold(false)
    gesture.current = null
    endListeners.current?.()
    endListeners.current = null
  }, [reorderRef])

  useEffect(() => endGesture, [endGesture])
  // A gesture whose press was never reported leaves its mark; a later row under this key must
  // not inherit it.
  useEffect(() => () => gate?.unmark(rowKey), [gate, rowKey])

  const isOpenRef = useLatest(isOpen)
  const settleRef = useLatest(settle)

  const onPointerDown = (event: ReactPointerEvent) => {
    // Pointer frames use hover actions; a mouse drag here belongs to text selection or reorder.
    if (event.pointerType !== 'touch' || !event.isPrimary || event.button !== 0) return
    endGesture()
    const closing = isOpenRef.current
    const current: Gesture = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      timer: null,
      held: false,
      movedAfterHold: false,
      reorder: null,
      locked: false,
      closing,
    }
    if (!closing && (onLongPressRef.current || reorderRef.current)) {
      current.timer = setTimeout(() => {
        current.timer = null
        current.held = true
        // React Aria's own long press, which selects a row that also has an action, lands on
        // this tick too; the hold belongs to the menu and the reorder drag.
        if (root.current) gate?.mark(rowKey, root.current)
        reorderRef.current?.hold(true)
        tap()
        dragControls.cancel()
        settleRef.current(false)
      }, LONG_PRESS_MS)
    }
    gesture.current = current
    dragOrigin.current = x.get()
    lockedAxis.current = null
    dragControls.start(event)

    const ours = (e: PointerEvent) => e.pointerId === current.pointerId && e.isPrimary
    const onMove = (e: PointerEvent) => {
      if (!ours(e)) return
      if (current.reorder) {
        current.reorder.move(e.clientY)
        return
      }
      if (Math.hypot(e.clientX - current.x, e.clientY - current.y) <= LONG_PRESS_SLOP_PX) return
      if (current.held) {
        current.movedAfterHold = true
        current.reorder = reorderRef.current?.begin(rowKey, current.y) ?? null
        current.reorder?.move(e.clientY)
      } else if (current.timer) {
        clearTimeout(current.timer)
        current.timer = null
      }
    }
    // Capture, so the mark is set before React Aria's own release listener sees the lift.
    const onUp = (e: PointerEvent) => {
      if (!ours(e)) return
      if ((current.held || current.locked || current.closing) && root.current) {
        gate?.mark(rowKey, root.current)
      }
      if (current.reorder) {
        current.reorder.end(true)
        current.reorder = null
      } else if (current.held && !current.movedAfterHold) {
        onLongPressRef.current?.(current.x, current.y)
      } else if (current.closing && !current.locked) settleRef.current(false)
      endGesture()
    }
    const onCancel = (e: PointerEvent) => {
      if (ours(e)) endGesture()
    }
    // The row is draggable for the mouse, and a browser may start its own drag from a touch
    // hold too, which this gesture already owns.
    const onDragStart = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('dragstart', onDragStart, true)
    endListeners.current = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('dragstart', onDragStart, true)
    }
  }

  const onDragEnd = (_event: unknown, info: PanInfo) => {
    // The content moves only once Motion locks the drag to x: it starts a drag at 3px, locks
    // past 10px, and checks y first. Any other drag leaves the row as the press decided, though
    // its offset and velocity can still be mostly sideways.
    if (lockedAxis.current !== 'x') {
      settle(isOpenRef.current)
      return
    }
    const velocity = info.velocity.x
    if (velocity < -FLING_VELOCITY) settle(true)
    else if (velocity > FLING_VELOCITY) settle(false)
    // Where the finger let go, not where the content is now: Motion starts its release
    // animation before this runs, so the content may already be on its way elsewhere.
    else settle(dragOrigin.current + info.offset.x < -width / 2)
  }

  return (
    <div
      ref={root}
      data-swipe={isOpen ? 'open' : 'closed'}
      // A browser menu mid-gesture would cut the hold short. Firefox on Android reports a touch
      // hold's menu event as a plain mouse event, so the gesture, not the event, decides.
      onContextMenu={(event) => {
        if (!gesture.current) return
        event.preventDefault()
        event.stopPropagation()
      }}
      className="relative flex min-w-0 flex-1 self-stretch overflow-hidden"
    >
      <motion.div
        data-swipe-actions
        style={{ clipPath: trayClip }}
        className="absolute inset-y-0 right-0 flex"
        // Focus from the keyboard or assistive technology opens the row, so the focused action
        // is in view. React Aria's input modality, which every engine reports alike, is set by
        // its capture listener before this runs. Focus handed back after a tap leaves the row
        // as the tap left it, until a key is pressed there; capture, since an action's press
        // handling stops Enter and Space. Tab and Escape leave the row, so they open nothing.
        onFocus={() => {
          const modality = getInteractionModality()
          if (modality === 'keyboard' || modality === 'virtual') setOpen(true)
        }}
        onKeyDownCapture={(event) => {
          if (event.key !== 'Tab' && event.key !== 'Escape') setOpen(true)
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
        }}
      >
        {actions.map(({ id, label, shortLabel, icon: Icon, tone = 'neutral', onAction }) => (
          <AriaButton
            key={id}
            aria-label={label}
            onPress={(event) => {
              onAction()
              // A keyboard or screen reader press leaves focus here, so the row stays open to
              // keep the focused action in view.
              if (event.pointerType !== 'keyboard' && event.pointerType !== 'virtual') {
                settle(false)
              }
            }}
            style={{ width: SWIPE_ACTION_WIDTH }}
            className={`flex h-full flex-col items-center justify-center gap-0.5 px-1 focus-visible:-outline-offset-4! focus-visible:outline-current! ${FILL[tone]}`}
          >
            <Icon className="size-5 shrink-0" aria-hidden />
            <span className="t-caption max-w-full truncate">{shortLabel ?? label}</span>
          </AriaButton>
        ))}
      </motion.div>
      <motion.div
        drag="x"
        dragControls={dragControls}
        dragListener={false}
        dragDirectionLock
        onDirectionLock={(axis) => {
          lockedAxis.current = axis
          if (gesture.current) gesture.current.locked = true
        }}
        dragConstraints={{ left: -width * 1.5, right: 0 }}
        dragElastic={0.1}
        dragMomentum={false}
        onDragEnd={onDragEnd}
        onPointerDown={onPointerDown}
        style={{ x, touchAction: 'pan-y' }}
        className="bg-ground relative flex min-w-0 flex-1 items-center gap-3 px-3 py-1.5 select-none [-webkit-touch-callout:none] group-data-[playing]:bg-[linear-gradient(var(--play-wash),var(--play-wash))] group-data-[selected]:bg-[linear-gradient(var(--wash),var(--wash))]"
      >
        {children}
      </motion.div>
    </div>
  )
}
