import type { SortChoice } from '../../ui/sortChoice'
import type { SortOptions } from '../../ui/SortMenu'
import type { CatalogEntry } from './filters'

export type CatalogSort = 'title' | 'added' | 'modified' | 'played'

/** Every sort, in the order the sort menu lists them. */
export const CATALOG_SORTS: readonly CatalogSort[] = ['title', 'added', 'modified', 'played']

/** True for a sort whose first direction is newest first rather than A first. */
export function isCatalogDateSort(sort: CatalogSort): boolean {
  return sort !== 'title'
}

interface Played {
  tune_id?: string | null
  started_at: string
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base' })

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function byTitle(a: CatalogEntry, b: CatalogEntry): number {
  return collator.compare(a.tune.title, b.tune.title) || compareIds(a.tune.id, b.tune.id)
}

// Parsed, not compared as text: a row written here and one pulled from the server spell
// the same instant with different fractional-second precision.
function addedAt(entry: CatalogEntry): number {
  return Date.parse(entry.userTune.created_at)
}

function modifiedAt(entry: CatalogEntry): number {
  return Math.max(Date.parse(entry.tune.updated_at), Date.parse(entry.userTune.updated_at))
}

/**
 * The catalog in the chosen order, as a new list. Equal or unknown dates fall back to title A to
 * Z, and a tune never played comes last in both directions, as an unknown date does on the
 * Recordings screen.
 */
export function sortCatalog(
  entries: readonly CatalogEntry[],
  choice: SortChoice<CatalogSort>,
  lastPlayed: ReadonlyMap<string, number>,
): CatalogEntry[] {
  const { sort, descending } = choice
  if (sort === 'title') {
    return [...entries].sort((a, b) => (descending ? -byTitle(a, b) : byTitle(a, b)))
  }
  const dateOf =
    sort === 'added'
      ? addedAt
      : sort === 'modified'
        ? modifiedAt
        : (entry: CatalogEntry) => lastPlayed.get(entry.tune.id) ?? null
  return [...entries].sort((a, b) => {
    const x = dateOf(a)
    const y = dateOf(b)
    if (x === null || y === null) return Number(x === null) - Number(y === null) || byTitle(a, b)
    return (descending ? y - x : x - y) || byTitle(a, b)
  })
}

/** Each tune's latest play or practice session, in milliseconds since the epoch. */
export function lastPlayedByTune(
  plays: readonly Played[],
  sessions: readonly Played[],
): Map<string, number> {
  const latest = new Map<string, number>()
  for (const { tune_id: tuneId, started_at: startedAt } of [...plays, ...sessions]) {
    if (!tuneId) continue
    const at = Date.parse(startedAt)
    if (at > (latest.get(tuneId) ?? -Infinity)) latest.set(tuneId, at)
  }
  return latest
}

export const CATALOG_SORT_LABELS: Record<CatalogSort, string> = {
  title: 'Title',
  added: 'Date added',
  modified: 'Date modified',
  played: 'Last played',
}

export const CATALOG_SORT_OPTIONS: SortOptions<CatalogSort> = {
  sorts: CATALOG_SORTS,
  labels: CATALOG_SORT_LABELS,
  isDate: isCatalogDateSort,
}
