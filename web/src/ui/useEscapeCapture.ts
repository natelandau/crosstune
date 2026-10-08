import { useEffect } from 'react'
import { useLatest } from './useLatest'

/**
 * Runs `onEscape` for an Escape heard at window capture, ahead of the focused control and of an
 * overlay's own dismissal, while `enabled` and `when` agrees, typically when this overlay is on
 * top. The event goes no further, so whatever sits underneath never also steps out.
 */
export function useEscapeCapture(
  onEscape: () => void,
  { enabled = true, when }: { enabled?: boolean; when: (event: KeyboardEvent) => boolean },
): void {
  const onEscapeRef = useLatest(onEscape)
  const whenRef = useLatest(when)
  useEffect(() => {
    if (!enabled) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !whenRef.current(event)) return
      event.preventDefault()
      event.stopPropagation()
      onEscapeRef.current()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [enabled, onEscapeRef, whenRef])
}
