import type { SortChoice } from './sortChoice'

/** The name of every screen's sort menu. */
export const SORT = 'Sort'
/** Leads the sort button's spoken name, before the current sort. */
export const SORT_BY = 'Sort by'

export const NEWEST_FIRST = 'Newest first'
export const OLDEST_FIRST = 'Oldest first'
export const A_TO_Z = 'A to Z'
export const Z_TO_A = 'Z to A'

/** The words for the current sort's direction, read with its checked menu item. */
export function sortDirection<S extends string>(
  { sort, descending }: SortChoice<S>,
  isDate: (sort: S) => boolean,
): string {
  if (isDate(sort)) return descending ? NEWEST_FIRST : OLDEST_FIRST
  return descending ? Z_TO_A : A_TO_Z
}
