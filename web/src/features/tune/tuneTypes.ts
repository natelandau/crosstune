import type { TimeSignature } from '../../api/vocabulary'
import { GENRES, GENRE_TYPES, TUNE_TYPES, TYPE_TIME_SIGNATURES } from '../../constants'
import type { CatalogEntry } from '../catalog/filters'

/** The composer a player writes for a tune with no known author. */
export const TRAD = 'Trad.'

const collator = new Intl.Collator(undefined, { sensitivity: 'base' })
const same = (a: string, b: string) => collator.compare(a, b) === 0

function lookup<T>(table: Record<string, T>, key: string): T | undefined {
  const found = Object.keys(table).find((name) => same(name, key))
  return found === undefined ? undefined : table[found]
}

interface Spellings {
  firstSeen: string
  total: number
  /** Each raw spelling with its count, in the order first seen. */
  counts: Map<string, number>
}

function display(group: Spellings, canonical: readonly string[]): string {
  const known = canonical.find((name) => same(name, group.firstSeen))
  if (known !== undefined) return known
  let best = group.firstSeen
  let bestCount = 0
  for (const [spelling, count] of group.counts) {
    if (count > bestCount) {
      best = spelling
      bestCount = count
    }
  }
  return best
}

/**
 * Each value once, with how many live tunes hold it. A value that matches a canonical entry is
 * shown the canonical way; any other is shown the way most tunes spell it, ties to the first seen.
 */
function tally(
  values: readonly (string | null | undefined)[],
  canonical: readonly string[] = [],
): Map<string, number> {
  const groups: Spellings[] = []
  for (const raw of values) {
    const value = raw?.trim()
    if (!value) continue
    let group = groups.find((g) => same(g.firstSeen, value))
    if (group === undefined) {
      group = { firstSeen: value, total: 0, counts: new Map() }
      groups.push(group)
    }
    group.total += 1
    group.counts.set(value, (group.counts.get(value) ?? 0) + 1)
  }
  return new Map(groups.map((group) => [display(group, canonical), group.total]))
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
    first.length > 0
      ? first
      : mostFirst(
          tally(
            live(entries).map((e) => e.tune.tune_type),
            TUNE_TYPES,
          ),
        )
  const rest = without(TUNE_TYPES, lead).sort(collator.compare)
  return [...lead, ...rest]
}

/** The genre most live tunes hold, ties broken alphabetically, or null when none has one. */
export function mostUsedGenre(entries: readonly CatalogEntry[]): string | null {
  return (
    mostFirst(
      tally(
        live(entries).map((e) => e.tune.genre),
        GENRES,
      ),
    )[0] ?? null
  )
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
