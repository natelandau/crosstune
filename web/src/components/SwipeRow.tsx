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
  ACTION_WIDTH,
  guardTrailingClick,
  releaseVelocity,
  resist,
  revealWidthFor,
  settleOpen,
  type SwipeAction,
  type SwipeActions,
  type SwipeRowState,
  type SwipeSample,
} from './swipe'
import { usePointerIsFine } from './useMediaQuery'

export type { SwipeAction, SwipeActions }

const TONE_CLASSES: Record<SwipeAction['tone'], string> = {
  neutral: 'bg-neutral text-neutral-content',
  warning: 'bg-warning text-warning-content',
  error: 'bg-error text-error-content',
}

// With a mouse the actions sit in the row as plain buttons, so tone tints only the glyph.
const INLINE_TONE_CLASSES: Record<SwipeAction['tone'], string> = {
  neutral: '',
  warning: 'text-warning',
  error: 'text-error',
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
  actions: SwipeActions
  /** Turns the swipe off and rests the row closed, as while selecting songs. */
  disabled?: boolean
  children: ReactNode
}

/**
 * A row whose actions hide behind a leftward swipe on a touch screen. With a mouse there is no
 * hint that a row swipes, so the same actions sit visibly at its trailing edge instead.
 */
export function SwipeRow(props: Props) {
  const pointerFine = usePointerIsFine()
  return pointerFine ? <InlineActionsRow {...props} /> : <SwipeActionsRow {...props} />
}

function InlineActionsRow({ name, actions, disabled = false, children }: Props) {
  return (
    <div className="rounded-box bg-base-200 flex items-center">
      <div className="min-w-0 flex-1">{children}</div>
      {disabled ? null : (
        <div className="flex shrink-0 items-center gap-1 pr-2">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              aria-label={`${action.label} ${name}`}
              title={action.label}
              className={`btn btn-ghost btn-square min-h-11 min-w-11 ${INLINE_TONE_CLASSES[action.tone]}`}
              onClick={action.onPress}
            >
              {action.icon}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Each row owns its context: inside a sortable list the nearest context must be the swipe's, not the list's.
function SwipeActionsRow({
  name,
  actions,
  open,
  otherOpen,
  disabled = false,
  onOpenChange,
  onSwipeStart,
  closeOpenRow,
  children,
}: Props) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: SWIPE_ACTIVATION }))
  const [dragX, setDragX] = useState<number | null>(null)
  const samples = useRef<SwipeSample[]>([])
  const releaseClick = useRef<(() => void) | null>(null)
  const shownOpen = open && !disabled
  const revealWidth = revealWidthFor(actions)
  const rest = shownOpen ? -revealWidth : 0

  useEffect(() => () => releaseClick.current?.(), [])

  const offset = ({ delta }: DragMoveEvent | DragEndEvent) => resist(rest + delta.x, revealWidth)

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
        const x = offset(event)
        // A pointer at rest fires no moves, so the release itself marks a pause before letting go.
        samples.current.push({ time: performance.now(), x })
        const next = settleOpen({
          x,
          velocityX: releaseVelocity(samples.current),
          revealWidth,
        })
        finish()
        onOpenChange(next)
      }}
      onDragCancel={finish}
    >
      <SwipeLayers
        name={name}
        actions={actions}
        open={shownOpen}
        otherOpen={otherOpen && !disabled}
        disabled={disabled}
        onOpenChange={onOpenChange}
        closeOpenRow={closeOpenRow}
        revealWidth={revealWidth}
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
  disabled,
  onOpenChange,
  closeOpenRow,
  revealWidth,
  x,
  dragging,
  children,
}: Pick<
  Props,
  'name' | 'actions' | 'open' | 'otherOpen' | 'onOpenChange' | 'closeOpenRow' | 'children'
> & {
  revealWidth: number
  x: number
  dragging: boolean
  disabled: boolean
}) {
  const { setNodeRef, listeners } = useDraggable({ id: 'swipe', disabled })
  const revealed = x < 0

  return (
    <div className="rounded-box bg-base-200 relative overflow-hidden">
      <div
        className={`absolute inset-y-0 right-0 flex motion-safe:transition-opacity motion-safe:duration-0 ${
          // Hidden only once the closing slide has finished, so the buttons never vanish mid-slide.
          revealed ? '' : 'motion-safe:delay-200'
        }`}
        // The front layer's antialiased rounded edge lets colored buttons behind it show through.
        style={{ width: revealWidth, opacity: revealed ? 1 : 0 }}
        inert={!open}
      >
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            aria-label={`${action.label} ${name}`}
            className={`flex items-center justify-center ${TONE_CLASSES[action.tone]}`}
            style={{ width: ACTION_WIDTH }}
            onClick={() => {
              onOpenChange(false)
              action.onPress()
            }}
          >
            {action.icon}
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
