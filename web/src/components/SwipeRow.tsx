import {
  animate,
  domMax,
  LazyMotion,
  useMotionValue,
  useReducedMotion,
  type MotionValue,
  type PanInfo,
} from 'motion/react'
import * as m from 'motion/react-m'
import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react'
import { REVEAL_WIDTH, settleOpen, type SwipeRowState } from './swipe'

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

function snap(x: MotionValue<number>, open: boolean, reduced: boolean | null) {
  const target = open ? -REVEAL_WIDTH : 0
  if (x.get() === target) return
  animate(x, target, reduced ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 40 })
}

export function SwipeRow({
  name,
  actions,
  open,
  onOpenChange,
  onSwipeStart,
  children,
}: SwipeRowState & {
  name: string
  actions: readonly [SwipeAction, SwipeAction]
  children: ReactNode
}) {
  const x = useMotionValue(0)
  const reduced = useReducedMotion()
  const swiped = useRef(false)
  const openRef = useRef(open)
  const dragStarted = useRef(false)
  const releaseListeners = useRef<(() => void) | null>(null)

  useEffect(() => {
    openRef.current = open
    snap(x, open, reduced)
  }, [x, open, reduced])

  useEffect(() => () => releaseListeners.current?.(), [])

  return (
    <LazyMotion features={domMax} strict>
      <div className="rounded-box bg-base-200 relative overflow-hidden">
        <div
          className="absolute inset-y-0 right-0 flex"
          style={{ width: REVEAL_WIDTH }}
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
        <m.div
          className="bg-base-200 relative"
          drag="x"
          dragConstraints={{ left: -REVEAL_WIDTH, right: 0 }}
          dragElastic={0.1}
          dragMomentum={false}
          dragDirectionLock
          style={{ x }}
          onPointerDownCapture={(event) => {
            // A second finger must not reset the gesture the first one is still driving.
            if (!event.isPrimary) return
            swiped.current = false
            dragStarted.current = false
            releaseListeners.current?.()
            // Motion stops any running snap on pointer down but, below its 3px drag
            // threshold, never starts a session and so never calls onDragEnd either,
            // leaving x stranded mid-snap. Motion itself watches for the release on
            // window rather than the row, so a release outside it still ends the
            // gesture; mirror that here to catch the case it drops.
            const settle = () => {
              window.removeEventListener('pointerup', settle)
              window.removeEventListener('pointercancel', settle)
              releaseListeners.current = null
              if (!dragStarted.current) snap(x, openRef.current, reduced)
            }
            window.addEventListener('pointerup', settle)
            window.addEventListener('pointercancel', settle)
            releaseListeners.current = () => {
              window.removeEventListener('pointerup', settle)
              window.removeEventListener('pointercancel', settle)
            }
          }}
          onDirectionLock={(axis) => {
            // Motion starts a drag at 3px but locks the axis at 10px, so only an x lock is a swipe; a drifting tap stays a tap.
            if (axis === 'x') swiped.current = true
          }}
          onDragStart={() => {
            dragStarted.current = true
            onSwipeStart()
          }}
          onDragEnd={(_event: PointerEvent, info: PanInfo) => {
            if (!swiped.current) {
              // Pointer down stops a running snap, so settle back into the state the row already holds.
              snap(x, openRef.current, reduced)
              return
            }
            // A mouse swipe's trailing click already ran and a touch swipe fires none, so a stale flag would eat the next keyboard press.
            swiped.current = false
            const next = settleOpen({
              x: x.get(),
              velocityX: info.velocity.x,
              revealWidth: REVEAL_WIDTH,
            })
            // The effect only fires when `open` changes, so a row released back into its current state snaps here.
            snap(x, next, reduced)
            onOpenChange(next)
          }}
          onClickCapture={(event: MouseEvent) => {
            if (!swiped.current && !open) return
            // A swipe, or a tap that closes an open row, must not also follow the link inside.
            event.preventDefault()
            event.stopPropagation()
            if (!swiped.current) onOpenChange(false)
          }}
        >
          {children}
        </m.div>
      </div>
    </LazyMotion>
  )
}
