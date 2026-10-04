import { STATUSES, type Instrument, type TuneStatus } from '../../api/vocabulary'
import type { LocalTune, LocalUserTune } from '../../db/types'
import { containsText, foldText, sameText } from '../../text/fold'
import { countTunes } from '../selection/copy'
import { DETAIL_LABELS } from '../tune/detailFields'
import {
  byTuningKey,
  isTuningKey,
  TUNING_KEYS,
  tuningEntry,
  tuningKey,
  tuningKeyInstrument,
  tuningLabel,
} from '../settings/instruments'

/** One tuning facet per instrument, so each instrument's tunings filter on their own. */
export const FACETS = ['key', 'tune_type', 'mode', ...TUNING_KEYS, 'genre'] as const
export type Facet = (typeof FACETS)[number]

export const FACET_LABELS: Record<Facet, string> = {
  key: 'Key',
  tune_type: DETAIL_LABELS.tune_type,
  mode: 'Mode',
  ...byTuningKey(tuningLabel),
  genre: 'Genre',
}

/**
 * Every value a tune holds for a facet: one mode per part, one instrument's tuning from the
 * map, or a column's one value.
 */
export function facetValuesOf(
  tune: LocalTune,
  facet: Facet,
): readonly (string | null | undefined)[] {
  if (facet === 'mode') return tune.modes
  if (!isTuningKey(facet)) return [tune[facet]]
  const instrument = tuningKeyInstrument(facet)
  return [instrument ? tuningEntry(tune.tunings, instrument).tuning : null]
}

/**
 * Every attribute the Missing filter can ask about, in the order the sheet lists them. The
 * learned fields read the user's own row; every other attribute reads the tune.
 */
export const MISSING_ATTRIBUTES = [
  'key',
  'mode',
  'tune_type',
  'genre',
  'time_signature',
  'composer',
  'part_structure',
  ...TUNING_KEYS,
  'learned_from',
  'learned_on',
] as const
export type MissingAttribute = (typeof MISSING_ATTRIBUTES)[number]

export const MISSING_LABELS: Record<MissingAttribute, string> = {
  key: FACET_LABELS.key,
  mode: FACET_LABELS.mode,
  tune_type: FACET_LABELS.tune_type,
  genre: FACET_LABELS.genre,
  time_signature: DETAIL_LABELS.time_signature,
  composer: DETAIL_LABELS.composer,
  part_structure: DETAIL_LABELS.part_structure,
  ...byTuningKey(tuningLabel),
  learned_from: DETAIL_LABELS.learned_from,
  learned_on: DETAIL_LABELS.learned_on,
}

export type CatalogFilters = Record<Facet, string> & {
  status: TuneStatus | 'all'
  archived: boolean
  unheard: boolean
  missing: MissingAttribute | 'all'
}

export const DEFAULT_FILTERS: CatalogFilters = {
  status: 'all',
  key: 'all',
  tune_type: 'all',
  mode: 'all',
  ...byTuningKey(() => 'all'),
  genre: 'all',
  archived: false,
  unheard: false,
  missing: 'all',
}

/**
 * The key filter for tunes with no key. Stored like any key, so it must never be a key a tune
 * can hold, the way `all` is not.
 */
export const NO_KEY = 'none'

export const META_CATALOG_FILTERS = 'catalog_filters'

export interface CatalogEntry {
  tune: LocalTune
  userTune: LocalUserTune
}

/** A catalog entry that knows whether the tune has a recording or a link, deleted ones aside. */
export interface HeardEntry extends CatalogEntry {
  heard: boolean
}

function isStatus(value: unknown): value is TuneStatus {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value)
}

function isMissingAttribute(value: unknown): value is MissingAttribute {
  return typeof value === 'string' && (MISSING_ATTRIBUTES as readonly string[]).includes(value)
}

export function normalizeFilters(value: unknown): CatalogFilters {
  const stored = (typeof value === 'object' && value !== null ? value : {}) as Record<
    string,
    unknown
  >
  const text = (key: Facet) =>
    typeof stored[key] === 'string' ? (stored[key] as string) : DEFAULT_FILTERS[key]
  // Only current facet keys are read, so a filter stored under a retired key reads as Any and
  // the next write drops it.
  return {
    status: isStatus(stored.status) || stored.status === 'all' ? stored.status : 'all',
    key: text('key'),
    tune_type: text('tune_type'),
    mode: text('mode'),
    ...byTuningKey((instrument) => text(tuningKey(instrument))),
    genre: text('genre'),
    archived: stored.archived === true,
    unheard: stored.unheard === true,
    missing: isMissingAttribute(stored.missing) ? stored.missing : 'all',
  }
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base' })

export function catalogEntries(
  tunes: LocalTune[],
  userTunes: LocalUserTune[],
  heard: ReadonlySet<string> = new Set(),
): HeardEntry[] {
  const tuneById = new Map(tunes.filter((s) => !s.deleted_at).map((s) => [s.id, s]))
  const entries: HeardEntry[] = []
  for (const userTune of userTunes) {
    if (userTune.deleted_at) continue
    const tune = tuneById.get(userTune.tune_id)
    if (tune) entries.push({ tune, userTune, heard: heard.has(tune.id) })
  }
  return entries.sort((a, b) => collator.compare(a.tune.title, b.tune.title))
}

/** True when the query names the tune's title or an alternate title, as `sameText` compares them. */
export function titleMatches(tune: LocalTune, query: string): boolean {
  return isHeld(query) && [tune.title, ...tune.alternate_titles].some((t) => sameText(t, query))
}

export function hideArchived<T extends CatalogEntry>(entries: T[], show: boolean): T[] {
  return show ? entries : entries.filter((entry) => !entry.userTune.archived_at)
}

/** Whether a value holds anything the fold keeps; whitespace or combining marks alone are blank. */
function isHeld(value: string | null | undefined): value is string {
  return value != null && foldText(value) !== ''
}

function isMissing(values: readonly (string | null | undefined)[]): boolean {
  return !values.some(isHeld)
}

/**
 * Whether a facet can filter by a value. A value the fold calls the same as `all`, or as
 * `NO_KEY` for the key, is not one: the stored filter would read it as Any or No key.
 */
export function isFilterValue(facet: Facet, value: string): boolean {
  const key = foldText(value)
  return key !== '' && key !== 'all' && !(facet === 'key' && key === foldText(NO_KEY))
}

function attributeValues(
  { tune, userTune }: CatalogEntry,
  attribute: MissingAttribute,
): readonly (string | null | undefined)[] {
  if (attribute === 'learned_from' || attribute === 'learned_on') return [userTune[attribute]]
  if (attribute === 'time_signature' || attribute === 'composer' || attribute === 'part_structure')
    return [tune[attribute]]
  return facetValuesOf(tune, attribute)
}

function facetMatches(filter: string, value: string | null | undefined): boolean {
  return filter === 'all' || (isHeld(value) && sameText(filter, value))
}

export function filterCatalog(
  entries: HeardEntry[],
  filters: CatalogFilters,
  query = '',
): HeardEntry[] {
  const needle = query.trim()
  return hideArchived(entries, filters.archived).filter((entry) => {
    const { tune, userTune } = entry
    if (filters.status !== 'all' && userTune.status !== filters.status) return false
    if (filters.unheard && entry.heard) return false
    if (filters.missing !== 'all' && !isMissing(attributeValues(entry, filters.missing)))
      return false
    for (const facet of FACETS) {
      const values = facetValuesOf(tune, facet)
      if (facet === 'key' && filters.key === NO_KEY) {
        if (!isMissing(values)) return false
      } else if (
        filters[facet] !== 'all' &&
        !values.some((value) => facetMatches(filters[facet], value))
      )
        return false
    }
    if (!needle) return true
    const haystack = [tune.title, ...tune.alternate_titles, tune.composer ?? '']
    return haystack.some((t) => containsText(t, needle))
  })
}

// Dedupe the way facetMatches compares, so one option stands for every spelling it matches.
function distinct(facet: Facet, values: (string | null | undefined)[]): string[] {
  const first = new Map<string, string>()
  for (const value of values) {
    if (value == null || !isFilterValue(facet, value)) continue
    const key = foldText(value)
    if (!first.has(key)) first.set(key, value)
  }
  return [...first.values()].sort(collator.compare)
}

export type FacetValues = Record<Facet, string[]>

/**
 * Each facet's distinct values. The key facet leads with `NO_KEY` while some tunes have a key
 * and some do not; with no keys at all it would narrow nothing.
 */
export function facetValues(entries: CatalogEntry[]): FacetValues {
  const values = Object.fromEntries(
    FACETS.map((facet) => [
      facet,
      distinct(
        facet,
        entries.flatMap((e) => facetValuesOf(e.tune, facet)),
      ),
    ]),
  ) as FacetValues
  if (values.key.length > 0 && entries.some((e) => !isHeld(e.tune.key)))
    values.key = [NO_KEY, ...values.key]
  return values
}

/** Facets worth offering: those with values, minus tunings for instruments the user does not play. */
export function visibleFacets(facets: FacetValues, instruments: ReadonlySet<Instrument>): Facet[] {
  return FACETS.filter((facet) => {
    if (facets[facet].length === 0) return false
    const instrument = tuningKeyInstrument(facet)
    return instrument === undefined || instruments.has(instrument)
  })
}

/** `all` counts the catalog as stored, so the count row outlives every tune being filtered out. */
export interface CatalogCounts {
  visible: number
  total: number
  archived: number
  all: number
}

/** The one wording for a catalog count, so the bar and the filter sheet never disagree. */
export function tuneCountLabel(visible: number, total: number): string {
  if (visible !== total) return `${visible} of ${total} tunes`
  return countTunes(total)
}

/** The attributes some tune holds, in sheet order: asking for a missing one is only useful then. */
export function missingChoices(entries: CatalogEntry[]): MissingAttribute[] {
  return MISSING_ATTRIBUTES.filter((attribute) =>
    entries.some((entry) => !isMissing(attributeValues(entry, attribute))),
  )
}

/**
 * A patch that resets every hidden facet, so a change never carries a stale filter along. A
 * missing tuning for an instrument the musician does not play is hidden the same way.
 */
export function hiddenResets(
  visible: readonly Facet[],
  missing: CatalogFilters['missing'] = 'all',
): Partial<CatalogFilters> {
  const resets: Partial<CatalogFilters> = {}
  if (isTuningKey(missing) && !visible.includes(missing)) resets.missing = 'all'
  for (const facet of FACETS) {
    if (!visible.includes(facet)) resets[facet] = 'all'
  }
  return resets
}

/** Facets with their own control on the filter bar; every other visible facet lives in the sheet. */
export const BAR_FACETS: readonly Facet[] = ['key', 'tune_type']

export function sheetFacets(visible: readonly Facet[]): Facet[] {
  return visible.filter((facet) => !BAR_FACETS.includes(facet))
}

/** How many sheet filters are set: the badge on the Filters button and the gate on Reset. */
export function sheetFilterCount(filters: CatalogFilters, visible: readonly Facet[]): number {
  const facets = sheetFacets(visible).filter((facet) => filters[facet] !== 'all').length
  return (
    facets +
    (filters.archived ? 1 : 0) +
    (filters.unheard ? 1 : 0) +
    (filters.missing !== 'all' ? 1 : 0)
  )
}

/** A patch that clears the sheet's filters and nothing else. */
export function sheetResets(visible: readonly Facet[]): Partial<CatalogFilters> {
  const patch: Partial<CatalogFilters> = { archived: false, unheard: false, missing: 'all' }
  for (const facet of sheetFacets(visible)) patch[facet] = 'all'
  return patch
}
