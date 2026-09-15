import { useCallback, useEffect, useRef } from 'react'
import type { RowSelection } from '../catalog/SongRow'
import { selectionCheckboxId } from './ids'
import { useSongSelection, type SongSelection } from './useSongSelection'

export interface SongSelectionMode {
  selection: SongSelection
  selectButtonRef: (node: HTMLButtonElement | null) => void
  enter: (focusId?: string) => void
  exit: () => void
  rowSelection: (userSongId: string, index: number) => RowSelection
}

function isTextEntry(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true
  return (
    target instanceof HTMLInputElement &&
    !['checkbox', 'radio', 'button', 'submit'].includes(target.type)
  )
}

function overlayOpen(): boolean {
  if (document.querySelector('dialog[open]')) return true
  try {
    return document.querySelector(':popover-open') !== null
  } catch {
    // Engines without the popover API reject the selector, and then no popover can be open.
    return false
  }
}

/** Selection mode for a screen of song rows: entering, leaving, focus, keys, and per-row props. */
export function useSongSelectionMode({
  visibleIds,
  active,
  setActive,
  onEnter,
}: {
  visibleIds: readonly string[]
  active: boolean
  setActive: (next: boolean) => void
  onEnter?: () => void
}): SongSelectionMode {
  const selection = useSongSelection(visibleIds, active)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  // Focus moves to main when the focused Select button unmounts, which can happen after
  // selection has already ended.
  const selectButtonRef = useCallback((node: HTMLButtonElement | null) => {
    if (node === null && buttonRef.current && document.activeElement === buttonRef.current) {
      document.querySelector<HTMLElement>('main')?.focus({ preventScroll: true })
    }
    buttonRef.current = node
  }, [])
  const focusTarget = useRef<string | null>(null)
  const firstVisible = useRef<string | undefined>(visibleIds[0])
  const wasActive = useRef(active)

  useEffect(() => {
    firstVisible.current = visibleIds[0]
  })

  useEffect(() => {
    if (wasActive.current === active) return
    wasActive.current = active
    if (active) {
      const id = focusTarget.current ?? firstVisible.current
      focusTarget.current = null
      if (id) document.getElementById(selectionCheckboxId(id))?.focus()
    } else if (buttonRef.current) {
      // The Select button sits at the top of the screen; scrolling to it would lose the reader's place.
      buttonRef.current.focus({ preventScroll: true })
    } else {
      // The Select button is gone when nothing is left to select, so the page itself takes focus.
      document.querySelector<HTMLElement>('main')?.focus({ preventScroll: true })
    }
  }, [active])

  // Screens pass a new setter each render, so reading it through a ref keeps the key listener
  // from resubscribing on every render.
  const setActiveRef = useRef(setActive)
  useEffect(() => {
    setActiveRef.current = setActive
  })
  const exit = useCallback(() => setActiveRef.current(false), [])
  const { selectAll } = selection

  useEffect(() => {
    if (!active) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTextEntry(event.target) || overlayOpen()) return
      if (event.key === 'Escape') {
        exit()
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        selectAll()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [active, exit, selectAll])

  const enter = (focusId?: string) => {
    onEnter?.()
    focusTarget.current = focusId ?? null
    setActive(true)
  }

  const rowSelection = (userSongId: string, index: number): RowSelection => ({
    active,
    selected: selection.isSelected(userSongId),
    index,
    onToggle: (shiftKey) =>
      shiftKey ? selection.toggleRange(userSongId) : selection.toggle(userSongId),
    onLongPress: () => {
      selection.toggle(userSongId)
      enter(userSongId)
    },
  })

  return { selection, selectButtonRef, enter, exit, rowSelection }
}
