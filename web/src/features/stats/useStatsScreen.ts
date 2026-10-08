import { useState } from 'react'
import { useDb } from '../../db/DbProvider'
import { DEFAULT_FILTERS, type CatalogFilters } from '../catalog/filters'
import { writeSearchQuery } from '../../ui/searchSession'
import { useCatalogFilters } from '../catalog/useCatalogFilters'
import { useStats, type StatsView } from './useStats'

export interface StatsScreenOptions {
  openCatalog(): void
  /** The moment the page opened; the stats are for that day. */
  now?: Date
}

export interface StatsScreen {
  view: StatsView | undefined
  /**
   * Opens the catalog showing exactly the tunes a value counted. When the filter cannot be
   * saved the catalog stays closed and `filterError(header)` reports it under `header`, the
   * group the value was tapped in. Never rejects.
   */
  filterCatalog(patch: Partial<CatalogFilters>, header: string): Promise<void>
  /** Why the last filter tapped under `header` could not be saved, or null. */
  filterError(header: string): string | null
}

/** The stats page's data and its catalog tap-through. */
export function useStatsScreen({ openCatalog, now }: StatsScreenOptions): StatsScreen {
  const db = useDb()
  const [opened] = useState(() => now ?? new Date())
  const view = useStats(db, opened)
  const [, updateFilters, error] = useCatalogFilters()
  // The header whose write failed, set only once it has, so a later tap elsewhere never carries
  // the message over before its own write settles. A write that succeeds clears the error.
  const [failed, setFailed] = useState<string | null>(null)

  // Every other filter and the search are cleared, so the catalog shows exactly the tunes the
  // value counted.
  const filterCatalog = async (patch: Partial<CatalogFilters>, header: string) => {
    try {
      await updateFilters({ ...DEFAULT_FILTERS, ...patch })
    } catch {
      setFailed(header)
      return
    }
    writeSearchQuery('catalog', '')
    openCatalog()
  }

  return {
    view,
    filterCatalog,
    filterError: (header) => (failed === header ? error : null),
  }
}
