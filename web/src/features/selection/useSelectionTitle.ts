import { countTunes } from './copy'
import { DESELECT_ALL, SELECT_ALL, selectedTitle } from './selectionCopy'

export interface SelectionTitle {
  /** The bar's title: the count every action beside it acts on. */
  title: string
  /** The same count read aloud, naming what is counted. */
  spoken: string
  /** Select all, or Deselect all once every visible tune is selected. */
  selectAllLabel: string
}

/** The words a selection bar shows for `count` selected out of `total` visible. */
export function useSelectionTitle(count: number, total: number): SelectionTitle {
  return {
    title: selectedTitle(count),
    spoken: `${countTunes(count)} selected`,
    selectAllLabel: total > 0 && count === total ? DESELECT_ALL : SELECT_ALL,
  }
}
