export const FILTERS = 'Filters'

/** The filter control's name: "Filters", or "Filters, 2 set" while any are set. */
export function filtersLabel(setCount: number): string {
  return setCount > 0 ? `${FILTERS}, ${setCount} set` : FILTERS
}

/** The name of a set filter's capsule, which removes it. */
export function removeFilterLabel(value: string): string {
  return `Remove filter ${value}`
}

/** A filter's empty choice, which widens it to every value. */
export const ANY = 'Any'
/** Clears a filter sheet's own filters. */
export const RESET = 'Reset'
