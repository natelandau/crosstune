import { useCallback, useState } from 'react'

export interface TuneSelection {
  count: number
  /** How many tunes are visible to select. */
  total?: number
  allSelected: boolean
  isSelected: (userTuneId: string) => boolean
  toggle: (userTuneId: string) => void
  toggleRange: (userTuneId: string) => void
  selectAll: () => void
  clear: () => void
  toggleAll: () => void
}

/** The selection with the set itself, for a caller that walks it rather than asks of it. */
export interface TuneSelectionState extends TuneSelection {
  selected: ReadonlySet<string>
  /** Selects the tune, leaving it selected if it already was. */
  add: (userTuneId: string) => void
}

const EMPTY: ReadonlySet<string> = new Set()

/**
 * The user tunes selected on a screen. The selection only ever holds visible tunes, so an
 * action never reaches a tune the user cannot see.
 */
export function useTuneSelection(
  visibleIds: readonly string[],
  active: boolean,
): TuneSelectionState {
  const [selected, setSelected] = useState<ReadonlySet<string>>(EMPTY)
  const [anchor, setAnchor] = useState<string | null>(null)
  const [wasActive, setWasActive] = useState(active)

  // The value this render intends, so the mode-end reset below isn't clobbered by a
  // prune computed from the stale `selected` still in scope for this render.
  let nextSelected = selected

  if (wasActive !== active) {
    setWasActive(active)
    if (!active) {
      nextSelected = EMPTY
      setAnchor(null)
    }
  }

  if (nextSelected.size > 0) {
    const visible = new Set(visibleIds)
    if ([...nextSelected].some((id) => !visible.has(id))) {
      nextSelected = new Set([...nextSelected].filter((id) => visible.has(id)))
    }
  }

  if (nextSelected !== selected) {
    setSelected(nextSelected)
  }

  const toggle = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setAnchor(id)
  }, [])

  const add = useCallback((id: string) => {
    setSelected((current) => (current.has(id) ? current : new Set([...current, id])))
    setAnchor(id)
  }, [])

  const toggleRange = useCallback(
    (id: string) => {
      const from = anchor === null ? -1 : visibleIds.indexOf(anchor)
      const to = visibleIds.indexOf(id)
      if (from < 0 || to < 0) {
        toggle(id)
        return
      }
      const [start, end] = from < to ? [from, to] : [to, from]
      setSelected((current) => new Set([...current, ...visibleIds.slice(start, end + 1)]))
      setAnchor(id)
    },
    [anchor, visibleIds, toggle],
  )

  const selectAll = useCallback(() => setSelected(new Set(visibleIds)), [visibleIds])
  const clear = useCallback(() => {
    setSelected(EMPTY)
    setAnchor(null)
  }, [])
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => nextSelected.has(id))
  const isSelected = useCallback((id: string) => nextSelected.has(id), [nextSelected])
  const toggleAll = useCallback(
    () => (allSelected ? clear() : selectAll()),
    [allSelected, clear, selectAll],
  )

  return {
    selected: nextSelected,
    count: nextSelected.size,
    total: visibleIds.length,
    allSelected,
    isSelected,
    toggle,
    add,
    toggleRange,
    selectAll,
    clear,
    toggleAll,
  }
}
