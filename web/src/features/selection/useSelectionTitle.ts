import { DESELECT_ALL, SELECT_ALL, selectedTitle } from './selectionCopy'
import type { SelectionMode } from './useSelectionMode'

export interface SelectionTitle {
  /** The bar's title: the count every action beside it acts on. */
  title: string
  /** The same count read aloud, naming what is counted. */
  spoken: string
  /** Select all, or Deselect all once every visible row is selected. */
  selectAllLabel: string
}

/**
 * The words a selection bar shows for the rows `mode` has selected out of those visible.
 * `noun` counts what the rows are, such as "3 tunes".
 */
export function useSelectionTitle(
  mode: { selection: Pick<SelectionMode['selection'], 'count' | 'total'> },
  noun: (n: number) => string,
): SelectionTitle {
  const { count, total = 0 } = mode.selection
  return {
    title: selectedTitle(count),
    spoken: `${noun(count)} selected`,
    selectAllLabel: total > 0 && count === total ? DESELECT_ALL : SELECT_ALL,
  }
}
