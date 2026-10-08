import { useEffect, useRef, useSyncExternalStore, type RefObject } from 'react'
import { useSelectionMode, type SelectionMode } from './useSelectionMode'
import { useLatest } from '../../ui/useLatest'
import { useBackEntry } from '../../app/backEntries'
import { useOverlayOpen } from '../../ui/overlayClaim'

let selecting = 0
const listeners = new Set<() => void>()

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => listeners.delete(onChange)
}

function change(by: number): void {
  selecting += by
  for (const listener of listeners) listener()
}

/** Whether a screen is selecting, so the shell swaps its tab bar out and stands Record down. */
export function useShellSelecting(): boolean {
  return useSyncExternalStore(subscribe, () => selecting > 0)
}

/** Forgets every selecting screen, so no test inherits one another test left behind. */
export function resetSelectingForTest(): void {
  selecting = 0
  for (const listener of listeners) listener()
}

/**
 * Tells the shell while `mode` is on, and holds the mode on the back stack, so a device back or
 * Escape leaves it once every overlay over it has closed. Cmd-A or Ctrl-A selects every row,
 * unless an overlay holds the keyboard.
 */
export function useSelectionShell(mode: SelectionMode): void {
  const { active } = mode
  const overlayOpenRef = useLatest(useOverlayOpen())
  const onKeyDownRef = useLatest(mode.onKeyDown)
  useBackEntry({ layer: 'screen', back: mode.exit }, active)

  useEffect(() => {
    if (!active) return
    change(1)
    return () => change(-1)
  }, [active])

  useEffect(() => {
    if (!active) return
    const onKeyDown = (event: KeyboardEvent) => {
      // Escape steps out through the back stack, in order with every overlay above the mode.
      if (event.key === 'Escape' || overlayOpenRef.current) return
      onKeyDownRef.current(event)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [active, overlayOpenRef, onKeyDownRef])
}

/** `useSelectionMode` over a screen's rows, with the shell told while it is on. */
export function useScreenSelection(
  visibleIds: readonly string[],
  options: { onEnter?: () => void } = {},
): SelectionMode {
  const mode = useSelectionMode(visibleIds, options)
  useSelectionShell(mode)
  return mode
}

export interface SelectionReturn {
  /** On the screen's More trigger, where Select tunes opens the mode. */
  moreRef: RefObject<HTMLButtonElement | null>
  /** On an element holding the rows, whose grid gives focus back to its focused row. */
  rowsRef: RefObject<HTMLDivElement | null>
  /** Opens the mode from More. */
  fromMore: () => void
  /** Opens the mode from a row's menu, with that row selected. */
  fromRow: (id: string) => void
  /** Puts focus back where the mode was opened from, or on More. */
  restore: () => void
}

/** Remembers where a screen's selection was opened from, so leaving it can return focus there. */
export function useSelectionReturn(mode: SelectionMode): SelectionReturn {
  const moreRef = useRef<HTMLButtonElement>(null)
  const rowsRef = useRef<HTMLDivElement>(null)
  const from = useRef<'more' | 'row'>('more')
  return {
    moreRef,
    rowsRef,
    fromMore: () => {
      from.current = 'more'
      mode.enter()
    },
    fromRow: (id) => {
      from.current = 'row'
      mode.enter(id)
    },
    restore: () => {
      const grid =
        from.current === 'row'
          ? rowsRef.current?.querySelector<HTMLElement>('[role="grid"]')
          : undefined
      ;(grid ?? moreRef.current)?.focus()
    },
  }
}
