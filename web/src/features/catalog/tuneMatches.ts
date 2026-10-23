import { sortCatalog } from './catalogSort'
import { DEFAULT_FILTERS, filterCatalog } from './filters'
import type { CatalogEntry, HeardEntry } from '../../db/types'

// Archived tunes are searchable in every picker, so each filter is open and only the query narrows.
const PICKER_FILTERS = { ...DEFAULT_FILTERS, archived: true }

export const MAX_RESULTS = 8

/** The catalog narrowed by a picker's query, archived tunes included; nothing for a blank one. */
export function matchTunes(entries: HeardEntry[], query: string): HeardEntry[] {
  return query.trim() ? filterCatalog(entries, PICKER_FILTERS, query) : []
}

/** Every tune A to Z by title, archived included, as the catalog sorts by title. */
export function listCatalog(entries: CatalogEntry[]): CatalogEntry[] {
  return sortCatalog(entries, { sort: 'title', descending: false }, new Map())
}
