import { useCallback, useState } from 'react'

export interface SongSelection {
  count: number
  allSelected: boolean
  isSelected: (userSongId: string) => boolean
  toggle: (userSongId: string) => void
  toggleRange: (userSongId: string) => void
  selectAll: () => void
  clear: () => void
  toggleAll: () => void
}

const EMPTY: ReadonlySet<string> = new Set()

/**
 * The user songs selected on a screen. The selection only ever holds visible songs, so an
 * action never reaches a song the user cannot see.
 */
export function useSongSelection(visibleIds: readonly string[], active: boolean): SongSelection {
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
    count: nextSelected.size,
    allSelected,
    isSelected,
    toggle,
    toggleRange,
    selectAll,
    clear,
    toggleAll,
  }
}
