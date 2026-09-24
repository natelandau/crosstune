import type { TimeSignature } from '../../api/vocabulary'
import { GENRE_TYPES, TUNE_TYPES, TYPE_TIME_SIGNATURES } from '../../constants'
import type { CatalogEntry } from '../catalog/filters'

/** The composer a player writes for a tune with no known author. */
export const TRAD = 'Trad.'

const collator = new Intl.Collator(undefined, { sensitivity: 'base' })
const same = (a: string, b: string) => collator.compare(a, b) === 0

function lookup<T>(table: Record<string, T>, key: string): T | undefined {
  const found = Object.keys(table).find((name) => same(name, key))
  return found === undefined ? undefined : table[found]
}

/** Each value once, spelled with its most capitalized variant, with how many live tunes hold it. */
function tally(values: readonly (string | null | undefined)[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const raw of values) {
    const value = raw?.trim()
    if (!value) continue
    const existing = [...counts.keys()].find((key) => same(key, value))
    if (existing === undefined) {
      counts.set(value, 1)
      continue
    }
    const count = counts.get(existing)! + 1
    // A capital letter sorts before its lowercase form, so this keeps the tidier spelling
    // as the display form regardless of which variant the catalog happened to see first.
    const spelling = value < existing ? value : existing
    if (spelling !== existing) counts.delete(existing)
    counts.set(spelling, count)
  }
  return counts
}

const live = (entries: readonly CatalogEntry[]) => entries.filter((e) => !e.tune.deleted_at)

function mostFirst(counts: Map<string, number>): string[] {
  return [...counts.entries()]
    .sort(([a, x], [b, y]) => y - x || collator.compare(a, b))
    .map(([value]) => value)
}

function without(values: readonly string[], taken: readonly string[]): string[] {
  return values.filter((value) => !taken.some((t) => same(t, value)))
}

/** Type suggestions for a tune: its genre's types, else the catalog's by use, then the rest. */
export function orderedTypes(genre: string, entries: readonly CatalogEntry[]): string[] {
  const first = [...(lookup(GENRE_TYPES, genre.trim()) ?? [])]
  const lead =
    first.length > 0 ? first : mostFirst(tally(live(entries).map((e) => e.tune.tune_type)))
  const rest = without(TUNE_TYPES, lead).sort(collator.compare)
  return [...lead, ...rest]
}

/** The genre most live tunes hold, ties broken alphabetically, or null when none has one. */
export function mostUsedGenre(entries: readonly CatalogEntry[]): string | null {
  return mostFirst(tally(live(entries).map((e) => e.tune.genre)))[0] ?? null
}

/** Composer suggestions: Trad. first, then every composer the catalog holds, alphabetically. */
export function catalogComposers(entries: readonly CatalogEntry[]): string[] {
  const named = [...tally(live(entries).map((e) => e.tune.composer)).keys()]
  return [TRAD, ...without(named, [TRAD]).sort(collator.compare)]
}

/** The one time signature a type is written in, or null when it has none or several. */
export function timeSignatureFor(type: string): TimeSignature | null {
  return lookup(TYPE_TIME_SIGNATURES, type.trim()) ?? null
}
