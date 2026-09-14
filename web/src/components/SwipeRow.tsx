import {
  DndContext,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragMoveEvent,
  type ScreenReaderInstructions,
} from '@dnd-kit/core'
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import {
  guardTrailingClick,
  releaseVelocity,
  resist,
  REVEAL_WIDTH,
  settleOpen,
  type SwipeRowState,
  type SwipeSample,
} from './swipe'

export interface SwipeAction {
  label: string
  tone: 'neutral' | 'warning' | 'error'
  onPress: () => void
}

const TONE_CLASSES: Record<SwipeAction['tone'], string> = {
  neutral: 'bg-neutral text-neutral-content',
  warning: 'bg-warning text-warning-content',
  error: 'bg-error text-error-content',
}

// Moving sideways first starts a swipe; moving vertically first leaves the gesture to page scroll.
const SWIPE_ACTIVATION = { distance: { x: 10 }, tolerance: { y: 10 } }

// A swipe is not a drag and drop, so nothing about it is announced.
const SILENT: Announcements = {
  onDragStart: () => undefined,
  onDragOver: () => undefined,
  onDragEnd: () => undefined,
  onDragCancel: () => undefined,
}
const NO_INSTRUCTIONS: ScreenReaderInstructions = { draggable: '' }

type Props = SwipeRowState & {
  name: string
  actions: readonly [SwipeAction, SwipeAction]
  children: ReactNode
}

// Each row owns its context: inside a sortable list the nearest context must be the swipe's, not the list's.
export function SwipeRow({
  name,
  actions,
  open,
  otherOpen,
  onOpenChange,
  onSwipeStart,
  closeOpenRow,
  children,
}: Props) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: SWIPE_ACTIVATION }))
  const [dragX, setDragX] = useState<number | null>(null)
  const samples = useRef<SwipeSample[]>([])
  const releaseClick = useRef<(() => void) | null>(null)
  const rest = open ? -REVEAL_WIDTH : 0

  useEffect(() => () => releaseClick.current?.(), [])

  const offset = ({ delta }: DragMoveEvent | DragEndEvent) => resist(rest + delta.x, REVEAL_WIDTH)

  const finish = () => {
    setDragX(null)
    releaseClick.current?.()
    releaseClick.current = null
  }

  return (
    <DndContext
      sensors={sensors}
      autoScroll={false}
      accessibility={{ announcements: SILENT, screenReaderInstructions: NO_INSTRUCTIONS }}
      onDragStart={() => {
        samples.current = []
        releaseClick.current = guardTrailingClick()
        onSwipeStart()
      }}
      onDragMove={(event) => {
        const x = offset(event)
        samples.current.push({ time: performance.now(), x })
        setDragX(x)
      }}
      onDragEnd={(event) => {
        const next = settleOpen({
          x: offset(event),
          velocityX: releaseVelocity(samples.current),
          revealWidth: REVEAL_WIDTH,
        })
        finish()
        onOpenChange(next)
      }}
      onDragCancel={finish}
    >
      <SwipeLayers
        name={name}
        actions={actions}
        open={open}
        otherOpen={otherOpen}
        onOpenChange={onOpenChange}
        closeOpenRow={closeOpenRow}
        x={dragX ?? rest}
        dragging={dragX !== null}
      >
        {children}
      </SwipeLayers>
    </DndContext>
  )
}

function SwipeLayers({
  name,
  actions,
  open,
  otherOpen,
  onOpenChange,
  closeOpenRow,
  x,
  dragging,
  children,
}: Pick<
  Props,
  'name' | 'actions' | 'open' | 'otherOpen' | 'onOpenChange' | 'closeOpenRow' | 'children'
> & {
  x: number
  dragging: boolean
}) {
  const { setNodeRef, listeners } = useDraggable({ id: 'swipe' })
  const revealed = x < 0

  return (
    <div className="rounded-box bg-base-200 relative overflow-hidden">
      <div
        className={`absolute inset-y-0 right-0 flex motion-safe:transition-opacity motion-safe:duration-0 ${
          // Hidden only once the closing slide has finished, so the buttons never vanish mid-slide.
          revealed ? '' : 'motion-safe:delay-200'
        }`}
        // The front layer's antialiased rounded edge lets colored buttons behind it show through.
        style={{ width: REVEAL_WIDTH, opacity: revealed ? 1 : 0 }}
        inert={!open}
      >
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            aria-label={`${action.label} ${name}`}
            className={`flex-1 text-sm font-semibold ${TONE_CLASSES[action.tone]}`}
            onClick={() => {
              onOpenChange(false)
              action.onPress()
            }}
          >
            {action.label}
          </button>
        ))}
      </div>
      {/* The draggable's attributes are left off so the row does not become a focusable button. */}
      <div
        ref={setNodeRef}
        {...listeners}
        className={`bg-base-200 relative ${
          dragging
            ? ''
            : 'motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out'
        }`}
        style={{ transform: `translateX(${x}px)`, touchAction: 'pan-y' }}
        onClickCapture={(event: MouseEvent) => {
          if (!open && !otherOpen) return
          // While any row is open, a tap on a row only closes it, as on iOS, rather than also following the link.
          event.preventDefault()
          event.stopPropagation()
          closeOpenRow()
        }}
      >
        {children}
      </div>
    </div>
  )
}
