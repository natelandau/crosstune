import { ANY } from '../../ui/filterCopy'
import { UNKNOWN_KEY } from '../../ui/keyName'
import { tuningKeyInstrument, withInstrumentLabel } from '../settings/instruments'
import {
  FACET_LABELS,
  MISSING_LABELS,
  NO_KEY,
  sheetFacets,
  sheetFilterCount,
  sheetResets,
  type CatalogFilters,
  type Facet,
} from './filters'

/** Wording shared by the filter sheet, the filter bar's pills, and the tests that query them. */
export const SHOW_UNHEARD = 'Only unheard'
export const MISSING_LABEL = 'Missing'
export const UNHEARD_PILL = 'Unheard'
export const ARCHIVED_SHOWN = 'Archived shown'

/** A facet value as a musician reads it: the no-key filter is named in words. */
export function facetValueLabel(facet: Facet, value: string): string {
  return facet === 'key' && value === NO_KEY ? UNKNOWN_KEY : value
}

/** A filter control's face: "Key: Any", "Type: reel". */
export function facetControlLabel(facet: Facet, value: string): string {
  return `${FACET_LABELS[facet]}: ${value === 'all' ? ANY : facetValueLabel(facet, value)}`
}

// A tuning names its instrument, since two instruments can share a tuning's name, and a
// composer or learned from names its field, since one person can be both.
function tokenLabel(facet: Facet, value: string): string {
  const instrument = tuningKeyInstrument(facet)
  if (instrument) return withInstrumentLabel(instrument, value)
  if (facet === 'composer' || facet === 'learned_from') return `${FACET_LABELS[facet]}: ${value}`
  return facetValueLabel(facet, value)
}

/** A set sheet filter as its removable capsule reads, and the patch that removes it. */
export interface FilterToken {
  key: string
  label: string
  patch: Partial<CatalogFilters>
}

/** Every set sheet filter, in sheet order. A facet in `bar` shows on its own control instead. */
export function filterTokens(
  filters: CatalogFilters,
  visible: readonly Facet[],
  bar?: readonly Facet[],
): FilterToken[] {
  const tokens: FilterToken[] = sheetFacets(visible, bar)
    .filter((facet) => filters[facet] !== 'all')
    .map((facet) => ({
      key: facet,
      label: tokenLabel(facet, filters[facet]),
      patch: { [facet]: 'all' },
    }))
  if (filters.archived)
    tokens.push({ key: 'archived', label: ARCHIVED_SHOWN, patch: { archived: false } })
  if (filters.unheard)
    tokens.push({ key: 'unheard', label: UNHEARD_PILL, patch: { unheard: false } })
  if (filters.missing !== 'all')
    tokens.push({
      key: 'missing',
      label: `${MISSING_LABEL} ${MISSING_LABELS[filters.missing]}`,
      patch: { missing: 'all' },
    })
  return tokens
}

/** The archived count under Show archived: "2 archived tunes". */
export function archivedCountLabel(count: number): string {
  return `${count} archived ${count === 1 ? 'tune' : 'tunes'}`
}

/** The sheet's side of a screen's filters, from the one list of facets the screen shows itself. */
export interface SheetFilters {
  /** The facets the sheet lists, in sheet order. */
  facets: Facet[]
  /** How many sheet filters are set: the Filters count and the gate on Reset. */
  count: number
  tokens: FilterToken[]
  /** The patch Reset writes. */
  reset: Partial<CatalogFilters>
}

export function sheetFilters(
  filters: CatalogFilters,
  visible: readonly Facet[],
  bar?: readonly Facet[],
): SheetFilters {
  return {
    facets: sheetFacets(visible, bar),
    count: sheetFilterCount(filters, visible, bar),
    tokens: filterTokens(filters, visible, bar),
    reset: sheetResets(visible, bar),
  }
}
