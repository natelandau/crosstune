import { useMemo } from 'react'
import type { CatalogEntry } from './filters'
import { searchOutcome, type SearchOutcome } from './searchIntent'
import { matchTunes } from './tuneMatches'
import { useCatalog } from './useCatalog'

// An unread catalog looks exactly like a catalog holding no such tune, so the search offers
// nothing until it has been read; otherwise a query typed as the picker opens offers to create a
// tune that is already there.
const UNREAD: SearchOutcome = { kind: 'none' }

export interface TuneMatches {
  /** The catalog, undefined until read. */
  entries: CatalogEntry[] | undefined
  matches: CatalogEntry[]
  outcome: SearchOutcome
}

/**
 * The catalog narrowed by a picker's query, and what the search offers beyond the matches.
 * `enabled` false stands the catalog query down, for a picker behind a closed sheet.
 */
export function useTuneMatches(query: string, enabled = true): TuneMatches {
  const entries = useCatalog(enabled)
  const matches = useMemo(() => (entries ? matchTunes(entries, query) : []), [entries, query])
  const outcome = useMemo(
    () => (entries ? searchOutcome(entries, matches, query, true) : UNREAD),
    [entries, matches, query],
  )
  return { entries, matches, outcome }
}
