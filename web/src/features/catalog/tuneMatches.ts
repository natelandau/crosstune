import { DEFAULT_FILTERS, filterCatalog, type HeardEntry } from './filters'

// Archived tunes are searchable in every picker, so each filter is open and only the query narrows.
const PICKER_FILTERS = { ...DEFAULT_FILTERS, archived: true }

export const MAX_RESULTS = 8

/** The catalog narrowed by a picker's query, archived tunes included; nothing for a blank one. */
export function matchTunes(entries: HeardEntry[], query: string): HeardEntry[] {
  return query.trim() ? filterCatalog(entries, PICKER_FILTERS, query) : []
}
