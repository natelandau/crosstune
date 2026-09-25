import { INSTRUMENTS, type Instrument } from '../../api/vocabulary'
import { CAPO_INSTRUMENTS, INSTRUMENT_LABELS, STANDARD_TUNINGS } from '../../constants'
import { isInstrument, storedInstruments, type LocalUserSettings } from '../../db/types'

/** The footer under the instruments setting, wherever it is asked. */
export const INSTRUMENTS_HELP = 'Tunes show a tuning for each instrument chosen here.'

export function instrumentsFrom(
  row: LocalUserSettings | null | undefined,
): ReadonlySet<Instrument> {
  const stored = storedInstruments(row)
  return new Set((stored ?? []).filter(isInstrument))
}

/** One instrument's entry in a tune's tunings. A field is present only when it is set. */
export interface TuningEntry {
  tuning?: string
  capo?: number
}

/**
 * A tune's tunings. A key can name an instrument this client does not know yet, and a value
 * can take a shape it does not know, so entries are read through `tuningEntry`.
 */
export type TuningsMap = Record<string, unknown>

/** A filter or bulk edit field that reads one instrument's tuning out of the map. */
export type TuningKey = `tuning:${Instrument}`

export const tuningKey = (instrument: Instrument): TuningKey => `tuning:${instrument}`

export const TUNING_KEYS: readonly TuningKey[] = INSTRUMENTS.map(tuningKey)

const KEY_INSTRUMENTS = new Map<string, Instrument>(
  INSTRUMENTS.map((instrument) => [tuningKey(instrument), instrument]),
)

export function isTuningKey(key: string): key is TuningKey {
  return KEY_INSTRUMENTS.has(key)
}

export function tuningKeyInstrument(key: string): Instrument | undefined {
  return KEY_INSTRUMENTS.get(key)
}

function hasEveryTuningKey<T>(
  record: Partial<Record<TuningKey, T>>,
): record is Record<TuningKey, T> {
  return TUNING_KEYS.every((key) => key in record)
}

/** One value per tuning key, typed as a complete record. */
export function byTuningKey<T>(value: (instrument: Instrument) => T): Record<TuningKey, T> {
  const record: Partial<Record<TuningKey, T>> = {}
  for (const instrument of INSTRUMENTS) record[tuningKey(instrument)] = value(instrument)
  if (!hasEveryTuningKey(record)) throw new Error('A tuning key is missing its value')
  return record
}

export const tuningLabel = (instrument: Instrument) => `${INSTRUMENT_LABELS[instrument]} tuning`

export const capoLabel = (instrument: Instrument) => `${INSTRUMENT_LABELS[instrument]} capo`

/** The capo picker's empty choice. */
export const NO_CAPO = 'None'

/** Whether a display helper should prefix its text with the instrument's label. */
interface DisplayOptions {
  withInstrument?: boolean
}

// A pulled row can come from a server newer than this client, so the map is read defensively
// and written back with every key it arrived with.
export function tuningsMap(tunings: unknown): TuningsMap {
  return isRecord(tunings) ? { ...tunings } : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function tuningEntry(
  tunings: unknown,
  instrument: Instrument,
): { tuning: string | null; capo: number | null } {
  const entry = tuningsMap(tunings)[instrument]
  if (!isRecord(entry)) return { tuning: null, capo: null }
  const { tuning, capo } = entry
  return {
    tuning: typeof tuning === 'string' ? tuning : null,
    capo: typeof capo === 'number' ? capo : null,
  }
}

/** The map with one instrument's entry changed and every other key kept. Never mutates. */
export function setTuning(
  tunings: unknown,
  instrument: Instrument,
  patch: { tuning?: string | null; capo?: number | null },
): TuningsMap {
  const current = tuningEntry(tunings, instrument)
  const tuning = patch.tuning === undefined ? current.tuning : patch.tuning
  const capo = patch.capo === undefined ? current.capo : patch.capo
  // Written the way the API stores it: no null fields, and no capo key at all on an instrument
  // without one, which InstrumentTuning refuses whatever its value.
  const entry: TuningEntry = {}
  if (tuning !== null) entry.tuning = tuning
  if (capo !== null && CAPO_INSTRUMENTS[instrument]) entry.capo = capo
  const next = tuningsMap(tunings)
  if (Object.keys(entry).length === 0) delete next[instrument]
  else next[instrument] = entry
  return next
}

/** Instruments to show a tuning for: every played one, plus any the tune already holds. */
export function tuningInstruments(
  instruments: ReadonlySet<Instrument>,
  tune: { tunings?: unknown } | null,
): Instrument[] {
  return INSTRUMENTS.filter((instrument) => {
    if (instruments.has(instrument)) return true
    const { tuning, capo } = tuningEntry(tune?.tunings, instrument)
    return tuning !== null || capo !== null
  })
}

/** A tuning's text prefixed with its instrument's label, as `Mandolin: GDAE`. */
export function withInstrumentLabel(instrument: Instrument, text: string): string {
  return `${INSTRUMENT_LABELS[instrument]}: ${text}`
}

/**
 * One tuning's text: the tuning, its capo, or both. `options.withInstrument` prefixes the
 * instrument's label from `INSTRUMENT_LABELS`.
 */
export function tuningDisplay(
  instrument: Instrument,
  tunings: unknown,
  options?: DisplayOptions,
): string | null {
  const { tuning, capo } = tuningEntry(tunings, instrument)
  const text = capo === null ? tuning : tuning === null ? `Capo ${capo}` : `${tuning}, capo ${capo}`
  if (text === null) return null
  return options?.withInstrument ? withInstrumentLabel(instrument, text) : text
}

/**
 * One tuning's text as `tuningDisplay` gives it, or null for the instrument's standard tuning
 * with no capo. `options.withInstrument` prefixes the instrument's label from `INSTRUMENT_LABELS`.
 */
export function tuningSummary(
  instrument: Instrument,
  tunings: unknown,
  options?: DisplayOptions,
): string | null {
  const { tuning, capo } = tuningEntry(tunings, instrument)
  if (capo === null && tuning !== null && tuning === STANDARD_TUNINGS[instrument]) return null
  return tuningDisplay(instrument, tunings, options)
}
