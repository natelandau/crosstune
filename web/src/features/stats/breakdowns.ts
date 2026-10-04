import { MODES } from '../../api/vocabulary'
import { foldText, sameText } from '../../text/fold'
import { tuningsMap } from '../settings/instruments'
import type {
  Breakdowns,
  KeyRow,
  Rarity,
  RarityAttribute,
  StatsTune,
  StatsUserTune,
  Value,
} from './types'

export interface Entry {
  tune: StatsTune
  userTune: StatsUserTune
}

const MAX_RARITIES = 3
const MIN_DISTINCT_FOR_RARITY = 3

/** Code point order, never a locale collator, so the Swift module orders the same. */
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function present(value: string | null | undefined): value is string {
  return value !== null && value !== undefined && value !== ''
}

function byCount(a: { count: number }, b: { count: number }): number {
  return b.count - a.count
}

function byCountThenValue(a: Value, b: Value): number {
  return byCount(a, b) || compareText(a.value, b.value)
}

/** The trimmed spelling, or null for a value the fold calls blank. */
function heldSpelling(value: string | null | undefined): string | null {
  const spelling = value?.trim()
  return present(spelling) && foldText(spelling) !== '' ? spelling : null
}

interface Group<T> {
  /** The spelling most members hold, ties to the first in code point order. */
  shown: string
  members: T[]
}

/**
 * Items grouped the way the catalog filter matches their trimmed spelling, so tapping a group's
 * shown spelling opens exactly its members. A blank spelling joins no group.
 */
function groupByFold<T>(
  items: readonly T[],
  spellingOf: (item: T) => string | null | undefined,
): Group<T>[] {
  const groups = new Map<string, { spellings: Map<string, number>; members: T[] }>()
  for (const item of items) {
    const spelling = heldSpelling(spellingOf(item))
    if (spelling === null) continue
    const key = foldText(spelling)
    const group = groups.get(key) ?? { spellings: new Map<string, number>(), members: [] }
    groups.set(key, group)
    group.spellings.set(spelling, (group.spellings.get(spelling) ?? 0) + 1)
    group.members.push(item)
  }
  return [...groups.values()].map(({ spellings, members }) => {
    const [shown] = [...spellings]
      .map(([value, count]) => ({ value, count }))
      .sort(byCountThenValue)
    return { shown: shown!.value, members }
  })
}

function tally(values: readonly (string | null | undefined)[]): Value[] {
  return groupByFold(values, (value) => value)
    .map(({ shown, members }) => ({ value: shown, count: members.length }))
    .sort(byCountThenValue)
}

export function tuningOf(tune: StatsTune, instrument: string): string | null {
  const entry = tuningsMap(tune.tunings)[instrument]
  if (typeof entry !== 'object' || entry === null) return null
  const tuning = (entry as { tuning?: unknown }).tuning
  return typeof tuning === 'string' && tuning !== '' ? tuning : null
}

/** Adds `value` to the list `map` holds for `key`, starting one when there is none. */
export function appendTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

/**
 * Each mode a tune holds in any part, once, so a key and mode cell counts the tunes the catalog's
 * mode filter shows for it.
 */
function heldModes(tune: StatsTune): string[] {
  const seen = new Set<string>()
  return tune.modes.filter((mode) => {
    const key = foldText(mode)
    if (key === '' || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function keyRows(tunes: readonly StatsTune[]): KeyRow[] {
  // One spelling per mode across every key, so each mode is one column of the grid, and a known
  // mode keeps the vocabulary's spelling so it sorts and abbreviates with the others.
  const modeNames = new Map(
    groupByFold(tunes.flatMap(heldModes), (mode) => mode).map(({ shown }) => [
      foldText(shown),
      MODES.find((mode) => sameText(mode, shown)) ?? shown,
    ]),
  )
  return groupByFold(tunes, (tune) => tune.key)
    .map(({ shown, members }) => ({
      key: shown,
      count: members.length,
      modes: tally(members.flatMap(heldModes).map((mode) => modeNames.get(foldText(mode))!)),
    }))
    .sort((a, b) => byCount(a, b) || compareText(a.key, b.key))
}

/** Every block lists only values a non-archived tune holds, so an unused block is empty. */
export function breakdowns(entries: readonly Entry[], instruments: readonly string[]): Breakdowns {
  const tunes = entries.map((entry) => entry.tune)
  return {
    key: keyRows(tunes),
    tune_type: tally(tunes.map((tune) => tune.tune_type)),
    genre: tally(tunes.map((tune) => tune.genre)),
    time_signature: tally(tunes.map((tune) => tune.time_signature)),
    learned_from: tally(entries.map((entry) => entry.userTune.learned_from)),
    tunings: instruments
      .map((instrument) => ({
        instrument,
        values: tally(tunes.map((tune) => tuningOf(tune, instrument))),
      }))
      .filter((row) => row.values.length > 0),
  }
}

interface Candidate {
  rarity: Rarity
  title: string
  /** The instrument's place in the musician's list; 0 for every attribute but tuning. */
  instrument: number
}

/**
 * The values exactly one tune holds, when the tunes hold at least three distinct values. Values
 * the catalog filter calls the same count as one.
 */
function onlyHolders(
  tunes: readonly StatsTune[],
  valueOf: (tune: StatsTune) => string | null | undefined,
): { value: string; tune: StatsTune }[] {
  const groups = groupByFold(tunes, valueOf)
  if (groups.length < MIN_DISTINCT_FOR_RARITY) return []
  return groups
    .filter(({ members }) => members.length === 1)
    .map(({ shown, members }) => ({ value: shown, tune: members[0]! }))
}

const ATTRIBUTES: {
  attribute: Exclude<RarityAttribute, 'tuning'>
  valueOf: (tune: StatsTune) => string | null | undefined
}[] = [
  {
    attribute: 'key_mode',
    valueOf: (tune) => {
      const key = heldSpelling(tune.key)
      const mode = heldSpelling(tune.modes[0])
      return key !== null && mode !== null ? `${key} ${mode}` : null
    },
  },
  { attribute: 'time_signature', valueOf: (tune) => tune.time_signature },
  { attribute: 'tune_type', valueOf: (tune) => tune.tune_type },
  { attribute: 'genre', valueOf: (tune) => tune.genre },
]

const ATTRIBUTE_ORDER: readonly RarityAttribute[] = [
  'key_mode',
  'time_signature',
  'tuning',
  'tune_type',
  'genre',
]

/** At most three, in attribute order and then by title, so a catalog always shows the same ones. */
export function rarities(entries: readonly Entry[], instruments: readonly string[]): Rarity[] {
  const tunes = entries.map((entry) => entry.tune)
  const candidates: Candidate[] = []
  for (const { attribute, valueOf } of ATTRIBUTES) {
    for (const { value, tune } of onlyHolders(tunes, valueOf)) {
      candidates.push({
        rarity: { attribute, value, tune_id: tune.id },
        title: tune.title,
        instrument: 0,
      })
    }
  }
  instruments.forEach((instrument, index) => {
    for (const { value, tune } of onlyHolders(tunes, (t) => tuningOf(t, instrument))) {
      candidates.push({
        rarity: { attribute: 'tuning', value, instrument, tune_id: tune.id },
        title: tune.title,
        instrument: index,
      })
    }
  })
  const attributeIndex = (candidate: Candidate) =>
    ATTRIBUTE_ORDER.indexOf(candidate.rarity.attribute)
  return candidates
    .sort(
      (a, b) =>
        attributeIndex(a) - attributeIndex(b) ||
        compareText(a.title, b.title) ||
        a.instrument - b.instrument ||
        compareText(a.rarity.tune_id, b.rarity.tune_id),
    )
    .slice(0, MAX_RARITIES)
    .map((candidate) => candidate.rarity)
}
