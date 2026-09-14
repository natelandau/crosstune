import { useCallback, useEffect, useState } from 'react'

/** Width of the revealed action area: two 80px buttons. */
export const REVEAL_WIDTH = 160

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

export interface SwipeRowState {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSwipeStart: () => void
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
      onOpenChange: (next: boolean) =>
        setOpenRowId((current) => (next ? id : current === id ? null : current)),
      onSwipeStart: () => setOpenRowId((current) => (current === id ? current : null)),
    }),
    [openRowId],
  )
}
