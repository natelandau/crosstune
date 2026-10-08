import { useCallback, useState } from 'react'
import { isTextEntry } from '../../ui/keyTarget'
import { useLatest } from '../../ui/useLatest'
import { useTuneSelection, type TuneSelection } from './useTuneSelection'

/** The parts of a key event the mode reads; a DOM event and a React one both carry them. */
export type SelectionKey = Pick<
  KeyboardEvent,
  'key' | 'metaKey' | 'ctrlKey' | 'preventDefault' | 'target'
>

export interface SelectionMode {
  active: boolean
  /** Opens the mode, with `firstId` already selected when given. Entering never clears. */
  enter: (firstId?: string) => void
  exit: () => void
  /** Only ever visible ids: one that leaves the screen leaves the selection too. */
  selected: ReadonlySet<string>
  toggle: (id: string) => void
  /** Selects every id from the last one toggled to `toId`. */
  range: (toId: string) => void
  selectAll: () => void
  clear: () => void
  /**
   * Escape leaves the mode; Cmd-A or Ctrl-A selects every visible id. A key typed in a field
   * is left to the field.
   */
  onKeyDown: (event: SelectionKey) => void
  /** The same selection, with the counts a toolbar reads. */
  selection: TuneSelection
}

/**
 * Selection mode over a screen of tune rows: whether it is on and which rows are in it. Where
 * focus goes, and whether an open overlay holds the keys, belong to the app that hosts it.
 *
 * `visibleIds` must be memoized by the caller: `selectAll` depends on its identity. `onEnter`
 * runs before the mode opens, for a caller with an open swipe row to close first.
 */
export function useSelectionMode(
  visibleIds: readonly string[],
  options: { onEnter?: () => void } = {},
): SelectionMode {
  const [active, setActive] = useState(false)
  const selection = useTuneSelection(visibleIds, active)
  const onEnterRef = useLatest(options.onEnter)
  const { selected, add, toggle, toggleRange, selectAll, clear } = selection

  const enter = useCallback(
    (firstId?: string) => {
      onEnterRef.current?.()
      if (firstId !== undefined) add(firstId)
      setActive(true)
    },
    [add, onEnterRef],
  )
  const exit = useCallback(() => setActive(false), [])

  const onKeyDown = useCallback(
    (event: SelectionKey) => {
      if (!active || isTextEntry(event.target)) return
      if (event.key === 'Escape') {
        exit()
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        // Never toggleAll: the one key that means "everything" must not also mean "nothing".
        selectAll()
      }
    },
    [active, exit, selectAll],
  )

  return {
    active,
    enter,
    exit,
    selected,
    toggle,
    range: toggleRange,
    selectAll,
    clear,
    onKeyDown,
    selection,
  }
}
