import { useCallback, useEffect, useState, type ReactNode } from 'react'

/** Width of one revealed action button. */
export const ACTION_WIDTH = 56

export interface SwipeAction {
  /** The accessible name; the button itself shows only the icon. */
  label: string
  tone: 'neutral' | 'warning' | 'error'
  onPress: () => void
  icon: ReactNode
}

/** One to three actions, revealed side by side. */
export type SwipeActions =
  | readonly [SwipeAction]
  | readonly [SwipeAction, SwipeAction]
  | readonly [SwipeAction, SwipeAction, SwipeAction]

/** Total width of the revealed action area for these actions. */
export function revealWidthFor(actions: SwipeActions): number {
  return actions.length * ACTION_WIDTH
}

const FLICK_VELOCITY = 500

/** Whether a released row rests open, from its translate and release velocity in px/s. */
export function settleOpen({
  x,
  velocityX,
  revealWidth,
}: {
  x: number
  velocityX: number
  revealWidth: number
}): boolean {
  if (velocityX <= -FLICK_VELOCITY) return true
  if (velocityX >= FLICK_VELOCITY) return false
  return x <= -revealWidth / 2
}

const OVERSHOOT = 0.1

/** A drag offset past closed or past fully open, eased so the row stretches rather than slides. */
export function resist(x: number, revealWidth: number): number {
  if (x > 0) return x * OVERSHOOT
  if (x < -revealWidth) return -revealWidth + (x + revealWidth) * OVERSHOOT
  return x
}

export interface SwipeSample {
  time: number
  x: number
}

const VELOCITY_WINDOW_MS = 80

/** Release speed in px/s over the last moments of a drag, so an early pause does not mask a final flick. */
export function releaseVelocity(samples: readonly SwipeSample[]): number {
  const last = samples.at(-1)
  if (!last) return 0
  const first = samples.find((s) => s.time >= last.time - VELOCITY_WINDOW_MS) ?? last
  const elapsed = last.time - first.time
  return elapsed > 0 ? ((last.x - first.x) / elapsed) * 1000 : 0
}

export const CLICK_GUARD_MS = 50

/**
 * Block the click a mouse drag leaves behind until shortly after the returned release runs.
 * dnd-kit only stops that click's propagation, so a link or popover button would still act on it.
 */
export function guardTrailingClick(): () => void {
  const block = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
  }
  window.addEventListener('click', block, { capture: true })
  return () => {
    setTimeout(() => window.removeEventListener('click', block, { capture: true }), CLICK_GUARD_MS)
  }
}

export interface SwipeRowState {
  open: boolean
  /** Another row on the screen is open, so a tap on this one should only close that one. */
  otherOpen: boolean
  onOpenChange: (open: boolean) => void
  onSwipeStart: () => void
  closeOpenRow: () => void
}

/** Tracks the one open swipe row on a screen and closes it when the page scrolls. */
export function useOpenRow(): (id: string) => SwipeRowState {
  const [openRowId, setOpenRowId] = useState<string | null>(null)

  useEffect(() => {
    if (openRowId === null) return
    const close = () => setOpenRowId(null)
    window.addEventListener('scroll', close, { passive: true })
    return () => window.removeEventListener('scroll', close)
  }, [openRowId])

  return useCallback(
    (id: string) => ({
      open: openRowId === id,
      otherOpen: openRowId !== null && openRowId !== id,
      onOpenChange: (next: boolean) =>
        setOpenRowId((current) => (next ? id : current === id ? null : current)),
      onSwipeStart: () => setOpenRowId((current) => (current === id ? current : null)),
      closeOpenRow: () => setOpenRowId(null),
    }),
    [openRowId],
  )
}
