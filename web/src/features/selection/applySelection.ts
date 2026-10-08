import type { Selection } from 'react-aria-components'
import type { SelectionMode } from './useSelectionMode'

/**
 * Brings `mode` to the rows' selection after a click, a shift-click, or a key in the list.
 * The list works out ranges from its own anchor, so the mode takes the result row by row.
 */
export function applySelection(mode: SelectionMode, keys: Selection): void {
  if (!mode.active) return
  if (keys === 'all') {
    mode.selectAll()
    return
  }
  const next = new Set([...keys].map(String))
  for (const id of new Set([...mode.selected, ...next])) {
    if (mode.selected.has(id) !== next.has(id)) mode.toggle(id)
  }
}
