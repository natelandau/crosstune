import { useRef } from 'react'
import { useLatest } from './useLatest'

const KEY_DIRECTIONS: Record<string, number> = {
  ArrowLeft: -1,
  ArrowDown: -1,
  ArrowRight: 1,
  ArrowUp: 1,
}
const PAGE_DIRECTIONS: Record<string, number> = { PageDown: -1, PageUp: 1 }

type StepKey = { key: string; shiftKey: boolean }

/**
 * The signed step a key moves a slider: an arrow by `step`, or by `largeStep` with Shift, and
 * with `pageKeys`, Page Up and Page Down by `largeStep`. Null for any other key.
 */
export function keyStep(
  event: StepKey,
  step: number,
  largeStep: number,
  pageKeys = false,
): number | null {
  const direction = KEY_DIRECTIONS[event.key]
  if (direction !== undefined) return direction * (event.shiftKey ? largeStep : step)
  const page = pageKeys ? PAGE_DIRECTIONS[event.key] : undefined
  return page === undefined ? null : page * largeStep
}

/**
 * Commits a run of key steps once: when a stepping key is let go, or when focus leaves, since
 * a key let go elsewhere never reaches the keyup. `stepped` marks a step taken.
 */
export function useStepCommit(commit: () => void, pageKeys = false) {
  const commitRef = useLatest(commit)
  const pending = useRef(false)
  const end = () => {
    if (!pending.current) return
    pending.current = false
    commitRef.current()
  }
  return {
    stepped: () => {
      pending.current = true
    },
    onKeyUp: (event: StepKey) => {
      if (keyStep(event, 1, 1, pageKeys) !== null) end()
    },
    onBlur: end,
  }
}
