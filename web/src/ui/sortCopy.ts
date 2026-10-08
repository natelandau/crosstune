import { nextSort, type SortChoice } from './sortChoice'
import type { SortOptions } from './sortTypes'

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

/** The sort control's name: the visible sort leads, and the arrow's meaning is spoken. */
export function sortControlName<S extends string>(
  options: SortOptions<S>,
  choice: SortChoice<S>,
): string {
  return `${SORT_BY} ${options.labels[choice.sort]}, ${sortDirection(choice, options.isDate)}`
}

export interface SortMenuChoice<S extends string> {
  sort: S
  label: string
  /** The current sort, marked in the menu with its direction. */
  checked: boolean
  description?: string
  /** What picking it sets: the current sort reverses, another starts at its first direction. */
  next: SortChoice<S>
}

/** A Sort menu's items, in menu order. */
export function sortMenuChoices<S extends string>(
  options: SortOptions<S>,
  choice: SortChoice<S>,
): SortMenuChoice<S>[] {
  return options.sorts.map((sort) => {
    const checked = choice.sort === sort
    return {
      sort,
      label: options.labels[sort],
      checked,
      description: checked ? sortDirection(choice, options.isDate) : undefined,
      next: nextSort(choice, sort, options.isDate),
    }
  })
}
