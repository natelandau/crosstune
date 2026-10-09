import { FILTERS, type Filter } from '../../analytics/events'
import { isTuningKey } from '../../domain/instruments'
import { FACETS, type CatalogFilters } from './filters'

/**
 * The kinds of filter a patch sets or changes on `before`, each once, in the plan's order.
 * A filter cleared is not one applied, and every instrument's tuning is the one `tuning`.
 */
export function appliedFilters(before: CatalogFilters, patch: Partial<CatalogFilters>): Filter[] {
  const applied = new Set<Filter>()
  if (patch.status !== undefined && patch.status !== 'all' && patch.status !== before.status) {
    applied.add('status')
  }
  for (const facet of FACETS) {
    const value = patch[facet]
    if (value === undefined || value === 'all' || value === before[facet]) continue
    applied.add(isTuningKey(facet) ? 'tuning' : facet)
  }
  if (patch.archived && !before.archived) applied.add('archived')
  if (patch.unheard && !before.unheard) applied.add('unheard')
  if (patch.missing !== undefined && patch.missing !== 'all' && patch.missing !== before.missing) {
    applied.add('missing')
  }
  return FILTERS.filter((filter) => applied.has(filter))
}
