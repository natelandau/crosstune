import type { Instrument } from '../../api/vocabulary'
import { STATUS_LABELS } from '../../constants'
import {
  isTuningKey,
  tuningDisplay,
  tuningInstruments,
  tuningKey,
  tuningLabel,
  type TuningKey,
} from '../../domain/instruments'
import { KEY } from '../../ui/keyName'
import { DETAIL_LABELS } from './detailFields'
import { isMode } from './keyMode'
import { STATUS_HEADER } from './tuneFormCopy'
import type { TuneView } from './useTune'

export type FactId =
  | 'status'
  | 'key'
  | TuningKey
  | 'tune_type'
  | 'time_signature'
  | 'part_structure'
  | 'is_crooked'
  | 'genre'
  | 'composer'
  | 'alternate_titles'
  | 'learned_from'
  | 'learned_on'

export interface FactRow {
  id: FactId
  label: string
  /** Null when the tune holds no value, so the row can offer to add one. */
  text: string | null
  /** The rail's group the row sits under. */
  group: 'details' | 'about' | 'learned'
}

const LEARNED_ON_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

/** A stored YYYY-MM-DD read as a local calendar date, so no timezone moves it a day. */
export function formatLearnedOn(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return value
  const [, year, month, day] = match
  return LEARNED_ON_FORMAT.format(new Date(Number(year), Number(month) - 1, Number(day)))
}

// A tune holds at most four modes: the tune's own, then one each for parts B to D.
const PART_LETTERS = 'ABCD'

/** A mode worth showing: a real one, and not `other`, which says nothing. */
export const namedMode = (mode: string | undefined): mode is string =>
  isMode(mode) && mode !== 'other'

/**
 * The key with each part's mode: the first mode is the tune's, later ones name their part.
 * A mode `namedMode` refuses is left out.
 */
function keyText(key: string | null | undefined, modes: readonly string[]): string | null {
  if (!key) return null
  const [first, ...rest] = modes
  return [
    namedMode(first) ? `${key} ${first}` : key,
    ...rest.flatMap((mode, index) =>
      namedMode(mode) ? [`${PART_LETTERS.charAt(index + 1)} part ${mode}`] : [],
    ),
  ].join(', ')
}

/** An unrecognized status reads as Unknown, as the status glyph does. */
const statusText = (status: string) =>
  Object.hasOwn(STATUS_LABELS, status)
    ? STATUS_LABELS[status as keyof typeof STATUS_LABELS]
    : STATUS_LABELS.want_to_learn

const orNull = (value: string | null | undefined) => value || null

export function factRows(view: TuneView, instruments: ReadonlySet<Instrument>): FactRow[] {
  const { tune, userTune } = view
  const row = (
    id: FactId,
    label: string,
    text: string | null,
    group: FactRow['group'] = 'details',
  ): FactRow => ({ id, label, text, group })
  return [
    row('status', STATUS_HEADER, statusText(userTune.status)),
    row('key', KEY, keyText(tune.key, tune.modes)),
    ...tuningInstruments(instruments, tune).map((instrument) =>
      row(tuningKey(instrument), tuningLabel(instrument), tuningDisplay(instrument, tune.tunings)),
    ),
    row('tune_type', DETAIL_LABELS.tune_type, orNull(tune.tune_type)),
    row('time_signature', DETAIL_LABELS.time_signature, orNull(tune.time_signature)),
    row('part_structure', DETAIL_LABELS.part_structure, orNull(tune.part_structure)),
    ...(tune.is_crooked
      ? [row('is_crooked', DETAIL_LABELS.is_crooked, DETAIL_LABELS.is_crooked)]
      : []),
    row('genre', DETAIL_LABELS.genre, orNull(tune.genre), 'about'),
    row('composer', DETAIL_LABELS.composer, orNull(tune.composer), 'about'),
    row(
      'alternate_titles',
      DETAIL_LABELS.alternate_titles,
      tune.alternate_titles.length > 0 ? tune.alternate_titles.join(', ') : null,
      'about',
    ),
    row('learned_from', DETAIL_LABELS.learned_from, orNull(userTune.learned_from), 'learned'),
    row(
      'learned_on',
      DETAIL_LABELS.learned_on,
      userTune.learned_on ? formatLearnedOn(userTune.learned_on) : null,
      'learned',
    ),
  ]
}

const CARD_IDS = new Set<FactId>(['status', 'key', 'tune_type'])

/**
 * The rows a narrow card shows up front: status, key, tunings, and type with its parts folded
 * in. Everything else waits behind "more", the parts row too, so it stays editable.
 */
export function cardRows(rows: FactRow[]): { shown: FactRow[]; more: FactRow[] } {
  const parts = rows.find((r) => r.id === 'part_structure')?.text ?? null
  const shown: FactRow[] = []
  const more: FactRow[] = []
  for (const r of rows) {
    if (r.id === 'tune_type') {
      shown.push({ ...r, text: [r.text, parts].filter(Boolean).join(' · ') || null })
    } else if (CARD_IDS.has(r.id) || isTuningKey(r.id)) shown.push(r)
    else more.push(r)
  }
  return { shown, more }
}
