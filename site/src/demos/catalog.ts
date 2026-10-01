// The "Your tunes" demo: a small catalog and the filter the key rail, status control, and
// list row drive. Real old-time tunes with their usual keys and tunings.

export type Status = 'known' | 'learning' | 'unknown'
export type Key = 'C' | 'G' | 'D' | 'A' | 'E' | 'B' | 'Bb' | 'F'

export interface Tune {
  name: string
  key: Key
  tuning: string
  type: string
  status: Status
}

// Like the app, the rail offers only keys the catalog holds.
export const RAIL: readonly Key[] = ['C', 'G', 'D', 'A']

export const STATUS_LABELS: Record<Status, string> = {
  known: 'Known',
  learning: 'Learning',
  unknown: 'Want to learn',
}

export const TUNES: readonly Tune[] = [
  { name: 'Cluck Old Hen', key: 'A', tuning: 'AEAE', type: 'Reel', status: 'known' },
  { name: 'Bibb County Hoedown', key: 'A', tuning: 'AEAE', type: 'Reel', status: 'learning' },
  { name: 'Sally Goodin', key: 'A', tuning: 'AEAE', type: 'Breakdown', status: 'known' },
  { name: 'Breaking Up Christmas', key: 'A', tuning: 'AEAE', type: 'Reel', status: 'learning' },
  { name: 'Red Haired Boy', key: 'A', tuning: 'GDAE', type: 'Hornpipe', status: 'unknown' },
  { name: "Soldier's Joy", key: 'D', tuning: 'GDAE', type: 'Reel', status: 'known' },
  { name: 'Forked Deer', key: 'D', tuning: 'GDAE', type: 'Reel', status: 'known' },
  { name: "Bonaparte's Retreat", key: 'D', tuning: 'DDAD', type: 'Air', status: 'unknown' },
  { name: 'Midnight on the Water', key: 'D', tuning: 'DDAD', type: 'Waltz', status: 'learning' },
  { name: 'Sandy River Belle', key: 'G', tuning: 'GDAE', type: 'Reel', status: 'known' },
  { name: 'Ashokan Farewell', key: 'D', tuning: 'GDAE', type: 'Waltz', status: 'unknown' },
  { name: 'Billy in the Lowground', key: 'C', tuning: 'GDAE', type: 'Reel', status: 'known' },
  { name: 'Old Joe Clark', key: 'A', tuning: 'AEAE', type: 'Reel', status: 'known' },
  { name: 'Turkey in the Straw', key: 'G', tuning: 'GDAE', type: 'Reel', status: 'known' },
  { name: 'Eighth of January', key: 'D', tuning: 'GDAE', type: 'Reel', status: 'learning' },
  { name: 'Tennessee Wagoner', key: 'C', tuning: 'GDAE', type: 'Reel', status: 'learning' },
  { name: 'Leather Britches', key: 'G', tuning: 'GDAE', type: 'Reel', status: 'learning' },
  { name: 'Lost Indian', key: 'A', tuning: 'AEAE', type: 'Reel', status: 'unknown' },
  { name: 'Seneca Square Dance', key: 'G', tuning: 'GDAE', type: 'Reel', status: 'unknown' },
  { name: 'Shenandoah Falls', key: 'C', tuning: 'GDAE', type: 'Reel', status: 'unknown' },
  { name: 'Whiskey Before Breakfast', key: 'D', tuning: 'GDAE', type: 'Reel', status: 'known' },
]

export interface TuneList {
  name: string
  tunes: readonly string[]
}

export const LISTS: readonly TuneList[] = [
  {
    name: 'Saturday session',
    tunes: ["Soldier's Joy", 'Cluck Old Hen', 'Sally Goodin', 'Forked Deer', 'Sandy River Belle'],
  },
  {
    name: 'Band sets',
    tunes: ['Bibb County Hoedown', 'Breaking Up Christmas', 'Cluck Old Hen', 'Sandy River Belle'],
  },
  {
    name: 'Learn by spring',
    tunes: ['Red Haired Boy', "Bonaparte's Retreat", 'Midnight on the Water'],
  },
  { name: 'Waltzes', tunes: ['Midnight on the Water', 'Ashokan Farewell'] },
]

export interface CatalogState {
  key: Key | null
  status: Status | null
  list: string | null
}

export const NO_FILTER: CatalogState = { key: null, status: null, list: null }

/** The tunes the state shows, in display order: a list's own order, else the catalog's. */
export function filterTunes(state: CatalogState): Tune[] {
  if (state.list) {
    const list = LISTS.find((l) => l.name === state.list)
    if (!list) return []
    return list.tunes.flatMap((name) => TUNES.filter((t) => t.name === name))
  }
  return TUNES.filter(
    (t) => (!state.key || t.key === state.key) && (!state.status || t.status === state.status),
  )
}

export const MAX_ROWS = 7
export const moreLabel = (hidden: number) => `${hidden} more…`
export const EMPTY_TITLE = 'No tunes match these filters.'
export const SHOW_ALL = 'Show all tunes'

/** The rows the list draws, at most MAX_ROWS, and how many matching tunes it leaves out. */
export function visibleTunes(state: CatalogState): { shown: Tune[]; more: number } {
  const tunes = filterTunes(state)
  return { shown: tunes.slice(0, MAX_ROWS), more: Math.max(0, tunes.length - MAX_ROWS) }
}

/** Choosing a list clears key and status; choosing either clears the list. */
export function choose(state: CatalogState, change: Partial<CatalogState>): CatalogState {
  if ('list' in change) return { ...NO_FILTER, list: change.list ?? null }
  return { ...state, ...change, list: null }
}

const keyName = (key: Key) => (key === 'Bb' ? 'B♭' : key)
const count = (n: number) => `${n} ${n === 1 ? 'tune' : 'tunes'}`

const STATUS_PHRASES: Record<Status, string> = {
  known: 'you know',
  learning: "you're learning",
  unknown: 'you want to learn',
}

export function catalogCaption(state: CatalogState): string {
  const tunes = filterTunes(state)
  if (state.list) return `${state.list}: ${count(tunes.length)}, in the order you play them.`
  if (!state.key && !state.status) {
    return 'Tap a key, a status, or a list.'
  }
  const where = state.key ? ` in ${keyName(state.key)}` : ''
  if (tunes.length === 0) return `No tunes${where} yet.`
  const status = state.status ? ` ${STATUS_PHRASES[state.status]}` : ''
  const crossTuned = !state.status && new Set(tunes.map((t) => t.tuning)).size > 1
  return `${count(tunes.length)}${where}${status}${crossTuned ? ', cross-tuned ones included' : ''}.`
}

/** The caption before any choice, and the only one a visitor without JavaScript sees. */
export const CATALOG_REST = `${TUNES.length} tunes, each with its key, tuning, and status.`
